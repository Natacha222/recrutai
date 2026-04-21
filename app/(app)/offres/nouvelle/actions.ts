'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  extractOffreFromPdfBuffer,
  type ExtractedOffre,
} from '@/lib/offre-extraction'
import { formatReferent, normalizeClientName, todayIso } from '@/lib/format'

const CONTRATS = ['CDI', 'CDD', 'Alternance', 'Stage']
const FORMULES = ['Abonnement', 'À la mission', 'Volume entreprise']
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function createOffre(formData: FormData) {
  const supabase = await createClient()

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

  if (!titre || !client_id || !lieu || !description || !date_validite) {
    return redirect(
      '/offres/nouvelle?error=Tous+les+champs+sont+obligatoires'
    )
  }
  if (
    !Number.isFinite(seuilRaw) ||
    seuilRaw < 0 ||
    seuilRaw > 100 ||
    !Number.isInteger(seuilRaw)
  ) {
    return redirect(
      '/offres/nouvelle?error=Le+seuil+doit+%C3%AAtre+un+entier+compris+entre+0+et+100'
    )
  }
  const seuil = seuilRaw
  if (date_validite < todayIso()) {
    return redirect(
      '/offres/nouvelle?error=La+date+de+validit%C3%A9+doit+%C3%AAtre+post%C3%A9rieure+ou+%C3%A9gale+%C3%A0+aujourd%27hui'
    )
  }

  const { data, error } = await supabase
    .from('offres')
    .insert({
      titre,
      client_id,
      description,
      lieu,
      statut: 'actif',
      contrat,
      seuil,
      date_validite,
      am_referent,
    })
    .select('id')
    .single()

  if (error || !data) {
    const message = error?.message ?? 'Erreur+inconnue'
    return redirect(
      `/offres/nouvelle?error=${encodeURIComponent(message)}`
    )
  }

  revalidatePath('/offres')
  redirect(`/offres/${data.id}`)
}

/**
 * Reçoit un PDF d'offre d'emploi en FormData, appelle Claude pour extraire
 * les champs, puis essaie de matcher le client extrait avec un client
 * existant (match par nom, case-insensitive).
 */
export async function extractOffreAction(
  formData: FormData
): Promise<
  | {
      ok: true
      data: ExtractedOffre
      matchedClientId: string | null
    }
  | { ok: false; error: string }
> {
  const file = formData.get('pdf')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Aucun fichier PDF transmis.' }
  }
  if (
    file.type !== 'application/pdf' &&
    !file.name.toLowerCase().endsWith('.pdf')
  ) {
    return { ok: false, error: 'Seul un PDF est accepté.' }
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const result = await extractOffreFromPdfBuffer(buffer)
  if (!result.ok) return result

  // Essaye de matcher le nom du client extrait avec un client existant
  const supabase = await createClient()
  const { data: clients } = await supabase.from('clients').select('id, nom')

  const normalize = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  const target = normalize(result.data.client_nom)
  const match = clients?.find((c) => normalize(c.nom) === target)

  return {
    ok: true,
    data: result.data,
    matchedClientId: match?.id ?? null,
  }
}

/**
 * Crée un client inline depuis le formulaire d'offre (modale).
 * Retourne l'id + nom pour que le client puisse être sélectionné dans le
 * dropdown sans recharger la page.
 */
export async function createClientInlineAction(input: {
  nom: string
  secteur: string | null
  contact_email: string | null
  formule: string
  am_referent: string | null
}): Promise<
  { ok: true; client: { id: string; nom: string } } | { ok: false; error: string }
> {
  const supabase = await createClient()

  const nom = input.nom.trim()
  if (!nom) return { ok: false, error: 'Le nom du client est obligatoire.' }

  // Détection de doublon : même logique que createClientAction, mais on
  // retourne l'erreur pour l'afficher dans la modale (pas de redirect).
  const { data: existing } = await supabase.from('clients').select('nom')
  const targetNorm = normalizeClientName(nom)
  const duplicate = (existing ?? []).find(
    (c) => normalizeClientName(c.nom ?? '') === targetNorm
  )
  if (duplicate) {
    // Le préfixe « Un client nommé » est reconnu par la modale pour afficher
    // la bannière à 2 choix (abandonner / modifier le nom). Les options
    // détaillées sont fournies par la bannière, pas par ce message.
    return {
      ok: false,
      error: `Un client nommé « ${duplicate.nom} » existe déjà.`,
    }
  }

  const secteur = input.secteur?.trim() || null
  const contact_email = input.contact_email?.trim() || null
  const formule = FORMULES.includes(input.formule) ? input.formule : 'Abonnement'
  const am_referent = formatReferent(input.am_referent)

  const { data, error } = await supabase
    .from('clients')
    .insert({ nom, secteur, contact_email, formule, am_referent })
    .select('id, nom')
    .single()

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Erreur inconnue.' }
  }

  revalidatePath('/clients')
  return { ok: true, client: data }
}
