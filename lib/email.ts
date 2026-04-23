import { Resend } from 'resend'
import type { createClient } from '@/lib/supabase/server'
import { isValidEmail } from '@/lib/format'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Résultat de `sendQualifiedCandidateEmail`. Extrait en type pour pouvoir
 * le passer tel quel à `persistEmailResult` sans re-déballer les champs.
 */
export type EmailSendResult = { ok: true } | { ok: false; error: string }

/**
 * Persiste l'état courant du dernier envoi d'email pour une candidature.
 *
 * À appeler systématiquement juste après chaque `sendQualifiedCandidateEmail`.
 * Les deux colonnes `email_sent_at` / `email_error` reflètent toujours l'ÉTAT
 * COURANT (dernière tentative uniquement), pas l'historique :
 *   - succès → sent_at = now(), error = NULL
 *   - échec  → sent_at = NULL,  error = message
 * Cela simplifie la logique UI : « statut = qualifié ET email_error != NULL »
 * ⇒ afficher badge d'alerte + bouton « Renvoyer ».
 *
 * Si l'UPDATE lui-même échoue (cas rarissime — Supabase down, RLS cassée),
 * on se contente de logguer : on ne veut surtout pas masquer le vrai
 * résultat de l'envoi à l'appelant (qui doit continuer à retourner ok=true
 * si l'email est bien parti).
 */
export async function persistEmailResult(
  supabase: SupabaseServerClient,
  candidatureId: string,
  result: EmailSendResult
): Promise<void> {
  const payload = result.ok
    ? { email_sent_at: new Date().toISOString(), email_error: null }
    : { email_sent_at: null, email_error: result.error }
  const { error } = await supabase
    .from('candidatures')
    .update(payload)
    .eq('id', candidatureId)
  if (error) {
    console.warn(
      `[persistEmailResult] UPDATE échoué pour ${candidatureId} : ${error.message}`
    )
  }
}

/**
 * Envoie une notification email quand un CV est qualifié par l'IA.
 *
 * En mode test, l'adresse destinataire est forcée via l'env
 * NOTIFICATION_EMAIL_OVERRIDE (ex : n.magne@agoriade.fr).
 * En production, on utilisera l'email du client de l'offre.
 *
 * From : "RecrutAI <onboarding@resend.dev>" par défaut. L'adresse technique
 * reste celle de Resend (seule `onboarding@resend.dev` est autorisée en
 * mode test), mais le display name RecrutAI s'affiche dans les boîtes mail
 * à la place de "onboarding". À remplacer par un domaine vérifié via
 * RESEND_FROM (ex : "RecrutAI <contact@agoriade.fr>") une fois la DNS prête.
 */
