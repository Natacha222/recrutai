'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function createOffre(formData: FormData) {
  const supabase = await createClient()

  const titre = String(formData.get('titre') ?? '').trim()
  const client_id = String(formData.get('client_id') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const lieu = String(formData.get('lieu') ?? '').trim() || null

  if (!titre || !client_id) {
    return redirect(
      '/offres/nouvelle?error=Le+titre+et+le+client+sont+obligatoires'
    )
  }

  const { error } = await supabase
    .from('offres')
    .insert({ titre, client_id, description, lieu, statut: 'actif' })

  if (error) {
    return redirect(`/offres/nouvelle?error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/offres')
  redirect('/offres')
}
