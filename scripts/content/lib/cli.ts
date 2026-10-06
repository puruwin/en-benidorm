import {ENTITY_TYPES, type EntityType} from './types'

export interface PipelineOptions {
  dryRun: boolean
  force: boolean
  type?: EntityType
  limit?: number
  id?: string
}

const TYPE_ALIASES: Record<string, EntityType> = {
  restaurant: 'restaurant', restaurants: 'restaurant', restaurante: 'restaurant', restaurantes: 'restaurant',
  bar: 'bar', bars: 'bar', cafe: 'cafe', cafes: 'cafe', cafeteria: 'cafe', cafeterias: 'cafe',
  hotel: 'hotel', hotels: 'hotel', attraction: 'attraction', attractions: 'attraction', atraccion: 'attraction', atracciones: 'attraction',
  shop: 'shop', shops: 'shop', tienda: 'shop', tiendas: 'shop',
}

export function parsePipelineOptions(args = process.argv.slice(2)): PipelineOptions {
  const result: PipelineOptions = {dryRun: false, force: false}
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === '--dry-run') result.dryRun = true
    else if (argument === '--force') result.force = true
    else if (argument.startsWith('--type')) {
      const value = optionValue(args, index, '--type')
      if (!argument.includes('=')) index += 1
      const type = TYPE_ALIASES[value.toLocaleLowerCase('es')]
      if (!type) throw new Error(`--type debe ser uno de: ${ENTITY_TYPES.join(', ')}.`)
      result.type = type
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
