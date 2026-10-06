import type {BusinessKind, DiscoveredEntity, EnrichedEntity, Fact, FactualAddress, SourceProvenance} from './types'

export function enrichEntity(entity: DiscoveredEntity): EnrichedEntity {
  const tags = entity.raw.tags
  // `raw` procede del registro primario. Las fuentes adicionales pueden haber
  // servido para deduplicar la entidad, pero no se atribuyen a cada campo sin
  // una comparación campo a campo.
  const sourceKeys = entity.sources.slice(0, 1).map((source) => source.key)
  const sourced = <T>(value: T | null): Fact<T> => ({value, sources: value === null ? [] : sourceKeys})
  const address = factualAddress(tags)
  const location = entity.raw.latitude === null || entity.raw.longitude === null
    ? null
    : {lat: entity.raw.latitude, lng: entity.raw.longitude}
  return {
    schemaVersion: 1,
    id: entity.id,
    type: entity.type,
    targetDocumentType: entity.targetDocumentType,
    slug: entity.slug,
    facts: {
      name: sourced(entity.raw.name || null),
      businessKind: sourced(businessKind(entity)),
      address: sourced(address),
      location: sourced(location),
      phone: sourced(first(tags['contact:phone'], tags.phone)),
      website: sourced(normalizeWebsite(first(tags['contact:website'], tags.website))),
      openingHoursRaw: sourced(first(tags.opening_hours)),
    },
    editorial: {},
    sources: entity.sources,
  }
}

export function validateFactProvenance(entity: EnrichedEntity): string[] {
  const knownSources = new Set(entity.sources.map((source) => source.key))
  const errors: string[] = []
  for (const source of entity.sources) {
    if (!sourceIsComplete(source)) errors.push(`sources: la fuente ${source.key} no tiene proveedor, identificador, URL, fecha o atribución completos.`)
  }
  for (const [field, fact] of Object.entries(entity.facts)) {
    if (fact.value !== null && fact.sources.length === 0) errors.push(`${field}: un valor factual requiere al menos una fuente.`)
    for (const source of fact.sources) {
      if (!knownSources.has(source)) errors.push(`${field}: la fuente ${source} no existe en sources.`)
    }
  }
  return errors
}

export function sourceIsComplete(source: SourceProvenance): boolean {
  return Boolean(source.provider && source.identifier && source.url && source.retrievedAt && source.attribution)
}

function businessKind(entity: DiscoveredEntity): BusinessKind | null {
  if (entity.type === 'attraction') return null
  if (entity.type === 'bar' && entity.raw.tags.amenity === 'pub') return 'pub'
  return entity.type
}

function factualAddress(tags: Record<string, string>): FactualAddress | null {
  const streetName = first(tags['addr:street'], tags['addr:place'])
  const houseNumber = first(tags['addr:housenumber'])
  const street = [streetName, houseNumber].filter(Boolean).join(' ') || undefined
  const address: FactualAddress = {
    ...(street ? {street} : {}),
    ...(tags['addr:postcode'] ? {postalCode: tags['addr:postcode']} : {}),
    ...(tags['addr:city'] ? {locality: tags['addr:city']} : {}),
    ...(tags['addr:province'] ? {province: tags['addr:province']} : {}),
    ...(tags['addr:country'] ? {country: tags['addr:country']} : {}),
  }
  return Object.keys(address).length > 0 ? address : null
}

function normalizeWebsite(value: string | null): string | null {
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  return `https://${value}`
}

function first(...values: Array<string | undefined>): string | null {
  return values.find((value) => value?.trim())?.trim() ?? null
}