export async function sendQualifiedCandidateEmail({
  to,
  offreReference,
  offreTitle,
  candidateName,
  candidateEmail,
  score,
  seuil,
  justification,
  pointsForts,
  pointsFaibles,
  cvBuffer,
  cvFilename,
}: {
  to: string
  /** Référence client (ex : "TECH-2026-018"). null si l'offre n'en a pas :
   *  dans ce cas, le sujet n'inclut pas le préfixe `[…]`. */
  offreReference: string | null
  offreTitle: string
  candidateName: string
  /** Email candidat. Nullable depuis que la colonne est optionnelle —
   *  si vide, la ligne « Email » est simplement masquée dans le mail. */
  candidateEmail: string | null
  score: number
  seuil: number
  justification: string
  /** Top forces IA (colonne `points_forts`). `null` = scoring pré-refactor
   *  ou en erreur → on tombe sur la justification brute. `[]` = IA OK mais
   *  rien de saillant → section simplement omise. */
  pointsForts: string[] | null
  pointsFaibles: string[] | null
  cvBuffer: Buffer
  cvFilename: string
}): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY manquant' }
  }

  // Filet central : on refuse l'envoi si l'adresse destinataire n'a pas la
  // forme minimale attendue (local@domaine.tld). Ça protège contre des
  // données legacy stockées AVANT qu'on ait mis en place la validation
  // côté formulaire, et contre les adresses saisies via un POST direct qui
  // aurait contourné la validation — sans ça, Resend peut accepter ou
  // rebond discret, et on ne saurait jamais.
  if (!isValidEmail(to)) {
    return {
      ok: false,
      error: `Adresse de notification invalide (${to}) — vérifie le contact_email du client (attendu : prenom.nom@domaine.fr).`,
    }
  }

  const resend = new Resend(apiKey)
  const from = process.env.RESEND_FROM ?? 'RecrutAI <onboarding@resend.dev>'

  const subject = offreReference
    ? `[${offreReference}] ${offreTitle} - nouveau CV qualifié`
    : `${offreTitle} - nouveau CV qualifié`

  const displayName = candidateName?.trim() || 'Un nouveau candidat'
  const hasRealEmail =
    !!candidateEmail &&
    !candidateEmail.endsWith('@example.com')

  const justificationHtml = escapeHtml(justification).replace(/\n/g, '<br />')

  // Prépare les listes forts/faibles pour l'email. On en affiche jusqu'à 3
  // max côté mail (cohérent avec l'UI compacte côté listings) — au-delà,
  // l'info est dans le PDF / la justification complète. On caste `null`
  // (pas de données structurées) en `[]` pour ne rien afficher sans casser
  // le rendu.
  const fortsForEmail = (pointsForts ?? []).slice(0, 3)
  const faiblesForEmail = (pointsFaibles ?? []).slice(0, 3)

  const renderBullets = (items: string[], dotColor: string) =>
    items
      .map(
        (it) =>
          `<li style="margin-bottom: 4px;"><span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${dotColor}; margin-right: 8px; vertical-align: middle;"></span>${escapeHtml(
            it
          )}</li>`
      )
      .join('')

  const highlightsHtml =
    fortsForEmail.length > 0 || faiblesForEmail.length > 0
      ? `
      <div style="margin-bottom: 24px;">
        ${
          fortsForEmail.length > 0
            ? `<div style="margin-bottom: 16px;">
                <div style="font-weight: 600; color: #10B981; margin-bottom: 8px; text-transform: uppercase; font-size: 12px; letter-spacing: 0.04em;">Points forts</div>
                <ul style="list-style: none; padding: 0; margin: 0; color: #1F2937; font-size: 14px; line-height: 1.5;">${renderBullets(
                  fortsForEmail,
                  '#10B981'
                )}</ul>
              </div>`
            : ''
        }
        ${
          faiblesForEmail.length > 0
            ? `<div>
                <div style="font-weight: 600; color: #EF4444; margin-bottom: 8px; text-transform: uppercase; font-size: 12px; letter-spacing: 0.04em;">Points de vigilance</div>
                <ul style="list-style: none; padding: 0; margin: 0; color: #1F2937; font-size: 14px; line-height: 1.5;">${renderBullets(
                  faiblesForEmail,
                  '#EF4444'
                )}</ul>
              </div>`
            : ''
        }
      </div>`
      : ''

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1F2937;">
      <h2 style="color: #7C3AED; margin-bottom: 24px;">Nouveau CV qualifié</h2>
      <p style="font-size: 16px; margin-bottom: 24px;">
        <strong>${escapeHtml(displayName)}</strong> vient d'atteindre le seuil
        de qualification IA pour l'offre
        <strong>${escapeHtml(offreTitle)}</strong>.
      </p>
      <table style="border-collapse: collapse; width: 100%; margin-bottom: 24px;">
        <tr>
          <td style="padding: 8px 0; color: #6B7280; width: 180px;">Candidat</td>
          <td style="padding: 8px 0; font-weight: 600;">${escapeHtml(displayName)}</td>
        </tr>
        ${
          hasRealEmail
            ? `<tr>
          <td style="padding: 8px 0; color: #6B7280;">Email</td>
          <td style="padding: 8px 0;">
            <a href="mailto:${escapeHtml(candidateEmail)}" style="color: #7C3AED; text-decoration: none;">${escapeHtml(candidateEmail)}</a>
          </td>
        </tr>`
            : ''
        }
        <tr>
          <td style="padding: 8px 0; color: #6B7280;">Score IA</td>
          <td style="padding: 8px 0;">
            <span style="font-size: 20px; font-weight: 700; color: #10B981;">${score}</span>
            <span style="color: #6B7280;"> / 100 (seuil : ${seuil})</span>
          </td>
        </tr>
      </table>
      ${highlightsHtml}
      <div style="background: #F5F3FF; border-left: 4px solid #7C3AED; padding: 16px; border-radius: 4px; margin-bottom: 24px;">
        <div style="font-weight: 600; color: #7C3AED; margin-bottom: 8px;">Analyse IA</div>
        <div style="color: #1F2937; line-height: 1.5;">${justificationHtml}</div>
      </div>
      <p style="color: #6B7280; font-size: 14px;">
        Le CV du candidat est joint à cet email au format PDF.
      </p>
      <hr style="border: 0; border-top: 1px solid #E5E7EB; margin: 32px 0;" />
      <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
        Notification automatique envoyée par RecrutAI.
      </p>
    </div>
  `

  try {
    const { error } = await resend.emails.send({
      from,
      to: [to],
      subject,
      html,
      attachments: [
        {
          filename: cvFilename,
          content: cvBuffer,
        },
      ],
    })
    if (error) {
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (e) {
    const err = e as Error
    return { ok: false, error: err.message }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
