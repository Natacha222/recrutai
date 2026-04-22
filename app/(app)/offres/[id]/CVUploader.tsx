'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ingestCVs } from './actions'

type Status = 'idle' | 'uploading' | 'scoring' | 'done' | 'error'

// Estimations de durée (en secondes) pour informer l'utilisateur. Ce sont
// des ordres de grandeur observés :
//   - upload Supabase : ~2s par PDF (réseau + taille fichier)
//   - scoring IA : côté serveur, on fait 1 appel séquentiel pour amorcer
//     le cache de prompt Anthropic, puis on traite les CVs restants par
//     lots de SCORING_CONCURRENCY en parallèle. Durée totale :
//       1er CV (cache create) + ceil((n-1)/K) * temps d'un lot
//     Les constantes reflètent des temps d'appel Claude observés :
//       - ~15s pour un CV avec création de cache (1er appel)
//       - ~18s par lot de K CVs en parallèle (cache hit, pic output)
const UPLOAD_SEC_PER_FILE = 2
const SCORING_CONCURRENCY = 5
const SCORING_FIRST_SEC = 15
const SCORING_BATCH_SEC = 18

// Durée d'affichage (en ms) du temps total réel après la fin de
// l'ingestion. L'utilisateur le voit brièvement à titre indicatif puis
// il disparaît pour ne pas encombrer l'UI.
const FINAL_DURATION_DISPLAY_MS = 10_000

function estimateUploadSec(nFiles: number): number {
  return nFiles * UPLOAD_SEC_PER_FILE
}

function estimateScoringSec(nFiles: number): number {
  if (nFiles <= 0) return 0
  if (nFiles === 1) return SCORING_FIRST_SEC
  const batches = Math.ceil((nFiles - 1) / SCORING_CONCURRENCY)
  return SCORING_FIRST_SEC + batches * SCORING_BATCH_SEC
}

function formatSec(s: number): string {
  const rounded = Math.max(0, Math.round(s))
  if (rounded < 60) return `${rounded}s`
  const m = Math.floor(rounded / 60)
  const rest = rounded % 60
  return rest === 0 ? `${m}min` : `${m}min${rest.toString().padStart(2, '0')}`
}

