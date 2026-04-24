'use server'

import { getAuthedClient } from '@/lib/auth/require-user'
import { revalidatePath } from 'next/cache'
import {
  persistEmailResult,
  sendQualifiedCandidateEmail,
} from '@/lib/email'
import { effectiveStatut } from '@/lib/format'

/**
 * Relance l'envoi de l'email de qualification au client pour une
 * candidature déjà qualifiée dont le dernier envoi a échoué (Resend KO,
 * contact_email absent lors du 1er envoi, clé API manquante, offre alors
 * clôturée…). Cible le bouton « Renvoyer » affiché à côté du badge
 * ⚠️ « Email non envoyé » dans les tableaux candidatures.
 *
 * Contrat :
 *   - Refuse si la candidature n'est pas « qualifié » (erreur bloquante)
 *   - Refuse si le CV n'est plus dans le storage (erreur bloquante)
 *   - Sinon tente l'envoi, persiste le résultat (succès ou échec) et
 *     renvoie un message humain pour le feedback inline.
 * Les cas « envoi impossible pour cause externe » (offre close, pas de
 * destinataire…) sont persistés aussi — le bouton « Renvoyer » reste
 * disponible pour relancer après correction du contexte.
 */
export type ResendResult =
  | { ok: true; severity: 'success' | 'warning'; message: string }
  | { ok: false; error: string }

type ResendCandRow = {
  id: string
  offre_id: string | null
  nom: string | null
  email: string | null
  score_ia: number | null
  justification_ia: string | null
  points_forts: string[] | null
  points_faibles: string[] | null
  statut: string | null
  cv_path: string | null
  cv_filename: string | null
  email_error: string | null
  offres:
    | {
        id: string
        titre: string
        reference: string | null
        seuil: number
        statut: string
        date_validite: string | null
        clients:
          | { contact_email: string | null }
          | { contact_email: string | null }[]
          | null
      }
    | {
        id: string
        titre: string
        reference: string | null
        seuil: number
        statut: string
        date_validite: string | null
        clients:
          | { contact_email: string | null }
          | { contact_email: string | null }[]
          | null
      }[]
    | null
}

export async function resendQualifiedEmail(
  candidatureId: string
): Promise<ResendResult> {
  if (!candidatureId) return { ok: false, error: 'Candidature introuvable.' }

  const { supabase, user } = await getAuthedClient()
  if (!user) {
    return { ok: false, error: 'Session expirée, reconnecte-toi.' }
  }

  const { data: candRaw, error: candErr } = await supabase
    .from('candidatures')
    .select(
      'id, offre_id, nom, email, score_ia, justification_ia, points_forts, points_faibles, statut, cv_path, cv_filename, email_error, offres(id, titre, reference, seuil, statut, date_validite, clients(contact_email))'
    )
    .eq('id', candidatureId)
    .single()

  if (candErr || !candRaw) {
    return { ok: false, error: 'Candidature introuvable.' }
  }
  const cand = candRaw as ResendCandRow
  const offre = Array.isArray(cand.offres) ? cand.offres[0] : cand.offres

  if (!offre) {
    return { ok: false, error: "Pas d'offre liée — renvoi impossible." }
  }

  // Bloque l'appel si la candidature n'est pas dans un état « destinée à
  // être qualifiée » : soit `qualifié` (cas normal où l'AM relance une
  // notification qui a raté), soit `en attente` avec un `email_error` (cas
  // où la candidature a été rétrogradée par `persistEmailResult` après un
  // premier envoi échoué — voir lib/email.ts). Tout autre état (rejeté,
  // ou `en attente` sans email_error = score sous seuil) ne doit pas
  // recevoir d'email : ça n'aurait pas de sens côté client.
  const isAwaitingRetry =
    cand.statut === 'en attente' && !!cand.email_error
  if (cand.statut !== 'qualifié' && !isAwaitingRetry) {
    return {
      ok: false,
      error:
        'Seules les candidatures qualifiées peuvent recevoir un email de notification.',
    }
  }

  const revalidateAll = () => {
    revalidatePath('/candidatures')
    revalidatePath('/dashboard')
    revalidatePath(`/offres/${offre.id}`)
  }

  // Cas d'impossibilité externe : on persiste l'échec pour garder le badge
  // ⚠️ et la possibilité de retenter plus tard.
  if (effectiveStatut(offre.statut, offre.date_validite) === 'clos') {
    const reason =
      "Offre clôturée (statut manuel ou date de validité dépassée) : réactive l'offre avant de renvoyer."
    await persistEmailResult(supabase, candidatureId, { ok: false, error: reason })
    revalidateAll()
    return { ok: true, severity: 'warning', message: reason }
  }

  const clientInfo = Array.isArray(offre.clients)
    ? offre.clients[0]
    : offre.clients
  const override = process.env.NOTIFICATION_EMAIL_OVERRIDE
  const notifTo = override || clientInfo?.contact_email || null

  if (!notifTo) {
    const reason =
      "Aucune adresse de notification (ajoute contact_email sur le client ou définis NOTIFICATION_EMAIL_OVERRIDE)."
    await persistEmailResult(supabase, candidatureId, { ok: false, error: reason })
    revalidateAll()
    return { ok: true, severity: 'warning', message: reason }
  }
  if (!process.env.RESEND_API_KEY) {
    const reason = 'RESEND_API_KEY non défini côté serveur.'
    await persistEmailResult(supabase, candidatureId, { ok: false, error: reason })
    revalidateAll()
    return { ok: true, severity: 'warning', message: reason }
  }
  if (!cand.cv_path) {
    // Sans cv_path on ne peut pas joindre le PDF. On ne persiste pas —
    // aucune action de l'AM ne pourra corriger ce cas (candidature
    // importée avant l'ajout de cv_path en DB).
    return {
      ok: false,
      error:
        "CV introuvable dans le storage (candidature ancienne sans cv_path) — renvoi impossible.",
    }
  }

  const { data: blob, error: dlErr } = await supabase.storage
    .from('cvs')
    .download(cand.cv_path)
  if (dlErr || !blob) {
    const reason = `Téléchargement CV échoué : ${dlErr?.message ?? 'blob vide'}`
    await persistEmailResult(supabase, candidatureId, { ok: false, error: reason })
    revalidateAll()
    return { ok: true, severity: 'warning', message: reason }
  }
  const cvBuffer = Buffer.from(await blob.arrayBuffer())

  const mailRes = await sendQualifiedCandidateEmail({
    to: notifTo,
    offreReference: offre.reference,
    offreTitle: offre.titre,
    candidateName: cand.nom ?? '',
    candidateEmail: cand.email ?? '',
    score: cand.score_ia ?? 0,
    seuil: offre.seuil,
    justification: cand.justification_ia ?? '',
    pointsForts: cand.points_forts,
    pointsFaibles: cand.points_faibles,
    cvBuffer,
    cvFilename: cand.cv_filename || `CV-${cand.nom ?? 'candidat'}.pdf`,
  })

  await persistEmailResult(supabase, candidatureId, mailRes)
  revalidateAll()

  if (!mailRes.ok) {
    return {
      ok: true,
      severity: 'warning',
      message: `Envoi échoué : ${mailRes.error}`,
    }
  }
  return {
    ok: true,
    severity: 'success',
    message: 'Email renvoyé au client ✉️',
  }
}
