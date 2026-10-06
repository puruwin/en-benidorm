import {readFile} from 'node:fs/promises'
import {loadEnvFile} from 'node:process'
import {ENTITY_TYPES, type BusinessFacts, type EntityType, type Fact, type SourceProvenance} from './types'
import {sourceKey} from './normalize'

export interface SourceRecord {
  type: EntityType
  priority: number
  sources: SourceProvenance[]
  raw: {
    name: string
    tags: Record<string, string>
    latitude: number | null
    longitude: number | null
  }
}

export interface DiscoveryRequest {
  type?: EntityType
  limit?: number
  retrievedAt: string
}

export interface SourceAdapter {
  readonly provider: string
  discover(request: DiscoveryRequest): Promise<SourceRecord[]>
}

export type OfficialWebsiteFacts = Pick<BusinessFacts,
  | 'cuisine' | 'concept' | 'specialties' | 'services' | 'bookingAvailability'
  | 'takeaway' | 'delivery' | 'terrace' | 'accessibility' | 'openingInformation'
  | 'locationContext' | 'distinctiveFeatures'>

export interface OfficialWebsiteResult {
  facts: OfficialWebsiteFacts
  sources: SourceProvenance[]
}

const WEBSITE_LINK_LIMIT = 5
const RELEVANT_LINK = /(?:carta|menu|men[uú]|reserv|booking|contact|ubicaci|localiz|nosotros|about|servici|restaurante|food|drink)/i

/** Extracts attributable facts from public pages owned by the business. */
export class OfficialWebsiteAdapter {
  readonly provider = 'official-website'

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async enrich(website: string, retrievedAt: string): Promise<OfficialWebsiteResult> {
    const initial = publicWebsiteUrl(website)
    const queue = [initial]
    const visited = new Set<string>()
    const pages: WebsitePage[] = []
    while (queue.length && pages.length < WEBSITE_LINK_LIMIT) {
      const requested = queue.shift()!
      const canonical = canonicalWebsiteUrl(requested)
      if (visited.has(canonical)) continue
      visited.add(canonical)
      const response = await this.fetcher(requested, {
        headers: {'accept': 'text/html,application/xhtml+xml', 'user-agent': 'enBenidorm-content-pipeline/1.0'},
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) {
        if (pages.length === 0) throw new Error(`La web oficial respondió ${response.status} ${response.statusText}.`)
        continue
      }
      const contentType = response.headers.get('content-type') ?? ''
      if (contentType && !/html|xhtml/i.test(contentType)) continue
      const finalUrl = publicWebsiteUrl(response.url || requested)
      if (new URL(finalUrl).hostname !== new URL(initial).hostname && pages.length === 0) {
        // A canonical www/non-www redirect is accepted; unrelated redirect targets are not crawled.
        if (registrableHost(new URL(finalUrl).hostname) !== registrableHost(new URL(initial).hostname)) throw new Error('La web oficial redirige a un dominio distinto.')
      }
      const finalCanonical = canonicalWebsiteUrl(finalUrl)
      if (pages.some((page) => canonicalWebsiteUrl(page.url) === finalCanonical)) continue
      visited.add(finalCanonical)
      const html = (await response.text()).slice(0, 1_500_000)
      const source = websiteSource(finalUrl, retrievedAt)
      pages.push({url: finalUrl, html, source})
      for (const link of extractLinks(html, finalUrl)) {
        if (pages.length + queue.length >= WEBSITE_LINK_LIMIT || !RELEVANT_LINK.test(link)) continue
        if (registrableHost(new URL(link).hostname) === registrableHost(new URL(initial).hostname)) queue.push(link)
      }
    }
    if (pages.length === 0) throw new Error('La web oficial no devolvió ninguna página HTML pública.')
    return extractWebsiteFacts(pages)
  }
}

interface WebsitePage {
  url: string
  html: string
  source: SourceProvenance
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: {lat?: number; lon?: number}
  tags?: Record<string, string>
}

interface OverpassResponse {
  elements?: OverpassElement[]
}

interface GeoJsonFeatureCollection {
  features?: Array<{geometry?: {type?: string; coordinates?: unknown}}>
}

const DEFAULT_OVERPASS_URLS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
] as const
const BENIDORM_RELATION_ID = 341148
const BENIDORM_BBOX = '38.5011769,-0.1869109,38.6101333,-0.0667580'
const NOMINATIM_BOUNDARY_URL = `https://nominatim.openstreetmap.org/lookup?osm_ids=R${BENIDORM_RELATION_ID}&format=geojson&polygon_geojson=1`

