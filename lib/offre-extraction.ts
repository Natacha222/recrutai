import Anthropic from '@anthropic-ai/sdk'

export type ExtractedOffre = {
  titre: string
  client_nom: string
  lieu: string
  contrat: 'CDI' | 'CDD' | 'Alternance' | 'Stage'
  description: string
  /** Date limite / deadline si mentionnée dans le PDF, au format YYYY-MM-DD.
   *  Chaîne vide si l'information n'est pas disponible. */
  date_validite: string
}

/**
 * Extrait les champs d'une offre d'emploi depuis un PDF via Claude.
 *
 * Utilise le tool use pour garantir un output JSON structuré et typé.
 * Nécessite ANTHROPIC_API_KEY dans l'env.
 */
export async function extractOffreFromPdfBuffer(
  pdfBuffer: Buffer
): Promise<
  { ok: true; data: ExtractedOffre } | { ok: false; error: string }
> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      ok: false,
      error:
        "Extraction IA indisponible : ANTHROPIC_API_KEY n'est pas configurée.",
    }
  }

  const client = new Anthropic({ apiKey })
  const base64 = pdfBuffer.toString('base64')

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      tools: [
        {
          name: 'extract_offre_fields',
          description:
            "Extrait les champs structurés d'une offre d'emploi depuis le document fourni.",
          input_schema: {
            type: 'object' as const,
            properties: {
              titre: {
                type: 'string',
                description:
                  'Intitulé précis du poste (ex : "Développeur Full-Stack React/Node.js").',
              },
              client_nom: {
                type: 'string',
                description:
                  "Nom de l'entreprise qui recrute (ex : \"Dassault Systèmes\").",
              },
              lieu: {
                type: 'string',
                description:
                  'Ville ou région du poste (ex : "Paris", "Lyon", "Remote / France").',
              },
              contrat: {
                type: 'string',
                enum: ['CDI', 'CDD', 'Alternance', 'Stage'],
                description: 'Type de contrat.',
              },
              description: {
                type: 'string',
                description:
                  'Description synthétique du poste : missions clés, stack ou compétences attendues, profil recherché. 4 à 8 phrases maximum.',
              },
              date_validite: {
                type: 'string',
                description:
                  'Date limite de candidature au format YYYY-MM-DD si le document en mentionne une (ex : « candidatures avant le 30/06/2026 », « deadline », « date limite »). Chaîne vide si rien n\'est indiqué — ne devine pas.',
              },
            },
            required: [
              'titre',
              'client_nom',
              'lieu',
              'contrat',
              'description',
              'date_validite',
            ],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'extract_offre_fields' },
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
              text: "Extrais les champs de cette offre d'emploi en français. Si une information n'est pas explicite dans le document, fais de ton mieux avec ce qui est disponible (ex : déduis un contrat « CDI » si le type n'est pas précisé). Pour la date limite, ne la renseigne que si elle est clairement indiquée dans le document — sinon laisse la chaîne vide.",
            },
          ],
        },
      ],
    })

    const toolUse = msg.content.find((c) => c.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      return { ok: false, error: "L'IA n'a pas pu extraire les champs." }
    }

    const raw = toolUse.input as ExtractedOffre

    // Normalise la date : on n'accepte que YYYY-MM-DD. Tout autre format
    // (DD/MM/YYYY, texte libre, date invalide…) est ignoré et remis à vide
    // pour laisser l'utilisateur la saisir à la main.
    const dateClean = /^\d{4}-\d{2}-\d{2}$/.test(raw.date_validite ?? '')
      ? raw.date_validite
      : ''

    return {
      ok: true,
      data: {
        ...raw,
        date_validite: dateClean,
      },
    }
  } catch (e) {
    const err = e as Error
    return { ok: false, error: `Erreur Claude : ${err.message}` }
  }
}
