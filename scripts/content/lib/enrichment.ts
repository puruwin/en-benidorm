import type {OfficialWebsiteFacts, OfficialWebsiteResult} from './adapters'
import type {BusinessFacts, BusinessKind, DiscoveredEntity, EnrichedEntity, Fact, FactualAddress, SourceProvenance} from './types'

export function enrichEntity(entity: DiscoveredEntity, official?: OfficialWebsiteResult): EnrichedEntity {
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
  const officialFacts = official?.facts ?? emptyOfficialFacts()
  const osmFacts: BusinessFacts = {
    name: sourced(entity.raw.name || null),
    businessKind: sourced(businessKind(entity)),
    address: sourced(address),
    location: sourced(location),
    phone: sourced(first(tags['contact:phone'], tags.phone)),
    website: sourced(normalizeWebsite(first(tags['contact:website'], tags.website))),
    openingHoursRaw: sourced(first(tags.opening_hours)),
    cuisine: listFact(splitTag(tags.cuisine), sourceKeys),
    concept: emptyFact(), specialties: emptyFact(), services: listFact(osmServices(tags), sourceKeys),
    bookingAvailability: booleanFact(osmBoolean(tags.reservation), sourceKeys),
    takeaway: booleanFact(osmBoolean(tags.takeaway), sourceKeys), delivery: booleanFact(osmBoolean(tags.delivery), sourceKeys),
    terrace: booleanFact(osmBoolean(first(tags.outdoor_seating)), sourceKeys), accessibility: listFact(osmAccessibility(tags), sourceKeys),
    openingInformation: listFact(splitTag(tags.opening_hours), sourceKeys), locationContext: emptyFact(), distinctiveFeatures: emptyFact(),
  }
  return {
    schemaVersion: 2,
    id: entity.id,
    type: entity.type,
    targetDocumentType: entity.targetDocumentType,
    slug: entity.slug,
    facts: {
      ...osmFacts,
      cuisine: mergeFacts(osmFacts.cuisine, officialFacts.cuisine), concept: officialFacts.concept,
      specialties: officialFacts.specialties, services: mergeFacts(osmFacts.services, officialFacts.services),
      bookingAvailability: mergeFacts(osmFacts.bookingAvailability, officialFacts.bookingAvailability),
      takeaway: mergeFacts(osmFacts.takeaway, officialFacts.takeaway), delivery: mergeFacts(osmFacts.delivery, officialFacts.delivery),
      terrace: mergeFacts(osmFacts.terrace, officialFacts.terrace), accessibility: mergeFacts(osmFacts.accessibility, officialFacts.accessibility),
      openingInformation: mergeFacts(osmFacts.openingInformation, officialFacts.openingInformation),
      locationContext: officialFacts.locationContext, distinctiveFeatures: officialFacts.distinctiveFeatures,
    },
    factsBySource: {openStreetMap: osmFacts, officialWebsite: officialFacts},
    editorial: {},
    sources: [...entity.sources, ...(official?.sources ?? [])],
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
  for (const [provider, providerFacts] of Object.entries(entity.factsBySource)) {
    for (const [field, fact] of Object.entries(providerFacts)) {
      if (fact.value !== null && fact.sources.length === 0) errors.push(`factsBySource.${provider}.${field}: un valor factual requiere al menos una fuente.`)
      for (const source of fact.sources) if (!knownSources.has(source)) errors.push(`factsBySource.${provider}.${field}: la fuente ${source} no existe en sources.`)
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

function emptyFact<T>(): Fact<T> {
  return {value: null, sources: []}
}

function emptyOfficialFacts(): OfficialWebsiteFacts {
  return {
    cuisine: emptyFact(), concept: emptyFact(), specialties: emptyFact(), services: emptyFact(), bookingAvailability: emptyFact(),
    takeaway: emptyFact(), delivery: emptyFact(), terrace: emptyFact(), accessibility: emptyFact(), openingInformation: emptyFact(),
    locationContext: emptyFact(), distinctiveFeatures: emptyFact(),
  }
}

function listFact(value: string[], sources: string[]): Fact<string[]> {
  return {value: value.length ? value : null, sources: value.length ? sources : []}
}

function booleanFact(value: boolean | null, sources: string[]): Fact<boolean> {
  return {value, sources: value === null ? [] : sources}
}

function mergeFacts<T>(osm: Fact<T>, official?: Fact<T>): Fact<T> {
  if (!official || official.value === null) return osm
  if (osm.value === null) return {value: official.value, sources: [...official.sources]}
  if (Array.isArray(osm.value) && Array.isArray(official.value)) {
    return {value: [...new Set([...osm.value, ...official.value])] as T, sources: [...new Set([...osm.sources, ...official.sources])]}
  }
  if (osm.value === official.value) return {value: osm.value, sources: [...new Set([...osm.sources, ...official.sources])]}
  // Conflicting booleans remain attributed to OSM instead of silently choosing the official value.
  return osm
}

function splitTag(value: string | undefined): string[] {
  return value?.split(/[;,]/).map((item) => item.trim()).filter(Boolean) ?? []
}

function osmBoolean(value: string | null | undefined): boolean | null {
  if (!value) return null
  if (['yes', 'true', 'only'].includes(value.toLowerCase())) return true
  if (['no', 'false'].includes(value.toLowerCase())) return false
  return null
}

function osmServices(tags: Record<string, string>): string[] {
  const services: string[] = []
  if (osmBoolean(tags.breakfast) === true) services.push('desayuno')
  if (osmBoolean(tags.lunch) === true) services.push('almuerzo')
  if (osmBoolean(tags.dinner) === true) services.push('cena')
  if (osmBoolean(tags['diet:vegetarian']) === true) services.push('opciones vegetarianas')
  if (osmBoolean(tags['diet:vegan']) === true) services.push('opciones veganas')
  if (osmBoolean(tags['diet:gluten_free']) === true) services.push('opciones sin gluten')
  return services
}

function osmAccessibility(tags: Record<string, string>): string[] {
  const values: string[] = []
  if (osmBoolean(tags.wheelchair) === true) values.push('acceso para silla de ruedas')
  if (osmBoolean(tags['toilets:wheelchair']) === true) values.push('baño adaptado')
  return values
}
