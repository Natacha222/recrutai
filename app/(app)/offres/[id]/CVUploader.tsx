'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ingestCVs } from './actions'

type Status = 'idle' | 'uploading' | 'scoring' | 'done' | 'error'

export default function CVUploader({ offreId }: { offreId: string }) {
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>('')
  const [progress, setProgress] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  })
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | null) {
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

      setStatus('scoring')
      setMessage('Scoring IA en cours…')
      const result = await ingestCVs({ offreId, uploads })
      if (!result.ok) throw new Error(result.error)

      setStatus('done')
      setMessage(
        `${uploads.length} CV${uploads.length > 1 ? 's' : ''} ajouté${
          uploads.length > 1 ? 's' : ''
        } et scoré${uploads.length > 1 ? 's' : ''}.`
      )
      if (inputRef.current) inputRef.current.value = ''
    } catch (e) {
      const err = e as Error
      setStatus('error')
      setMessage(err.message)
    }
  }

  const isBusy = status === 'uploading' || status === 'scoring'

  return (
    <div className="bg-surface-alt rounded-xl p-6 border border-border-soft">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold mb-1">Joindre des CVs</h2>
          <p className="text-sm text-muted">
            Dépose un ou plusieurs fichiers PDF. Le scoring IA se lance
            automatiquement après l&apos;upload.
          </p>
        </div>

        <label
          className={`inline-flex items-center gap-2 px-4 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold whitespace-nowrap ${
            isBusy ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:opacity-90'
          }`}
        >
          <span>📎 Joindre des CVs</span>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            multiple
            disabled={isBusy}
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
          />
        </label>
      </div>

      {isBusy && (
        <div className="mt-4 text-sm text-muted">
          {status === 'uploading'
            ? `Upload ${progress.current}/${progress.total}…`
            : 'Scoring IA en cours…'}
        </div>
      )}

      {status === 'done' && message && (
        <div className="mt-4 px-3 py-2 rounded-md bg-status-green-bg text-status-green text-sm">
          {message}
        </div>
      )}
      {status === 'error' && message && (
        <div className="mt-4 px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
          {message}
        </div>
      )}
    </div>
  )
}
