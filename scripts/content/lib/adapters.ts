import {readFile} from 'node:fs/promises'
import {basename, resolve} from 'node:path'
import {loadEnvFile} from 'node:process'
import {ENTITY_TYPES, type BusinessFacts, type CommercialItem, type DiscoveryAttempt, type DiscoveryCategory, type DiscoveryRunStatus, type DiscoveryUnitResult, type EntityType, type Fact, type GeographicScope, type SourceProvenance} from './types'
import {readJsonIfExists, writeJsonAtomic} from './files'
import {shortHash, sourceKey} from './normalize'
import {crawlOfficialWebsite, htmlToEvidenceText, type CrawledWebsitePage, type WebsiteCrawlerOptions} from './website-crawler'
import {extractCommercialInformation, type CommercialExtractionSummary} from './commercial-extractor'

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
  categories?: DiscoveryCategory[]
  geography?: GeographicScope
  /** Legacy adapter hint. Catalog persistence must never be truncated by it. */
  limit?: number
  retrievedAt: string
}

export interface SourceAdapter {
  readonly provider: string
  discover(request: DiscoveryRequest): Promise<SourceRecord[]>
  discoverDetailed?(request: DiscoveryRequest): Promise<DiscoveryAdapterOutput>
}

export interface DiscoveryAdapterOutput {
  records: SourceRecord[]
  status: DiscoveryRunStatus
  units: DiscoveryUnitResult[]
  checkpointPath: string | null
  resumedUnits: number
}

interface DiscoveryCheckpoint {
  schemaVersion: 1
  requestKey: string
  updatedAt: string
  completed: Record<string, SourceRecord[]>
}

export class FileDiscoveryCheckpointStore {
  private pending: Promise<void> = Promise.resolve()

  constructor(private readonly root = process.cwd()) {}

  path(requestKey: string): string {
    return resolve(this.root, `content/discovery/checkpoints/${shortHash(requestKey, 16)}.json`)
  }

  async load(requestKey: string): Promise<DiscoveryCheckpoint> {
    return readJsonIfExists(this.path(requestKey), {schemaVersion: 1, requestKey, updatedAt: new Date(0).toISOString(), completed: {}})
  }

  async save(checkpoint: DiscoveryCheckpoint): Promise<void> {
    const snapshot = structuredClone(checkpoint)
    this.pending = this.pending.then(() => writeJsonAtomic(this.path(checkpoint.requestKey), snapshot))
    await this.pending
  }
}

export type OfficialWebsiteFacts = Pick<BusinessFacts,
  | 'cuisine' | 'concept' | 'specialties' | 'services' | 'bookingAvailability'
  | 'takeaway' | 'delivery' | 'terrace' | 'accessibility' | 'openingInformation'
  | 'locationContext' | 'distinctiveFeatures' | 'commercialItems'>

export interface OfficialWebsiteResult {
  facts: OfficialWebsiteFacts
  sources: SourceProvenance[]
  extraction?: CommercialExtractionSummary
}

export type OfficialWebsiteOptions = Pick<WebsiteCrawlerOptions,
  'linkHints' | 'maxPages' | 'maxDepth' | 'timeoutMs' | 'maxRedirects' | 'cache' | 'documentCache'
  | 'dnsLookup' | 'maxDocuments' | 'maxPdfBytes' | 'maxPdfPages'> & {expectedName?: string | null}