export class OpenStreetMapAdapter implements SourceAdapter {
  readonly provider = 'openstreetmap'
  private readonly endpoints: readonly string[]

  constructor(
    endpoint?: string | readonly string[],
    private readonly fetcher: typeof fetch = fetch,
  ) {
    loadEnvironment()
    if (endpoint) this.endpoints = typeof endpoint === 'string' ? [endpoint] : endpoint
    else {
      const configured = process.env.OVERPASS_API_URL
      this.endpoints = configured
        ? [configured, ...DEFAULT_OVERPASS_URLS.filter((candidate) => candidate !== configured)]
        : DEFAULT_OVERPASS_URLS
    }
  }

  async discover(request: DiscoveryRequest): Promise<SourceRecord[]> {
    const boundary = await this.loadBenidormBoundary()
    if (!request.type && request.limit) {
      const records: SourceRecord[] = []
      for (const type of ENTITY_TYPES) {
        const remaining = request.limit - records.length
        if (remaining <= 0) break
        const elements = await this.requestType(type)
        records.push(...elements.flatMap((element) => this.toSourceRecord(element, request.retrievedAt)))
      }
      return records.filter((record) => insideBoundary(record, boundary))
    }
    const elements = await this.requestType(request.type)
    return elements
      .flatMap((element) => this.toSourceRecord(element, request.retrievedAt))
      .filter((record) => insideBoundary(record, boundary))
  }

  private async requestType(type?: EntityType): Promise<OverpassElement[]> {
    const elements: OverpassElement[] = []
    for (const primitive of ['node', 'way', 'relation'] as const) {
      elements.push(...await this.request(buildOverpassQuery(type, undefined, primitive)))
    }
    return elements
  }

  private async loadBenidormBoundary(): Promise<unknown> {
    const response = await this.fetcher(NOMINATIM_BOUNDARY_URL, {
      headers: {'user-agent': 'enBenidorm-content-pipeline/1.0'},
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Nominatim no pudo cargar el límite municipal de Benidorm: ${response.status} ${response.statusText}.`)
    const payload = await response.json() as GeoJsonFeatureCollection
    const geometry = payload.features?.[0]?.geometry
    if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') || !Array.isArray(geometry.coordinates)) {
      throw new Error('Nominatim no devolvió el polígono municipal esperado para Benidorm.')
    }
    return geometry
  }

  private async request(query: string): Promise<OverpassElement[]> {
    const failures: string[] = []
    for (const endpoint of this.endpoints) {
      try {
        const response = await this.fetcher(endpoint, {
          method: 'POST',
          headers: {'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'user-agent': 'enBenidorm-content-pipeline/1.0'},
          body: new URLSearchParams({data: query}),
          signal: AbortSignal.timeout(20_000),
        })
        if (!response.ok) {
          failures.push(`${endpoint}: ${response.status} ${response.statusText}`)
          continue
        }
        const payload = await response.json() as OverpassResponse
        if (!Array.isArray(payload.elements)) throw new Error('La respuesta no contiene elements.')
        return payload.elements
      } catch (error) {
        failures.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new Error(`Ninguna instancia de OpenStreetMap/Overpass respondió correctamente (${failures.join('; ')}).`)
  }

  private toSourceRecord(element: OverpassElement, retrievedAt: string): SourceRecord[] {
    const tags = element.tags ?? {}
    const type = osmEntityType(tags)
    const name = tags.name?.trim()
    if (!type || !name) return []
    const identifier = `${element.type}/${element.id}`
    const lat = element.lat ?? element.center?.lat ?? null
    const lon = element.lon ?? element.center?.lon ?? null
    const source: SourceProvenance = {
      key: sourceKey(this.provider, identifier),
      provider: this.provider,
      identifier,
      url: `https://www.openstreetmap.org/${identifier}`,
      retrievedAt,
      attribution: '© OpenStreetMap contributors',
      licenseUrl: 'https://www.openstreetmap.org/copyright',
    }
    return [{
      type,
      priority: sourcePriority(tags),
      sources: [source],
      raw: {name, tags, latitude: lat, longitude: lon},
    }]
  }
}

export class ManualJsonAdapter implements SourceAdapter {
  readonly provider = 'manual-json'

  constructor(private readonly path: string) {}

