'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { formatReferent, normalizeClientName } from '@/lib/format'
import { FIELD_LIMITS, truncate } from '@/lib/validation'

const FORMULES = ['Abonnement', 'À la mission', 'Volume entreprise']

export async function updateClient(formData: FormData) {
  const supabase = await createClient()

  const id = String(formData.get('id') ?? '').trim()
  // Troncature défensive — voir commentaire dans createClientAction.
  const nom = truncate(
    String(formData.get('nom') ?? ''),
    FIELD_LIMITS.client_nom
  ).trim()
  const secteur =
    truncate(
      String(formData.get('secteur') ?? ''),
      FIELD_LIMITS.client_secteur
    ).trim() || null
  const contact_email =
    truncate(
      String(formData.get('contact_email') ?? ''),
      FIELD_LIMITS.email
    ).trim() || null
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
