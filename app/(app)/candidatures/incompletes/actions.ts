'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { scoreCandidate } from '@/lib/scoring'
import { sendQualifiedCandidateEmail } from '@/lib/email'
import { effectiveStatut } from '@/lib/format'

// Format email minimaliste : on ne cherche pas à être RFC-compliant, juste à
// bloquer les saisies manifestement fausses (ex : espace, absence de @, pas
// de TLD). Les cas limites (quotes, caractères unicode…) passent sans drame.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type UpdateCandidatureInfoResult =
  | {
      ok: true
      /** Message humain affiché dans l'UI sous le formulaire. */
      message: string
      /** 'success' = rescore + notif nominal, 'warning' = nom/email sauvés
       *  mais une étape avale (rescore ou email) n'a pas pu se faire. */
      severity: 'success' | 'warning'
    }
  | { ok: false; error: string }

type CandidatureWithOffre = {
  id: string
  offre_id: string | null
  cv_path: string | null
  cv_filename: string | null
  score_ia: number | null
  statut: string | null
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

/**
 * Met à jour le nom et l'email d'une candidature depuis la page
 * /candidatures/incompletes, puis :
 *   - Re-score automatiquement le CV si l'offre est toujours active (le
 *     scoring initial avait souvent échoué, d'où le statut « incomplet »).
 *   - Envoie l'email de notification au client si le nouveau score atteint
 *     le seuil de qualification.
 *
 * Le rescoring prend ~15 s (appel Claude sur le PDF), donc l'action bloque
 * le temps nécessaire — le bouton côté UI affiche « Enregistrement +
 * re-scoring… » pendant ce temps.
 */
export async function updateCandidatureInfo({
  id,
  nom,
  email,
}: {
  id: string
  nom: string
  email: string
}): Promise<UpdateCandidatureInfoResult> {
  if (!id) return { ok: false, error: 'Candidature introuvable.' }

  const cleanNom = nom.trim()
  const cleanEmail = email.trim()

  if (!cleanNom) return { ok: false, error: 'Le nom est obligatoire.' }
  if (!cleanEmail) return { ok: false, error: "L'email est obligatoire." }
  if (!EMAIL_RE.test(cleanEmail)) {
    return { ok: false, error: "Format d'email invalide." }
  }

  const supabase = await createClient()

  // 1) On charge d'abord la candidature + offre liée pour :
  //    - valider qu'elle existe,
  //    - récupérer cv_path + description + seuil pour le rescoring,
  //    - récupérer contact_email client + statut/date_validite offre.
  const { data: candRaw, error: candErr } = await supabase
    .from('candidatures')
    .select(
      'id, offre_id, cv_path, cv_filename, score_ia, statut, offres(id, titre, reference, description, seuil, statut, date_validite, clients(contact_email))'
    )
    .eq('id', id)
    .single()
  if (candErr || !candRaw) {
    return { ok: false, error: 'Candidature introuvable.' }
  }
  const cand = candRaw as CandidatureWithOffre
  const offre = Array.isArray(cand.offres) ? cand.offres[0] : cand.offres

  // 2) Update nom + email — toujours fait, indépendamment du rescoring.
  const { error: updErr } = await supabase
    .from('candidatures')
    .update({ nom: cleanNom, email: cleanEmail })
    .eq('id', id)
  if (updErr) return { ok: false, error: updErr.message }

  // Après cette étape, on renvoie toujours ok:true — les erreurs plus loin
  // (rescoring, email) deviennent des « warnings » affichés à l'utilisateur
  // mais la sauvegarde nom/email est bien persistée.
  const revalidateAll = () => {
    revalidatePath('/candidatures/incompletes')
    revalidatePath('/candidatures/flottement')
    revalidatePath('/dashboard')
    if (offre) revalidatePath(`/offres/${offre.id}`)
  }

  // 3) Pas d'offre liée ou offre clôturée → on s'arrête là sans rescorer.
  if (!offre) {
    revalidateAll()
    return {
      ok: true,
      severity: 'warning',
      message: "Nom et email enregistrés. Pas d'offre liée : rescoring ignoré.",
    }
  }
  if (effectiveStatut(offre.statut, offre.date_validite) === 'clos') {
    revalidateAll()
    return {
      ok: true,
      severity: 'warning',
      message:
        'Nom et email enregistrés. Offre clôturée : rescoring et notification ignorés.',
    }
  }

  // 4) Pas de cv_path → anciennes candidatures importées avant l'ajout du
  //    champ. On ne peut pas rescorer sans le PDF d'origine.
  if (!cand.cv_path) {
    revalidateAll()
    return {
      ok: true,
      severity: 'warning',
      message:
        'Nom et email enregistrés. CV introuvable dans le storage : rescoring impossible.',
    }
  }

  // 5) Télécharge le PDF du CV (réutilisé pour scoring + éventuelle PJ email).
  const { data: blob, error: dlErr } = await supabase.storage
    .from('cvs')
    .download(cand.cv_path)
  if (dlErr || !blob) {
    revalidateAll()
    return {
      ok: true,
      severity: 'warning',
      message: `Nom et email enregistrés. Téléchargement du CV échoué : ${dlErr?.message ?? 'blob vide'}.`,
    }
  }
  const cvBuffer = Buffer.from(await blob.arrayBuffer())

  // 6) Rescore.
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
    console.error(`[updateCandidatureInfo] scoring IA échoué (${id}) :`, msg)
    revalidateAll()
    return {
      ok: true,
      severity: 'warning',
      message: `Nom et email enregistrés. Rescoring IA échoué : ${msg}`,
    }
  }

  // 7) Sauve le nouveau score + justification + statut.
  const { error: updScoreErr } = await supabase
    .from('candidatures')
    .update({
      score_ia: newScore,
      justification_ia: newJustification,
      statut: newStatut,
    })
    .eq('id', id)
  if (updScoreErr) {
    revalidateAll()
    return {
      ok: true,
      severity: 'warning',
      message: `Nom et email enregistrés. Sauvegarde du nouveau score échouée : ${updScoreErr.message}`,
    }
  }

  revalidateAll()

  // 8) Notification email client uniquement si qualifié.
  if (newStatut !== 'qualifié') {
    return {
      ok: true,
      severity: 'success',
      message: `Rescoré : ${newScore}/100 (seuil ${offre.seuil}). Statut « ${newStatut} » — pas d'email envoyé.`,
    }
  }

  const clientInfo = Array.isArray(offre.clients)
    ? offre.clients[0]
    : offre.clients
  const override = process.env.NOTIFICATION_EMAIL_OVERRIDE
  const notifTo = override || clientInfo?.contact_email || null

  if (!notifTo) {
    return {
      ok: true,
      severity: 'warning',
      message: `Rescoré : ${newScore}/100, qualifié. Email non envoyé : aucune adresse de notification (NOTIFICATION_EMAIL_OVERRIDE non défini et clients.contact_email manquant).`,
    }
  }
  if (!process.env.RESEND_API_KEY) {
    return {
      ok: true,
      severity: 'warning',
      message: `Rescoré : ${newScore}/100, qualifié. Email non envoyé : RESEND_API_KEY non défini côté serveur.`,
    }
  }

  const mailRes = await sendQualifiedCandidateEmail({
    to: notifTo,
    offreReference: offre.reference,
    offreTitle: offre.titre,
    candidateName: cleanNom,
    candidateEmail: cleanEmail,
    score: newScore,
    seuil: offre.seuil,
    justification: newJustification,
    cvBuffer,
    cvFilename: cand.cv_filename || `CV-${cleanNom}.pdf`,
  })

  if (!mailRes.ok) {
    return {
      ok: true,
      severity: 'warning',
      message: `Rescoré : ${newScore}/100, qualifié. Envoi email échoué : ${mailRes.error}`,
    }
  }
  return {
    ok: true,
    severity: 'success',
    message: `Rescoré : ${newScore}/100, qualifié ✅. Email envoyé au client ✉️`,
  }
}
