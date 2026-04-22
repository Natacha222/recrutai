'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { scoreCandidate } from '@/lib/scoring'
import { sendQualifiedCandidateEmail } from '@/lib/email'
import { effectiveStatut } from '@/lib/format'

/**
 * Relance le scoring IA sur une candidature existante, sans toucher à ses
 * nom/email (pour ça il faut passer par /candidatures/incompletes qui fait
 * update + rescore). Cible typique : candidatures dont le 1er scoring a
 * planté (justification_ia commence par « Scoring IA indisponible »).
 *
 * Comportement miroir de updateCandidatureInfo :
 *   - Vérifie que l'offre est active (sinon on rescore mais pas d'email)
 *   - Télécharge le CV depuis Storage
 *   - Appelle scoreCandidate
 *   - Sauve score + justification + statut
 *   - Si nouveau statut = qualifié ET offre active → email au client
 *   - Revalide les paths concernés
 *
 * Renvoie un résultat typé avec severity (success / warning) et un
 * message humain pour le feedback inline de TrancherActions.
 */

export type RescoreResult =
  | {
      ok: true
      severity: 'success' | 'warning'
      message: string
      /** Nouveau score IA après rescore — peut servir à l'UI. */
      newScore: number
      /** Nouveau statut IA après rescore. */
      newStatut: string
    }
  | { ok: false; error: string }

type CandRow = {
  id: string
  offre_id: string | null
  nom: string | null
  email: string | null
  cv_path: string | null
  cv_filename: string | null
  offres:
    | {
        id: string
        titre: string
        reference: string | null
        description: string | null
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
        description: string | null
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

export async function rescoreCandidature(
  candidatureId: string
): Promise<RescoreResult> {
  if (!candidatureId) return { ok: false, error: 'Candidature introuvable.' }

  const supabase = await createClient()

  const { data: candRaw, error: candErr } = await supabase
    .from('candidatures')
    .select(
      'id, offre_id, nom, email, cv_path, cv_filename, offres(id, titre, reference, description, seuil, statut, date_validite, clients(contact_email))'
    )
    .eq('id', candidatureId)
    .single()

  if (candErr || !candRaw) {
    return { ok: false, error: 'Candidature introuvable.' }
  }
  const cand = candRaw as CandRow
  const offre = Array.isArray(cand.offres) ? cand.offres[0] : cand.offres

  if (!offre) {
    return { ok: false, error: "Pas d'offre liée — rescoring impossible." }
  }

  if (!cand.cv_path) {
    return {
      ok: false,
      error: 'CV introuvable dans le storage — rescoring impossible.',
    }
  }

  // Télécharge le PDF — réutilisé pour scoring + PJ email.
  const { data: blob, error: dlErr } = await supabase.storage
    .from('cvs')
    .download(cand.cv_path)
  if (dlErr || !blob) {
    return {
      ok: false,
      error: `Téléchargement du CV échoué : ${dlErr?.message ?? 'blob vide'}`,
    }
  }
  const cvBuffer = Buffer.from(await blob.arrayBuffer())

  // Rescore.
  let newScore: number
  let newJustification: string
  let newStatut: string
  try {
    const res = await scoreCandidate({
      cvBuffer,
      jobDescription: offre.description,
      seuil: offre.seuil,
    })
    newScore = res.score
    newJustification = res.justification
    newStatut = res.statut
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(
      `[rescoreCandidature] scoring IA échoué (${candidatureId}) :`,
      msg
    )
    return { ok: false, error: `Scoring IA échoué : ${msg}` }
  }

  const { error: updErr } = await supabase
    .from('candidatures')
    .update({
      score_ia: newScore,
      justification_ia: newJustification,
      statut: newStatut,
    })
    .eq('id', candidatureId)
  if (updErr) {
    return {
      ok: false,
      error: `Sauvegarde du nouveau score échouée : ${updErr.message}`,
    }
  }

  const revalidateAll = () => {
    revalidatePath('/candidatures')
    revalidatePath('/candidatures/flottement')
    revalidatePath('/candidatures/incompletes')
    revalidatePath('/dashboard')
    revalidatePath(`/offres/${offre.id}`)
  }

  // Offre clôturée : on a rescoré, on ne spam pas le client.
  if (effectiveStatut(offre.statut, offre.date_validite) === 'clos') {
    revalidateAll()
    return {
      ok: true,
      severity: 'warning',
      message: `Rescoré : ${newScore}/100, statut « ${newStatut} ». Offre clôturée : pas d'email envoyé.`,
      newScore,
      newStatut,
    }
  }

  if (newStatut !== 'qualifié') {
    revalidateAll()
    return {
      ok: true,
      severity: 'success',
      message: `Rescoré : ${newScore}/100 (seuil ${offre.seuil}). Statut « ${newStatut} » — pas d'email envoyé.`,
      newScore,
      newStatut,
    }
  }

  // Qualifié + offre active → on notifie le client comme ailleurs dans
  // l'app (même helper sendQualifiedCandidateEmail).
  const clientInfo = Array.isArray(offre.clients)
    ? offre.clients[0]
    : offre.clients
  const override = process.env.NOTIFICATION_EMAIL_OVERRIDE
  const notifTo = override || clientInfo?.contact_email || null

  if (!notifTo) {
    revalidateAll()
    return {
      ok: true,
      severity: 'warning',
      message: `Rescoré : ${newScore}/100, qualifié. Email non envoyé : aucune adresse de notification client.`,
      newScore,
      newStatut,
    }
  }
  if (!process.env.RESEND_API_KEY) {
    revalidateAll()
    return {
      ok: true,
      severity: 'warning',
      message: `Rescoré : ${newScore}/100, qualifié. Email non envoyé : RESEND_API_KEY absent côté serveur.`,
      newScore,
      newStatut,
    }
  }

  const mailRes = await sendQualifiedCandidateEmail({
    to: notifTo,
    offreReference: offre.reference,
    offreTitle: offre.titre,
    candidateName: cand.nom ?? '',
    candidateEmail: cand.email ?? '',
    score: newScore,
    seuil: offre.seuil,
    justification: newJustification,
    cvBuffer,
    cvFilename: cand.cv_filename || `CV-${cand.nom ?? 'candidat'}.pdf`,
  })

  revalidateAll()

  if (!mailRes.ok) {
    return {
      ok: true,
      severity: 'warning',
      message: `Rescoré : ${newScore}/100, qualifié. Envoi email échoué : ${mailRes.error}`,
      newScore,
      newStatut,
    }
  }
  return {
    ok: true,
    severity: 'success',
    message: `Rescoré : ${newScore}/100, qualifié ✅. Email envoyé au client ✉️`,
    newScore,
    newStatut,
  }
}
