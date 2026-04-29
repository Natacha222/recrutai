import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Cron RGPD — supprime les candidatures (+ CVs Storage) liées aux offres
 * dont la date de validité est expirée depuis plus de 3 mois.
 *
 * Trigger : Vercel Cron, 1×/jour à 3h UTC (≈ 4h Paris hiver, 5h Paris été).
 * Cf. vercel.json à la racine pour le schedule.
 *
 * Authentification : header `Authorization: Bearer <CRON_SECRET>`. Vercel
 * pose ce header automatiquement quand il déclenche le cron. Tout autre
 * appel (curl manuel sans secret, attaquant) est rejeté en 401.
 *
 * Bypass RLS : on utilise un client admin (service_role) car aucun
 * utilisateur n'est connecté en cron — les RLS policies de la DB
 * bloqueraient toute opération.
 *
 * Action :
 *  - Sélectionne les offres dont `date_validite + 3 mois < aujourd'hui`.
 *  - Supprime toutes les candidatures liées + leurs CVs dans `cvs/`.
 *  - L'OFFRE EST CONSERVÉE (info business, pas donnée personnelle).
 *
 * Périmètre : ignore les offres sans `date_validite` (legacy < V26). Pour
 * ces cas, le nettoyage manuel passe par /clients/[id] ou /offres/[id].
 *
 * Idempotence : safe à relancer plusieurs fois — le filtre sur la date
 * garantit qu'on ne supprime jamais deux fois la même candidature.
 *
 * Test local :
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     http://localhost:3000/api/cron/cleanup-candidatures
 */
export async function GET(request: NextRequest) {
  // 1) Auth — bloque tout appel hors Vercel Cron (ou test local avec le
  //    secret). Si CRON_SECRET n'est pas défini en env, on refuse tout —
  //    safe-by-default.
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2) Cutoff : aujourd'hui - 3 mois (au format YYYY-MM-DD pour comparer
  //    à `date_validite` qui est de type DATE en DB, pas TIMESTAMP).
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 3)
  const cutoffIso = cutoff.toISOString().slice(0, 10)

  let supabase
  try {
    supabase = createAdminClient()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[cron-cleanup]', msg)
    return Response.json({ error: msg }, { status: 500 })
  }

  // 3) Lit les offres expirées de plus de 3 mois.
  const { data: offres, error: offresErr } = await supabase
    .from('offres')
    .select('id')
    .not('date_validite', 'is', null)
    .lt('date_validite', cutoffIso)
  if (offresErr) {
    console.error('[cron-cleanup] lecture offres :', offresErr.message)
    return Response.json(
      { error: `Lecture offres : ${offresErr.message}` },
      { status: 500 }
    )
  }

  const offreIds = (offres ?? []).map((o) => o.id)
  if (offreIds.length === 0) {
    const summary = {
      ok: true,
      cutoff: cutoffIso,
      offresExpirees: 0,
      candidaturesSupprimees: 0,
      cvsSupprimes: 0,
      message: 'Aucune offre expirée +3 mois — rien à nettoyer.',
    }
    console.log('[cron-cleanup]', summary)
    return Response.json(summary)
  }

  // 4) Lit les candidatures à supprimer (avec leurs `cv_path` pour Storage).
  const { data: candidatures, error: candErr } = await supabase
    .from('candidatures')
    .select('id, cv_path')
    .in('offre_id', offreIds)
  if (candErr) {
    console.error('[cron-cleanup] lecture candidatures :', candErr.message)
    return Response.json(
      { error: `Lecture candidatures : ${candErr.message}` },
      { status: 500 }
    )
  }

  const cvPaths = (candidatures ?? [])
    .map((c) => c.cv_path)
    .filter((p): p is string => !!p)
  let cvsSupprimes = 0

  // 5) Storage cleanup — best-effort. Voir deleteOffre / deleteClient pour
  //    le rationale (orphelin = OK, row morte = pas OK).
  if (cvPaths.length > 0) {
    const { data: removed, error: storageErr } = await supabase.storage
      .from('cvs')
      .remove(cvPaths)
    if (storageErr) {
      console.warn(
        `[cron-cleanup] suppression CVs Storage partielle : ${storageErr.message}`
      )
    }
    cvsSupprimes = removed?.length ?? 0
  }

  // 6) DB cleanup — DELETE candidatures uniquement (les offres restent).
  const { error: delErr } = await supabase
    .from('candidatures')
    .delete()
    .in('offre_id', offreIds)
  if (delErr) {
    console.error('[cron-cleanup] suppression candidatures :', delErr.message)
    return Response.json(
      { error: `Suppression candidatures : ${delErr.message}` },
      { status: 500 }
    )
  }

  const summary = {
    ok: true,
    cutoff: cutoffIso,
    offresExpirees: offreIds.length,
    candidaturesSupprimees: candidatures?.length ?? 0,
    cvsSupprimes,
  }
  // Log agrégé seulement (pas de PII : ni nom, ni email, ni id de candidat).
  console.log('[cron-cleanup] done :', summary)
  return Response.json(summary)
}
