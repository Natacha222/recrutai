'use server'

import { getAuthedClient } from '@/lib/auth/require-user'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { formatReferent, isValidEmail, normalizeClientName } from '@/lib/format'
import { FIELD_LIMITS, truncate } from '@/lib/validation'

const FORMULES = ['Abonnement', 'À la mission', 'Volume entreprise']

export async function updateClient(formData: FormData) {
  const { supabase, user } = await getAuthedClient()
  if (!user) return redirect('/login?error=Session+expir%C3%A9e')

  const id = String(formData.get('id') ?? '').trim()
  // Troncature défensive — voir commentaire dans createClientAction.
  const nom = truncate(
    String(formData.get('nom') ?? ''),
    FIELD_LIMITS.client_nom
  ).trim()
  const secteur = truncate(
    String(formData.get('secteur') ?? ''),
    FIELD_LIMITS.client_secteur
  ).trim()
  const contact_email = truncate(
    String(formData.get('contact_email') ?? ''),
    FIELD_LIMITS.email
  ).trim()
  const formuleRaw = String(formData.get('formule') ?? '').trim()
  const formule = FORMULES.includes(formuleRaw) ? formuleRaw : 'Abonnement'
  const am_referent = formatReferent(
    truncate(
      String(formData.get('am_referent') ?? ''),
      FIELD_LIMITS.am_referent
    )
  )

  if (!id) {
    return redirect('/clients?error=Client+introuvable')
  }

  if (!nom) {
    return redirect(`/clients/${id}?error=Le+nom+est+obligatoire`)
  }

  // Secteur et email de notification sont obligatoires, alignés sur la
  // création : les `required` HTML bloquent déjà la saisie normale, on
  // re-check ici pour les POST directs et pour éviter qu'une édition
  // vide en douce ces champs sur un client existant.
  if (!secteur) {
    return redirect(`/clients/${id}?error=Le+secteur+est+obligatoire`)
  }
  if (!contact_email) {
    return redirect(
      `/clients/${id}?error=L%27email+de+notification+est+obligatoire`
    )
  }

  // Filet serveur identique à createClientAction : `type="email"` seul
  // accepte `user@host` sans point, on durcit avec isValidEmail.
  if (!isValidEmail(contact_email)) {
    return redirect(
      `/clients/${id}?error=${encodeURIComponent(
        'Format d\'email invalide. Utilise par exemple prenom.nom@domaine.fr.'
      )}`
    )
  }

  // Détection de doublon côté app : exclut le client courant (on peut
  // reenregistrer son propre nom) et compare le nom normalisé aux autres.
  // L'index unique posé en DB (clients_nom_normalise_uniq) reste le
  // vrai filet de sécurité anti-race — ce check pré-update sert juste à
  // produire un meilleur message (avec le nom exact du client existant).
  const { data: existing } = await supabase
    .from('clients')
    .select('id, nom')
    .neq('id', id)
  const targetNorm = normalizeClientName(nom)
  const duplicate = (existing ?? []).find(
    (c) => normalizeClientName(c.nom ?? '') === targetNorm
  )
  if (duplicate) {
    // Le préfixe « Un client nommé » est reconnu par la page pour afficher
    // la bannière à 2 choix (abandonner / modifier le nom). Les options
    // détaillées sont fournies par la bannière, pas par ce message.
    const msg = `Un client nommé « ${duplicate.nom} » existe déjà.`
    return redirect(`/clients/${id}?error=${encodeURIComponent(msg)}`)
  }

  const { error } = await supabase
    .from('clients')
    .update({ nom, secteur, contact_email, formule, am_referent })
    .eq('id', id)

  if (error) {
    // Code 23505 = conflit d'index unique (race-condition sur le nom
    // normalisé). Message explicite pour que l'utilisateur comprenne
    // qu'un autre onglet/collègue a créé un homonyme entre-temps.
    if (error.code === '23505') {
      const msg =
        'Un client avec ce nom vient d\'être créé par un autre utilisateur. Recharge la liste pour le voir.'
      return redirect(`/clients/${id}?error=${encodeURIComponent(msg)}`)
    }
    return redirect(
      `/clients/${id}?error=${encodeURIComponent(error.message)}`
    )
  }

  revalidatePath('/clients')
  revalidatePath(`/clients/${id}`)
  redirect(`/clients?saved=${encodeURIComponent(nom)}`)
}