/** Extracts attributable facts from public pages owned by the business. */
export class OfficialWebsiteAdapter {
  readonly provider = 'official-website'

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async enrich(
    website: string,
    retrievedAt: string,
    options: OfficialWebsiteOptions = {},
  ): Promise<OfficialWebsiteResult> {
    const crawl = await crawlOfficialWebsite(website, retrievedAt, {
      fetcher: this.fetcher,
      maxPages: options.maxPages ?? 5,
      maxDepth: options.maxDepth ?? 1,
      timeoutMs: options.timeoutMs ?? 20_000,
      ...(options.linkHints ? {linkHints: options.linkHints} : {}),
      ...(options.maxRedirects !== undefined ? {maxRedirects: options.maxRedirects} : {}),
      ...(options.cache ? {cache: options.cache} : {}),
      ...(options.documentCache ? {documentCache: options.documentCache} : {}),
      ...(options.dnsLookup ? {dnsLookup: options.dnsLookup} : {}),
      ...(options.maxDocuments !== undefined ? {maxDocuments: options.maxDocuments} : {}),
      ...(options.maxPdfBytes !== undefined ? {maxPdfBytes: options.maxPdfBytes} : {}),
      ...(options.maxPdfPages !== undefined ? {maxPdfPages: options.maxPdfPages} : {}),
    })
    return extractOfficialWebsiteFacts(crawl.pages, crawl.documents, options.expectedName !== undefined ? {expectedName: options.expectedName} : {})
  }
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
export const BENIDORM_SCOPE: GeographicScope = {
  name: 'Benidorm', bbox: [38.5011769, -0.1869109, 38.6101333, -0.0667580], boundaryRelationId: 341148,
}

export class OpenStreetMapAdapter implements SourceAdapter {
  readonly provider = 'openstreetmap'
  private readonly endpoints: readonly string[]

  constructor(
    endpoint?: string | readonly string[],
    private readonly fetcher: typeof fetch = fetch,
    private readonly options: {
      concurrency?: number
      tileGrid?: number
      timeoutMs?: number
      maxAttempts?: number
      baseBackoffMs?: number
      sleep?: (milliseconds: number) => Promise<void>
      checkpointStore?: FileDiscoveryCheckpointStore
      resume?: boolean
    } = {},
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
    return (await this.discoverDetailed(request)).records
  }

  async discoverDetailed(request: DiscoveryRequest): Promise<DiscoveryAdapterOutput> {
    const geography = request.geography ?? BENIDORM_SCOPE
    const types = request.type ? [request.type] : typesForCategories(request.categories)
    const boxes = splitBbox(geography.bbox, this.options.tileGrid ?? 1)
    const units = types.flatMap((type) => boxes.flatMap((bbox) => (['node', 'way', 'relation'] as const).map((primitive) => ({
      key: `${type}:${primitive}:${bbox.join(',')}`, type, primitive, bbox,
    }))))
    const requestKey = JSON.stringify({queryVersion: 'p3a1b-v1', provider: this.provider, geography, types, boxes})
    const checkpointStore = this.options.checkpointStore
    const checkpoint = checkpointStore && this.options.resume
      ? await checkpointStore.load(requestKey)
      : {schemaVersion: 1 as const, requestKey, updatedAt: request.retrievedAt, completed: {}}
    const resumedUnits = units.filter((unit) => checkpoint.completed[unit.key]).length
    const results = await mapConcurrent(units, this.options.concurrency ?? 2, async (unit) => {
      const cached = checkpoint.completed[unit.key]
      if (cached) return {
        records: cached,
        unit: {...unitResult(unit, 'checkpoint', cached.length, []), query: buildOverpassQuery(unit.type, undefined, unit.primitive, unit.bbox)},
      }
      const result = await this.requestUnit(unit, request.retrievedAt)
      if (result.unit.status === 'success' && checkpointStore) {
        checkpoint.completed[unit.key] = result.records
        checkpoint.updatedAt = request.retrievedAt
        await checkpointStore.save(checkpoint)
      }
      return result
    })
    const successfulRecords = results.flatMap((result) => result.records)
    const failed = results.filter((result) => result.unit.status === 'failed').length
    let records = successfulRecords
    if (geography.boundaryRelationId && records.length) {
      try {
        const boundary = await this.loadBoundary(geography.boundaryRelationId)
        records = records.filter((record) => insideBoundary(record, boundary))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          records: [], status: 'failed', checkpointPath: checkpointStore?.path(requestKey) ?? null, resumedUnits,
          units: results.map((result) => ({...result.unit, status: 'failed', attempts: [...result.unit.attempts, boundaryFailureAttempt(message)]})),
        }
      }
    }
    const status: DiscoveryRunStatus = failed === units.length ? 'failed'
      : failed > 0 ? 'partial'
        : records.length === 0 ? 'anomalous-empty'
          : 'success'
    return {
      records, status, units: results.map((result) => result.unit),
      checkpointPath: checkpointStore?.path(requestKey) ?? null, resumedUnits,
    }
  }

