'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { scoreCandidate } from '@/lib/scoring'

const CONTRATS = ['CDI', 'CDD', 'Alternance', 'Stage']
const STATUTS = ['actif', 'clos']

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

  if (!id) return redirect('/offres?error=Offre+introuvable')
  if (!titre || !client_id) {
    return redirect(
      `/offres/${id}?error=Le+titre+et+le+client+sont+obligatoires`
    )
  }

  const { error } = await supabase
    .from('offres')
    .update({ titre, client_id, description, lieu, contrat, statut, seuil })
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

export async function ingestCVs({
  offreId,
  uploads,
}: {
  offreId: string
  uploads: { path: string; filename: string }[]
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!offreId || uploads.length === 0) {
    return { ok: false, error: 'Aucun fichier à traiter.' }
  }

  const supabase = await createClient()

  const { data: offre, error: offreErr } = await supabase
    .from('offres')
    .select('id, description, seuil')
    .eq('id', offreId)
    .single()

  if (offreErr || !offre) {
    return { ok: false, error: "Offre introuvable." }
  }

  // Génère une URL signée longue durée pour chaque CV (30 jours)
  const rows = await Promise.all(
    uploads.map(async (u) => {
      const { data: signed } = await supabase.storage
        .from('cvs')
        .createSignedUrl(u.path, 60 * 60 * 24 * 30)

      const nom = candidateNameFromFilename(u.filename)
      const email = emailFromName(nom)
      const { score, justification, statut } = scoreCandidate({
        filename: u.filename,
        jobDescription: offre.description,
        seuil: offre.seuil,
      })

      return {
        offre_id: offreId,
        nom,
        email,
        score_ia: score,
        justification_ia: justification,
        statut,
        cv_url: signed?.signedUrl ?? null,
      }
    })
  )

  const { error } = await supabase.from('candidatures').insert(rows)
  if (error) {
    return { ok: false, error: error.message }
  }

  revalidatePath(`/offres/${offreId}`)
  revalidatePath('/offres')
  revalidatePath('/dashboard')
  return { ok: true }
}
