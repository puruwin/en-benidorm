import {readFile} from 'node:fs/promises'
import {loadEnvFile} from 'node:process'
import {ENTITY_TYPES, type EntityType, type SourceProvenance} from './types'
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
