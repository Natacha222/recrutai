'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { formatReferent } from '@/lib/format'

const FORMULES = ['Abonnement', 'À la mission', 'Volume entreprise']

export async function updateClient(formData: FormData) {
  const supabase = await createClient()

  const id = String(formData.get('id') ?? '').trim()
  const nom = String(formData.get('nom') ?? '').trim()
  const secteur = String(formData.get('secteur') ?? '').trim() || null
  const contact_email =
    String(formData.get('contact_email') ?? '').trim() || null
  const formuleRaw = String(formData.get('formule') ?? '').trim()
  const formule = FORMULES.includes(formuleRaw) ? formuleRaw : 'Abonnement'
  const am_referent = formatReferent(
    String(formData.get('am_referent') ?? '')
  )

  if (!id) {
    return redirect('/clients?error=Client+introuvable')
  }

  if (!nom) {
    return redirect(`/clients/${id}?error=Le+nom+est+obligatoire`)
  }

  const { error } = await supabase
    .from('clients')
    .update({ nom, secteur, contact_email, formule, am_referent })
    .eq('id', id)

  if (error) {
    return redirect(
      `/clients/${id}?error=${encodeURIComponent(error.message)}`
    )
  }

  revalidatePath('/clients')
  revalidatePath(`/clients/${id}`)
  redirect(`/clients?saved=${encodeURIComponent(nom)}`)
}
