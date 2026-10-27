import {parse} from 'parse5'

export const MAX_AGE_DAYS = 90

export type DatedOrigin = 'página' | 'artefacto'

/** Un dato con fecha de consulta u observación, ligado a la ruta pública que lo muestra o lo usa. */
export interface DatedItem {
  route: string
  label: string
  source: string
  date: string
  origin: DatedOrigin
}

export interface StaleItem extends DatedItem {
  /** Días desde `date` hasta hoy; `null` si la fecha no es válida. */
  ageDays: number | null
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const CONSULTED = /consultada\s+(\d{4}-\d{2}-\d{2})/i
const DAY_MS = 24 * 60 * 60 * 1000

interface HtmlNode {
  nodeName?: string
  tagName?: string
  value?: string
  attrs?: Array<{name: string; value: string}>
  childNodes?: HtmlNode[]
}

/**
 * Fechas que el HTML publicado muestra al lector: `consultada AAAA-MM-DD` de `Sources.astro` y el
 * `<time datetime>` de `DataProvenance.astro`.
 */
export function extractPageDates(route: string, html: string): DatedItem[] {
  const items: DatedItem[] = []
  const stack: HtmlNode[] = [parse(html) as unknown as HtmlNode]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.tagName === 'time') {
      const date = attr(node, 'datetime')
      if (date) items.push({route, label: 'Fecha de consulta', source: 'página', date, origin: 'página'})
      continue
    }
    if (node.tagName === 'li') {
      const date = CONSULTED.exec(textOf(node))?.[1]
      if (date) {
        const link = find(node, 'a')
        items.push({route, label: link ? textOf(link).trim() : 'Fuente', source: attr(link, 'href') ?? 'sin URL', date, origin: 'página'})
        continue
      }
    }
    for (const child of [...(node.childNodes ?? [])].reverse()) stack.push(child)
  }
  return items
}

/**
 * Fechas de un documento generado (`content/generated/{businesses,comparisons}`) que la página no
 * pinta: `sources[].accessedAt` y, en comparativas, `entries[].featuredItem.retrievedAt`.
 * `lastVerified` no se incluye porque la página ya lo muestra.
 */
export function artifactDates(document: Record<string, unknown>): DatedItem[] {
  const route = routeOfDocument(document)
  if (!route) return []
  const items: DatedItem[] = []
  for (const source of records(document.sources)) {
    if (typeof source.accessedAt !== 'string') continue
    const label = [source.title, source.publisher].filter((part) => typeof part === 'string').join(' · ') || 'Fuente'
    items.push({route, label, source: typeof source.url === 'string' ? source.url : 'sin URL', date: source.accessedAt, origin: 'artefacto'})
  }
  for (const entry of records(document.entries)) {
    const featured = isRecord(entry.featuredItem) ? entry.featuredItem : null
    if (!featured || typeof featured.retrievedAt !== 'string') continue
    const business = isRecord(entry.business) && typeof entry.business._ref === 'string' ? entry.business._ref : 'negocio'
    const price = typeof featured.price === 'number' ? ` ${featured.price} €${typeof featured.priceQualifier === 'string' ? ` (${featured.priceQualifier})` : ''}` : ''
    items.push({
      route,
      label: `${business}: ${String(featured.name)}${price}`,
      source: typeof featured.source === 'string' ? featured.source : 'sin fuente',
      date: featured.retrievedAt,
      origin: 'artefacto',
    })
  }
  return items
}

/** Ruta pública de un documento generado, como la construye `src/lib/content-source.ts`. */
export function routeOfDocument(document: Record<string, unknown>): string | null {
  const slug = isRecord(document.slug) && typeof document.slug.current === 'string' ? document.slug.current : null
  if (!slug) return null
  if (document._type === 'comparison') return `/donde-comer/${slug}/`
  if (document._type === 'business') return `/restaurantes/${slug}/`
  return null
}

/** Días completos entre `date` y `today` (AAAA-MM-DD); `null` si `date` no es válida. */
export function ageInDays(date: string, today: string): number | null {
  const from = parseIsoDate(date)
  const to = parseIsoDate(today)
  if (from === null || to === null) throw new Error(`Fecha de referencia no válida: ${today}`)
  return Math.round((to - from) / DAY_MS)
}

/**
 * Datos con más de `maxAgeDays` días, y los que no tienen una fecha válida (no se descartan: sin
 * fecha no se puede saber si siguen vigentes). Ordenados por ruta y, dentro, del más antiguo al más reciente.
 */
export function staleItems(items: readonly DatedItem[], today: string, maxAgeDays = MAX_AGE_DAYS): StaleItem[] {
  if (parseIsoDate(today) === null) throw new Error(`Fecha de referencia no válida: ${today}`)
  const seen = new Set<string>()
  const result: StaleItem[] = []
  for (const item of items) {
    const key = `${item.route}\u0000${item.label}\u0000${item.source}\u0000${item.date}`
    if (seen.has(key)) continue
    seen.add(key)
    const ageDays = parseIsoDate(item.date) === null ? null : ageInDays(item.date, today)
    if (ageDays === null || ageDays > maxAgeDays) result.push({...item, ageDays})
  }
  return result.sort((a, b) => a.route.localeCompare(b.route) || (b.ageDays ?? Infinity) - (a.ageDays ?? Infinity))
}

function parseIsoDate(value: string): number | null {
  const match = ISO_DATE.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const time = Date.UTC(year, month - 1, day)
  const check = new Date(time)
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? time : null
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function find(node: HtmlNode, tagName: string): HtmlNode | undefined {
  for (const child of node.childNodes ?? []) {
    if (child.tagName === tagName) return child
    const found = find(child, tagName)
    if (found) return found
  }
  return undefined
}

function textOf(node: HtmlNode): string {
  if (node.nodeName === '#text') return node.value ?? ''
  if (node.tagName === 'span' && attr(node, 'class')?.split(/\s+/).includes('sr-only')) return ''
  return (node.childNodes ?? []).map(textOf).join('')
}

function attr(node: HtmlNode | undefined, name: string): string | null {
  return node?.attrs?.find((attribute) => attribute.name === name)?.value ?? null
}
