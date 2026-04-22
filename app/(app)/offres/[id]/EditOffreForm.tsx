'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FIELD_LIMITS } from '@/lib/validation'
import { updateOffre } from './actions'

type Client = { id: string; nom: string }
type Contrat = 'CDI' | 'CDD' | 'Alternance' | 'Stage'

const CONTRATS: Contrat[] = ['CDI', 'CDD', 'Alternance', 'Stage']

type Offre = {
  id: string
  reference: string | null
  titre: string | null
  description: string | null
  lieu: string | null
  contrat: string | null
  seuil: number | null
  date_validite: string | null
  client_id: string | null
  am_referent: string | null
}

export default function EditOffreForm({
  offre,
  clients,
  today,
  defaultReferent,
  availableReferents,
}: {
  offre: Offre
  clients: Client[]
  today: string
  /** Référent de l'utilisateur connecté, utilisé comme fallback d'affichage. */
  defaultReferent: string | null
  /** Liste des référents proposés dans le select. */
  availableReferents: string[]
}) {
  const [reference, setReference] = useState(offre.reference ?? '')
  const [titre, setTitre] = useState(offre.titre ?? '')
  const [clientId, setClientId] = useState(offre.client_id ?? '')
  const [lieu, setLieu] = useState(offre.lieu ?? '')
  const [contrat, setContrat] = useState<Contrat>(
    (CONTRATS as string[]).includes(offre.contrat ?? '')
      ? (offre.contrat as Contrat)
      : 'CDI'
  )
  const [seuilStr, setSeuilStr] = useState<string>(String(offre.seuil ?? 60))
  const [dateValidite, setDateValidite] = useState(offre.date_validite ?? '')
  const [description, setDescription] = useState(offre.description ?? '')
  // Référent : valeur existante si définie, sinon celle de l'utilisateur
  // connecté pour pré-remplir lors de la première édition.
  const [amReferent, setAmReferent] = useState<string>(
    offre.am_referent ?? defaultReferent ?? ''
  )

  // Validation seuil : entier dans [50, 100]. On garde la valeur en `string`
  // plutôt qu'en `number` pour pouvoir distinguer « champ vide » de « 0 ».
  const seuilNum = Number(seuilStr)
  const seuilIsValid =
    seuilStr.trim() !== '' &&
    Number.isFinite(seuilNum) &&
    Number.isInteger(seuilNum) &&
    seuilNum >= 50 &&
    seuilNum <= 100

  // Validation date : format ISO + postérieure ou égale à aujourd'hui.
  const dateFormatIsValid = /^\d{4}-\d{2}-\d{2}$/.test(dateValidite)
  const dateInPast = dateFormatIsValid && dateValidite < today
  const todayDisplay = `${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}`

  const formIsValid =
    titre.trim() !== '' &&
    clientId !== '' &&
    seuilIsValid &&
    dateFormatIsValid &&
    !dateInPast

  return (
    <form action={updateOffre} className="px-6 pb-6 pt-6 space-y-4">
      <input type="hidden" name="id" value={offre.id} />

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
          maxLength={FIELD_LIMITS.offre_reference}
          className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
        />
        <p className="text-xs text-muted mt-1">
          Référence attribuée par le client, optionnelle.
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
          maxLength={FIELD_LIMITS.offre_titre}
          className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="client_id"
            className="block text-sm font-medium text-brand-indigo-text mb-1"
          >
            Client <span className="text-status-red">*</span>
          </label>
          <select
            id="client_id"
            name="client_id"
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full px-3 py-2 border border-border-soft rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand-purple"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="lieu"
            className="block text-sm font-medium text-brand-indigo-text mb-1"
          >
            Lieu
          </label>
          <input
            id="lieu"
            name="lieu"
            type="text"
            value={lieu}
            onChange={(e) => setLieu(e.target.value)}
            maxLength={FIELD_LIMITS.offre_lieu}
            className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
        </div>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label
            htmlFor="contrat"
            className="block text-sm font-medium text-brand-indigo-text mb-1"
          >
            Contrat
          </label>
          <select
            id="contrat"
            name="contrat"
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
            value={seuilStr}
            onChange={(e) => setSeuilStr(e.target.value)}
            aria-invalid={!seuilIsValid}
            aria-describedby={!seuilIsValid ? 'seuil_error' : undefined}
            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 ${
              !seuilIsValid
                ? 'border-status-red focus:ring-status-red'
                : 'border-border-soft focus:ring-brand-purple'
            }`}
          />
          {!seuilIsValid ? (
            <p id="seuil_error" className="text-xs text-status-red mt-1">
              Le seuil doit être un entier compris entre 50 et 100.
            </p>
          ) : (
            <p className="text-xs text-muted mt-1">
              Entier compris entre 50 et 100.
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
            min={today}
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
          {dateInPast ? (
            <p
              id="date_validite_error"
              className="text-xs text-status-red mt-1"
            >
              La date de validité doit être postérieure ou égale à
              aujourd&apos;hui ({todayDisplay}).
            </p>
          ) : (
            <p className="text-xs text-muted mt-1">
              Statut déterminé par la date : active si la date est future,
              clôturée automatiquement sinon.
            </p>
          )}
        </div>
      </div>

      <div>
        <label
          htmlFor="description"
          className="block text-sm font-medium text-brand-indigo-text mb-1"
        >
          Description du poste
        </label>
        <textarea
          id="description"
          name="description"
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={FIELD_LIMITS.offre_description}
          className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Link
          href={`/offres/${offre.id}`}
          className="px-4 py-2 border border-border-soft rounded-md text-sm hover:bg-surface"
        >
          Annuler
        </Link>
        <button
          type="submit"
          disabled={!formIsValid}
          className={`px-4 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold ${
            formIsValid
              ? 'hover:opacity-90'
              : 'opacity-50 cursor-not-allowed'
          }`}
        >
          Enregistrer les modifications
        </button>
      </div>
    </form>
  )
}
