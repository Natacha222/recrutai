/**
 * Scoring candidat mock — à remplacer par un vrai appel LLM plus tard.
 *
 * Génère un score (0-100) + une justification à partir du nom de fichier
 * et de la description du poste. Déterministe : même input → même score.
 *
 * TODO : brancher sur l'API Anthropic / OpenAI avec :
 *   1. Extraction du texte du PDF (pdf-parse côté serveur)
 *   2. Prompt = description poste + texte CV + barème
 *   3. Parsing de la réponse JSON { score, justification, statut }
 */

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

const strengths = [
  'solide expérience technique',
  "très bonne maîtrise de l'écosystème",
  'parcours académique convaincant',
  'expériences internationales',
  'compétences transverses',
  'forte autonomie sur des projets similaires',
  'stack technique alignée avec le poste',
]

const weaknesses = [
  'expérience sectorielle limitée',
  'manque de séniorité sur le management',
  'profil encore junior sur certaines techno',
  'peu de certifications listées',
  'lacunes sur la dimension internationale',
]

export function scoreCandidate({
  filename,
  jobDescription,
  seuil,
}: {
  filename: string
  jobDescription: string | null
  seuil: number
}): { score: number; justification: string; statut: string } {
  const h = hash(filename + (jobDescription ?? ''))
  // Score entre 35 et 95 pour rester plausible
  const score = 35 + (h % 61)

  const s1 = strengths[h % strengths.length]
  const s2 = strengths[(h >> 3) % strengths.length]
  const w = weaknesses[(h >> 6) % weaknesses.length]

  let justification: string
  if (score >= seuil + 10) {
    justification = `Excellent profil : ${s1} et ${s2}. Correspondance forte avec les attendus.`
  } else if (score >= seuil) {
    justification = `Profil intéressant : ${s1}. ${w[0].toUpperCase() + w.slice(1)} à challenger en entretien.`
  } else {
    justification = `Profil en deçà du seuil : ${w}. ${s1[0].toUpperCase() + s1.slice(1)} mais pas suffisant sur les attendus clés.`
  }

  const statut =
    score >= seuil ? 'qualifié' : score >= seuil - 15 ? 'en attente' : 'rejeté'

  return { score, justification, statut }
}
