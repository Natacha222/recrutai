'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

const CONTRATS = ['CDI', 'CDD', 'Alternance', 'Stage']

export async function createOffre(formData: FormData) {
  const supabase = await createClient()

  const titre = String(formData.get('titre') ?? '').trim()
  const client_id = String(formData.get('client_id') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const lieu = String(formData.get('lieu') ?? '').trim() || null
  const contratRaw = String(formData.get('contrat') ?? '').trim()
  const contrat = CONTRATS.includes(contratRaw) ? contratRaw : 'CDI'
  const seuilRaw = Number(formData.get('seuil') ?? 60)
  const seuil = Number.isFinite(seuilRaw)
    ? Math.min(100, Math.max(0, Math.round(seuilRaw)))
    : 60

  if (!titre || !client_id) {
    return redirect(
      '/offres/nouvelle?error=Le+titre+et+le+client+sont+obligatoires'
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
