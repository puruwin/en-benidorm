import {DISCOVERY_CATEGORIES, ENTITY_TYPES, type DiscoveryCategory, type EntityType, type GeographicScope} from './types'

export interface PipelineOptions {
  dryRun: boolean
  force: boolean
  type?: EntityType
  limit?: number
  id?: string
  categories?: DiscoveryCategory[]
  geography?: GeographicScope
  researchLimit?: number
  resume?: boolean
  concurrency?: number
  tileGrid?: number
  osmExtract?: string
  extractSourceUrl?: string
  extractDownloadedAt?: string
  timeoutMs?: number
  maxAttempts?: number
  backoffMs?: number
}

const TYPE_ALIASES: Record<string, EntityType> = {
  restaurant: 'restaurant', restaurants: 'restaurant', restaurante: 'restaurant', restaurantes: 'restaurant',
  bar: 'bar', bars: 'bar', cafe: 'cafe', cafes: 'cafe', cafeteria: 'cafe', cafeterias: 'cafe',
  hotel: 'hotel', hotels: 'hotel', attraction: 'attraction', attractions: 'attraction', atraccion: 'attraction', atracciones: 'attraction',
  shop: 'shop', shops: 'shop', tienda: 'shop', tiendas: 'shop',
  service: 'service', services: 'service', servicio: 'service', servicios: 'service',
}

const CATEGORY_ALIASES: Record<string, DiscoveryCategory> = {
  hospitality: 'hospitality', hosteleria: 'hospitality', 'hostelería': 'hospitality',
  'professional-services': 'professional-services', profesionales: 'professional-services', servicios: 'professional-services',
  retail: 'retail', comercio: 'retail', tiendas: 'retail',
  attractions: 'attractions', atracciones: 'attractions',
}

export function parsePipelineOptions(args = process.argv.slice(2)): PipelineOptions {
  const result: PipelineOptions = {dryRun: false, force: false}
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === '--dry-run') result.dryRun = true
    else if (argument === '--force') result.force = true
    else if (argument === '--resume') result.resume = true
    else if (argument.startsWith('--type')) {
      const value = optionValue(args, index, '--type')
      if (!argument.includes('=')) index += 1
      const type = TYPE_ALIASES[value.toLocaleLowerCase('es')]
      if (!type) throw new Error(`--type debe ser uno de: ${ENTITY_TYPES.join(', ')}.`)
      result.type = type
    } else if (argument.startsWith('--category')) {
      const values = optionValue(args, index, '--category').split(',').map((value) => value.trim().toLocaleLowerCase('es'))
      if (!argument.includes('=')) index += 1
      const categories = values.map((value) => CATEGORY_ALIASES[value])
      if (categories.some((value) => !value)) throw new Error(`--category debe usar: ${DISCOVERY_CATEGORIES.join(', ')}.`)
      result.categories = [...new Set([...(result.categories ?? []), ...categories])] as DiscoveryCategory[]
    } else if (argument.startsWith('--bbox')) {
      const parts = optionValue(args, index, '--bbox').split(',').map(Number)
      if (!argument.includes('=')) index += 1
      if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) throw new Error('--bbox requiere south,west,north,east.')
      const [south, west, north, east] = parts as [number, number, number, number]
      if (south >= north || west >= east) throw new Error('--bbox no define un rectángulo válido.')
      result.geography = {name: result.geography?.name ?? 'custom', bbox: [south, west, north, east]}
    } else if (argument.startsWith('--area')) {
      const name = optionValue(args, index, '--area').trim()
      if (!argument.includes('=')) index += 1
      result.geography = {
        name, bbox: result.geography?.bbox ?? [38.5011769, -0.1869109, 38.6101333, -0.0667580],
        ...(name.toLocaleLowerCase('es') === 'benidorm' ? {boundaryRelationId: 341148} : {}),
      }
    } else if (argument.startsWith('--research-limit')) {
      const value = Number(optionValue(args, index, '--research-limit'))
      if (!argument.includes('=')) index += 1
      if (!Number.isInteger(value) || value <= 0) throw new Error('--research-limit debe ser un entero positivo.')
      result.researchLimit = value
    } else if (argument.startsWith('--concurrency')) {
      const value = Number(optionValue(args, index, '--concurrency'))
      if (!argument.includes('=')) index += 1
      if (!Number.isInteger(value) || value < 1 || value > 4) throw new Error('--concurrency debe estar entre 1 y 4.')
      result.concurrency = value
    } else if (argument.startsWith('--tile-grid')) {
      const value = Number(optionValue(args, index, '--tile-grid'))
      if (!argument.includes('=')) index += 1
      if (!Number.isInteger(value) || value < 1 || value > 4) throw new Error('--tile-grid debe estar entre 1 y 4.')
      result.tileGrid = value
    } else if (argument.startsWith('--osm-extract')) {
      result.osmExtract = optionValue(args, index, '--osm-extract')
      if (!argument.includes('=')) index += 1
    } else if (argument.startsWith('--extract-source-url')) {
      result.extractSourceUrl = optionValue(args, index, '--extract-source-url')
      if (!argument.includes('=')) index += 1
    } else if (argument.startsWith('--extract-downloaded-at')) {
      const value = optionValue(args, index, '--extract-downloaded-at')
      if (!argument.includes('=')) index += 1
      if (Number.isNaN(Date.parse(value))) throw new Error('--extract-downloaded-at debe ser una fecha válida.')
      result.extractDownloadedAt = value
    } else if (argument.startsWith('--timeout-ms')) {
      const value = Number(optionValue(args, index, '--timeout-ms'))
      if (!argument.includes('=')) index += 1
      if (!Number.isInteger(value) || value < 1_000 || value > 60_000) throw new Error('--timeout-ms debe estar entre 1000 y 60000.')
      result.timeoutMs = value
    } else if (argument.startsWith('--max-attempts')) {
      const value = Number(optionValue(args, index, '--max-attempts'))
      if (!argument.includes('=')) index += 1
      if (!Number.isInteger(value) || value < 1 || value > 10) throw new Error('--max-attempts debe estar entre 1 y 10.')
      result.maxAttempts = value
    } else if (argument.startsWith('--backoff-ms')) {
      const value = Number(optionValue(args, index, '--backoff-ms'))
      if (!argument.includes('=')) index += 1
      if (!Number.isInteger(value) || value < 0 || value > 60_000) throw new Error('--backoff-ms debe estar entre 0 y 60000.')
      result.backoffMs = value
    } else if (argument.startsWith('--limit')) {
      const value = Number(optionValue(args, index, '--limit'))
      if (!argument.includes('=')) index += 1
      if (!Number.isInteger(value) || value <= 0) throw new Error('--limit debe ser un entero positivo.')
      result.limit = value
    } else if (argument.startsWith('--id')) {
      result.id = optionValue(args, index, '--id')
      if (!argument.includes('=')) index += 1
    } else {
      throw new Error(`Argumento no reconocido: ${argument}`)
    }
  }
  return result
}

function optionValue(args: readonly string[], index: number, option: string): string {
  const argument = args[index]!
  const equals = argument.indexOf('=')
  const value = equals >= 0 ? argument.slice(equals + 1) : args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${option} requiere un valor.`)
  return value
}

export function applyFilters<T extends {id: string; type: EntityType}>(items: readonly T[], options: PipelineOptions): T[] {
  let filtered = items.filter((item) => (!options.type || item.type === options.type) && (!options.id || item.id === options.id))
  if (options.limit !== undefined) filtered = filtered.slice(0, options.limit)
  return filtered
}
