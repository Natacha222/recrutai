import Anthropic from '@anthropic-ai/sdk'

/**
 * Scoring candidat via Claude avec analyse du PDF du CV.
 *
 * Envoie le CV (PDF) + la description du poste à l'IA et récupère :
 *   - score 0-100
 *   - justification factuelle
 *   - nom + email du candidat (extraits du CV)
 *
 * Le statut est dérivé du score vs seuil :
 *   score >= seuil         → 'qualifié'
 *   score >= seuil - 15    → 'en attente'
 *   sinon                  → 'rejeté'
 *
 * Optimisation : la description d'offre + les instructions sont placées dans
 * le `system` avec `cache_control: ephemeral`. Quand on score plusieurs CVs
 * pour une même offre (batch upload), les appels suivants du même offreId
 * bénéficient du prompt caching d'Anthropic → coût / 10 et moins de pression
 * sur le rate limit input tokens/min. TTL cache : 5 minutes.
 */
export type ScoringResult = {
  score: number
  /** Résumé synthétique (2-4 phrases) — conservé pour legacy et pour
   *  afficher un fallback si les arrays ci-dessous arrivent vides. */
  justification: string
  /** Forces principales du candidat (3-5 items concis). Source unique
   *  pour les bullets « points forts » affichés partout dans l'UI. */
  pointsForts: string[]
  /** Lacunes / points à challenger (3-5 items concis). */
  pointsFaibles: string[]
  statut: string
  candidateName?: string
  candidateEmail?: string
}

export async function scoreCandidate({
  cvBuffer,
  jobDescription,
  seuil,
}: {
  cvBuffer: Buffer
  jobDescription: string | null
  seuil: number
}): Promise<ScoringResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY manquant')
  }

  const client = new Anthropic({ apiKey })
  const base64 = cvBuffer.toString('base64')

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    // Prompt system avec cache_control : identique pour tous les CVs d'une
    // même offre → cache partagé entre appels sur 5 minutes.
    system: [
      {
        type: 'text',
        text: `Tu es un recruteur expérimenté. Tu évalues un CV (PDF joint dans le message suivant) par rapport à l'offre d'emploi ci-dessous, puis tu appelles l'outil evaluate_candidate.

Offre d'emploi :
"""
${jobDescription ?? '(description non fournie)'}
"""

Seuil de qualification : ${seuil}/100.

Sois factuel, concis et utile pour un recruteur pressé. Rédige tout en français.

Structure attendue côté tool call :
- justification : résumé en 2-4 phrases.
- points_forts : 3 à 5 puces max (items de l'array), une phrase courte chacun, axées sur la correspondance CV / attendus poste.
- points_faibles : 3 à 5 puces max, mêmes règles. Si aucune lacune sérieuse, liste les zones à clarifier en entretien.`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        name: 'evaluate_candidate',
        description:
          "Évalue un candidat par rapport à une offre d'emploi et extrait ses coordonnées du CV.",
        input_schema: {
          type: 'object' as const,
          properties: {
            candidate_name: {
              type: 'string',
              description:
                'Prénom et nom du candidat tels qu\'ils apparaissent dans le CV (ex : "Sophie Dupont"). Chaîne vide si vraiment introuvable.',
            },
            candidate_email: {
              type: 'string',
              description:
                'Adresse email du candidat extraite du CV. Chaîne vide si absente.',
            },
            score: {
              type: 'integer',
              minimum: 0,
              maximum: 100,
              description: 'Score de correspondance CV / poste, sur 100.',
            },
            justification: {
              type: 'string',
              description:
                "Résumé court en 2 à 4 phrases : synthèse globale CV vs poste. Pas d'intro, pas de flatterie. Sert de fallback si l'UI ne peut pas afficher les listes structurées.",
            },
            points_forts: {
              type: 'array',
              items: { type: 'string' },
              minItems: 2,
              maxItems: 5,
              description:
                "Forces principales du candidat vs attendus du poste. 3 à 5 items, chacun une phrase concise (≤ 20 mots). Pas de numérotation, pas de puces, juste le contenu.",
            },
            points_faibles: {
              type: 'array',
              items: { type: 'string' },
              minItems: 2,
              maxItems: 5,
              description:
                "Lacunes ou points à challenger en entretien. 3 à 5 items, chacun une phrase concise (≤ 20 mots). Si le candidat n'a aucun gros point faible, liste des zones à clarifier ou des ambiguïtés du CV.",
            },
          },
          required: [
            'candidate_name',
            'candidate_email',
            'score',
            'justification',
            'points_forts',
            'points_faibles',
          ],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'evaluate_candidate' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64,
            },
          },
          {
            type: 'text',
            text: "Évalue le CV ci-dessus en appelant l'outil evaluate_candidate.",
          },
        ],
      },
    ],
  })

  // Log usage pour verifier que le cache est bien hit sur les CVs suivants.
  // `cache_creation_input_tokens` > 0 sur le 1er appel, `cache_read_input_tokens`
  // > 0 sur les suivants (tant que l'offre est la même et que <5min s'écoulent).
  const u = msg.usage
  console.log(
    `[scoreCandidate] usage : input=${u.input_tokens} cache_create=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0} output=${u.output_tokens}`
  )

  const toolUse = msg.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error("Réponse IA sans tool_use.")
  }

  const input = toolUse.input as {
    candidate_name?: string
    candidate_email?: string
    score?: number
    justification?: string
    points_forts?: unknown
    points_faibles?: unknown
  }

  const score = Math.min(
    100,
    Math.max(0, Math.round(Number(input.score ?? 0)))
  )
  const justification = (input.justification ?? '').trim()
  const statut =
    score >= seuil ? 'qualifié' : score >= seuil - 15 ? 'en attente' : 'rejeté'

  const candidateName = (input.candidate_name ?? '').trim()
  const candidateEmail = (input.candidate_email ?? '').trim()

  // Sanitize : on accepte uniquement les arrays de strings non vides. Une
  // réponse mal formée (string, null, array de numbers…) donne un array
  // vide plutôt que de crasher — l'UI retombera sur `justification`.
  const cleanArr = (val: unknown): string[] =>
    Array.isArray(val)
      ? val
          .map((x) => (typeof x === 'string' ? x.trim() : ''))
          .filter((x) => x.length > 0)
      : []

  return {
    score,
    justification,
    pointsForts: cleanArr(input.points_forts),
    pointsFaibles: cleanArr(input.points_faibles),
    statut,
    candidateName: candidateName || undefined,
    candidateEmail: candidateEmail || undefined,
  }
}
