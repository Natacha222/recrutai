import Link from 'next/link'
import { createClientAction } from './actions'

type SearchParams = Promise<{ error?: string }>

const FORMULES = ['Abonnement', 'À la mission', 'Volume entreprise']

export default async function NouveauClientPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { error } = await searchParams

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Nouveau client</h1>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
          {error}
        </div>
      )}

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

        <Field
          label="Référent"
          name="am_referent"
          placeholder="N. MAGNE (1re lettre du prénom, puis nom)"
        />

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