  private async loadBoundary(relationId: number): Promise<unknown> {
    const url = `https://nominatim.openstreetmap.org/lookup?osm_ids=R${relationId}&format=geojson&polygon_geojson=1`
    const response = await this.fetcher(url, {
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

  private async requestUnit(
    unit: {key: string; type: EntityType; primitive: 'node' | 'way' | 'relation'; bbox: GeographicScope['bbox']},
    retrievedAt: string,
  ): Promise<{records: SourceRecord[]; unit: DiscoveryUnitResult}> {
    const attempts: DiscoveryAttempt[] = []
    const maxAttempts = this.options.maxAttempts ?? Math.max(3, this.endpoints.length + 1)
    const sleep = this.options.sleep ?? ((milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds)))
    const query = buildOverpassQuery(unit.type, undefined, unit.primitive, unit.bbox)
    for (let index = 0; index < maxAttempts; index += 1) {
      const endpoint = this.endpoints[index % this.endpoints.length]!
      const startedAt = new Date().toISOString()
      try {
        const response = await this.fetcher(endpoint, {
          method: 'POST',
          headers: {'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'user-agent': 'enBenidorm-content-pipeline/1.0'},
          body: new URLSearchParams({data: query}),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
        })
        if (!response.ok) {
          const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
          attempts.push({endpoint, startedAt, finishedAt: new Date().toISOString(), outcome: 'http-error', statusCode: response.status, ...(retryAfterMs !== undefined ? {retryAfterMs} : {}), message: response.statusText})
          if (index + 1 < maxAttempts) await sleep(retryAfterMs ?? backoff(this.options.baseBackoffMs ?? 250, index))
          continue
        }
        const payload = await response.json() as OverpassResponse
        if (!Array.isArray(payload.elements)) {
          attempts.push({endpoint, startedAt, finishedAt: new Date().toISOString(), outcome: 'invalid-response', message: 'La respuesta no contiene elements.'})
          if (index + 1 < maxAttempts) await sleep(backoff(this.options.baseBackoffMs ?? 250, index))
          continue
        }
        attempts.push({endpoint, startedAt, finishedAt: new Date().toISOString(), outcome: 'success', statusCode: response.status})
        const records = payload.elements.flatMap((element) => this.toSourceRecord(element, retrievedAt, endpoint))
        return {records, unit: {...unitResult(unit, 'success', records.length, attempts), query}}
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const outcome = /timeout|aborted/i.test(message) ? 'timeout' as const : 'network-error' as const
        attempts.push({endpoint, startedAt, finishedAt: new Date().toISOString(), outcome, message})
        if (index + 1 < maxAttempts) await sleep(backoff(this.options.baseBackoffMs ?? 250, index))
      }
    }
    return {records: [], unit: {...unitResult(unit, 'failed', 0, attempts), query}}
  }

  private toSourceRecord(element: OverpassElement, retrievedAt: string, endpoint: string): SourceRecord[] {
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
      sourceClass: 'open-data',
      claimScope: 'establishment',
      dataset: {kind: 'overpass-api', name: 'OpenStreetMap via Overpass API', sourceUrl: endpoint},
    }
    return [{
      type,
      priority: sourcePriority(tags),
      sources: [source],
      raw: {name, tags, latitude: lat, longitude: lon},
    }]
  }
}

export class LocalOsmExtractAdapter implements SourceAdapter {
  readonly provider = 'openstreetmap'

  constructor(
    private readonly path: string,
    private readonly metadata: {sourceUrl?: string; downloadedAt?: string} = {},
  ) {}

  async discover(request: DiscoveryRequest): Promise<SourceRecord[]> {
    return (await this.discoverDetailed(request)).records
  }

  async discoverDetailed(request: DiscoveryRequest): Promise<DiscoveryAdapterOutput> {
    const parsed = JSON.parse(await readFile(this.path, 'utf8')) as OverpassResponse
    if (!Array.isArray(parsed.elements)) throw new Error('El extracto OSM local debe ser JSON Overpass con elements[].')
    const geography = request.geography ?? BENIDORM_SCOPE
    const wanted = new Set(request.type ? [request.type] : typesForCategories(request.categories))
    const records = parsed.elements.flatMap((element) => localExtractRecord(element, request.retrievedAt, this.path, this.metadata))
      .filter((record) => wanted.has(record.type) && insideBbox(record, geography.bbox))
    const unit: DiscoveryUnitResult = {
      key: `extract:${resolve(this.path)}`, type: request.type ?? 'mixed', primitive: 'extract', bbox: geography.bbox,
      status: 'success', recordCount: records.length, attempts: [],
    }
    return {records, status: records.length ? 'success' : 'anomalous-empty', units: [unit], checkpointPath: null, resumedUnits: 0}
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
  bbox: GeographicScope['bbox'] = BENIDORM_SCOPE.bbox,
): string {
  const selectors = type ? selectorsFor(type) : [
    ...selectorsFor('restaurant'), ...selectorsFor('bar'), ...selectorsFor('cafe'),
    ...selectorsFor('hotel'), ...selectorsFor('attraction'), ...selectorsFor('shop'), ...selectorsFor('service'),
  ]
  const box = bbox.join(',')
  return `[out:json][timeout:15];\n(\n${selectors.map((selector) => `  ${primitive}["name"]${selector}(${box});`).join('\n')}\n);\nout center${limit ? ` ${limit}` : ''};`
}

function selectorsFor(type: EntityType): string[] {
  if (type === 'restaurant') return ['["amenity"="restaurant"]']
  if (type === 'bar') return ['["amenity"~"^(bar|pub)$"]']
  if (type === 'cafe') return ['["amenity"="cafe"]']
  if (type === 'hotel') return ['["tourism"="hotel"]']
  if (type === 'attraction') return ['["tourism"="attraction"]']
  if (type === 'shop') return ['["shop"]']
  return ['["office"]']
}

function osmEntityType(tags: Record<string, string>): EntityType | undefined {
  if (tags.amenity === 'restaurant') return 'restaurant'
  if (tags.amenity === 'bar' || tags.amenity === 'pub') return 'bar'
  if (tags.amenity === 'cafe') return 'cafe'
  if (tags.tourism === 'hotel') return 'hotel'
  if (tags.tourism === 'attraction') return 'attraction'
  if (tags.shop) return 'shop'
  if (tags.office) return 'service'
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
  if (typeof type !== 'string' || !ENTITY_TYPES.includes(type as EntityType)) {
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
    sourceClass: 'third-party',
    claimScope: 'unknown',
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

function typesForCategories(categories?: readonly DiscoveryCategory[]): EntityType[] {
  // Preserve the pre-P3A.1 default; professional services are opt-in.
  if (!categories?.length) return ENTITY_TYPES.filter((type) => type !== 'service')
  const types = new Set<EntityType>()
  for (const category of categories) {
    if (category === 'hospitality') for (const type of ['restaurant', 'bar', 'cafe', 'hotel'] as const) types.add(type)
    else if (category === 'professional-services') types.add('service')
    else if (category === 'retail') types.add('shop')
    else if (category === 'attractions') types.add('attraction')
  }
  return [...types]
}

function unitResult(
  unit: {key: string; type: EntityType; primitive: 'node' | 'way' | 'relation'; bbox: GeographicScope['bbox']},
  status: DiscoveryUnitResult['status'],
  recordCount: number,
  attempts: DiscoveryAttempt[],
): DiscoveryUnitResult {
  return {...unit, status, recordCount, attempts}
}

function splitBbox(bbox: GeographicScope['bbox'], grid: number): GeographicScope['bbox'][] {
  if (grid <= 1) return [bbox]
  const [south, west, north, east] = bbox
  const latitudeStep = (north - south) / grid
  const longitudeStep = (east - west) / grid
  const boxes: GeographicScope['bbox'][] = []
  for (let row = 0; row < grid; row += 1) for (let column = 0; column < grid; column += 1) {
    boxes.push([
      south + latitudeStep * row,
      west + longitudeStep * column,
      row === grid - 1 ? north : south + latitudeStep * (row + 1),
      column === grid - 1 ? east : west + longitudeStep * (column + 1),
    ])
  }
  return boxes
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, operation: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await operation(items[index]!)
    }
  }))
  return results
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1_000
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - Date.now())
}

