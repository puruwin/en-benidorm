import {parse} from 'parse5'
import type {CommercialFactFormat, CommercialItem} from './types'
import type {CrawledWebsiteDocument, CrawledWebsitePage} from './website-crawler'

export const COMMERCIAL_EXTRACTOR_VERSION = '2'

export interface CommercialExtractionContext {
  expectedName?: string | null
}

export interface CommercialExtractionSummary {
  byFormat: Record<CommercialFactFormat, number>
  byDimension: {products: number; services: number; specialties: number; prices: number; openingHours: number}
  discarded: Array<{sourceKey: string; reason: string}>
}

export interface CommercialExtractionResult {
  items: CommercialItem[]
  openingHours: Array<{value: string; sourceKey: string; format: CommercialFactFormat}>
  summary: CommercialExtractionSummary
}

interface HtmlNode {
  nodeName?: string
  tagName?: string
  value?: string
  attrs?: Array<{name: string; value: string}>
  childNodes?: HtmlNode[]
  parentNode?: HtmlNode
}

interface PriceMatch {
  amount: number
  raw: string
  qualifier?: 'from'
}

const PRICE = /(?:(?:desde|from)\s+)?(?:€\s*(\d{1,4}(?:[.,]\d{1,2})?)|(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:€|EUR\b))/gi
const HOURS = /\b(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s*(?:a|to|-|–|,|y)\s*(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday))?\s*[:\-]?\s*(?:de\s*)?(\d{1,2}[:.]\d{2})\s*(?:a|-|–)\s*(\d{1,2}[:.]\d{2})\b/gi
const BUSINESS_TYPES = new Set(['LocalBusiness', 'Restaurant', 'CafeOrCoffeeShop', 'Store', 'Hotel', 'LodgingBusiness', 'FoodEstablishment', 'ProfessionalService', 'HealthAndBeautyBusiness'])
const COMMERCIAL_TYPES = new Set(['Menu', 'MenuSection', 'MenuItem', 'Product', 'Offer', 'AggregateOffer', 'Service', 'OpeningHoursSpecification'])
const CONTEXT = /\b(?:menu|men[uú]|carta|productos?|products?|cat[aá]logo|catalog|servicios?|services?|tratamientos?|treatments?|tarifas?|prices?|especialidades?|specialties?)\b/i
const SERVICE_CONTEXT = /\b(?:servicios?|services?|tratamientos?|treatments?|tarifas?)\b/i
const SPECIALTY_CONTEXT = /\b(?:especialidades?|specialties?)\b/i
const GENERIC_NAME = /^(?:menu|men[uú]|carta|productos?|servicios?|tarifas?|precio|price|ver m[aá]s|more)$/i
const EXPLICIT_ITEM = /(?:^|[-_\s])(?:(?:menu|product|service|treatment|catalog)[-_\s]?(?:item|card|entry|row)|single[-_\s]?(?:menu|product|service))(?:$|[-_\s])/i

