import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import StatusBadge from '@/components/StatusBadge'

export default async function DashboardPage() {
  const supabase = await createClient()

  const [{ count: nbClients }, { count: nbOffres }, { count: nbCandidatures }] =
    await Promise.all([
      supabase.from('clients').select('*', { count: 'exact', head: true }),
      supabase.from('offres').select('*', { count: 'exact', head: true }),
      supabase.from('candidatures').select('*', { count: 'exact', head: true }),
    ])

  const { count: nbQualifies } = await supabase
    .from('candidatures')
    .select('*', { count: 'exact', head: true })
    .eq('statut', 'qualifié')

  const { data: recent } = await supabase
    .from('candidatures')
    .select('id, nom, email, score_ia, statut, created_at, offres(id, titre)')
    .order('created_at', { ascending: false })
    .limit(5)

  // Qualité IA : on fetch toutes les candidatures scorées avec le seuil de
  // leur offre pour calculer des indicateurs globaux sur la qualité du
  // scoring (score moyen, flottement autour du seuil, taux d'extraction
  // nom/email). L'agrégation est faite en JS côté serveur : acceptable
  // tant que le volume reste raisonnable. À basculer en SQL agrégé si on
  // dépasse quelques milliers de candidatures.
  const { data: qualiteIaRows } = await supabase
    .from('candidatures')
    .select('nom, email, score_ia, offres(seuil)')

  type QualiteIaRow = {
    nom: string | null
    email: string | null
    score_ia: number | null
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
  // à conseiller le client sur le réglage du curseur).
  const flottementCount = scored.filter((c) => {
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

  const kpis = [
    { label: 'Clients', value: nbClients ?? 0 },
    { label: 'Offres actives', value: nbOffres ?? 0 },
    { label: 'Candidatures reçues', value: nbCandidatures ?? 0 },
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
          <div className="bg-surface-alt rounded-xl p-5 shadow-sm border border-border-soft">
            <div className="text-sm text-muted font-medium">
              Taux de flottement
            </div>
            <div className="text-3xl font-bold text-brand-indigo-text mt-1">
              {totalScored > 0 ? `${tauxFlottement}\u00A0%` : '—'}
            </div>
            <div className="text-sm text-muted mt-1">
              Candidats à ±5 pts du seuil de leur offre
            </div>
          </div>
          <div className="bg-surface-alt rounded-xl p-5 shadow-sm border border-border-soft">
            <div className="text-sm text-muted font-medium">
              Taux d&apos;incomplets
            </div>
            <div className="text-3xl font-bold text-brand-indigo-text mt-1">
              {totalScored > 0 ? `${tauxIncomplets}\u00A0%` : '—'}
            </div>
            <div className="text-sm text-muted mt-1">
              Nom ou email non extrait par l&apos;IA
            </div>
          </div>
        </div>
      </section>

      {/* Activité récente */}
      <div className="bg-surface-alt rounded-xl border border-border-soft overflow-x-auto">
        <div className="px-6 py-4 border-b border-border-soft">
          <h2 className="font-semibold">Activité récente</h2>
          <p className="text-sm text-muted mt-0.5">
            Les 5 derniers CV scorés par l&apos;IA
          </p>
        </div>
        <table className="w-full">
          <thead className="bg-surface">
            <tr className="text-left text-xs font-semibold text-muted uppercase">
              <th className="px-6 py-3">Candidat</th>
              <th className="px-6 py-3">Offre</th>
              <th className="px-6 py-3">Score</th>
              <th className="px-6 py-3">Statut</th>
              <th className="px-6 py-3">Reçu le</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {recent?.map((c) => {
              const offreInfo = Array.isArray(c.offres)
                ? c.offres[0]
                : (c.offres as { id: string; titre: string } | null)
              return (
                <tr key={c.id} className="text-sm">
                  <td className="px-6 py-4">
                    <div className="font-medium">{c.nom}</div>
                    <div className="text-muted text-sm">{c.email}</div>
                  </td>
                  <td className="px-6 py-4">
                    {offreInfo ? (
                      <Link
                        href={`/offres/${offreInfo.id}`}
                        className="text-brand-purple font-medium hover:underline"
                      >
                        {offreInfo.titre}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`font-bold ${
                        (c.score_ia ?? 0) >= 70
                          ? 'text-status-green'
                          : (c.score_ia ?? 0) >= 50
                            ? 'text-status-amber'
                            : 'text-status-red'
                      }`}
                    >
                      {c.score_ia ?? '—'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={c.statut ?? 'en attente'} />
                  </td>
                  <td className="px-6 py-4 text-muted">
                    {fmtDate(c.created_at)}
                  </td>
                </tr>
              )
            })}
            {(!recent || recent.length === 0) && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-muted">
                  Aucune activité récente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
