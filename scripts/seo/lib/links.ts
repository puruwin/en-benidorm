import {MIN_INCOMING_LINKS, type PageGraphEntry} from './audit'

export type RouteKind = 'home' | 'hub' | 'ficha' | 'guia' | 'other'

export type LinkReason = 'hub-ficha' | 'ficha-hub' | 'ficha-hermana' | 'misma-zona'

export interface LinkProposal {
  from: string
  to: string
  reason: LinkReason
  detail: string
  /** El destino no llega al mínimo de enlaces entrantes de seo:audit. */
  targetBelowMinimum: boolean
}

const REASON_ORDER: Record<LinkReason, number> = {'hub-ficha': 0, 'ficha-hub': 1, 'ficha-hermana': 2, 'misma-zona': 3}

/** Tipo de página según los patrones de `src/lib/routes.ts`. */
export function classifyRoute(route: string): RouteKind {
  if (route === '/') return 'home'
  if (/^\/donde-comer\/(?:[^/]+\/)?$/.test(route)) return 'hub'
  if (/^\/restaurantes\/[^/]+\/$/.test(route)) return 'ficha'
  if (/^\/guias\/[^/]+\/$/.test(route)) return 'guia'
  return 'other'
}

/**
 * Propone enlaces contextuales hub ↔ ficha y ficha ↔ ficha cercana a partir del grafo de seo:audit.
 * Solo entre páginas indexables, nunca enlaces que ya existen. «Cercana» es compartir un hub entrante
 * de categoría (cercanía temática) o, si se pasa `zones`, la misma zona (cercanía geográfica).
 */
export function proposeLinks(pages: Readonly<Record<string, PageGraphEntry>>, options: {zones?: Readonly<Record<string, string>>} = {}): LinkProposal[] {
  const indexable = Object.keys(pages).filter((route) => pages[route]?.type === 'indexable').sort(compare)
  const outgoing = new Map(indexable.map((route) => [route, new Set(pages[route]?.outgoing ?? [])]))
  const incomingCount = new Map(indexable.map((route) => [route, pages[route]?.incoming.length ?? 0]))
  const fichas = indexable.filter((route) => classifyRoute(route) === 'ficha')
  const hubs = indexable.filter((route) => classifyRoute(route) === 'hub')
  const proposals = new Map<string, LinkProposal>()

  const propose = (from: string, to: string, reason: LinkReason, detail: string) => {
    if (from === to || outgoing.get(from)?.has(to)) return
    const key = `${from}|${to}`
    const current = proposals.get(key)
    if (current) {
      // Un mismo par puede tener varios motivos: se queda el más fuerte y se anotan los demás.
      const [strong, weak] = REASON_ORDER[current.reason] <= REASON_ORDER[reason] ? [current, {reason, detail}] : [{...current, reason, detail}, current]
      proposals.set(key, {...strong, detail: `${strong.detail}; ${weak.detail}`})
      return
    }
    proposals.set(key, {from, to, reason, detail, targetBelowMinimum: (incomingCount.get(to) ?? 0) < MIN_INCOMING_LINKS})
  }

  const hubsOf = new Map(fichas.map((ficha) => [ficha, hubs.filter((hub) => outgoing.get(hub)?.has(ficha) || outgoing.get(ficha)?.has(hub))]))
  for (const ficha of fichas) {
    for (const hub of hubsOf.get(ficha) ?? []) {
      propose(hub, ficha, 'hub-ficha', `${ficha} ya enlaza ${hub}`)
      propose(ficha, hub, 'ficha-hub', `${hub} ya enlaza ${ficha}`)
    }
  }

  for (const a of fichas) {
    for (const b of fichas) {
      if (a === b) continue
      // El hub general lista todas las fichas: compartirlo no hace a dos fichas cercanas.
      const shared = (hubsOf.get(a) ?? []).filter((hub) => isCategoryHub(hub) && hubsOf.get(b)?.includes(hub))
      if (shared.length > 0) propose(a, b, 'ficha-hermana', `comparten ${shared.join(', ')}`)
      const zoneA = options.zones?.[a]
      if (zoneA && zoneA === options.zones?.[b]) propose(a, b, 'misma-zona', `zona ${zoneA}`)
    }
  }

  // Primero lo que arregla huérfanas; después por destino, origen y motivo.
  return [...proposals.values()].sort((x, y) => Number(y.targetBelowMinimum) - Number(x.targetBelowMinimum)
    || compare(x.to, y.to) || compare(x.from, y.from) || REASON_ORDER[x.reason] - REASON_ORDER[y.reason])
}

function isCategoryHub(route: string): boolean {
  return route.split('/').filter(Boolean).length > 1
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
