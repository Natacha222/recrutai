'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { scoreCandidate } from '@/lib/scoring'
import {
  persistEmailResult,
  sendQualifiedCandidateEmail,
} from '@/lib/email'
import { effectiveStatut } from '@/lib/format'

/**
 * Relance le scoring IA sur une candidature existante (typiquement quand le
 * 1er scoring a planté : justification_ia commence par « Scoring IA
 * indisponible »). Le nom/email extraits par l'IA au 1er passage restent
 * inchangés — et sont d'ailleurs non-bloquants pour l'envoi client : le CV
 * PDF part en pièce jointe, le client voit le candidat directement dedans.
 *
 * Étapes :
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
  let newPointsForts: string[] = []
  let newPointsFaibles: string[] = []
  let newStatut: string
  try {
    const res = await scoreCandidate({
      cvBuffer,
      jobDescription: offre.description,
      seuil: offre.seuil,
    })
    newScore = res.score
    newJustification = res.justification
    newPointsForts = res.pointsForts
    newPointsFaibles = res.pointsFaibles
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
      points_forts: newPointsForts,
      points_faibles: newPointsFaibles,
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
    revalidatePath('/dashboard')
    revalidatePath(`/offres/${offre.id}`)
  }

  // Helper : persiste l'échec d'envoi (offre close, pas de destinataire,
  // pas de clé API…) en base pour que le badge ⚠️ apparaisse dans la liste
  // et que l'AM puisse cliquer « Renvoyer » plus tard quand la situation
  // est réglée (ex : après avoir renseigné contact_email).
  const persistFail = (reason: string) =>
    persistEmailResult(supabase, candidatureId, { ok: false, error: reason })

  // Offre clôturée : on a rescoré, on ne spam pas le client.
  if (effectiveStatut(offre.statut, offre.date_validite) === 'clos') {
    if (newStatut === 'qualifié') {
      await persistFail(
        "Offre clôturée (statut manuel ou date de validité dépassée) : email non envoyé."
      )
    }
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
    await persistFail(
      "Aucune adresse de notification (NOTIFICATION_EMAIL_OVERRIDE non défini et clients.contact_email manquant)."
    )
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
    await persistFail('RESEND_API_KEY non défini côté serveur.')
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
    pointsForts: newPointsForts,
    pointsFaibles: newPointsFaibles,
    cvBuffer,
    cvFilename: cand.cv_filename || `CV-${cand.nom ?? 'candidat'}.pdf`,
  })

  // Toujours persister — succès comme échec alimentent la même colonne
  // de vérité côté UI (badge + Renvoyer).
  await persistEmailResult(supabase, candidatureId, mailRes)

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

  const supabase = await createClient()

  const { data: candRaw, error: candErr } = await supabase
    .from('candidatures')
    .select(
      'id, offre_id, nom, email, score_ia, justification_ia, points_forts, points_faibles, statut, cv_path, cv_filename, offres(id, titre, reference, seuil, statut, date_validite, clients(contact_email))'
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

  // Bloque l'appel si la candidature n'est pas/plus qualifiée : l'email de
  // notification n'a de sens que pour un candidat qualifié. Cas edge : un
  // AM aurait ré-ouvert la page, le statut aurait changé entre-temps.
  if (cand.statut !== 'qualifié') {
    return {
      ok: false,
      error:
        'Seules les candidatures qualifiées peuvent recevoir un email de notification.',
    }
  }

  const revalidateAll = () => {
    revalidatePath('/candidatures')
    revalidatePath('/candidatures/flottement')
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