function backoff(base: number, attemptIndex: number): number {
  return Math.min(30_000, base * 2 ** attemptIndex)
}

function boundaryFailureAttempt(message: string): DiscoveryAttempt {
  const at = new Date().toISOString()
  return {endpoint: 'nominatim-boundary', startedAt: at, finishedAt: at, outcome: 'network-error', message}
}

function localExtractRecord(
  element: OverpassElement,
  retrievedAt: string,
  path: string,
  metadata: {sourceUrl?: string; downloadedAt?: string},
): SourceRecord[] {
  const tags = element.tags ?? {}
  const type = osmEntityType(tags)
  const name = tags.name?.trim()
  if (!type || !name) return []
  const identifier = `${element.type}/${element.id}`
  const latitude = element.lat ?? element.center?.lat ?? null
  const longitude = element.lon ?? element.center?.lon ?? null
  return [{
    type, priority: sourcePriority(tags),
    sources: [{
      key: sourceKey('openstreetmap', identifier), provider: 'openstreetmap', identifier,
      url: `https://www.openstreetmap.org/${identifier}`, retrievedAt,
      attribution: '© OpenStreetMap contributors', licenseUrl: 'https://www.openstreetmap.org/copyright',
      sourceClass: 'open-data', claimScope: 'establishment',
      dataset: {
        kind: 'local-osm-extract', name: basename(path), sourceUrl: metadata.sourceUrl ?? null,
        ...(metadata.downloadedAt ? {downloadedAt: metadata.downloadedAt} : {}),
      },
    }],
    raw: {name, tags, latitude, longitude},
  }]
}

