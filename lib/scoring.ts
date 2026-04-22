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
  justification: string
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

Sois factuel, concis et utile pour un recruteur pressé. Rédige la justification en français.`,
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
                "Justification factuelle en 2 à 4 phrases : forces du candidat vs attendus du poste, lacunes éventuelles, points à challenger en entretien. Pas d'intro, pas de flatterie.",
            },
          },
          required: [
            'candidate_name',
            'candidate_email',
            'score',
            'justification',
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

  return {
    score,
    justification,
    statut,
    candidateName: candidateName || undefined,
    candidateEmail: candidateEmail || undefined,
  }
}
