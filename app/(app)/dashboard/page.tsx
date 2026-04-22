import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import StatusBadge from '@/components/StatusBadge'

// Force le rendu dynamique : sinon Next.js peut servir une version cachée
// du dashboard quand une candidature vient d'être ajoutée ou un statut de
// changer, et l'utilisateur voit des données périmées.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()

  // nbOffres : offres au statut 'actif' uniquement, pour coller au label.
  // nbCandidatures : candidatures liées à une offre active, via inner
  // join sur offres + filtre offres.statut. On filtre les deux pour
  // que la moyenne "Candidatures / offre" soit cohérente — sinon on
  // divise un numérateur "all-time toutes offres" par un dénominateur
  // "offres actives", ce qui gonfle artificiellement le chiffre.
  const [{ count: nbOffres }, { count: nbCandidatures }] = await Promise.all([
    supabase
      .from('offres')
      .select('*', { count: 'exact', head: true })
      .eq('statut', 'actif'),
    supabase
      .from('candidatures')
      .select('*, offres!inner(statut)', { count: 'exact', head: true })
      .eq('offres.statut', 'actif'),
  ])

  const { count: nbQualifies } = await supabase
    .from('candidatures')
    .select('*', { count: 'exact', head: true })
    .eq('statut', 'qualifié')

  // Feed d'activités unifié : on fetch les 5 derniers objets créés dans
  // chaque table principale (candidatures, clients, offres), on merge,
  // on trie par created_at desc et on garde les 5 plus récents. Sans
  // table d'audit log, c'est notre meilleure approximation d'un vrai
  // fil d'activité — on ne capture que les créations, pas les
  // changements de statut.
  const [
    { data: recentCandidatures },
    { data: recentClients },
    { data: recentOffres },
  ] = await Promise.all([
    supabase
      .from('candidatures')
      .select(
        'id, nom, email, score_ia, statut, created_at, offres(id, titre)'
      )
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('clients')
      .select('id, nom, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('offres')
      .select('id, titre, created_at, clients(id, nom)')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  type OffreRef = { id: string; titre: string } | null
  type ClientRef = { id: string; nom: string } | null

  type Activite =
    | {
        type: 'candidature'
        id: string
        nom: string | null
        email: string | null
        scoreIa: number | null
        statut: string | null
        offre: OffreRef
        createdAt: string
      }
    | {
        type: 'client'
        id: string
        nom: string
        createdAt: string
      }
    | {
        type: 'offre'
        id: string
        titre: string
        client: ClientRef
        createdAt: string
      }

  const activites: Activite[] = [
    ...(recentCandidatures ?? []).map((c): Activite => {
      const offreInfo = (Array.isArray(c.offres)
        ? c.offres[0]
        : c.offres) as OffreRef
      return {
        type: 'candidature',
        id: c.id,
        nom: c.nom,
        email: c.email,
        scoreIa: c.score_ia,
        statut: c.statut,
        offre: offreInfo,
        createdAt: c.created_at,
      }
    }),
    ...(recentClients ?? []).map(
      (c): Activite => ({
        type: 'client',
        id: c.id,
        nom: c.nom,
        createdAt: c.created_at,
      })
    ),
    ...(recentOffres ?? []).map((o): Activite => {
      const clientInfo = (Array.isArray(o.clients)
        ? o.clients[0]
        : o.clients) as ClientRef
      return {
        type: 'offre',
        id: o.id,
        titre: o.titre,
        client: clientInfo,
        createdAt: o.created_at,
      }
    }),
  ]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 5)

  // Qualité IA : on fetch toutes les candidatures scorées avec le seuil de
  // leur offre pour calculer des indicateurs globaux sur la qualité du
  // scoring (score moyen, flottement autour du seuil, taux d'extraction
  // nom/email). L'agrégation est faite en JS côté serveur : acceptable
  // tant que le volume reste raisonnable. À basculer en SQL agrégé si on
  // dépasse quelques milliers de candidatures.
  const { data: qualiteIaRows } = await supabase
    .from('candidatures')
    .select('nom, email, score_ia, statut, offres(seuil)')

  type QualiteIaRow = {
    nom: string | null
    email: string | null
    score_ia: number | null
    statut: string | null
    offres:
      | { seuil: number | null }
      | { seuil: number | null }[]
      | null
  }

  const scored = ((qualiteIaRows ?? []) as QualiteIaRow[]).filter(
    (c): c is QualiteIaRow & { score_ia: number } => c.score_ia !== null
  )
  const totalScored = scored.length

  const scoreMoyen =
    totalScored > 0
      ? Math.round(
          scored.reduce((sum, c) => sum + c.score_ia, 0) / totalScored
        )
      : 0

  // Taux de flottement : % de candidats dont le score est à ±5 points du
  // seuil de leur offre (fenêtre de "candidats limites" qui aident l'AM
  // à conseiller le client sur le réglage du curseur). On exclut les
  // qualifié/rejeté qui ont déjà été tranchés — le chiffre doit coller
  // à la liste /candidatures/flottement (qui applique le même filtre).
  const flottementCount = scored.filter((c) => {
    if (c.statut === 'qualifié' || c.statut === 'rejeté') return false
    const offre = Array.isArray(c.offres) ? c.offres[0] : c.offres
    const seuil = offre?.seuil ?? 60
    return Math.abs(c.score_ia - seuil) <= 5
  }).length
  const tauxFlottement =
    totalScored > 0
      ? Math.round((flottementCount / totalScored) * 100)
      : 0

  // Taux d'incomplets : parmi les CV scorés par l'IA, % pour lesquels
  // Claude n'a pas extrait de nom ou d'email réel (les emails placeholder
  // se terminent par @example.com, cf. lib/email.ts).
  const incompletsCount = scored.filter((c) => {
    const hasNom = !!c.nom?.trim()
    const hasEmail =
      !!c.email?.trim() && !c.email.endsWith('@example.com')
    return !hasNom || !hasEmail
  }).length
  const tauxIncomplets =
    totalScored > 0
      ? Math.round((incompletsCount / totalScored) * 100)
      : 0

  // Répartition par statut sur l'ensemble des candidatures scorées : barre
  // empilée verte/ambre/rouge pour voir en un coup d'œil la proportion de
  // qualifiés / en attente / rejetés. On filtre les statuts vides pour ne
  // pas afficher de segment 0.
  const statutCounts = scored.reduce((acc, c) => {
    const s = c.statut ?? 'en attente'
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const statutOrder: Array<{
    key: string
    label: string
    className: string
  }> = [
    { key: 'qualifié', label: 'Qualifiés', className: 'bg-status-green' },
    { key: 'en attente', label: 'En attente', className: 'bg-status-amber' },
    { key: 'rejeté', label: 'Rejetés', className: 'bg-status-red' },
  ]
  const statutBreakdown = statutOrder
    .map((s) => ({ ...s, count: statutCounts[s.key] ?? 0 }))
    .filter((s) => s.count > 0)
  const totalStatut = statutBreakdown.reduce((s, x) => s + x.count, 0)

  // Moyenne de candidatures par offre : nb CV / nb offres, arrondie à
  // 1 décimale et formatée avec virgule (norme française). Tombe sur
  // '—' si aucune offre pour éviter une division par zéro.
  const moyenneCandidaturesParOffre =
    nbOffres && nbOffres > 0
      ? ((nbCandidatures ?? 0) / nbOffres).toFixed(1).replace('.', ',')
      : '—'

  const kpis = [
    { label: 'Offres actives', value: nbOffres ?? 0 },
    { label: 'Candidatures / offre', value: moyenneCandidaturesParOffre },
    { label: 'Candidats qualifiés', value: nbQualifies ?? 0 },
  ]

  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    const jj = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const aaaa = d.getFullYear()
    return `${jj}/${mm}/${aaaa}`
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="bg-surface-alt rounded-xl p-5 shadow-sm border border-border-soft"
          >
            <div className="text-sm text-muted font-medium">{k.label}</div>
            <div className="text-3xl font-bold text-brand-indigo-text mt-1">
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {/* Qualité IA — indicateurs sur le comportement du scoring */}
      <section aria-labelledby="qualite-ia-heading">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
          <h2 id="qualite-ia-heading" className="text-lg font-semibold">
            Qualité IA
          </h2>
          <p className="text-sm text-muted">
            Comment l&apos;IA se comporte sur tes flux de CV
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-surface-alt rounded-xl p-5 shadow-sm border border-border-soft">
            <div className="text-sm text-muted font-medium">Score moyen</div>
            <div className="text-3xl font-bold text-brand-indigo-text mt-1">
              {totalScored > 0 ? scoreMoyen : '—'}
            </div>
            <div className="text-sm text-muted mt-1">
              sur {totalScored} CV scoré{totalScored > 1 ? 's' : ''}
            </div>
          </div>
          <Link
            href="/candidatures/flottement"
            className="bg-surface-alt rounded-xl p-5 shadow-sm border border-border-soft block hover:border-brand-purple hover:shadow-md transition-all"
          >
            <div className="text-sm text-muted font-medium">
              Taux de flottement
            </div>
            <div className="text-3xl font-bold text-brand-indigo-text mt-1">
              {totalScored > 0 ? `${tauxFlottement}\u00A0%` : '—'}
            </div>
            <div className="text-sm text-muted mt-1">
              {flottementCount > 0
                ? `${flottementCount} CV${flottementCount > 1 ? 's' : ''} à trancher →`
                : 'Candidats à ±5 pts du seuil de leur offre'}
            </div>
          </Link>
          <Link
            href="/candidatures/incompletes"
            className="bg-surface-alt rounded-xl p-5 shadow-sm border border-border-soft block hover:border-brand-purple hover:shadow-md transition-all"
          >
            <div className="text-sm text-muted font-medium">
              Taux d&apos;incomplets
            </div>
            <div className="text-3xl font-bold text-brand-indigo-text mt-1">
              {totalScored > 0 ? `${tauxIncomplets}\u00A0%` : '—'}
            </div>
            <div className="text-sm text-muted mt-1">
              {incompletsCount > 0
                ? `${incompletsCount} CV${incompletsCount > 1 ? 's' : ''} à compléter →`
                : "Nom ou email non extrait par l'IA"}
            </div>
          </Link>
        </div>
      </section>

      {/* Répartition des candidatures — barre empilée pleine largeur +
          légende. Fallback accessible via role="img" + aria-label. */}
      <section aria-labelledby="repartition-heading">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
          <h2
            id="repartition-heading"
            className="text-lg font-semibold"
          >
            Répartition des candidatures
          </h2>
          <p className="text-sm text-muted">
            Vue globale des statuts sur l&apos;ensemble des CV scorés
          </p>
        </div>
        <div className="bg-surface-alt rounded-xl p-5 shadow-sm border border-border-soft">
          {totalStatut > 0 ? (
            <>
              <div
                className="flex h-8 rounded-md overflow-hidden"
                role="img"
                aria-label={`Répartition de ${totalStatut} candidature${totalStatut > 1 ? 's' : ''} par statut`}
              >
                {statutBreakdown.map((s) => {
                  const pct = (s.count / totalStatut) * 100
                  return (
                    <div
                      key={s.key}
                      className={`${s.className} flex items-center justify-center text-white text-xs font-semibold`}
                      style={{ width: `${pct}%` }}
                      title={`${s.label}\u00A0: ${s.count} (${Math.round(pct)}\u00A0%)`}
                    >
                      {pct >= 10 ? `${Math.round(pct)}\u00A0%` : ''}
                    </div>
                  )
                })}
              </div>
              <ul className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
                {statutBreakdown.map((s) => (
                  <li
                    key={s.key}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`inline-block w-3 h-3 rounded-sm ${s.className}`}
                        aria-hidden
                      />
                      <span>{s.label}</span>
                    </span>
                    <span className="text-muted tabular-nums">
                      {s.count} (
                      {Math.round((s.count / totalStatut) * 100)}
                      {'\u00A0%'})
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted py-8 text-center">
              Aucune donnée pour le moment.
            </p>
          )}
        </div>
      </section>

      {/* Activité récente — feed unifié : nouveaux clients, nouvelles
          offres, nouvelles candidatures. Triés par created_at desc,
          limités aux 5 plus récents. Pas d'audit log sur les changements
          de statut — juste les créations. */}
      <div className="bg-surface-alt rounded-xl border border-border-soft">
        <div className="px-6 py-4 border-b border-border-soft">
          <h2 className="font-semibold">Activité récente</h2>
          <p className="text-sm text-muted mt-0.5">
            Les 5 derniers événements sur la plateforme
          </p>
        </div>
        <ul className="divide-y divide-border-soft">
          {activites.map((a) => (
            <li
              key={`${a.type}-${a.id}`}
              className="px-6 py-4 flex items-start justify-between gap-4 text-sm flex-wrap"
            >
              {a.type === 'candidature' && (
                <>
                  <div className="min-w-0 flex-1">
                    <span className="text-brand-purple font-semibold">
                      Nouvelle candidature
                    </span>
                    <span className="text-muted"> • </span>
                    <span className="font-medium">
                      {a.nom?.trim() || 'Candidat'}
                    </span>
                    {a.offre && (
                      <>
                        <span className="text-muted"> → </span>
                        <Link
                          href={`/offres/${a.offre.id}`}
                          className="text-brand-purple hover:underline font-medium"
                        >
                          {a.offre.titre}
                        </Link>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {a.scoreIa !== null && (
                      <span
                        className={`font-bold ${
                          a.scoreIa >= 70
                            ? 'text-status-green'
                            : a.scoreIa >= 50
                              ? 'text-status-amber'
                              : 'text-status-red'
                        }`}
                        aria-label={`Score ${a.scoreIa} sur 100`}
                      >
                        {a.scoreIa}
                      </span>
                    )}
                    <StatusBadge status={a.statut ?? 'en attente'} />
                    <span className="text-muted text-xs tabular-nums">
                      {fmtDate(a.createdAt)}
                    </span>
                  </div>
                </>
              )}
              {a.type === 'client' && (
                <>
                  <div className="min-w-0 flex-1">
                    <span className="text-brand-indigo-text font-semibold">
                      Nouveau client
                    </span>
                    <span className="text-muted"> • </span>
                    <Link
                      href={`/clients/${a.id}`}
                      className="font-medium text-brand-indigo-text hover:text-brand-purple"
                    >
                      {a.nom}
                    </Link>
                  </div>
                  <span className="text-muted text-xs tabular-nums shrink-0">
                    {fmtDate(a.createdAt)}
                  </span>
                </>
              )}
              {a.type === 'offre' && (
                <>
                  <div className="min-w-0 flex-1">
                    <span className="text-status-amber font-semibold">
                      Nouvelle offre
                    </span>
                    <span className="text-muted"> • </span>
                    <Link
                      href={`/offres/${a.id}`}
                      className="font-medium text-brand-indigo-text hover:text-brand-purple"
                    >
                      {a.titre}
                    </Link>
                    {a.client && (
                      <>
                        <span className="text-muted"> chez </span>
                        <Link
                          href={`/clients/${a.client.id}`}
                          className="hover:underline"
                        >
                          {a.client.nom}
                        </Link>
                      </>
                    )}
                  </div>
                  <span className="text-muted text-xs tabular-nums shrink-0">
                    {fmtDate(a.createdAt)}
                  </span>
                </>
              )}
            </li>
          ))}
          {activites.length === 0 && (
            <li className="px-6 py-8 text-center text-muted text-sm">
              Aucune activité récente.
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
