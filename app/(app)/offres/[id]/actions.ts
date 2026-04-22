'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { scoreCandidate } from '@/lib/scoring'
import { sendQualifiedCandidateEmail } from '@/lib/email'
import { effectiveStatut, formatReferent, todayIso } from '@/lib/format'

const CONTRATS = ['CDI', 'CDD', 'Alternance', 'Stage']

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function updateOffre(formData: FormData) {
  const supabase = await createClient()

  const id = String(formData.get('id') ?? '').trim()
  const titre = String(formData.get('titre') ?? '').trim()
  const client_id = String(formData.get('client_id') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const lieu = String(formData.get('lieu') ?? '').trim() || null
  const contratRaw = String(formData.get('contrat') ?? '').trim()
  const contrat = CONTRATS.includes(contratRaw) ? contratRaw : 'CDI'
  const seuilRaw = Number(formData.get('seuil'))
  const dateValiditeRaw = String(formData.get('date_validite') ?? '').trim()
  const date_validite = ISO_DATE_RE.test(dateValiditeRaw)
    ? dateValiditeRaw
    : null
  const am_referent = formatReferent(
    String(formData.get('am_referent') ?? '')
  )

  if (!id) return redirect('/offres?error=Offre+introuvable')
  if (!titre || !client_id) {
    return redirect(
      `/offres/${id}/modifier?error=Le+titre+et+le+client+sont+obligatoires`
    )
  }
  if (
    !Number.isFinite(seuilRaw) ||
    seuilRaw < 50 ||
    seuilRaw > 100 ||
    !Number.isInteger(seuilRaw)
  ) {
    return redirect(
      `/offres/${id}/modifier?error=Le+seuil+doit+%C3%AAtre+un+entier+compris+entre+50+et+100`
    )
  }
  const seuil = seuilRaw
  if (!date_validite) {
    return redirect(
      `/offres/${id}/modifier?error=La+date+de+validit%C3%A9+est+obligatoire`
    )
  }
  if (date_validite < todayIso()) {
    return redirect(
      `/offres/${id}/modifier?error=La+date+de+validit%C3%A9+doit+%C3%AAtre+post%C3%A9rieure+ou+%C3%A9gale+%C3%A0+aujourd%27hui`
    )
  }

  // La date future est déjà validée plus haut : sauvegarder une offre avec
  // une date valide signifie qu'elle est active. Une éventuelle clôture
  // manuelle (« clos » en DB) est donc réinitialisée à chaque édition, ce
  // qui permet à l'utilisateur de réactiver une offre en mettant simplement
  // une date ultérieure.
  const { error } = await supabase
    .from('offres')
    .update({
      titre,
      client_id,
      description,
      lieu,
      contrat,
      statut: 'actif',
      seuil,
      date_validite,
      am_referent,
    })
    .eq('id', id)

  if (error) {
    return redirect(
      `/offres/${id}/modifier?error=${encodeURIComponent(error.message)}`
    )
  }

  revalidatePath('/offres')
  revalidatePath(`/offres/${id}`)
  redirect(`/offres/${id}?saved=1`)
}

function candidateNameFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '')
  const cleaned = stem
    .replace(/[_\-.]+/g, ' ')
    .replace(/\b(cv|resume|curriculum|vitae)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'Candidat sans nom'
  return cleaned
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

function emailFromName(name: string): string {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .trim()
    .replace(/\s+/g, '.')
  return normalized ? `${normalized}@example.com` : 'candidat@example.com'
}

export type IngestResult =
  | {
      ok: true
      notifications: {
        qualifiedCount: number
        sentCount: number
        errors: string[]
        skippedReason?: string
      }
    }
  | { ok: false; error: string }

export async function ingestCVs({
  offreId,
  uploads,
}: {
  offreId: string
  uploads: { path: string; filename: string }[]
}): Promise<IngestResult> {
  if (!offreId || uploads.length === 0) {
    return { ok: false, error: 'Aucun fichier à traiter.' }
  }

  const supabase = await createClient()

  const { data: offre, error: offreErr } = await supabase
    .from('offres')
    .select(
      'id, titre, description, seuil, statut, date_validite, clients(contact_email)'
    )
    .eq('id', offreId)
    .single()

  if (offreErr || !offre) {
    return { ok: false, error: "Offre introuvable." }
  }

  // Garde-fou : on ne traite pas de CV pour une offre clôturée (manuellement
  // ou parce que sa date de validité est dépassée).
  if (effectiveStatut(offre.statut, offre.date_validite) === 'clos') {
    return {
      ok: false,
      error:
        "Cette offre est clôturée (statut manuel ou date de validité dépassée). Réactive-la avant de joindre des CVs.",
    }
  }

  // Pour chaque upload : télécharge le PDF une seule fois (réutilisé pour le
  // scoring IA + la pièce jointe email), génère une URL signée longue durée
  // pour l'affichage, et lance le scoring IA (score + justification + nom +
  // email candidat) à partir du contenu réel du PDF.
  type Prepared = {
    row: {
      offre_id: string
      nom: string
      email: string
      score_ia: number
      justification_ia: string
      statut: string
      cv_url: string | null
      cv_path: string
      cv_filename: string
    }
    upload: { path: string; filename: string }
    cvBuffer: Buffer
  }

  const prepared: Prepared[] = await Promise.all(
    uploads.map(async (u) => {
      // 1) Télécharge le PDF depuis Storage
      const { data: blob, error: dlErr } = await supabase.storage
        .from('cvs')
        .download(u.path)
      if (dlErr || !blob) {
        throw new Error(
          `Téléchargement ${u.filename} : ${dlErr?.message ?? 'blob vide'}`
        )
      }
      const arrayBuffer = await blob.arrayBuffer()
      const cvBuffer = Buffer.from(arrayBuffer)

      // 2) URL signée longue durée (30 jours) pour le tableau des candidatures
      const { data: signed } = await supabase.storage
        .from('cvs')
        .createSignedUrl(u.path, 60 * 60 * 24 * 30)

      // 3) Scoring IA sur le PDF — on isole les erreurs pour ne pas casser
      //    tout le batch si un CV pose problème.
      let score = 0
      let justification = ''
      let statut = 'en attente'
      let extractedName: string | undefined
      let extractedEmail: string | undefined
      try {
        const res = await scoreCandidate({
          cvBuffer,
          jobDescription: offre.description,
          seuil: offre.seuil,
        })
        score = res.score
        justification = res.justification
        statut = res.statut
        extractedName = res.candidateName
        extractedEmail = res.candidateEmail
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[ingestCVs] scoring IA échoué (${u.filename}) :`, msg)
        justification = `Scoring IA indisponible : ${msg}`
      }

      const nom = extractedName || candidateNameFromFilename(u.filename)
      const email = extractedEmail || emailFromName(nom)

      return {
        row: {
          offre_id: offreId,
          nom,
          email,
          score_ia: score,
          justification_ia: justification,
          statut,
          cv_url: signed?.signedUrl ?? null,
          cv_path: u.path,
          cv_filename: u.filename,
        },
        upload: u,
        cvBuffer,
      }
    })
  )

  const { error } = await supabase
    .from('candidatures')
    .insert(prepared.map((p) => p.row))
  if (error) {
    return { ok: false, error: error.message }
  }

  // Notification email pour chaque CV qualifié (≥ seuil)
  const clientInfo = Array.isArray(offre.clients)
    ? offre.clients[0]
    : (offre.clients as { contact_email: string | null } | null)
  const override = process.env.NOTIFICATION_EMAIL_OVERRIDE
  const notifTo = override || clientInfo?.contact_email || null

  const qualified = prepared.filter((p) => p.row.statut === 'qualifié')
  const notifErrors: string[] = []
  let sentCount = 0
  let skippedReason: string | undefined

  if (!notifTo) {
    skippedReason =
      "Aucune adresse de notification (NOTIFICATION_EMAIL_OVERRIDE non défini et clients.contact_email manquant)."
    console.warn(`[ingestCVs] ${skippedReason}`)
  } else if (!process.env.RESEND_API_KEY) {
    skippedReason = 'RESEND_API_KEY non défini côté serveur.'
    console.warn(`[ingestCVs] ${skippedReason}`)
  } else if (qualified.length === 0) {
    skippedReason = 'Aucun CV n\'a atteint le seuil.'
  } else {
    const results = await Promise.allSettled(
      qualified.map(async (p) => {
        const res = await sendQualifiedCandidateEmail({
          to: notifTo,
          offreTitle: offre.titre,
          candidateName: p.row.nom,
          candidateEmail: p.row.email,
          score: p.row.score_ia,
          seuil: offre.seuil,
          justification: p.row.justification_ia,
          cvBuffer: p.cvBuffer,
          cvFilename: p.upload.filename,
        })
        if (!res.ok) throw new Error(res.error)
      })
    )
    for (const r of results) {
      if (r.status === 'fulfilled') {
        sentCount += 1
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
        console.error(`[ingestCVs] envoi email échoué : ${msg}`)
        notifErrors.push(msg)
      }
    }
  }

  revalidatePath(`/offres/${offreId}`)
  revalidatePath('/offres')
  revalidatePath('/dashboard')
  return {
    ok: true,
    notifications: {
      qualifiedCount: qualified.length,
      sentCount,
      errors: notifErrors,
      skippedReason,
    },
  }
}

/**
 * Qualifie manuellement une candidature en attente : passe son statut à
 * « qualifié » et envoie l'email de notification au client avec le PDF
 * en pièce jointe. Utilisé quand un recruteur valide un CV après revue
 * manuelle (le score IA n'avait pas atteint le seuil mais la fiche est
 * quand même pertinente).
 */
export type PromoteResult =
  | { ok: true; emailSent: boolean; skippedReason?: string }
  | { ok: false; error: string }

export async function qualifyCandidature(
  candidatureId: string
): Promise<PromoteResult> {
  if (!candidatureId) return { ok: false, error: 'Candidature introuvable.' }

  const supabase = await createClient()

  const { data: cand, error: candErr } = await supabase
    .from('candidatures')
    .select(
      'id, offre_id, nom, email, score_ia, justification_ia, cv_path, cv_filename'
    )
    .eq('id', candidatureId)
    .single()

  if (candErr || !cand) {
    return { ok: false, error: 'Candidature introuvable.' }
  }

  const { data: offre, error: offreErr } = await supabase
    .from('offres')
    .select('id, titre, seuil, clients(contact_email)')
    .eq('id', cand.offre_id)
    .single()

  if (offreErr || !offre) {
    return { ok: false, error: "Offre introuvable." }
  }

  // Passe le statut à qualifié
  const { error: updErr } = await supabase
    .from('candidatures')
    .update({ statut: 'qualifié' })
    .eq('id', candidatureId)

  if (updErr) return { ok: false, error: updErr.message }

  revalidatePath(`/offres/${cand.offre_id}`)
  revalidatePath('/dashboard')

  // Prépare l'envoi email
  const clientInfo = Array.isArray(offre.clients)
    ? offre.clients[0]
    : (offre.clients as { contact_email: string | null } | null)
  const override = process.env.NOTIFICATION_EMAIL_OVERRIDE
  const notifTo = override || clientInfo?.contact_email || null

  if (!notifTo) {
    return {
      ok: true,
      emailSent: false,
      skippedReason:
        "Aucune adresse de notification (NOTIFICATION_EMAIL_OVERRIDE non défini et clients.contact_email manquant).",
    }
  }
  if (!process.env.RESEND_API_KEY) {
    return {
      ok: true,
      emailSent: false,
      skippedReason: 'RESEND_API_KEY non défini côté serveur.',
    }
  }
  if (!cand.cv_path) {
    return {
      ok: true,
      emailSent: false,
      skippedReason:
        "CV introuvable dans le storage (candidature importée avant l'ajout de cv_path).",
    }
  }

  // Télécharge le PDF du CV pour la pièce jointe
  const { data: blob, error: dlErr } = await supabase.storage
    .from('cvs')
    .download(cand.cv_path)
  if (dlErr || !blob) {
    return {
      ok: true,
      emailSent: false,
      skippedReason: `Téléchargement CV échoué : ${dlErr?.message ?? 'blob vide'}`,
    }
  }
  const arrayBuffer = await blob.arrayBuffer()
  const cvBuffer = Buffer.from(arrayBuffer)

  const res = await sendQualifiedCandidateEmail({
    to: notifTo,
    offreTitle: offre.titre,
    candidateName: cand.nom,
    candidateEmail: cand.email ?? '',
    score: cand.score_ia ?? 0,
    seuil: offre.seuil,
    justification: cand.justification_ia ?? '',
    cvBuffer,
    cvFilename: cand.cv_filename || `CV-${cand.nom}.pdf`,
  })

  if (!res.ok) {
    return { ok: true, emailSent: false, skippedReason: res.error }
  }
  return { ok: true, emailSent: true }
}

/**
 * Supprime TOUTES les candidatures d'une offre, et nettoie les PDF
 * correspondants dans le storage. Action irréversible, utilisée depuis
 * le bouton « Effacer toutes les candidatures » de la fiche offre
 * (protégé par une modale de confirmation côté client).
 */
export async function deleteAllCandidaturesForOffre(
  offreId: string
): Promise<
  | { ok: true; deletedCount: number; storageDeletedCount: number }
  | { ok: false; error: string }
> {
  if (!offreId) return { ok: false, error: 'Offre introuvable.' }

  const supabase = await createClient()

  // 1) Récupère la liste des cv_path pour nettoyer le storage après
  const { data: rows, error: listErr } = await supabase
    .from('candidatures')
    .select('id, cv_path')
    .eq('offre_id', offreId)

  if (listErr) return { ok: false, error: listErr.message }

  const cvPaths = (rows ?? [])
    .map((r) => r.cv_path)
    .filter((p): p is string => !!p)

  // 2) Supprime les candidatures
  const { error: delErr, count } = await supabase
    .from('candidatures')
    .delete({ count: 'exact' })
    .eq('offre_id', offreId)

  if (delErr) return { ok: false, error: delErr.message }

  // 3) Supprime les PDF du storage (best-effort : on n'échoue pas si ça
  //    foire, les candidatures sont déjà parties en base de toute façon)
  let storageDeletedCount = 0
  if (cvPaths.length > 0) {
    const { data: removed, error: rmErr } = await supabase.storage
      .from('cvs')
      .remove(cvPaths)
    if (rmErr) {
      console.error(
        `[deleteAllCandidaturesForOffre] storage cleanup partiel : ${rmErr.message}`
      )
    } else {
      storageDeletedCount = removed?.length ?? 0
    }
  }

  revalidatePath(`/offres/${offreId}`)
  revalidatePath('/offres')
  revalidatePath('/dashboard')
  return {
    ok: true,
    deletedCount: count ?? 0,
    storageDeletedCount,
  }
}

/**
 * Rejette manuellement une candidature en attente : passe son statut à
 * « rejeté » sans envoyer d'email au client.
 */
export async function rejectCandidature(
  candidatureId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!candidatureId) return { ok: false, error: 'Candidature introuvable.' }

  const supabase = await createClient()

  const { data: cand, error: candErr } = await supabase
    .from('candidatures')
    .select('id, offre_id')
    .eq('id', candidatureId)
    .single()

  if (candErr || !cand) {
    return { ok: false, error: 'Candidature introuvable.' }
  }

  const { error } = await supabase
    .from('candidatures')
    .update({ statut: 'rejeté' })
    .eq('id', candidatureId)

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/offres/${cand.offre_id}`)
  revalidatePath('/dashboard')
  return { ok: true }
}
