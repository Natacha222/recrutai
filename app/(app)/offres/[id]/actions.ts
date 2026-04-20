'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { scoreCandidate } from '@/lib/scoring'
import { sendQualifiedCandidateEmail } from '@/lib/email'
import { effectiveStatut, todayIso } from '@/lib/format'

const CONTRATS = ['CDI', 'CDD', 'Alternance', 'Stage']
const STATUTS = ['actif', 'clos']

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
  const statutRaw = String(formData.get('statut') ?? '').trim()
  const statut = STATUTS.includes(statutRaw) ? statutRaw : 'actif'
  const seuilRaw = Number(formData.get('seuil') ?? 60)
  const seuil = Number.isFinite(seuilRaw)
    ? Math.min(100, Math.max(0, Math.round(seuilRaw)))
    : 60
  const dateValiditeRaw = String(formData.get('date_validite') ?? '').trim()
  const date_validite = ISO_DATE_RE.test(dateValiditeRaw)
    ? dateValiditeRaw
    : null

  if (!id) return redirect('/offres?error=Offre+introuvable')
  if (!titre || !client_id) {
    return redirect(
      `/offres/${id}?error=Le+titre+et+le+client+sont+obligatoires`
    )
  }
  if (!date_validite) {
    return redirect(
      `/offres/${id}?error=La+date+de+validit%C3%A9+est+obligatoire`
    )
  }
  if (date_validite < todayIso()) {
    return redirect(
      `/offres/${id}?error=La+date+de+validit%C3%A9+doit+%C3%AAtre+post%C3%A9rieure+ou+%C3%A9gale+%C3%A0+aujourd%27hui`
    )
  }

  const { error } = await supabase
    .from('offres')
    .update({
      titre,
      client_id,
      description,
      lieu,
      contrat,
      statut,
      seuil,
      date_validite,
    })
    .eq('id', id)

  if (error) {
    return redirect(`/offres/${id}?error=${encodeURIComponent(error.message)}`)
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
