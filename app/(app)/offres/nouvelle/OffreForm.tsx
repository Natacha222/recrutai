'use client'

import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import Link from 'next/link'
import DuplicateClientErrorBanner from '@/components/DuplicateClientErrorBanner'
import {
  createOffre,
  extractOffreAction,
  createClientInlineAction,
} from './actions'

type Client = { id: string; nom: string }
type Contrat = 'CDI' | 'CDD' | 'Alternance' | 'Stage'
type ImportStatus = 'idle' | 'importing' | 'error' | 'success'

const CONTRATS: Contrat[] = ['CDI', 'CDD', 'Alternance', 'Stage']

// Durée estimée de l'extraction IA d'une offre depuis un PDF. L'appel
// Claude tourne autour de 10–15s pour un PDF typique ; on utilise 12s
// comme référence pour la barre de progression.
const IMPORT_ESTIMATE_SEC = 12

function formatSec(s: number): string {
  const rounded = Math.max(0, Math.round(s))
  if (rounded < 60) return `${rounded}s`
  const m = Math.floor(rounded / 60)
  const rest = rounded % 60
  return rest === 0 ? `${m}min` : `${m}min${rest.toString().padStart(2, '0')}`
}

export default function OffreForm({
  clients: initialClients,
  initialClientId,
  today,
  defaultReferent,
  availableReferents,
}: {
  clients: Client[]
  initialClientId: string
  today: string
  defaultReferent: string | null
  availableReferents: string[]
}) {
  const [clients, setClients] = useState<Client[]>(initialClients)

  // Champs du formulaire (contrôlés pour pouvoir les pré-remplir depuis le PDF)
  const [reference, setReference] = useState('')
  const [titre, setTitre] = useState('')
  const [clientId, setClientId] = useState(initialClientId)
  const [lieu, setLieu] = useState('')
  const [contrat, setContrat] = useState<Contrat>('CDI')
  const [seuil, setSeuil] = useState<number>(60)
  const [description, setDescription] = useState('')
  const [dateValidite, setDateValidite] = useState('')
  // Par défaut, l'offre est attribuée au référent de l'utilisateur connecté.
  // Il peut changer si l'offre est enregistrée pour un collègue.
  const [amReferent, setAmReferent] = useState<string>(defaultReferent ?? '')
  // Chemin du PDF dans le bucket offres-pdf après import réussi. Envoyé
  // au server action via un champ hidden pour être persisté en base.
  const [pdfPath, setPdfPath] = useState<string>('')

  // État de l'import PDF + chrono pour la barre de progression.
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle')
  const [importMessage, setImportMessage] = useState('')
  const [importElapsedSec, setImportElapsedSec] = useState(0)
  const importStartRef = useRef<number>(0)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  // Tick toutes les 250ms pendant l'import pour alimenter la barre et le
  // compteur. Se nettoie dès qu'on sort de l'état `importing`.
  useEffect(() => {
    if (importStatus !== 'importing') return
    const tick = () =>
      setImportElapsedSec((Date.now() - importStartRef.current) / 1000)
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [importStatus])

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

    // On force le flush synchronisé du changement de statut AVANT d'appeler
    // le server action. Sans ça, React 19 peut agréger ces updates avec
    // celles qui suivent le `await` dans une unique transition → l'état
    // `importing` n'est jamais rendu et la barre de progression reste
    // invisible. Avec flushSync, le DOM est mis à jour immédiatement.
    importStartRef.current = Date.now()
    flushSync(() => {
      setImportElapsedSec(0)
      setImportStatus('importing')
      setImportMessage('')
    })

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
    setReference(result.data.reference)
    setPdfPath(result.pdfPath ?? '')
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

  // Progression approximative pendant l'import : on plafonne à 95 % pour
  // éviter la fausse complétion si l'appel déborde l'estimation.
  const importProgressPct =
    importStatus === 'importing'
      ? Math.min(95, (importElapsedSec / IMPORT_ESTIMATE_SEC) * 100)
      : 0
  const importOverrun =
    importStatus === 'importing' && importElapsedSec > IMPORT_ESTIMATE_SEC

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

  const seuilIsValid =
    Number.isFinite(seuil) &&
    Number.isInteger(seuil) &&
    seuil >= 50 &&
    seuil <= 100

  const allFieldsFilled =
    titre.trim() !== '' &&
    clientId !== '' &&
    lieu.trim() !== '' &&
    description.trim() !== '' &&
    seuilIsValid &&
    dateFormatIsValid &&
    !dateInPast

  return (
    <>
      {/* En-tête : bouton d'import PDF compact */}
      <div className="flex items-start justify-end gap-4 flex-wrap mb-4">
        {/* A11y : on utilise htmlFor + sr-only (au lieu de `hidden`) pour que
            le `<input type="file">` reste focusable au clavier. Le label
            montre un focus ring via `focus-within:` quand l'input caché a
            le focus. */}
        <label
          htmlFor="offre-pdf-import"
          className={`inline-flex items-center gap-2 px-4 py-2 border-2 border-brand-purple text-brand-purple rounded-md text-sm font-semibold whitespace-nowrap focus-within:ring-2 focus-within:ring-brand-purple focus-within:ring-offset-2 ${
            importStatus === 'importing'
              ? 'opacity-60 cursor-not-allowed'
              : 'cursor-pointer hover:bg-brand-purple hover:text-white'
          }`}
        >
          <span aria-hidden="true">📎</span>
          <span>
            {importStatus === 'importing'
              ? 'Analyse IA…'
              : 'Importer un PDF'}
          </span>
          <input
            id="offre-pdf-import"
            ref={pdfInputRef}
            type="file"
            accept="application/pdf"
            disabled={importStatus === 'importing'}
            onChange={(e) => handlePdfImport(e.target.files)}
            className="sr-only"
          />
        </label>
      </div>

      {importStatus === 'importing' && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span id="offre-import-label" className="text-muted">
              Analyse IA du PDF en cours…
            </span>
            <span className="text-muted text-xs font-mono tabular-nums">
              {formatSec(importElapsedSec)} / ~{formatSec(IMPORT_ESTIMATE_SEC)}
            </span>
          </div>
          <div
            className="h-2 w-full bg-surface rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(importProgressPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-labelledby="offre-import-label"
          >
            <div
              className="h-full bg-brand-purple transition-[width] duration-300 ease-out"
              style={{ width: `${importProgressPct}%` }}
            />
          </div>
          {importOverrun && (
            <p className="text-xs text-muted">
              L&apos;analyse prend un peu plus de temps que prévu, merci de
              patienter…
            </p>
          )}
        </div>
      )}

      {/* Live regions : succès annoncé en polite, erreur en assertive. */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {importStatus === 'success' && importMessage && (
          <div className="mb-4 px-3 py-2 rounded-md bg-status-green-bg text-status-green text-sm">
            {importMessage}
          </div>
        )}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {importStatus === 'error' && importMessage && (
          <div className="mb-4 px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
            {importMessage}
          </div>
        )}
      </div>

      {/* Formulaire */}
      <form
        action={createOffre}
        className="bg-surface-alt rounded-xl p-6 border border-border-soft space-y-4"
      >
        {/* Chemin du PDF importé, renseigné uniquement si l'utilisateur a
            utilisé « Importer un PDF ». Permet de stocker le path en base
            pour pouvoir proposer « Voir le PDF » sur la fiche. */}
        <input type="hidden" name="pdf_path" value={pdfPath} />

        <div>
          <label
            htmlFor="reference"
            className="block text-sm font-medium text-brand-indigo-text mb-1"
          >
            Référence
          </label>
          <input
            id="reference"
            name="reference"
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Ex : TECH-2026-018"
            aria-describedby="reference_help"
            className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
          <p id="reference_help" className="text-xs text-muted mt-1">
            Référence attribuée par le client, optionnelle. Extraite
            automatiquement du PDF si présente.
          </p>
        </div>

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
            <div className="flex gap-2">
              <select
                id="client_id"
                name="client_id"
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="flex-1 px-3 py-2 border border-border-soft rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand-purple"
              >
                <option value="">— Sélectionnez un client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowClientModal(true)}
                className="px-3 py-2 border-2 border-brand-purple text-brand-purple rounded-md text-sm font-semibold whitespace-nowrap hover:bg-brand-purple hover:text-white"
              >
                + Nouveau client
              </button>
            </div>
          )}
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
            value={amReferent}
            onChange={(e) => setAmReferent(e.target.value)}
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
              min={50}
              max={100}
              step={1}
              required
              value={seuil}
              onChange={(e) => setSeuil(Number(e.target.value))}
              aria-invalid={!seuilIsValid}
              aria-describedby={!seuilIsValid ? 'seuil_error' : undefined}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 ${
                !seuilIsValid
                  ? 'border-status-red focus:ring-status-red'
                  : 'border-border-soft focus:ring-brand-purple'
              }`}
            />
            {!seuilIsValid && (
              <p id="seuil_error" className="text-xs text-status-red mt-1">
                Le seuil doit être un entier compris entre 50 et 100.
              </p>
            )}
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
          defaultReferent={defaultReferent}
          availableReferents={availableReferents}
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
  defaultReferent,
  availableReferents,
  onCreated,
  onClose,
}: {
  initialName: string
  defaultReferent: string | null
  availableReferents: string[]
  onCreated: (c: Client) => void
  onClose: () => void
}) {
  const [nom, setNom] = useState(initialName)
  const [secteur, setSecteur] = useState('')
  const [email, setEmail] = useState('')
  const [formule, setFormule] = useState<string>('Abonnement')
  const [amReferent, setAmReferent] = useState(defaultReferent ?? '')
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
          <label
            htmlFor="client-modal-nom"
            className="block text-sm font-medium text-brand-indigo-text mb-1"
          >
            Nom <span className="text-status-red">*</span>
          </label>
          <input
            id="client-modal-nom"
            type="text"
            required
            value={nom}
            onChange={(e) => {
              setNom(e.target.value)
              // On efface l'erreur dès que l'utilisateur change le nom : elle
              // ne correspond plus forcément à l'état courant.
              if (error) setError('')
            }}
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
          <select
            value={amReferent}
            onChange={(e) => setAmReferent(e.target.value)}
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

        {error && error.startsWith('Un client nommé') ? (
          <DuplicateClientErrorBanner
            message={error}
            onCancel={onClose}
            nameInputId="client-modal-nom"
          />
        ) : error ? (
          <div className="px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
            {error}
          </div>
        ) : null}

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