  async discover(request: DiscoveryRequest): Promise<SourceRecord[]> {
    const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
    if (!Array.isArray(parsed)) throw new Error('ManualJsonAdapter requiere un array JSON.')
    return parsed.map((item, index) => parseManualRecord(item, index, request.retrievedAt))
      .filter((item) => !request.type || item.type === request.type)
  }
}

export function buildOverpassQuery(
  type?: EntityType,
  limit?: number,
  primitive: 'node' | 'way' | 'relation' = 'node',
): string {
  const selectors = type ? selectorsFor(type) : [
    ...selectorsFor('restaurant'), ...selectorsFor('bar'), ...selectorsFor('cafe'),
    ...selectorsFor('hotel'), ...selectorsFor('attraction'), ...selectorsFor('shop'),
  ]
  return `[out:json][timeout:15];\n(\n${selectors.map((selector) => `  ${primitive}["name"]${selector}(${BENIDORM_BBOX});`).join('\n')}\n);\nout center${limit ? ` ${limit}` : ''};`
}

function selectorsFor(type: EntityType): string[] {
  if (type === 'restaurant') return ['["amenity"="restaurant"]']
  if (type === 'bar') return ['["amenity"~"^(bar|pub)$"]']
  if (type === 'cafe') return ['["amenity"="cafe"]']
  if (type === 'hotel') return ['["tourism"="hotel"]']
  if (type === 'attraction') return ['["tourism"="attraction"]']
  return ['["shop"]']
}

function osmEntityType(tags: Record<string, string>): EntityType | undefined {
  if (tags.amenity === 'restaurant') return 'restaurant'
  if (tags.amenity === 'bar' || tags.amenity === 'pub') return 'bar'
  if (tags.amenity === 'cafe') return 'cafe'
  if (tags.tourism === 'hotel') return 'hotel'
  if (tags.tourism === 'attraction') return 'attraction'
  if (tags.shop) return 'shop'
  return undefined
}

function sourcePriority(tags: Record<string, string>): number {
  const useful = ['addr:street', 'contact:phone', 'phone', 'contact:website', 'website', 'opening_hours']
    .filter((key) => Boolean(tags[key])).length
  return 50 + useful * 5
}

function insideBoundary(record: SourceRecord, geometry: unknown): boolean {
  const {latitude, longitude} = record.raw
  if (latitude === null || longitude === null || !isRecord(geometry) || !Array.isArray(geometry.coordinates)) return false
  if (geometry.type === 'Polygon') return pointInPolygon(longitude, latitude, geometry.coordinates)
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((polygon) => pointInPolygon(longitude, latitude, polygon))
  return false
}

function pointInPolygon(longitude: number, latitude: number, value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  const rings = value.filter(Array.isArray)
  const outer = rings[0]
  if (!outer || !pointInRing(longitude, latitude, outer)) return false
  return !rings.slice(1).some((ring) => pointInRing(longitude, latitude, ring))
}

function pointInRing(longitude: number, latitude: number, value: unknown[]): boolean {
  let inside = false
  for (let current = 0, previous = value.length - 1; current < value.length; previous = current, current += 1) {
    const a = coordinate(value[current])
    const b = coordinate(value[previous])
    if (!a || !b) continue
    const crosses = (a[1] > latitude) !== (b[1] > latitude)
      && longitude < ((b[0] - a[0]) * (latitude - a[1])) / (b[1] - a[1]) + a[0]
    if (crosses) inside = !inside
  }
  return inside
}

function coordinate(value: unknown): [number, number] | undefined {
  return Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number'
    ? [value[0], value[1]]
    : undefined
}

function parseManualRecord(value: unknown, index: number, retrievedAt: string): SourceRecord {
  if (!isRecord(value)) throw new Error(`Registro manual ${index}: debe ser un objeto.`)
  const type = value.type
  if (typeof type !== 'string' || !['restaurant', 'bar', 'cafe', 'hotel', 'attraction', 'shop'].includes(type)) {
    throw new Error(`Registro manual ${index}: type no admitido.`)
  }
  if (typeof value.identifier !== 'string' || typeof value.name !== 'string' || typeof value.sourceUrl !== 'string') {
    throw new Error(`Registro manual ${index}: identifier, name y sourceUrl son obligatorios.`)
  }
  const tags = isRecord(value.tags)
    ? Object.fromEntries(Object.entries(value.tags).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {}
  const source: SourceProvenance = {
    key: sourceKey('manual-json', value.identifier),
    provider: 'manual-json',
    identifier: value.identifier,
    url: value.sourceUrl,
    retrievedAt,
    attribution: typeof value.attribution === 'string' ? value.attribution : 'Fuente manual indicada en sourceUrl',
    licenseUrl: typeof value.licenseUrl === 'string' ? value.licenseUrl : null,
  }
  return {
    type: type as EntityType,
    priority: typeof value.priority === 'number' ? value.priority : 50,
    sources: [source],
    raw: {
      name: value.name,
      tags,
      latitude: typeof value.latitude === 'number' ? value.latitude : null,
      longitude: typeof value.longitude === 'number' ? value.longitude : null,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractWebsiteFacts(pages: WebsitePage[]): OfficialWebsiteResult {
  const facts = emptyWebsiteFacts()
  for (const page of pages) {
    const structured = extractJsonLd(page.html)
    const visible = htmlToText(page.html)
    const metaDescription = extractMetaDescription(page.html)
    const descriptions = compactStrings([
      ...structured.flatMap((item) => jsonLdStrings(item, 'description')),
      metaDescription,
    ]).filter((value) => value.length >= 20 && !GENERIC_DESCRIPTION.test(value))
    const evidenceText = `${visible} ${descriptions.join(' ')}`
    mergeFact(facts.concept, descriptions[0] ?? null, page.source.key)
    mergeListFact(facts.cuisine, [
      ...structured.flatMap((item) => jsonLdStrings(item, 'servesCuisine')),
      ...controlledMatches(evidenceText, CUISINES),
    ], page.source.key)
    mergeListFact(facts.specialties, [
      ...structured.flatMap(menuItemNames),
      ...labelledList(visible, /(?:especialidades?|platos? estrella|specialties?)\s*[:\-]\s*/i),
    ], page.source.key)
    mergeListFact(facts.services, controlledMatches(visible, SERVICES), page.source.key)
    mergeBooleanFact(facts.bookingAvailability, hasBookingEvidence(page.html, visible), page.source.key)
    mergeBooleanFact(facts.takeaway, explicitBoolean(visible, /(?:para llevar|takeaway|take away|recogida en local)/i, /(?:no (?:ofrecemos|hay|disponemos de) (?:comida )?para llevar|no takeaway)/i), page.source.key)
    mergeBooleanFact(facts.delivery, explicitBoolean(visible, /(?:servicio a domicilio|entrega a domicilio|delivery|home delivery)/i, /(?:no (?:ofrecemos|hay|disponemos de) (?:servicio a domicilio|delivery)|no delivery)/i), page.source.key)
    mergeBooleanFact(facts.terrace, explicitBoolean(visible, /(?:terraza|terrace|outdoor seating)/i, /(?:sin terraza|no (?:tenemos|hay|disponemos de) terraza)/i), page.source.key)
    mergeListFact(facts.accessibility, controlledMatches(visible, ACCESSIBILITY), page.source.key)
    mergeListFact(facts.openingInformation, [
      ...structured.flatMap((item) => jsonLdStrings(item, 'openingHours')),
      ...structured.flatMap(openingSpecification),
    ], page.source.key)
    mergeFact(facts.locationContext, controlledMatches(visible, LOCATION_CONTEXT).join(', ') || null, page.source.key)
    mergeListFact(facts.distinctiveFeatures, controlledMatches(visible, DISTINCTIVE_FEATURES), page.source.key)
  }
  return {facts, sources: [...new Map(pages.map((page) => [page.source.key, page.source])).values()]}
}

const GENERIC_DESCRIPTION = /(?:write something about yourself|no need to be fancy|just an overview|lorem ipsum|website is under construction)/i

const CUISINES: Array<[RegExp, string]> = [
  [/\bmediterr[aá]nea\b/i, 'mediterránea'], [/\bindia\b|\bindian\b/i, 'india'], [/\bitaliana\b|\bitalian\b/i, 'italiana'],
  [/\bmexicana\b|\bmexican\b/i, 'mexicana'], [/\bjaponesa\b|\bjapanese\b/i, 'japonesa'], [/\bsushi\b/i, 'sushi'],
  [/\bpoke\b/i, 'poke'], [/\basi[aá]tica\b|\basian\b/i, 'asiática'], [/\bchina\b|\bchinese\b/i, 'china'],
  [/\bespa[nñ]ola\b|\bspanish cuisine\b/i, 'española'], [/\bamericana\b|\bamerican\b/i, 'americana'],
  [/\bbarbacoa\b|\bbarbecue\b|\bbbq\b/i, 'barbacoa'], [/\bmarisco(?:s)?\b|\bseafood\b/i, 'mariscos'],
  [/\barroces?\b|\bpaellas?\b/i, 'arroces'], [/\bvegetariana\b|\bvegetarian\b/i, 'vegetariana'], [/\bvegana\b|\bvegan\b/i, 'vegana'],
]
const SERVICES: Array<[RegExp, string]> = [
  [/\bdesayunos?\b|\bbreakfast\b/i, 'desayuno'], [/\balmuerzos?\b|\blunch\b/i, 'almuerzo'], [/\bcenas?\b|\bdinner\b/i, 'cena'],
  [/\bmen[uú] del d[ií]a\b/i, 'menú del día'], [/\bmen[uú] infantil\b|\bkids menu\b/i, 'menú infantil'],
  [/\bopciones? sin gluten\b|\bgluten[- ]free\b/i, 'opciones sin gluten'], [/\bopciones? vegetarianas?\b/i, 'opciones vegetarianas'],
]
const ACCESSIBILITY: Array<[RegExp, string]> = [
  [/\bacceso (?:para|en) silla de ruedas\b|\bwheelchair accessible\b/i, 'acceso para silla de ruedas'],
  [/\bba[nñ]o adaptado\b|\baccessible toilet\b/i, 'baño adaptado'],
]
const LOCATION_CONTEXT: Array<[RegExp, string]> = [
  [/\bprimera l[ií]nea de playa\b|\bbeachfront\b/i, 'primera línea de playa'], [/\bcasco antiguo\b|\bold town\b/i, 'casco antiguo'],
  [/\bplaya de levante\b/i, 'playa de Levante'], [/\bplaya de poniente\b/i, 'playa de Poniente'], [/\bcentro de benidorm\b/i, 'centro de Benidorm'],
]
const DISTINCTIVE_FEATURES: Array<[RegExp, string]> = [
  [/\bvistas? al mar\b|\bsea views?\b/i, 'vistas al mar'], [/\bm[uú]sica en directo\b|\blive music\b/i, 'música en directo'],
  [/\brooftop\b|\bazotea\b/i, 'rooftop'], [/\bcocina abierta\b|\bopen kitchen\b/i, 'cocina abierta'],
  [/\bhorno de le[nñ]a\b|\bwood[- ]fired oven\b/i, 'horno de leña'], [/\bproductos? locales?\b|\blocal produce\b/i, 'producto local'],
]

function emptyWebsiteFacts(): OfficialWebsiteFacts {
  const fact = <T>(): Fact<T> => ({value: null, sources: []})
  return {
    cuisine: fact(), concept: fact(), specialties: fact(), services: fact(), bookingAvailability: fact(),
    takeaway: fact(), delivery: fact(), terrace: fact(), accessibility: fact(), openingInformation: fact(),
    locationContext: fact(), distinctiveFeatures: fact(),
  }
}

function mergeFact(fact: Fact<string>, value: string | null, source: string): void {
  const clean = value?.replace(/\s+/g, ' ').trim().slice(0, 600) || null
  if (!clean) return
  if (fact.value === null) {
    fact.value = clean
    fact.sources.push(source)
  } else if (normalizeComparable(fact.value) === normalizeComparable(clean) && !fact.sources.includes(source)) fact.sources.push(source)
}

function mergeListFact(fact: Fact<string[]>, values: Array<string | null>, source: string): void {
  const clean = compactStrings(values).map((value) => value.replace(/\s+/g, ' ').trim().slice(0, 160)).filter((value) => value.length >= 2)
  if (!clean.length) return
  fact.value = uniqueNormalized([...(fact.value ?? []), ...clean]).slice(0, 20)
  if (!fact.sources.includes(source)) fact.sources.push(source)
}

function mergeBooleanFact(fact: Fact<boolean>, value: boolean | null, source: string): void {
  if (value === null || (fact.value !== null && fact.value !== value)) return
  fact.value = value
  if (!fact.sources.includes(source)) fact.sources.push(source)
}

function extractJsonLd(html: string): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = []
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeEntities(match[1] ?? '')) as unknown
      collectRecords(parsed, items)
    } catch { /* Invalid publisher JSON-LD is ignored. */ }
  }
  return items
}

function collectRecords(value: unknown, target: Record<string, unknown>[]): void {
  if (Array.isArray(value)) for (const item of value) collectRecords(item, target)
  else if (isRecord(value)) {
    target.push(value)
    if ('@graph' in value) collectRecords(value['@graph'], target)
  }
}

function jsonLdStrings(item: Record<string, unknown>, key: string): string[] {
  const value = item[key]
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string')
  return []
}

function menuItemNames(item: Record<string, unknown>): string[] {
  const type = item['@type']
  if (type !== 'MenuItem' && !(Array.isArray(type) && type.includes('MenuItem'))) return []
  return typeof item.name === 'string' ? [item.name] : []
}

function openingSpecification(item: Record<string, unknown>): string[] {
  const specs = Array.isArray(item.openingHoursSpecification) ? item.openingHoursSpecification : []
  return specs.flatMap((spec) => {
    if (!isRecord(spec)) return []
    const days = Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek : [spec.dayOfWeek]
    const dayText = days.filter((day): day is string => typeof day === 'string').map((day) => day.split('/').at(-1)).join(', ')
    const opens = typeof spec.opens === 'string' ? spec.opens : ''
    const closes = typeof spec.closes === 'string' ? spec.closes : ''
    return dayText && opens && closes ? [`${dayText}: ${opens}-${closes}`] : []
  })
}

function hasBookingEvidence(html: string, text: string): boolean | null {
  if (/(?:no (?:aceptamos|se admiten) reservas|walk[- ]ins? only)/i.test(text)) return false
  return /(?:reservar|reserva (?:tu|una) mesa|book (?:a )?table|online booking)/i.test(text)
    || /href=["'][^"']*(?:reserv|booking)/i.test(html) ? true : null
}

function explicitBoolean(text: string, yes: RegExp, no: RegExp): boolean | null {
  if (no.test(text)) return false
  return yes.test(text) ? true : null
}

function controlledMatches(text: string, patterns: Array<[RegExp, string]>): string[] {
  return patterns.filter(([pattern]) => pattern.test(text)).map(([, label]) => label)
}

function labelledList(text: string, label: RegExp): string[] {
  const match = label.exec(text)
  if (!match) return []
  return text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 240)
    .split(/[|•·;,.]/).map((item) => item.trim()).filter((item) => item.length >= 3 && item.length <= 80).slice(0, 8)
}

function extractMetaDescription(html: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    if (!/(?:name|property)=["'](?:description|og:description)["']/i.test(tag)) continue
    const content = /content=["']([^"']+)["']/i.exec(tag)?.[1]
    if (content) return decodeEntities(content)
  }
  return null
}

function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<(?:script|style|noscript|svg)\b[\s\S]*?<\/(?:script|style|noscript|svg)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 300_000)
}