export default function CVUploader({
  offreId,
  disabled = false,
}: {
  offreId: string
  disabled?: boolean
}) {
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>('')
  const [progress, setProgress] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  })
  // Chrono : temps écoulé depuis le début de la phase en cours
  // (upload ou scoring). Remis à 0 à chaque changement de phase.
  const [elapsedSec, setElapsedSec] = useState(0)
  const phaseStartRef = useRef<number>(0)
  // Temps total réel (upload + scoring) affiché brièvement en fin
  // d'ingestion, null le reste du temps.
  const [finalDurationSec, setFinalDurationSec] = useState<number | null>(null)
  const totalStartRef = useRef<number>(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Incrémente elapsedSec toutes les 250ms pendant les phases actives.
  // Se nettoie automatiquement quand on sort de uploading/scoring.
  useEffect(() => {
    if (status !== 'uploading' && status !== 'scoring') return
    const tick = () =>
      setElapsedSec((Date.now() - phaseStartRef.current) / 1000)
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [status])

  // Efface le temps total après un court délai pour ne rester qu'à
  // titre indicatif (le reste du message de succès/erreur persiste).
  useEffect(() => {
    if (finalDurationSec === null) return
    const id = setTimeout(
      () => setFinalDurationSec(null),
      FINAL_DURATION_DISPLAY_MS
    )
    return () => clearTimeout(id)
  }, [finalDurationSec])

  async function handleFiles(files: FileList | null) {
    if (disabled) return
    if (!files || files.length === 0) return

    const pdfFiles = Array.from(files).filter(
      (f) =>
        f.type === 'application/pdf' ||
        f.name.toLowerCase().endsWith('.pdf')
    )
    if (pdfFiles.length === 0) {
      setStatus('error')
      setMessage('Seuls les fichiers PDF sont acceptés.')
      return
    }

    const supabase = createClient()
    const startedAt = Date.now()
    totalStartRef.current = startedAt
    phaseStartRef.current = startedAt
    setElapsedSec(0)
    setFinalDurationSec(null)
    setStatus('uploading')
    setMessage('')
    setProgress({ current: 0, total: pdfFiles.length })

    const uploads: { path: string; filename: string }[] = []
    try {
      for (let i = 0; i < pdfFiles.length; i++) {
        const file = pdfFiles[i]
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${offreId}/${Date.now()}-${i}-${safeName}`
        const { error } = await supabase.storage
          .from('cvs')
          .upload(path, file, {
            upsert: false,
            contentType: 'application/pdf',
          })
        if (error) throw new Error(`Upload de ${file.name} : ${error.message}`)
        uploads.push({ path, filename: file.name })
        setProgress({ current: i + 1, total: pdfFiles.length })
      }

      // Passage en phase scoring : on réinitialise le chrono pour afficher
      // le temps de cette phase (plus long et moins visible que l'upload).
      phaseStartRef.current = Date.now()
      setElapsedSec(0)
      setStatus('scoring')

      const result = await ingestCVs({ offreId, uploads })
      if (!result.ok) throw new Error(result.error)

      const n = result.notifications
      const plural = uploads.length > 1 ? 's' : ''
      const parts: string[] = [
        `${uploads.length} CV${plural} ajouté${plural} et scoré${plural}.`,
      ]
      if (n.qualifiedCount > 0) {
        if (n.sentCount > 0) {
          parts.push(
            `${n.sentCount} email${n.sentCount > 1 ? 's' : ''} envoyé${
              n.sentCount > 1 ? 's' : ''
            } pour les CV qualifiés.`
          )
        }
        if (n.errors.length > 0) {
          parts.push(
            `${n.errors.length} envoi${n.errors.length > 1 ? 's' : ''} échoué${
              n.errors.length > 1 ? 's' : ''
            } : ${n.errors.join(' ; ')}`
          )
        }
      }
      if (n.skippedReason) parts.push(n.skippedReason)

      const totalSec = (Date.now() - totalStartRef.current) / 1000
      setFinalDurationSec(totalSec)
      setStatus(n.errors.length > 0 ? 'error' : 'done')
      setMessage(parts.join(' '))
      if (inputRef.current) inputRef.current.value = ''
    } catch (e) {
      const err = e as Error
      setStatus('error')
      setMessage(err.message)
    }
  }

  const isBusy = status === 'uploading' || status === 'scoring'
  const blocked = disabled || isBusy

  // Barre de progression :
  //   - upload : on connaît current/total, on utilise ça (progression réelle)
  //   - scoring : on approxime avec elapsedSec / estimation, plafonné à 95 %
  //     pour éviter la « fausse complétion » quand ça déborde l'estimation
  const estimateSec =
    status === 'uploading'
      ? estimateUploadSec(progress.total)
      : status === 'scoring'
        ? estimateScoringSec(progress.total)
        : 0
  const phaseProgressPct =
    status === 'uploading' && progress.total > 0
      ? (progress.current / progress.total) * 100
      : status === 'scoring' && estimateSec > 0
        ? Math.min(95, (elapsedSec / estimateSec) * 100)
        : 0
  const overrun = status === 'scoring' && elapsedSec > estimateSec

  return (
    <div className="bg-surface-alt rounded-xl p-6 border border-border-soft">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold mb-1">Joindre des CVs</h2>
          <p className="text-sm text-muted">
            {disabled
              ? "Cette offre est clôturée. Réactive-la pour pouvoir joindre de nouveaux CVs."
              : `Dépose un ou plusieurs fichiers PDF. Le scoring IA se lance automatiquement après l'upload. Compter ~${SCORING_FIRST_SEC}s pour 1 CV, ~${SCORING_FIRST_SEC + SCORING_BATCH_SEC}s pour 6 CVs, ~${SCORING_FIRST_SEC + 2 * SCORING_BATCH_SEC}s pour 11 CVs et ~${SCORING_FIRST_SEC + 4 * SCORING_BATCH_SEC}s pour 20 CVs.`}
          </p>
        </div>

        {/* A11y : htmlFor + sr-only pour garder l'input focusable au
            clavier. focus-within: rend le focus visible sur le label. */}
        <label
          htmlFor="cv-upload-input"
          className={`inline-flex items-center gap-2 px-4 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold whitespace-nowrap focus-within:ring-2 focus-within:ring-brand-purple focus-within:ring-offset-2 ${
            blocked
              ? 'opacity-60 cursor-not-allowed'
              : 'cursor-pointer hover:opacity-90'
          }`}
        >
          <span aria-hidden="true">📎</span>
          <span>Joindre des CVs</span>
          <input
            id="cv-upload-input"
            ref={inputRef}
            type="file"
            accept="application/pdf"
            multiple
            disabled={blocked}
            onChange={(e) => handleFiles(e.target.files)}
            className="sr-only"
          />
        </label>
      </div>

      {isBusy && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span id="cv-upload-label" className="text-muted">
              {status === 'uploading'
                ? `Upload ${progress.current}/${progress.total} fichier${
                    progress.total > 1 ? 's' : ''
                  }…`
                : `Scoring IA de ${progress.total} CV${
                    progress.total > 1 ? 's' : ''
                  }…`}
            </span>
            <span className="text-muted text-xs font-mono tabular-nums">
              {formatSec(elapsedSec)}
              {estimateSec > 0 ? ` / ~${formatSec(estimateSec)}` : ''}
            </span>
          </div>
          <div
            className="h-2 w-full bg-surface rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(phaseProgressPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-labelledby="cv-upload-label"
          >
            <div
              className="h-full bg-brand-purple transition-[width] duration-300 ease-out"
              style={{ width: `${phaseProgressPct}%` }}
            />
          </div>
          {overrun && (
            <p className="text-xs text-muted">
              Le scoring prend un peu plus de temps que prévu, merci de
              patienter…
            </p>
          )}
        </div>
      )}

      {/* Live regions : succès annoncé en polite (n'interrompt pas), erreur
          en assertive (interrompt — l'utilisateur doit savoir tout de suite). */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {status === 'done' && message && (
          <div className="mt-4 px-3 py-2 rounded-md bg-status-green-bg text-status-green text-sm">
            <div>{message}</div>
            {finalDurationSec !== null && (
              <div className="mt-1 text-xs opacity-80">
                Temps total : {formatSec(finalDurationSec)}
              </div>
            )}
          </div>
        )}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {status === 'error' && message && (
          <div className="mt-4 px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
            <div>{message}</div>
            {finalDurationSec !== null && (
              <div className="mt-1 text-xs opacity-80">
                Temps total : {formatSec(finalDurationSec)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
