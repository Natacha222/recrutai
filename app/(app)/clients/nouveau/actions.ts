'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function createClientAction(formData: FormData) {
  const supabase = await createClient()

  const nom = String(formData.get('nom') ?? '').trim()
  const secteur = String(formData.get('secteur') ?? '').trim() || null
  const contact_email =
    String(formData.get('contact_email') ?? '').trim() || null

  if (!nom) {
    return redirect('/clients/nouveau?error=Le+nom+est+obligatoire')
  }

  const { error } = await supabase
    .from('clients')
    .insert({ nom, secteur, contact_email })

  if (error) {
    return redirect(`/clients/nouveau?error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/clients')
  redirect('/clients')
}
