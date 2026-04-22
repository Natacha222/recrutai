/**
 * Limites de taille des champs texte, centralisées ici pour rester
 * cohérentes entre le HTML (`maxLength` côté client → UX : compteur +
 * blocage clavier) et les server actions (troncature défensive côté
 * serveur, au cas où un attaquant bypass le HTML via un POST direct ou
 * fait un paste d'un payload monstrueux).
 *
 * Les valeurs sont choisies généreuses — largement au-dessus de ce qu'on
 * rencontre en saisie naturelle — tout en restant raisonnables pour la
 * base et pour les emails HTML générés par lib/email.ts :
 *   - titre d'offre : ~200 chars (une fiche de poste typique fait 40-80)
 *   - description   : 20 000 chars (une JD complète avec mission +
 *     compétences + process tient sous 8 000, marge x2.5)
 *   - lieu          : 150 chars (« Paris 17e, remote partiel Lyon »)
 *   - nom client    : 200 chars (raison sociale + siège possible)
 *   - secteur       : 150 chars
 *   - email         : 254 chars (limite RFC 5321)
 *   - référence     : 80 chars (codes ATS souvent 20-40)
 *   - am_referent   : 80 chars (format « F. NOM » standard mais on garde
 *     de la marge pour double nom)
 *
 * Sans ces limites : un utilisateur collant 100 000 caractères dans
 * « description » fait exploser les tokens Claude (scoring IA ingère la
 * description), sature le payload Resend et peut DoS la RAM de la fonction
 * serverless. Même risque sur les autres champs texte, à moindre échelle.
 */
export const FIELD_LIMITS = {
  offre_titre: 200,
  offre_description: 20_000,
  offre_lieu: 150,
  offre_reference: 80,
  // Même limite pour tous les am_referent (offres + clients) — il est
  // formaté ensuite via formatReferent() en « F. NOM ».
  am_referent: 80,
  client_nom: 200,
  client_secteur: 150,
  // RFC 5321 limit (3 + 64 + 1 + 187 = 255, souvent approximée à 254).
  email: 254,
} as const

/**
 * Tronque une chaîne à `max` caractères. Si la chaîne est déjà ≤ max,
 * retourne la chaîne originale (pas de copie inutile).
 *
 * Unité : code point UTF-16 (= ce que `.length` compte côté JS). Pour des
 * contenus purement textuels en latin, c'est équivalent à des caractères.
 * Pour des emojis complexes (ZWJ sequences), on peut couper au milieu
 * d'un grapheme cluster ; c'est acceptable ici car on est sur des champs
 * de saisie métier (titre offre, nom client) pas des messages libres.
 */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max)
}
