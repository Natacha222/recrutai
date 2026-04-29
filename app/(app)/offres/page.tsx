import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  effectiveStatut,
  normalizeStatutOffreParam,
} from '@/lib/format'
import { FiltersReset } from '@/components/TableFilters'
import OffresTable, { type OffreItem } from './OffresTable'

type SortKey =
  | 'reference'
  | 'titre'
  | 'client'
  | 'referent'
  | 'contrat'
  | 'statut'
  | 'date_validite'
  | 'candidatures'
  | 'seuil'
type SortDir = 'asc' | 'desc'

const SORT_KEYS: SortKey[] = [
  'reference',
  'titre',
  'client',
  'referent',
  'contrat',
  'statut',
  'date_validite',
  'candidatures',
  'seuil',
]

const FILTER_FIELDS = [
  'ref_q',
  'q',
  'client',
  'referent',
  'contrat',
  'statut',
  'validite',
]
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type SearchParams = Promise<{
  /** Recherche texte sur la référence d'offre (ex : "tech-2026"). */
  ref_q?: string
  q?: string
  client?: string
  referent?: string
  contrat?: string
  statut?: string
  /** YYYY-MM-DD — filtre date_validite >= validite si défini et valide. */
  validite?: string
  sort?: string
  dir?: string
}>

