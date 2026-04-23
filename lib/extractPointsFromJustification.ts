import Anthropic from '@anthropic-ai/sdk'

/**
 * Dérivation légère points forts / points faibles à partir d'un texte de
 * justification IA existant — pour backfiller les candidatures scorées
 * AVANT que scoreCandidate() ne renvoie les arrays structurés.
 *
 * Pourquoi pas un rescore complet ?
 * - Pas besoin de retélécharger le PDF (I/O, storage).
 * - Pas besoin de reposer les coûts/latence d'une analyse PDF (~2-3x plus
 *   cher que du texte).
 * - Le texte `justification_ia` est déjà une synthèse IA du CV vs. offre,
 *   donc la qualité des bullets extraits est largement suffisante pour
 *   l'UI (liste + email).
 *
 * Retourne `{ pointsForts: [], pointsFaibles: [] }` si la justification est
 * vide ou si Claude renvoie une réponse mal formée — l'appelant peut
 * décider de laisser `NULL` en base (fallback UI) plutôt qu'écrire du vide.
 */
export async function extractPointsFromJustification(
  justification: string
): Promise<{ pointsForts: string[]; pointsFaibles: string[] }> {
  const text = (justification ?? '').trim()
  if (!text) return { pointsForts: [], pointsFaibles: [] }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY manquant')
  }

  const client = new Anthropic({ apiKey })

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system:
      "Tu es un assistant qui structure des analyses de CV. On te donne une synthèse (2-4 phrases) rédigée par un recruteur IA sur la correspondance d'un candidat à une offre. Ta tâche : extraire 3-4 points forts et 3-4 points faibles en français, fidèles au texte fourni (n'ajoute rien qui n'y soit pas), et TRÈS concis — chaque item doit tenir en 3 à 6 mots max, style « tag » / mot-clé, PAS de phrase complète. Exemples attendus : « 5 ans React », « Anglais C1 », « Pas de Kubernetes », « Junior en management ». Si la synthèse ne mentionne quasi aucun point faible explicite, liste des zones à clarifier en entretien, toujours en quelques mots. Appelle ensuite l'outil extract_points.",
    tools: [
      {
        name: 'extract_points',
        description:
          'Structure une synthèse recruteur en points forts / points faibles exploitables par l\'UI.',
        input_schema: {
          type: 'object' as const,
          properties: {
            points_forts: {
              type: 'array',
              items: { type: 'string' },
              minItems: 2,
              maxItems: 5,
              description:
                "Forces principales du candidat vs attendus du poste. 3 à 4 items, chacun TRÈS court — 3 à 6 mots max, style « tag » / mot-clé. Exemples : « 5 ans React », « Anglais C1 », « Management équipe 8 pers. ». Pas de phrase complète.",
            },
            points_faibles: {
              type: 'array',
              items: { type: 'string' },
              minItems: 2,
              maxItems: 5,
              description:
                "Lacunes ou points à challenger en entretien. 3 à 4 items, chacun TRÈS court — 3 à 6 mots max, style « tag ». Exemples : « Pas de Kubernetes », « Anglais B1 », « Junior en management ». Pas de phrase complète.",
            },
          },
          required: ['points_forts', 'points_faibles'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'extract_points' },
    messages: [
      {
        role: 'user',
        content: `Voici la synthèse recruteur à structurer :\n\n"""\n${text}\n"""`,
      },
    ],
  })

  const toolUse = msg.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    return { pointsForts: [], pointsFaibles: [] }
  }

  const input = toolUse.input as {
    points_forts?: unknown
    points_faibles?: unknown
  }

  // Sanitize identique à scoreCandidate : array de strings non vides, ou
  // array vide si la réponse est mal formée — on ne crash pas sur une
  // réponse IA inattendue.
  const cleanArr = (val: unknown): string[] =>
    Array.isArray(val)
      ? val
          .map((x) => (typeof x === 'string' ? x.trim() : ''))
          .filter((x) => x.length > 0)
      : []

  return {
    pointsForts: cleanArr(input.points_forts),
    pointsFaibles: cleanArr(input.points_faibles),
  }
}
