import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { referentFromEmail } from '@/lib/format'
import { getAvailableReferents } from '@/lib/referents'
import { createClientAction } from './actions'
import DuplicateClientErrorBanner from '@/components/DuplicateClientErrorBanner'

type SearchParams = Promise<{ error?: string }>

const FORMULES = ['Abonnement', 'À la mission', 'Volume entreprise']

// Les actions serveur préfixent le message par « Un client nommé » quand on
// détecte un doublon : c'est le marqueur qui déclenche la bannière à 2 choix.
function isDuplicateError(err: string | undefined): err is string {
  return !!err && err.startsWith('Un client nommé')
}

export default async function NouveauClientPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { error } = await searchParams

  // User connecté + liste des référents distincts (union clients + offres).
  // L'user courant est toujours ajouté à la liste pour qu'il puisse se
  // sélectionner même s'il n'a encore aucun client ni aucune offre.
  const supabase = await createClient()
  const userRes = await supabase.auth.getUser()
  const defaultReferent = referentFromEmail(userRes.data.user?.email)
  const availableReferents = await getAvailableReferents(supabase, [
    defaultReferent,
  ])

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Nouveau client</h1>

      {isDuplicateError(error) ? (
        <DuplicateClientErrorBanner
          message={error}
          cancelHref="/clients"
          nameInputId="nom"
        />
      ) : error ? (
        <div className="mb-4 px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
          {error}
        </div>
      ) : null}

      <form
        action={createClientAction}
        className="bg-surface-alt rounded-xl p-6 border border-border-soft space-y-4"
      >
        <Field label="Nom de l'entreprise" name="nom" required />
        <Field label="Secteur" name="secteur" />
        <Field label="Email de notification" name="contact_email" type="email" />

        <div>
          <label
            htmlFor="formule"
            className="block text-sm font-medium text-brand-indigo-text mb-1"
          >
            Formule
          </label>
          <select
            id="formule"
            name="formule"
            defaultValue="Abonnement"
            className="w-full px-3 py-2 border border-border-soft rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand-purple"
          >
            {FORMULES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="am_referent"
            className="block text-sm font-medium text-brand-indigo-text mb-1"
          >
            Référent
          </label>
          <select
            id="am_referent"
            name="am_referent"
            defaultValue={defaultReferent ?? ''}
            className="w-full px-3 py-2 border border-border-soft rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand-purple"
          >
            <option value="">— Sans référent —</option>
            {availableReferents.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Link
            href="/clients"
            className="px-4 py-2 border border-border-soft rounded-md text-sm hover:bg-surface"
          >
            Annuler
          </Link>
          <button
            type="submit"
            className="px-4 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold hover:opacity-90"
          >
            Enregistrer le client
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label,
  name,
  type = 'text',
  required = false,
  placeholder,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  placeholder?: string
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="block text-sm font-medium text-brand-indigo-text mb-1"
      >
        {label} {required && <span className="text-status-red">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
      />
    </div>
  )
}