function extractLinks(html: string, base: string): string[] {
  const links: string[] = []
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(decodeEntities(match[1] ?? ''), base)
      if (url.protocol === 'http:' || url.protocol === 'https:') links.push(canonicalWebsiteUrl(url.toString()))
    } catch { /* Ignore malformed publisher URLs. */ }
  }
  return [...new Set(links)]
}

function websiteSource(url: string, retrievedAt: string): SourceProvenance {
  const canonical = canonicalWebsiteUrl(url)
  return {
    key: sourceKey('official-website', canonical), provider: 'official-website', identifier: canonical, url: canonical,
    retrievedAt, attribution: `Sitio web oficial (${new URL(canonical).hostname})`, licenseUrl: null,
  }
}

function publicWebsiteUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('La web oficial debe usar HTTP o HTTPS.')
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.local') || /^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(hostname)) {
    throw new Error('La web oficial debe ser una URL pública.')
  }
  return url.toString()
}

function canonicalWebsiteUrl(value: string): string {
  const url = new URL(value)
  url.hash = ''
  return url.toString()
}

function registrableHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
}

function normalizeComparable(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function uniqueNormalized(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = normalizeComparable(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function decodeEntities(value: string): string {
  const entities: Record<string, string> = {amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' '}
  return value.replace(/&(#x?[\da-f]+|\w+);/gi, (_, entity: string) => {
    if (entity.startsWith('#')) {
      const hex = entity[1]?.toLowerCase() === 'x'
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _
    }
    return entities[entity.toLowerCase()] ?? _
  })
}

let environmentLoaded = false
function loadEnvironment(): void {
  if (environmentLoaded) return
  environmentLoaded = true
  try {
    loadEnvFile('.env')
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (code !== 'ENOENT') throw error
  }
}
