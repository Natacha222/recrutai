'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import {
  createOffre,
  extractOffreAction,
  createClientInlineAction,
} from './actions'

type Client = { id: string; nom: string }
type Contrat = 'CDI' | 'CDD' | 'Alternance' | 'Stage'
type ImportStatus = 'idle' | 'importing' | 'error' | 'success'

const CONTRATS: Contrat[] = ['CDI', 'CDD', 'Alternance', 'Stage']

export default function OffreForm({
  clients: initialClients,
  initialClientId,
  today,
}: {
  clients: Client[]
  initialClientId: string
  today: string
}) {
  const [clients, setClients] = useState<Client[]>(initialClients)

  // Champs du formulaire (contrôlés pour pouvoir les pré-remplir depuis le PDF)
  const [titre, setTitre] = useState('')
  const [clientId, setClientId] = useState(initialClientId)
  const [lieu, setLieu] = useState('')
  const [contrat, setContrat] = useState<Contrat>('CDI')
  const [seuil, setSeuil] = useState<number>(60)
  const [description, setDescription] = useState('')
  const [dateValidite, setDateValidite] = useState('')

  // État de l'import PDF
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle')
  const [importMessage, setImportMessage] = useState('')
  const pdfInputRef = useRef<HTMLInputElement>(null)

  // Client manquant : nom extrait qui ne matche aucun client existant
  const [missingClientName, setMissingClientName] = useState<string | null>(null)

  // Modale de création de client inline
  const [showClientModal, setShowClientModal] = useState(false)

  async function handlePdfImport(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    if (
      file.type !== 'application/pdf' &&
      !file.name.toLowerCase().endsWith('.pdf')
    ) {
      setImportStatus('error')
      setImportMessage('Seul un PDF est accepté.')
      return
    }

    setImportStatus('importing')
    setImportMessage('')

    const formData = new FormData()
    formData.append('pdf', file)

    const result = await extractOffreAction(formData)

    if (pdfInputRef.current) pdfInputRef.current.value = ''

    if (!result.ok) {
      setImportStatus('error')
      setImportMessage(result.error)
      return
    }

    setTitre(result.data.titre)
    setLieu(result.data.lieu)
    setContrat(result.data.contrat)
    setDescription(result.data.description)
    // On n'accepte une date extraite que si elle est dans le futur, sinon
    // l'utilisateur serait bloqué au moment de valider.
    if (result.data.date_validite && result.data.date_validite >= today) {
      setDateValidite(result.data.date_validite)
    }

    if (result.matchedClientId) {
      setClientId(result.matchedClientId)
      setMissingClientName(null)
    } else {
      setClientId('')
      setMissingClientName(result.data.client_nom)
    }

    setImportStatus('success')
    setImportMessage(
      result.matchedClientId
        ? 'Champs remplis automatiquement par l\'IA.'
        : `Champs remplis. Le client « ${result.data.client_nom} » n'existe pas encore — crée-le avant de valider.`
    )
  }

  async function handleClientCreated(newClient: Client) {
    setClients((prev) =>
      [...prev, newClient].sort((a, b) => a.nom.localeCompare(b.nom))
    )
    setClientId(newClient.id)
    setMissingClientName(null)
    setShowClientModal(false)
  }

  // Validation de la date. Un fallback local au navigateur sert de
  // filet si le `today` envoyé par le serveur est vide (ex. souci ICU
  // sur Vercel) — dans ce cas on ne peut pas compter dessus pour la
  // comparaison.
  const clientToday = (() => {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  })()
  const effectiveToday = /^\d{4}-\d{2}-\d{2}$/.test(today)
    ? today
    : clientToday

  const dateFormatIsValid = /^\d{4}-\d{2}-\d{2}$/.test(dateValidite)
  const dateInPast = dateFormatIsValid && dateValidite < effectiveToday
  const todayDisplay = `${effectiveToday.slice(8, 10)}/${effectiveToday.slice(5, 7)}/${effectiveToday.slice(0, 4)}`

  const allFieldsFilled =
    titre.trim() !== '' &&
    clientId !== '' &&
    lieu.trim() !== '' &&
    description.trim() !== '' &&
    Number.isFinite(seuil) &&
    dateFormatIsValid &&
    !dateInPast

  return (
    <>
      {/* En-tête : bouton d'import PDF compact */}
      <div className="flex items-start justify-end gap-4 flex-wrap mb-4">
        <label
          className={`inline-flex items-center gap-2 px-4 py-2 border-2 border-brand-purple text-brand-purple rounded-md text-sm font-semibold whitespace-nowrap ${
            importStatus === 'importing'
              ? 'opacity-60 cursor-not-allowed'
              : 'cursor-pointer hover:bg-brand-purple hover:text-white'
          }`}
        >
          <span>
            {importStatus === 'importing'
              ? 'Analyse IA…'
              : '📎 Importer un PDF'}
          </span>
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf"
            disabled={importStatus === 'importing'}
            onChange={(e) => handlePdfImport(e.target.files)}
            className="hidden"
          />
        </label>
      </div>

      {importStatus === 'success' && importMessage && (
        <div className="mb-4 px-3 py-2 rounded-md bg-status-green-bg text-status-green text-sm">
          {importMessage}
        </div>
      )}
      {importStatus === 'error' && importMessage && (
        <div className="mb-4 px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
          {importMessage}
        </div>
      )}

      {/* Formulaire */}
      <form
        action={createOffre}
        className="bg-surface-alt rounded-xl p-6 border border-border-soft space-y-4"
      >
        <div>
          <label
            htmlFor="titre"
            className="block text-sm font-medium text-brand-indigo-text mb-1"
          >
            Titre du poste <span className="text-status-red">*</span>
          </label>
          <input
            id="titre"
            name="titre"
            type="text"
            required
            value={titre}
            onChange={(e) => setTitre(e.target.value)}
            className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
        </div>

        <div>
          <label
            htmlFor="client_id"
            className="block text-sm font-medium text-brand-indigo-text mb-1"
          >
            Client <span className="text-status-red">*</span>
          </label>

          {missingClientName ? (
            <div className="px-4 py-3 rounded-md border border-status-amber bg-status-amber-bg">
              <div className="text-sm text-brand-indigo-text">
                Le client{' '}
                <strong>&laquo;&nbsp;{missingClientName}&nbsp;&raquo;</strong>{' '}
                n&apos;existe pas encore dans ta base. Tu dois le créer avant
                de valider l&apos;offre.
              </div>
              <button
                type="button"
                onClick={() => setShowClientModal(true)}
                className="mt-3 px-3 py-1.5 bg-brand-purple text-white rounded-md text-sm font-semibold hover:opacity-90"
              >
                + Créer ce client
              </button>
            </div>
          ) : (
            <select
              id="client_id"
              name="client_id"
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full px-3 py-2 border border-border-soft rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand-purple"
            >
              <option value="">— Sélectionnez un client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label
              htmlFor="lieu"
              className="block text-sm font-medium text-brand-indigo-text mb-1"
            >
              Lieu <span className="text-status-red">*</span>
            </label>
            <input
              id="lieu"
              name="lieu"
              type="text"
              required
              value={lieu}
              onChange={(e) => setLieu(e.target.value)}
              className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
            />
          </div>
          <div>
            <label
              htmlFor="contrat"
              className="block text-sm font-medium text-brand-indigo-text mb-1"
            >
              Contrat <span className="text-status-red">*</span>
            </label>
            <select
              id="contrat"
              name="contrat"
              required
              value={contrat}
              onChange={(e) => setContrat(e.target.value as Contrat)}
              className="w-full px-3 py-2 border border-border-soft rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand-purple"
            >
              {CONTRATS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="seuil"
              className="block text-sm font-medium text-brand-indigo-text mb-1"
            >
              Seuil de qualification{' '}
              <span className="text-status-red">*</span>
            </label>
            <input
              id="seuil"
              name="seuil"
              type="number"
              min={0}
              max={100}
              step={1}
              required
              value={seuil}
              onChange={(e) => setSeuil(Number(e.target.value))}
              className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
            />
          </div>
          <div>
            <label
              htmlFor="date_validite"
              className="block text-sm font-medium text-brand-indigo-text mb-1"
            >
              Valide jusqu&apos;au <span className="text-status-red">*</span>
            </label>
            <input
              id="date_validite"
              name="date_validite"
              type="date"
              required
              min={effectiveToday}
              value={dateValidite}
              onChange={(e) => setDateValidite(e.target.value)}
              aria-invalid={dateInPast}
              aria-describedby={dateInPast ? 'date_validite_error' : undefined}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 ${
                dateInPast
                  ? 'border-status-red focus:ring-status-red'
                  : 'border-border-soft focus:ring-brand-purple'
              }`}
            />
            {dateInPast && (
              <p
                id="date_validite_error"
                className="text-xs text-status-red mt-1"
              >
                La date de validité doit être postérieure ou égale à
                aujourd&apos;hui ({todayDisplay}).
              </p>
            )}
          </div>
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-brand-indigo-text mb-1"
          >
            Description du poste <span className="text-status-red">*</span>
          </label>
          <textarea
            id="description"
            name="description"
            rows={8}
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Link
            href="/offres"
            className="px-4 py-2 border border-border-soft rounded-md text-sm hover:bg-surface"
          >
            Annuler
          </Link>
          <button
            type="submit"
            disabled={!allFieldsFilled}
            className={`px-4 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold ${
              allFieldsFilled
                ? 'hover:opacity-90'
                : 'opacity-50 cursor-not-allowed'
            }`}
          >
            Enregistrer l&apos;offre d&apos;emploi
          </button>
        </div>
      </form>

      {showClientModal && (
        <CreateClientModal
          initialName={missingClientName ?? ''}
          onCreated={handleClientCreated}
          onClose={() => setShowClientModal(false)}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Modale de création de client inline
// ---------------------------------------------------------------------------

const FORMULES = ['Abonnement', 'À la mission', 'Volume entreprise']

function CreateClientModal({
  initialName,
  onCreated,
  onClose,
}: {
  initialName: string
  onCreated: (c: Client) => void
  onClose: () => void
}) {
  const [nom, setNom] = useState(initialName)
  const [secteur, setSecteur] = useState('')
  const [email, setEmail] = useState('')
  const [formule, setFormule] = useState<string>('Abonnement')
  const [amReferent, setAmReferent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nom.trim()) {
      setError('Le nom est obligatoire.')
      return
    }
    setIsSubmitting(true)
    setError('')
    const result = await createClientInlineAction({
      nom,
      secteur: secteur || null,
      contact_email: email || null,
      formule,
      am_referent: amReferent || null,
    })
    setIsSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onCreated(result.client)
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl p-6 max-w-md w-full space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="font-bold text-lg">Créer un nouveau client</h2>

        <div>
          <label className="block text-sm font-medium text-brand-indigo-text mb-1">
            Nom <span className="text-status-red">*</span>
          </label>
          <input
            type="text"
            required
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-indigo-text mb-1">
            Secteur
          </label>
          <input
            type="text"
            value={secteur}
            onChange={(e) => setSecteur(e.target.value)}
            className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-indigo-text mb-1">
            Email de contact
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-indigo-text mb-1">
            Formule
          </label>
          <select
            value={formule}
            onChange={(e) => setFormule(e.target.value)}
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
          <label className="block text-sm font-medium text-brand-indigo-text mb-1">
            Référent
          </label>
          <input
            type="text"
            value={amReferent}
            onChange={(e) => setAmReferent(e.target.value)}
            placeholder="N. MAGNE (1re lettre du prénom, puis nom)"
            className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
        </div>

        {error && (
          <div className="px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-border-soft rounded-md text-sm hover:bg-surface"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !nom.trim()}
            className={`px-4 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold ${
              isSubmitting || !nom.trim()
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:opacity-90'
            }`}
          >
            {isSubmitting ? 'Création…' : 'Créer le client'}
          </button>
        </div>
      </form>
    </div>
  )
}