export default async function OffresPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const {
    ref_q = '',
    q = '',
    client = '',
    referent = '',
    contrat = '',
    validite = '',
  } = params
  // Normalise le paramètre `statut` vers la forme canonique DB (actif/clos).
  // Sans ça, une URL tapée à la main comme `?statut=Active` ou `?statut=Clôturée`
  // ne matchait rien (valeurs internes = actif/clos) et la page renvoyait 0
  // résultat alors que l'utilisateur voyait le label « Active » dans le select.
  const statut = normalizeStatutOffreParam(params.statut)
  const sort: SortKey = SORT_KEYS.includes(params.sort as SortKey)
    ? (params.sort as SortKey)
    : 'titre'
  const dir: SortDir = params.dir === 'desc' ? 'desc' : 'asc'

  // On ignore silencieusement une date mal formée pour éviter de casser
  // la requête sur un paramètre corrompu — l'input type=date du navigateur
  // garantit déjà le format ISO en usage normal.
  const validiteEffective = ISO_DATE_RE.test(validite) ? validite : ''

  const supabase = await createClient()
  const { data: offres } = await supabase
    .from('offres')
    .select(
      'id, reference, titre, lieu, statut, contrat, seuil, created_at, date_validite, am_referent, client_id, clients(nom), candidatures(id, statut)'
    )

  const allOffres: OffreItem[] = (offres ?? []).map((o) => {
    const clientNom = Array.isArray(o.clients)
      ? (o.clients[0]?.nom ?? null)
      : ((o.clients as { nom: string } | null)?.nom ?? null)
    const effective = effectiveStatut(o.statut, o.date_validite)
    const total = (o.candidatures ?? []).length
    const qualifies = (o.candidatures ?? []).filter(
      (c) => c.statut === 'qualifié'
    ).length
    return {
      id: o.id,
      reference: o.reference,
      titre: o.titre,
      lieu: o.lieu,
      statut: o.statut,
      contrat: o.contrat,
      seuil: o.seuil,
      date_validite: o.date_validite,
      am_referent: o.am_referent,
      client_id: o.client_id,
      clientNom,
      effective,
      total,
      qualifies,
    }
  })

  // Distinct client names for the filter dropdown
  const clientsList = Array.from(
    new Set(
      allOffres
        .map((o) => o.clientNom)
        .filter((n): n is string => !!n && n.trim() !== '')
    )
  ).sort((a, b) => a.localeCompare(b, 'fr'))

  // Distinct référents pour le filtre (offres uniquement — si on a besoin
  // d'autres référents, les filtres ne les matcheront pas de toute façon).
  const referentsList = Array.from(
    new Set(
      allOffres
        .map((o) => o.am_referent)
        .filter((r): r is string => !!r && r.trim() !== '')
    )
  ).sort((a, b) => a.localeCompare(b, 'fr'))

  // Filter
  const qLower = q.trim().toLowerCase()
  const refQLower = ref_q.trim().toLowerCase()
  const filtered = allOffres.filter((o) => {
    if (
      refQLower &&
      !(o.reference ?? '').toLowerCase().includes(refQLower)
    ) {
      return false
    }
    if (qLower && !(o.titre ?? '').toLowerCase().includes(qLower)) return false
    if (client && o.clientNom !== client) return false
    if (referent && o.am_referent !== referent) return false
    if (contrat && o.contrat !== contrat) return false
    if (statut && o.effective !== statut) return false
    // Comparaison lexicographique sur ISO YYYY-MM-DD = chronologique.
    // Sémantique « encore valide à cette date » : on garde les offres dont
    // la date de validité est >= la date choisie. Les offres sans date sont
    // exclues dès que le filtre est défini.
    if (validiteEffective) {
      if (!o.date_validite || o.date_validite < validiteEffective) return false
    }
    return true
  })

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let av: string | number
    let bv: string | number
    switch (sort) {
      case 'reference':
        av = (a.reference ?? '').toLowerCase()
        bv = (b.reference ?? '').toLowerCase()
        break
      case 'client':
        av = (a.clientNom ?? '').toLowerCase()
        bv = (b.clientNom ?? '').toLowerCase()
        break
      case 'referent':
        av = (a.am_referent ?? '').toLowerCase()
        bv = (b.am_referent ?? '').toLowerCase()
        break
      case 'contrat':
        av = (a.contrat ?? '').toLowerCase()
        bv = (b.contrat ?? '').toLowerCase()
        break
      case 'statut':
        av = a.effective
        bv = b.effective
        break
      case 'date_validite':
        av = a.date_validite ?? ''
        bv = b.date_validite ?? ''
        break
      case 'candidatures':
        av = a.total
        bv = b.total
        break
      case 'seuil':
        av = a.seuil ?? 0
        bv = b.seuil ?? 0
        break
      case 'titre':
      default:
        av = (a.titre ?? '').toLowerCase()
        bv = (b.titre ?? '').toLowerCase()
    }
    if (typeof av === 'string' && typeof bv === 'string') {
      const cmp = av.localeCompare(bv, 'fr')
      return dir === 'asc' ? cmp : -cmp
    }
    const na = av as number
    const nb = bv as number
    return dir === 'asc' ? na - nb : nb - na
  })

  const totalAll = allOffres.length
  const offresActives = allOffres.filter((o) => o.effective === 'actif').length
  const offresClos = allOffres.filter((o) => o.effective === 'clos').length
  const hasFilter = !!(
    refQLower ||
    q ||
    client ||
    referent ||
    contrat ||
    statut ||
    validiteEffective
  )
  const totalShown = sorted.length
  const subtitle = hasFilter
    ? `${totalShown} résultat${totalShown > 1 ? 's' : ''} sur ${totalAll}`
    : `${offresActives} offre${offresActives > 1 ? 's' : ''} active${
        offresActives > 1 ? 's' : ''
      } · ${offresClos} offre${offresClos > 1 ? 's' : ''} clôturée${
        offresClos > 1 ? 's' : ''
      }`

  // Pré-calcul des hrefs de tri (cf. ClientsTable pour le rationale).
  function sortHref(key: SortKey) {
    const newDir: SortDir = sort === key && dir === 'asc' ? 'desc' : 'asc'
    const sp = new URLSearchParams()
    if (ref_q) sp.set('ref_q', ref_q)
    if (q) sp.set('q', q)
    if (client) sp.set('client', client)
    if (referent) sp.set('referent', referent)
    if (contrat) sp.set('contrat', contrat)
    if (statut) sp.set('statut', statut)
    if (validiteEffective) sp.set('validite', validiteEffective)
    if (key !== 'titre') sp.set('sort', key)
    if (newDir !== 'asc') sp.set('dir', newDir)
    const qs = sp.toString()
    return qs ? `/offres?${qs}` : '/offres'
  }
  const sortHrefs = SORT_KEYS.reduce(
    (acc, key) => {
      acc[key] = sortHref(key)
      return acc
    },
    {} as Record<SortKey, string>
  )

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Offres d&apos;emploi</h1>
          <div className="text-sm text-muted mt-1 flex items-center gap-3">
            <span>{subtitle}</span>
            <FiltersReset fields={FILTER_FIELDS} />
          </div>
        </div>
        <Link
          href="/offres/nouvelle"
          className="px-4 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold hover:opacity-90"
        >
          + Nouvelle offre
        </Link>
      </div>

      <OffresTable
        items={sorted}
        hasFilter={hasFilter}
        clientsList={clientsList}
        referentsList={referentsList}
        sort={sort}
        dir={dir}
        sortHrefs={sortHrefs}
      />
    </div>
  )
}
