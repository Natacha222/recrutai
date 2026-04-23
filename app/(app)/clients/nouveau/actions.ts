'use server'

import { getAuthedClient } from '@/lib/auth/require-user'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { formatReferent, isValidEmail, normalizeClientName } from '@/lib/format'
import { FIELD_LIMITS, truncate } from '@/lib/validation'

const FORMULES = ['Abonnement', 'À la mission', 'Volume entreprise']

export async function createClientAction(formData: FormData) {
  const { supabase, user } = await getAuthedClient()
  if (!user) return redirect('/login?error=Session+expir%C3%A9e')

  // Troncature défensive : le `maxLength` côté HTML protège la saisie
  // normale, mais un POST direct ou un paste monstrueux peuvent passer
  // outre. On coupe AVANT le trim pour que trim finisse le boulot.
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

  if (!nom) {
    return redirect('/clients/nouveau?error=Le+nom+est+obligatoire')
  }

  // Secteur et email de notification sont obligatoires : les `required`
  // HTML bloquent la saisie normale, mais on double-check ici pour les
  // POST directs et pour garder l'invariant côté DB (un client complet =
  // nom + secteur + email exploitable pour les notifs clients).
  if (!secteur) {
    return redirect('/clients/nouveau?error=Le+secteur+est+obligatoire')
  }
  if (!contact_email) {
    return redirect(
      '/clients/nouveau?error=L%27email+de+notification+est+obligatoire'
    )
  }

  // Filet serveur : HTML `type="email"` bloque déjà la plupart des saisies
  // incorrectes côté navigateur, mais un POST direct peut contourner, et
  // `type="email"` seul accepte `user@host` sans point.
  if (!isValidEmail(contact_email)) {
    return redirect(
      `/clients/nouveau?error=${encodeURIComponent(
        'Format d\'email invalide. Utilise par exemple prenom.nom@domaine.fr.'
      )}`
    )
  }

  // Détection de doublon côté app : compare le nom normalisé (casse/
  // accents/espaces) avec les noms existants. L'index unique posé en DB
  // (clients_nom_normalise_uniq) est le vrai filet de sécurité contre
  // les races de concurrence — ce check pré-insert sert juste à produire
  // un meilleur message d'erreur (avec le nom exact du client existant).
  const { data: existing } = await supabase.from('clients').select('nom')
  const targetNorm = normalizeClientName(nom)
  const duplicate = (existing ?? []).find(
    (c) => normalizeClientName(c.nom ?? '') === targetNorm
  )
  if (duplicate) {
    // Le préfixe « Un client nommé » est reconnu par la page pour afficher
    // la bannière à 2 choix (abandonner / modifier le nom). Les options
    // détaillées sont fournies par la bannière, pas par ce message.
    const msg = `Un client nommé « ${duplicate.nom} » existe déjà.`
    return redirect(`/clients/nouveau?error=${encodeURIComponent(msg)}`)
  }

  const { data, error } = await supabase
    .from('clients')
    .insert({ nom, secteur, contact_email, formule, am_referent })
    .select('id')
    .single()

  if (error || !data) {
    // Code 23505 = violation de contrainte unique. Se déclenche quand
    // deux recruteurs créent le même client en parallèle et que le 2e
    // INSERT perd la course (l'index clients_nom_normalise_uniq refuse).
    // On ne connaît pas le nom exact qui conflit (l'index est fonctionnel)
    // → message générique qui invite à recharger pour voir le doublon.
    if (error?.code === '23505') {
      const msg =
        'Un client avec ce nom vient d\'être créé par un autre utilisateur. Recharge la liste pour le voir.'
      return redirect(`/clients/nouveau?error=${encodeURIComponent(msg)}`)
    }
    const message = error?.message ?? 'Erreur+inconnue'
    return redirect(`/clients/nouveau?error=${encodeURIComponent(message)}`)
  }

  revalidatePath('/clients')
  redirect(`/clients/${data.id}`)
}