/**
 * Supprime définitivement un client + TOUTES ses offres + TOUTES leurs
 * candidatures + tous les fichiers Storage associés.
 *
 * Stratégie en cascade explicite (sans dépendre d'un éventuel ON DELETE
 * CASCADE en DB) :
 *  1. Lecture des offres + candidatures liées AVANT suppression, pour
 *     récupérer la liste exhaustive des paths Storage à nettoyer.
 *  2. Suppression Storage (best-effort) : CVs (`cvs/`) + PDFs d'offres
 *     (`offres-pdf/`). Erreurs loggées mais non bloquantes — un orphelin
 *     dans le bucket est moins grave qu'une row DB pointant vers un
 *     fichier mort.
 *  3. DELETE candidatures → DELETE offres → DELETE client (ordre
 *     important pour ne pas violer la FK).
 *  4. Revalidate des pages impactées.
 *
 * Action irréversible : pas de soft-delete. La confirmation UI est dans
 * DeleteClientButton (modal avec compte exact des offres + CVs liés).
 */
export type DeleteClientResult =
  | { ok: true }
  | { ok: false; error: string }

export async function deleteClient(
  clientId: string
): Promise<DeleteClientResult> {
  if (!clientId) return { ok: false, error: 'Client introuvable.' }

  const { supabase, user } = await getAuthedClient()
  if (!user) {
    return { ok: false, error: 'Session expirée, reconnecte-toi.' }
  }

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .single()
  if (clientErr || !client) {
    return { ok: false, error: 'Client introuvable.' }
  }

  const { data: offres, error: offresErr } = await supabase
    .from('offres')
    .select('id, pdf_path')
    .eq('client_id', clientId)
  if (offresErr) {
    return { ok: false, error: `Lecture offres : ${offresErr.message}` }
  }

  const offreIds = (offres ?? []).map((o) => o.id)

  // Toutes les candidatures liées à toutes les offres du client (transitif).
  let candidatures: Array<{ id: string; cv_path: string | null }> = []
  if (offreIds.length > 0) {
    const { data, error: candErr } = await supabase
      .from('candidatures')
      .select('id, cv_path')
      .in('offre_id', offreIds)
    if (candErr) {
      return {
        ok: false,
        error: `Lecture candidatures : ${candErr.message}`,
      }
    }
    candidatures = data ?? []
  }

  // Storage cleanup — best-effort. Voir deleteOffre pour le rationale détaillé.
  const cvPaths = candidatures
    .map((c) => c.cv_path)
    .filter((p): p is string => !!p)
  if (cvPaths.length > 0) {
    const { error: cvStorageErr } = await supabase.storage
      .from('cvs')
      .remove(cvPaths)
    if (cvStorageErr) {
      console.warn(
        `[deleteClient] suppression CVs Storage partielle : ${cvStorageErr.message}`
      )
    }
  }
  const offrePdfPaths = (offres ?? [])
    .map((o) => o.pdf_path)
    .filter((p): p is string => !!p)
  if (offrePdfPaths.length > 0) {
    const { error: offresStorageErr } = await supabase.storage
      .from('offres-pdf')
      .remove(offrePdfPaths)
    if (offresStorageErr) {
      console.warn(
        `[deleteClient] suppression PDFs offres Storage : ${offresStorageErr.message}`
      )
    }
  }

  // DB cleanup — candidatures, puis offres, puis client (ordre = inverse
  // des dépendances FK pour ne pas violer de contrainte).
  if (offreIds.length > 0) {
    const { error: delCandErr } = await supabase
      .from('candidatures')
      .delete()
      .in('offre_id', offreIds)
    if (delCandErr) {
      return {
        ok: false,
        error: `Suppression candidatures : ${delCandErr.message}`,
      }
    }
  }

  const { error: delOffresErr } = await supabase
    .from('offres')
    .delete()
    .eq('client_id', clientId)
  if (delOffresErr) {
    return {
      ok: false,
      error: `Suppression offres : ${delOffresErr.message}`,
    }
  }

  const { error: delClientErr } = await supabase
    .from('clients')
    .delete()
    .eq('id', clientId)
  if (delClientErr) {
    return {
      ok: false,
      error: `Suppression client : ${delClientErr.message}`,
    }
  }

  revalidatePath('/clients')
  revalidatePath('/offres')
  revalidatePath('/dashboard')
  revalidatePath('/candidatures')
  return { ok: true }
}