export function extractCommercialInformation(
  pages: readonly CrawledWebsitePage[],
  documents: readonly CrawledWebsiteDocument[] = [],
  context: CommercialExtractionContext = {},
): CommercialExtractionResult {
  const items: CommercialItem[] = []
  const openingHours: CommercialExtractionResult['openingHours'] = []
  const discarded: CommercialExtractionSummary['discarded'] = []
  for (const page of pages) {
    const structured = structuredFromHtml(page, context)
    items.push(...structured.items)
    openingHours.push(...structured.openingHours)
    discarded.push(...structured.discarded)
    if (!structured.multipleBusinesses) {
      const semantic = semanticHtmlItems(page)
      items.push(...semantic.items)
      openingHours.push(...semantic.openingHours)
    } else {
      discarded.push({sourceKey: page.source.key, reason: 'HTML comercial no atribuido: la página contiene varios establecimientos.'})
    }
  }
  for (const document of documents) for (const page of document.pages) {
    items.push(...itemsFromText(page.text, page.source.key, page.source.retrievedAt, 'pdf', page.pageNumber))
    openingHours.push(...hoursFromText(page.text, page.source.key, 'pdf'))
  }
  const deduplicatedItems = deduplicateItems(items)
  const uniqueItems = deduplicatedItems.slice(0, 100)
  if (deduplicatedItems.length > uniqueItems.length) {
    discarded.push({
      sourceKey: 'commercial-extractor',
      reason: `Límite de hallazgos alcanzado: ${deduplicatedItems.length - uniqueItems.length} elementos comerciales no se incorporaron.`,
    })
  }
  const uniqueHours = uniqueBy(openingHours, (item) => `${normalize(item.value)}|${item.sourceKey}`)
  const byFormat = {html: 0, 'json-ld': 0, 'embedded-json': 0, pdf: 0} satisfies Record<CommercialFactFormat, number>
  for (const item of uniqueItems) byFormat[item.format] += 1
  return {
    items: uniqueItems,
    openingHours: uniqueHours,
    summary: {
      byFormat,
      byDimension: {
        products: uniqueItems.filter((item) => item.kind === 'product').length,
        services: uniqueItems.filter((item) => item.kind === 'service').length,
        specialties: uniqueItems.filter((item) => item.kind === 'specialty').length,
        prices: uniqueItems.filter((item) => item.price).length,
        openingHours: uniqueHours.length,
      },
      discarded: uniqueBy(discarded, (item) => `${item.sourceKey}|${item.reason}`),
    },
  }
}

