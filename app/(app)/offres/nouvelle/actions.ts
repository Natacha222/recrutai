'use server'

import { getAuthedClient } from '@/lib/auth/require-user'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  extractOffreFromPdfBuffer,
  type ExtractedOffre,
} from '@/lib/offre-extraction'
import {
  formatReferent,
  isValidEmail,
  normalizeClientName,
  todayIso,
} from '@/lib/format'
import { FIELD_LIMITS, truncate } from '@/lib/validation'

const CONTRATS = ['CDI', 'CDD', 'Alternance', 'Stage']
const FORMULES = ['Abonnement', 'À la mission', 'Volume entreprise']
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Taille max d'un PDF uploadé (offre ou CV côté CVUploader). 10 Mo est
// largement au-dessus de ce qu'on rencontre en pratique (CV ~1-3 Mo, offre
// ~2-5 Mo) et nous protège contre un user qui renommerait une archive ou
// une vidéo en .pdf — un fichier de 500 Mo planterait la RAM de la fonction
// serverless Vercel (~1 Go max). Synchronisé avec le check côté CVUploader.
const MAX_PDF_SIZE = 10 * 1024 * 1024

export async function createOffre(formData: FormData) {
  const { supabase, user } = await getAuthedClient()
  if (!user) return redirect('/login?error=Session+expir%C3%A9e')

  // Troncature défensive sur tous les champs texte : protège contre un
  // POST qui contournerait le maxLength HTML (paste monstrueux, attaque
  // manuelle). Limites dans lib/validation.ts.
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
  // La référence est obligatoire (V25) : une offre sans réf crée un flou
  // administratif. On la stocke telle quelle (sans mise en majuscules) car
  // les refs client sont parfois sensibles à la casse côté ATS client.
  const reference = truncate(
    String(formData.get('reference') ?? ''),
    FIELD_LIMITS.offre_reference
  ).trim()
  // Chemin du PDF dans le bucket offres-pdf, renseigné uniquement si l'offre
  // a été pré-remplie via « Importer un PDF ». NULL sinon → pas de bouton
  // « Voir le PDF » sur la fiche.
  const pdf_path = String(formData.get('pdf_path') ?? '').trim() || null

  if (
    !titre ||
    !client_id ||
    !lieu ||
    !description ||
    !date_validite ||
    !reference
  ) {
    return redirect(
      '/offres/nouvelle?error=Tous+les+champs+sont+obligatoires'
    )
  }
  if (
    !Number.isFinite(seuilRaw) ||
    seuilRaw < 50 ||
    seuilRaw > 100 ||
    !Number.isInteger(seuilRaw)
  ) {
    return redirect(
      '/offres/nouvelle?error=Le+seuil+doit+%C3%AAtre+un+entier+compris+entre+50+et+100'
    )
  }
  const seuil = seuilRaw
  if (date_validite < todayIso()) {
    return redirect(
      '/offres/nouvelle?error=La+date+de+validit%C3%A9+doit+%C3%AAtre+post%C3%A9rieure+ou+%C3%A9gale+%C3%A0+aujourd%27hui'
    )
  }

  // Pré-check d'unicité de la référence (case-insensitive, trimmée). On ne
  // peut pas poser un index unique en DB : il y a déjà des doublons
  // historiques (ex. DEV-2026-042 sur plusieurs offres actives). On bloque
  // donc côté app pour éviter d'en créer de nouveaux tout en laissant les
  // existants en place — le ménage se fera manuellement via la page
  // « Modifier ». Une race-condition reste théoriquement possible (deux
  // créations simultanées avec la même référence) mais le volume
  // d'utilisateurs est très faible : acceptable.
  const refLower = reference.toLowerCase()
  const { data: existingRefs } = await supabase
    .from('offres')
    .select('id, reference')
  const duplicate = (existingRefs ?? []).find(
    (o) => (o.reference ?? '').toLowerCase().trim() === refLower
  )
  if (duplicate) {
    return redirect(
      `/offres/nouvelle?error=${encodeURIComponent(
        `La référence « ${reference} » est déjà utilisée par une autre offre. Choisis-en une différente.`
      )}`
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
      reference,
      pdf_path,
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
 *
 * Stocke également le PDF dans le bucket `offres-pdf` pour qu'on puisse
 * le proposer en téléchargement depuis la fiche offre une fois créée.
 * Le path est retourné et sera réémis par le formulaire via un champ
 * hidden `pdf_path` → persistance dans `offres.pdf_path`.
 */
export async function extractOffreAction(
  formData: FormData
): Promise<
  | {
      ok: true
      data: ExtractedOffre
      matchedClientId: string | null
      pdfPath: string | null
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
  if (file.size > MAX_PDF_SIZE) {
    const sizeMb = (file.size / 1024 / 1024).toFixed(1)
    return {
      ok: false,
      error: `Fichier trop volumineux (${sizeMb} Mo). Limite : 10 Mo.`,
    }
  }

  const { supabase, user } = await getAuthedClient()
  if (!user) {
    return { ok: false, error: 'Session expirée, reconnecte-toi.' }
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const result = await extractOffreFromPdfBuffer(buffer)
  if (!result.ok) return result

  // Upload du PDF dans le bucket offres-pdf. L'offre n'existe pas encore
  // à ce stade, donc on stocke sous `${userId}/${timestamp}-${nom}`. Si
  // l'utilisateur abandonne le formulaire, l'objet reste orphelin — c'est
  // acceptable en pratique (volume faible + on peut nettoyer a posteriori).
  let pdfPath: string | null = null
  try {
    const userId = user.id
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const candidatePath = `${userId}/${Date.now()}-${safeName}`
    const { error: upErr } = await supabase.storage
      .from('offres-pdf')
      .upload(candidatePath, buffer, {
        upsert: false,
        contentType: 'application/pdf',
      })
    if (upErr) {
      console.warn(
        `[extractOffreAction] upload PDF échoué (on continue sans) : ${upErr.message}`
      )
    } else {
      pdfPath = candidatePath
    }
  } catch (e) {
    // L'upload est un bonus, pas un bloquant : on log et on continue.
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[extractOffreAction] upload PDF exception : ${msg}`)
  }

  // Essaye de matcher le nom du client extrait avec un client existant
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
    pdfPath,
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
  const { supabase, user } = await getAuthedClient()
  if (!user) {
    return { ok: false, error: 'Session expirée, reconnecte-toi.' }
  }

  // Troncature défensive — voir createClientAction pour le rationale.
  const nom = truncate(input.nom, FIELD_LIMITS.client_nom).trim()
  if (!nom) return { ok: false, error: 'Le nom du client est obligatoire.' }

  // Détection de doublon côté app : même logique que createClientAction,
  // mais on retourne l'erreur pour l'afficher dans la modale (pas de
  // redirect). L'index unique DB reste le vrai filet anti-race.
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

  const secteur = truncate(
    input.secteur ?? '',
    FIELD_LIMITS.client_secteur
  ).trim()
  const contact_email = truncate(
    input.contact_email ?? '',
    FIELD_LIMITS.email
  ).trim()
  // Secteur + email de notification obligatoires (aligné sur
  // createClientAction). Les `required` HTML bloquent la modale, mais
  // on garde le filet serveur pour les POST directs.
  if (!secteur) {
    return { ok: false, error: 'Le secteur est obligatoire.' }
  }
  if (!contact_email) {
    return { ok: false, error: 'L\'email de notification est obligatoire.' }
  }
  // Filet serveur : `type="email"` seul accepte `user@host` sans point,
  // on durcit avec isValidEmail pour garantir un domaine avec TLD.
  if (!isValidEmail(contact_email)) {
    return {
      ok: false,
      error:
        'Format d\'email invalide. Utilise par exemple prenom.nom@domaine.fr.',
    }
  }
  const formule = FORMULES.includes(input.formule) ? input.formule : 'Abonnement'
  const am_referent = formatReferent(
    truncate(input.am_referent ?? '', FIELD_LIMITS.am_referent)
  )

  const { data, error } = await supabase
    .from('clients')
    .insert({ nom, secteur, contact_email, formule, am_referent })
    .select('id, nom')
    .single()

  if (error || !data) {
    // Code 23505 = race-condition sur l'index unique clients_nom_normalise_uniq.
    // Message orienté modale : l'utilisateur doit fermer et recharger la
    // liste des clients pour sélectionner celui que l'autre a créé.
    if (error?.code === '23505') {
      return {
        ok: false,
        error:
          'Un client avec ce nom vient d\'être créé par un autre utilisateur. Ferme la modale et recharge la liste.',
      }
    }
    return { ok: false, error: error?.message ?? 'Erreur inconnue.' }
  }

  revalidatePath('/clients')
  return { ok: true, client: data }
}
