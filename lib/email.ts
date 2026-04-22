import { Resend } from 'resend'

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
  offreTitle,
  candidateName,
  candidateEmail,
  score,
  seuil,
  justification,
  cvBuffer,
  cvFilename,
}: {
  to: string
  offreTitle: string
  candidateName: string
  candidateEmail: string
  score: number
  seuil: number
  justification: string
  cvBuffer: Buffer
  cvFilename: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY manquant' }
  }

  const resend = new Resend(apiKey)
  const from = process.env.RESEND_FROM ?? 'RecrutAI <onboarding@resend.dev>'

  const subject = `${offreTitle} - nouveau CV qualifié`

  const displayName = candidateName?.trim() || 'Un nouveau candidat'
  const hasRealEmail =
    !!candidateEmail &&
    !candidateEmail.endsWith('@example.com')

  const justificationHtml = escapeHtml(justification).replace(/\n/g, '<br />')

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
