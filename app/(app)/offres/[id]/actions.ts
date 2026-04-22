'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { scoreCandidate } from '@/lib/scoring'
import {
  persistEmailResult,
  sendQualifiedCandidateEmail,
} from '@/lib/email'
import { effectiveStatut, formatReferent, todayIso } from '@/lib/format'
import { FIELD_LIMITS, truncate } from '@/lib/validation'

const CONTRATS = ['CDI', 'CDD', 'Alternance', 'Stage']

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Safety-net serveur : même limite que le check côté CVUploader. Si un
// attaquant contourne le check client (upload direct Supabase Storage via
// l'API publique), on refuse le CV avant de le renvoyer à Claude — ça
// protège la facturation Anthropic (pas de scoring sur un faux PDF de
// 500 Mo) et la RAM de la fonction serverless.
const MAX_CV_SIZE = 10 * 1024 * 1024

export async function updateOffre(formData: FormData) {
  const supabase = await createClient()

  const id = String(formData.get('id') ?? '').trim()
  // Troncature défensive : protège contre un POST qui bypass le maxLength
  // HTML. Limites centralisées dans lib/validation.ts.
  const titre = truncate(
    String(formData.get('titre') ?? ''),
    FIELD_LIMITS.offre_titre
  ).trim()
  const client_id = String(formData.get('client_id') ?? '').trim()
  const description =
    truncate(
      String(formData.get('description') ?? ''),
      FIELD_LIMITS.offre_description
    ).trim() || null
  const lieu =
    truncate(
      String(formData.get('lieu') ?? ''),
      FIELD_LIMITS.offre_lieu
    ).trim() || null
  const contratRaw = String(formData.get('contrat') ?? '').trim()
  const contrat = CONTRATS.includes(contratRaw) ? contratRaw : 'CDI'
  const seuilRaw = Number(formData.get('seuil'))
  const dateValiditeRaw = String(formData.get('date_validite') ?? '').trim()
  const date_validite = ISO_DATE_RE.test(dateValiditeRaw)
    ? dateValiditeRaw
    : null
  const am_referent = formatReferent(
    truncate(
      String(formData.get('am_referent') ?? ''),
      FIELD_LIMITS.am_referent
    )
  )
  // Référence optionnelle : chaîne vide → NULL.
  const reference =
    truncate(
      String(formData.get('reference') ?? ''),
      FIELD_LIMITS.offre_reference
    ).trim() || null

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
      reference,
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
        // Nombre de CVs pour lesquels le scoring IA a planté (rate limit
        // Claude, timeout, PDF invalide, etc.). Ils sont quand même insérés
        // en BD avec statut 'en attente' et justification « Scoring IA
        // indisponible : … » — à relancer depuis /candidatures.
        scoringFailures: number
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
      'id, reference, titre, description, seuil, statut, date_validite, clients(contact_email)'
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
    // Flag explicite : true si scoreCandidate a throw (distinct d'un CV
    // légitimement sous seuil). Sert à compter les scoringFailures pour
    // informer l'utilisateur en UI.
    scoringFailed: boolean
  }

  // On capture les champs de l'offre dans des consts locaux : la narrowing
  // TypeScript de `offre` (non-null après le guard) se perd dans la closure
  // de la fonction nommée `processUpload`.
  const offreDescription = offre.description
  const offreSeuil = offre.seuil

  async function processUpload(u: {
    path: string
    filename: string
  }): Promise<Prepared> {
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

    if (cvBuffer.length > MAX_CV_SIZE) {
      throw new Error(
        `${u.filename} dépasse 10 Mo — CV ignoré (protection Claude + RAM).`
      )
    }

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
    let scoringFailed = false
    try {
      const res = await scoreCandidate({
        cvBuffer,
        jobDescription: offreDescription,
        seuil: offreSeuil,
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
      scoringFailed = true
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
      scoringFailed,
    }
  }

  // Stratégie d'appel à l'IA pour respecter la rate limit (30k input tokens
  // /min en Tier 1) :
  //   1) On score le 1er CV tout seul pour AMORCER le cache de prompt
  //      d'Anthropic (l'offre + les instructions sont taguées
  //      cache_control: ephemeral dans scoreCandidate). Une fois ce 1er
  //      appel terminé, le système a mis en cache ~5000 tokens d'offre,
  //      et les appels suivants paient 10% du coût sur cette portion.
  //   2) Ensuite, on traite les CVs restants par lots de SCORING_CONCURRENCY
  //      via un pool de workers. Cela permet d'étaler la consommation de
  //      tokens dans le temps et d'éviter le 429 quand on upload 20 CVs
  //      d'un coup. Le cache est valide 5 minutes, largement assez.
  const SCORING_CONCURRENCY = 5
  async function mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let nextIndex = 0
    async function worker() {
      while (true) {
        const i = nextIndex++
        if (i >= items.length) return
        results[i] = await fn(items[i])
      }
    }
    const workers = Array.from(
      { length: Math.min(limit, items.length) },
      () => worker()
    )
    await Promise.all(workers)
    return results
  }

  let prepared: Prepared[]
  if (uploads.length <= 1) {
    prepared = await Promise.all(uploads.map(processUpload))
  } else {
    const first = await processUpload(uploads[0])
    const rest = await mapLimit(
      uploads.slice(1),
      SCORING_CONCURRENCY,
      processUpload
    )
    prepared = [first, ...rest]
  }

  // `.select('id, cv_path')` pour récupérer les IDs générés : on en a besoin
  // pour persister le résultat de l'envoi email (`email_sent_at` / `email_error`)
  // sur chaque candidature individuellement. Le matching par cv_path est
  // robuste (chaque upload a un path unique avec timestamp), donc même si
  // PostgREST réordonne les lignes retournées ça fonctionne.
  const { data: inserted, error } = await supabase
    .from('candidatures')
    .insert(prepared.map((p) => p.row))
    .select('id, cv_path')
  if (error) {
    return { ok: false, error: error.message }
  }
  const pathToId = new Map<string, string>()
  for (const row of inserted ?? []) {
    if (row.cv_path) pathToId.set(row.cv_path, row.id)
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
    // Marque toutes les qualifiées comme "email en échec" pour que le
    // badge ⚠️ apparaisse dans la liste — sans ça, l'AM ne saurait jamais
    // que le client n'a rien reçu.
    await Promise.all(
      qualified.map(async (p) => {
        const id = pathToId.get(p.row.cv_path)
        if (id) {
          await persistEmailResult(supabase, id, {
            ok: false,
            error: skippedReason!,
          })
        }
      })
    )
  } else if (!process.env.RESEND_API_KEY) {
    skippedReason = 'RESEND_API_KEY non défini côté serveur.'
    console.warn(`[ingestCVs] ${skippedReason}`)
    await Promise.all(
      qualified.map(async (p) => {
        const id = pathToId.get(p.row.cv_path)
        if (id) {
          await persistEmailResult(supabase, id, {
            ok: false,
            error: skippedReason!,
          })
        }
      })
    )
  } else if (qualified.length === 0) {
    skippedReason = 'Aucun CV n\'a atteint le seuil.'
  } else {
    const results = await Promise.allSettled(
      qualified.map(async (p) => {
        const res = await sendQualifiedCandidateEmail({
          to: notifTo,
          offreReference: offre.reference,
          offreTitle: offre.titre,
          candidateName: p.row.nom,
          candidateEmail: p.row.email,
          score: p.row.score_ia,
          seuil: offre.seuil,
          justification: p.row.justification_ia,
          cvBuffer: p.cvBuffer,
          cvFilename: p.upload.filename,
        })
        // Persiste l'état avant de throw pour le comptage — on veut
        // TOUJOURS laisser une trace en DB, qu'on ait réussi ou non.
        const id = pathToId.get(p.row.cv_path)
        if (id) await persistEmailResult(supabase, id, res)
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

  // Compte les CVs dont le scoring IA a planté — l'utilisateur doit le
  // voir pour savoir qu'il faut relancer manuellement (sinon il croit
  // que ces CVs sont réellement mauvais, alors qu'ils n'ont pas été évalués).
  const scoringFailures = prepared.filter((p) => p.scoringFailed).length

  revalidatePath(`/offres/${offreId}`)
  revalidatePath('/offres')
  revalidatePath('/dashboard')
  revalidatePath('/candidatures')
  revalidatePath('/candidatures/flottement')
  revalidatePath('/candidatures/incompletes')
  return {
    ok: true,
    notifications: {
      qualifiedCount: qualified.length,
      sentCount,
      errors: notifErrors,
      scoringFailures,
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
    .select(
      'id, reference, titre, seuil, statut, date_validite, clients(contact_email)'
    )
    .eq('id', cand.offre_id)
    .single()

  if (offreErr || !offre) {
    return { ok: false, error: "Offre introuvable." }
  }

  // UPDATE conditionnel sur `statut = 'en attente'` : si deux clics ou deux
  // onglets déclenchent qualifyCandidature en parallèle (ou si l'utilisateur
  // a rafraîchi pendant le premier appel), seul le premier passe. Les
  // suivants voient `updated = []` et sortent SANS ré-envoyer d'email au
  // client. `select('id')` force PostgREST à retourner les lignes
  // effectivement mises à jour (sinon on ne peut pas distinguer 0 vs 1 row).
  const { data: updated, error: updErr } = await supabase
    .from('candidatures')
    .update({ statut: 'qualifié' })
    .eq('id', candidatureId)
    .eq('statut', 'en attente')
    .select('id')

  if (updErr) return { ok: false, error: updErr.message }

  if (!updated || updated.length === 0) {
    return {
      ok: true,
      emailSent: false,
      skippedReason:
        'Candidature déjà tranchée (qualifiée ou rejetée) — email non envoyé.',
    }
  }

  revalidatePath(`/offres/${cand.offre_id}`)
  revalidatePath('/dashboard')
  // Listes globales de candidatures (dashboard drill-downs) : un candidat
  // qualifié change de part dans le camembert et disparaît de la liste
  // « en attente » / flottement.
  revalidatePath('/candidatures')
  revalidatePath('/candidatures/flottement')
  revalidatePath('/candidatures/incompletes')

  // Helper local : persiste l'échec + renvoie le warning à l'UI. On
  // persiste dans TOUS les cas d'échec (technique ou volontaire) pour
  // qu'un badge ⚠️ apparaisse dans la liste et que l'AM puisse relancer
  // plus tard (ex : après avoir renseigné contact_email ou réactivé l'offre).
  const failAndReport = async (
    reason: string
  ): Promise<PromoteResult> => {
    await persistEmailResult(supabase, candidatureId, {
      ok: false,
      error: reason,
    })
    return { ok: true, emailSent: false, skippedReason: reason }
  }

  // Garde-fou : si l'offre a été clôturée (manuellement ou date dépassée)
  // depuis que le CV a été scoré, on change bien le statut de la
  // candidature mais on n'envoie PAS l'email au client — ça n'aurait pas
  // de sens de le relancer sur une offre fermée.
  if (effectiveStatut(offre.statut, offre.date_validite) === 'clos') {
    return await failAndReport(
      "Offre clôturée (statut manuel ou date de validité dépassée) : email non envoyé."
    )
  }

  // Prépare l'envoi email
  const clientInfo = Array.isArray(offre.clients)
    ? offre.clients[0]
    : (offre.clients as { contact_email: string | null } | null)
  const override = process.env.NOTIFICATION_EMAIL_OVERRIDE
  const notifTo = override || clientInfo?.contact_email || null

  if (!notifTo) {
    return await failAndReport(
      "Aucune adresse de notification (NOTIFICATION_EMAIL_OVERRIDE non défini et clients.contact_email manquant)."
    )
  }
  if (!process.env.RESEND_API_KEY) {
    return await failAndReport('RESEND_API_KEY non défini côté serveur.')
  }
  if (!cand.cv_path) {
    return await failAndReport(
      "CV introuvable dans le storage (candidature importée avant l'ajout de cv_path)."
    )
  }

  // Télécharge le PDF du CV pour la pièce jointe
  const { data: blob, error: dlErr } = await supabase.storage
    .from('cvs')
    .download(cand.cv_path)
  if (dlErr || !blob) {
    return await failAndReport(
      `Téléchargement CV échoué : ${dlErr?.message ?? 'blob vide'}`
    )
  }
  const arrayBuffer = await blob.arrayBuffer()
  const cvBuffer = Buffer.from(arrayBuffer)

  const res = await sendQualifiedCandidateEmail({
    to: notifTo,
    offreReference: offre.reference,
    offreTitle: offre.titre,
    candidateName: cand.nom,
    candidateEmail: cand.email ?? '',
    score: cand.score_ia ?? 0,
    seuil: offre.seuil,
    justification: cand.justification_ia ?? '',
    cvBuffer,
    cvFilename: cand.cv_filename || `CV-${cand.nom}.pdf`,
  })

  // Toujours persister, succès comme échec — c'est la source de vérité
  // qui alimente le badge ⚠️ et le bouton « Renvoyer » dans les listes.
  await persistEmailResult(supabase, candidatureId, res)

  if (!res.ok) {
    return { ok: true, emailSent: false, skippedReason: res.error }
  }
  return { ok: true, emailSent: true }
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

  // UPDATE conditionnel : voir commentaire équivalent dans qualifyCandidature.
  // Si la candidature n'est plus « en attente », on renvoie `ok: true` quand
  // même (pour ne pas afficher d'erreur à l'utilisateur qui voulait juste
  // rejeter — le résultat final est le même : la candidature n'est plus
  // en attente).
  const { data: updated, error } = await supabase
    .from('candidatures')
    .update({ statut: 'rejeté' })
    .eq('id', candidatureId)
    .eq('statut', 'en attente')
    .select('id')

  if (error) return { ok: false, error: error.message }

  // Pas de side-effect (email) à protéger ici, mais on garde la logique
  // conditionnelle pour la cohérence avec qualifyCandidature.
  if (updated && updated.length > 0) {
    revalidatePath(`/offres/${cand.offre_id}`)
    revalidatePath('/dashboard')
    revalidatePath('/candidatures')
    revalidatePath('/candidatures/flottement')
    revalidatePath('/candidatures/incompletes')
  }
  return { ok: true }
}