function structuredFromHtml(page: CrawledWebsitePage, context: CommercialExtractionContext): {
  items: CommercialItem[]
  openingHours: CommercialExtractionResult['openingHours']
  discarded: CommercialExtractionSummary['discarded']
  multipleBusinesses: boolean
} {
  const scripts = [...page.html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  const roots: Array<{value: unknown; format: 'json-ld' | 'embedded-json'}> = []
  for (const script of scripts) {
    const attributes = script[1] ?? ''
    const format = /type=["']application\/ld\+json["']/i.test(attributes) ? 'json-ld'
      : /type=["']application\/json["']/i.test(attributes) ? 'embedded-json' : null
    if (!format || (script[2]?.length ?? 0) > 1_000_000) continue
    try { roots.push({value: JSON.parse(decodeEntities(script[2] ?? '')), format}) } catch { /* Publisher JSON is ignored safely. */ }
  }
  const businessRoots = roots.flatMap((root) => records(root.value).filter((item) => types(item).some((type) => BUSINESS_TYPES.has(type))))
  const namedBusinesses = uniqueBy(businessRoots.filter((item) => typeof item.name === 'string'), (item) => normalize(String(item.name)))
  const multipleBusinesses = namedBusinesses.length > 1
  let allowedBusiness: Record<string, unknown> | null = null
  if (multipleBusinesses && context.expectedName) {
    const expected = normalize(context.expectedName)
    const matches = namedBusinesses.filter((item) => comparableIdentity(normalize(String(item.name)), expected))
    if (matches.length === 1) allowedBusiness = matches[0]!
  }
  const values = multipleBusinesses ? (allowedBusiness ? [{value: allowedBusiness, format: 'json-ld' as const}] : []) : roots
  const items: CommercialItem[] = []
  const openingHours: CommercialExtractionResult['openingHours'] = []
  for (const root of values) {
    for (const record of records(root.value)) {
      const recordTypes = types(record)
      if (recordTypes.includes('OpeningHoursSpecification')) {
        const hours = openingSpecification(record)
        if (hours) openingHours.push({value: hours, sourceKey: page.source.key, format: root.format})
      }
      if (!recordTypes.some((type) => COMMERCIAL_TYPES.has(type)) && !recognizableEmbeddedItem(record)) continue
      const kind = recordTypes.includes('Service') ? 'service'
        : recordTypes.includes('MenuItem') || recordTypes.includes('Product') || recognizableEmbeddedItem(record) ? 'product' : null
      if (!kind || typeof record.name !== 'string') continue
      const name = cleanName(record.name)
      if (!validName(name)) continue
      const offer = firstOffer(record.offers) ?? (recordTypes.includes('Offer') ? record : null)
      const price = offer ? structuredPrice(offer, page.source.retrievedAt) : undefined
      const url = firstUrl(record.url, offer?.url, page.url)
      items.push({name, kind, ...(price ? {price} : {}), ...(url ? {url} : {}), sourceKey: page.source.key, observedAt: page.source.retrievedAt.slice(0, 10), format: root.format})
    }
  }
  return {
    items, openingHours,
    discarded: multipleBusinesses && !allowedBusiness
      ? [{sourceKey: page.source.key, reason: 'Datos estructurados ambiguos: no se confirmó cuál de los establecimientos era la entidad objetivo.'}]
      : [],
    multipleBusinesses,
  }
}

function semanticHtmlItems(page: CrawledWebsitePage): {items: CommercialItem[]; openingHours: CommercialExtractionResult['openingHours']} {
  const root = parse(page.html) as unknown as HtmlNode
  const elements = walk(root).filter((node) => {
    if (!['li', 'tr', 'article', 'div'].includes(node.tagName ?? '') || insideNonContent(node)) return false
    return node.tagName !== 'div' || explicitItemNode(node)
  })
  const items: CommercialItem[] = []
  for (const node of elements) {
    const context = semanticContext(node)
    if (!CONTEXT.test(context)) continue
    const text = cleanText(textContent(node))
    if (!text || text.length > 260 || HOURS.test(text)) { HOURS.lastIndex = 0; continue }
    HOURS.lastIndex = 0
    const prices = priceMatches(text)
    if (prices.length > 1) continue
    const name = candidateName(node, text, prices[0])
    if (!validName(name) || (!prices.length && looksDescriptive(name))) continue
    if (!prices.length && (!explicitItemNode(node) || text.length > 100 || /[.!?].+[.!?]/.test(text))) continue
    const kind = SPECIALTY_CONTEXT.test(context) ? 'specialty' : SERVICE_CONTEXT.test(context) ? 'service' : 'product'
    const href = firstDescendant(node, 'a') ? resolveHref(attr(firstDescendant(node, 'a')!, 'href'), page.url) : null
    items.push({
      name, kind,
      ...(prices[0] ? {price: commercialPrice(prices[0], page.source.retrievedAt)} : {}),
      ...(href ? {url: href} : {}), sourceKey: page.source.key, observedAt: page.source.retrievedAt.slice(0, 10), format: 'html',
    })
  }
  return {items, openingHours: hoursFromText(page.text, page.source.key, 'html')}
}

function itemsFromText(text: string, sourceKey: string, observedAt: string, format: 'pdf', pageNumber: number): CommercialItem[] {
  const items: CommercialItem[] = []
  let contextKind: CommercialItem['kind'] | null = null
  for (let line of text.split(/\n|\s{3,}/).map(cleanText).filter(Boolean)) {
    if (line.length > 220) continue
    const heading = /^(menu|men[uú]|carta|productos?|products?|cat[aá]logo|catalog|servicios?|services?|tratamientos?|treatments?|especialidades?|specialties?)\b[:\-]?\s*/i.exec(line)
    if (heading) {
      contextKind = SPECIALTY_CONTEXT.test(heading[0]) ? 'specialty' : SERVICE_CONTEXT.test(heading[0]) ? 'service' : 'product'
      line = line.slice(heading[0].length).trim()
      if (!line) continue
    }
    if (!contextKind) continue
    const prices = priceMatches(line)
    if (prices.length !== 1) continue
    const name = cleanName(line.replace(prices[0]!.raw, ''))
    if (!validName(name)) continue
    items.push({name, kind: contextKind, price: commercialPrice(prices[0]!, observedAt), sourceKey, observedAt: observedAt.slice(0, 10), format, pageNumber})
  }
  return items
}

function hoursFromText(text: string, sourceKey: string, format: CommercialFactFormat): CommercialExtractionResult['openingHours'] {
  const matches: CommercialExtractionResult['openingHours'] = []
  HOURS.lastIndex = 0
  for (const match of text.matchAll(HOURS)) matches.push({value: cleanText(match[0]), sourceKey, format})
  HOURS.lastIndex = 0
  return matches
}

function records(value: unknown): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = []
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) { for (const child of item) visit(child); return }
    if (!isRecord(item)) return
    result.push(item)
    for (const child of Object.values(item)) if (typeof child === 'object' && child !== null) visit(child)
  }
  visit(value)
  return result
}
function types(record: Record<string, unknown>): string[] {
  return (Array.isArray(record['@type']) ? record['@type'] : [record['@type']]).filter((item): item is string => typeof item === 'string')
}
function recognizableEmbeddedItem(record: Record<string, unknown>): boolean {
  return typeof record.name === 'string' && (record.price !== undefined || isRecord(record.offers))
}
function firstOffer(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value
  if (Array.isArray(value)) return value.find(isRecord) ?? null
  return null
}
function structuredPrice(offer: Record<string, unknown>, observedAt: string): CommercialItem['price'] | undefined {
  const currency = typeof offer.priceCurrency === 'string' ? offer.priceCurrency.toUpperCase() : ''
  const rawValue = typeof offer.price === 'number' || typeof offer.price === 'string' ? String(offer.price) : ''
  const amount = Number(rawValue.replace(',', '.'))
  if (currency !== 'EUR' || !Number.isFinite(amount) || amount <= 0 || amount > 100_000) return undefined
  return {amount, currency: 'EUR', raw: `${rawValue} ${currency}`, observedAt: observedAt.slice(0, 10), confidence: 'explicit'}
}
function openingSpecification(record: Record<string, unknown>): string | null {
  const days = (Array.isArray(record.dayOfWeek) ? record.dayOfWeek : [record.dayOfWeek])
    .filter((item): item is string => typeof item === 'string').map((item) => item.split('/').at(-1)).join(', ')
  return days && typeof record.opens === 'string' && typeof record.closes === 'string' ? `${days}: ${record.opens}-${record.closes}` : null
}
function semanticContext(node: HtmlNode): string {
  const values: string[] = []
  let current: HtmlNode | undefined = node
  for (let depth = 0; current && depth < 4; depth += 1, current = current.parentNode) {
    values.push(attr(current, 'class') ?? '', attr(current, 'id') ?? '', attr(current, 'aria-label') ?? '')
    if (current.parentNode) {
      const siblings = current.parentNode.childNodes ?? []
      const index = siblings.indexOf(current)
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const sibling = siblings[cursor]!
        if (/^h[1-6]$/.test(sibling.tagName ?? '')) { values.push(textContent(sibling)); break }
      }
    }
  }
  return cleanText(values.join(' '))
}
function candidateName(node: HtmlNode, text: string, price?: PriceMatch): string {
  const named = attr(node, 'data-name')
    ?? ['h1', 'h2', 'h3', 'h4', 'strong', 'b', 'td'].map((tag) => firstDescendant(node, tag)).find(Boolean)?.childNodes?.map(textContent).join(' ')
  const value = named || text
  return cleanName(price ? value.replace(price.raw, '') : value)
}
function priceMatches(text: string): PriceMatch[] {
  const result: PriceMatch[] = []
  PRICE.lastIndex = 0
  for (const match of text.matchAll(PRICE)) {
    const rawNumber = match[1] ?? match[2]
    const amount = Number(rawNumber?.replace(',', '.'))
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) continue
    result.push({amount, raw: match[0], ...(/^(?:desde|from)\b/i.test(match[0]) ? {qualifier: 'from' as const} : {})})
  }
  PRICE.lastIndex = 0
  return result
}
function commercialPrice(match: PriceMatch, observedAt: string): NonNullable<CommercialItem['price']> {
  return {amount: match.amount, currency: 'EUR', raw: match.raw, observedAt: observedAt.slice(0, 10), confidence: 'explicit', ...(match.qualifier ? {priceQualifier: match.qualifier} : {})}
}
function deduplicateItems(items: CommercialItem[]): CommercialItem[] {
  const priority: Record<CommercialFactFormat, number> = {'json-ld': 4, 'embedded-json': 3, html: 2, pdf: 1}
  const result = new Map<string, CommercialItem>()
  for (const item of items) {
    const key = `${item.kind}|${normalize(item.name)}`
    const previous = result.get(key)
    if (!previous || priority[item.format] > priority[previous.format]
      || (priority[item.format] === priority[previous.format] && !previous.price && item.price)) result.set(key, item)
  }
  return [...result.values()]
}
function walk(node: HtmlNode): HtmlNode[] { return [node, ...(node.childNodes ?? []).flatMap(walk)] }
function textContent(node: HtmlNode): string { return node.nodeName === '#text' ? node.value ?? '' : (node.childNodes ?? []).map(textContent).join(' ') }
function attr(node: HtmlNode, name: string): string | null { return node.attrs?.find((item) => item.name === name)?.value ?? null }
function firstDescendant(node: HtmlNode, tag: string): HtmlNode | null { return walk(node).find((item) => item.tagName === tag) ?? null }
function explicitItemNode(node: HtmlNode): boolean {
  const own = `${attr(node, 'class') ?? ''} ${attr(node, 'id') ?? ''}`
  const parent = node.parentNode ? `${attr(node.parentNode, 'class') ?? ''} ${attr(node.parentNode, 'id') ?? ''}` : ''
  return EXPLICIT_ITEM.test(own) || EXPLICIT_ITEM.test(parent)
    || attr(node, 'itemprop') === 'name'
    || /schema\.org\/(?:Product|Service|MenuItem)/i.test(attr(node, 'itemtype') ?? '')
}
function insideNonContent(node: HtmlNode): boolean {
  let current: HtmlNode | undefined = node.parentNode
  while (current) {
    if (['nav', 'header', 'footer', 'aside'].includes(current.tagName ?? '')) return true
    current = current.parentNode
  }
  return false
}
function cleanText(value: string): string { return decodeEntities(value).replace(/\s+/g, ' ').trim() }
function cleanName(value: string): string { return cleanText(value).replace(/^[|•·:;\-–]+|[|•·:;\-–]+$/g, '').trim().slice(0, 120) }
function validName(value: string): boolean { return value.length >= 2 && value.length <= 100 && !GENERIC_NAME.test(value) && /[A-Za-zÀ-ÿ]/.test(value) }
function looksDescriptive(value: string): boolean {
  return /^(?:todos?|todas?|nuestros?|nuestras?|los precios|elige|escoge|servidos?|acompa[nñ]ados?|incluye[n]?)\b/i.test(value)
}
function normalize(value: string): string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function comparableIdentity(left: string, right: string): boolean { return left === right || (left.length >= 6 && right.includes(left)) || (right.length >= 6 && left.includes(right)) }
function resolveHref(value: string | null, base: string): string | null { try { return value ? new URL(value, base).toString() : null } catch { return null } }
function firstUrl(...values: unknown[]): string | null { return values.find((item): item is string => typeof item === 'string' && /^https?:\/\//i.test(item)) ?? null }
function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] { return [...new Map(values.map((value) => [key(value), value])).values()] }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function decodeEntities(value: string): string {
  const entities: Record<string, string> = {amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' '}
  return value.replace(/&(#x?[\da-f]+|\w+);/gi, (original, entity: string) => {
    if (entity.startsWith('#')) {
      const hex = entity[1]?.toLowerCase() === 'x'; const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : original
    }
    return entities[entity.toLowerCase()] ?? original
  })
}