function insideBbox(record: SourceRecord, bbox: GeographicScope['bbox']): boolean {
  const {latitude, longitude} = record.raw
  if (latitude === null || longitude === null) return false
  const [south, west, north, east] = bbox
  return latitude >= south && latitude <= north && longitude >= west && longitude <= east
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function extractOfficialWebsiteFacts(
  pages: readonly CrawledWebsitePage[],
  documents: readonly import('./website-crawler').CrawledWebsiteDocument[] = [],
  context: {expectedName?: string | null} = {},
): OfficialWebsiteResult {
  const facts = emptyWebsiteFacts()
  for (const page of pages) {
    const structured = extractJsonLd(page.html)
    const visible = htmlToEvidenceText(page.html)
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
  const commercial = extractCommercialInformation(pages, documents, context)
  mergeCommercialFact(facts.commercialItems!, commercial.items)
  for (const item of commercial.openingHours) mergeListFact(facts.openingInformation, [item.value], item.sourceKey)
  const sources = [
    ...pages.map((page) => page.source),
    ...documents.flatMap((document) => document.pages.map((page) => page.source)),
  ]
  return {facts, sources: [...new Map(sources.map((source) => [source.key, source])).values()], extraction: commercial.summary}
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
    commercialItems: fact(),
  }
}

function mergeCommercialFact(fact: Fact<CommercialItem[]>, values: CommercialItem[]): void {
  if (!values.length) return
  fact.value = values
  fact.sources = [...new Set(values.map((item) => item.sourceKey))]
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
