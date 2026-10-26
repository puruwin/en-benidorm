import {readdir, stat} from 'node:fs/promises'
import {resolve} from 'node:path'
import type {DiscoveredEntity, EnrichedEntity, SourceProvenance} from '../../../../scripts/content/lib/types'
import type {ArtifactResponse} from '../../shared/types'
import type {BusinessContact, BusinessDetail, BusinessList, BusinessQuery, BusinessSummary} from '../../shared/business-types'
import {ArtifactLoader} from './artifact-loader'
import {validateBusinessId} from './validation'

export class BusinessError extends Error {
  constructor(readonly statusCode: number, message: string) {super(message)}
}

type Json = Record<string, any>
const object = (value: unknown): value is Json => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const validSources = (value: unknown): value is SourceProvenance[] => Array.isArray(value) && value.every(source => object(source) && typeof source.key === 'string' && typeof source.provider === 'string' && typeof source.retrievedAt === 'string' && typeof source.attribution === 'string' && (source.url === null || typeof source.url === 'string'))
const validDiscovery = (value: unknown): value is DiscoveredEntity => object(value) && typeof value.id === 'string'
  && /^business-[a-z0-9][a-z0-9-]*$/.test(value.id) && object(value.raw) && typeof value.raw.name === 'string'
  && object(value.raw.tags) && Object.values(value.raw.tags).every(tag => typeof tag === 'string') && validSources(value.sources)
  && (!value.businessClassification || (object(value.businessClassification) && typeof value.businessClassification.sector === 'string' && typeof value.businessClassification.subsector === 'string'))
  && (!value.geography || (object(value.geography) && typeof value.geography.municipality === 'string'))
const validEnriched = (value: unknown) => object(value) && typeof value.id === 'string' && object(value.facts) && validSources(value.sources)
  && ['address', 'location', 'phone', 'website'].every(key => object(value.facts[key]) && strings(value.facts[key].sources))
  && (value.facts.address.value === null || object(value.facts.address.value)) && (value.facts.location.value === null || object(value.facts.location.value))
  && ['phone', 'website'].every(key => value.facts[key].value === null || typeof value.facts[key].value === 'string')

export class BusinessCatalog {
  private files = new Map<string, {signature: string; artifact: ArtifactResponse<DiscoveredEntity>}>()
  private index: {entities: DiscoveredEntity[]; warnings: string[]} | undefined
  private pending: Promise<NonNullable<BusinessCatalog['index']>> | undefined
  private checkedAt = 0
  constructor(private root: string, private loader = new ArtifactLoader(root)) {}

  private async names(directory: string): Promise<string[]> {
    try {return (await readdir(resolve(this.root, directory), {withFileTypes: true})).filter(item => item.isFile() && item.name.endsWith('.json')).map(item => item.name).sort(compare)}
    catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error}
  }
  private async checked<T>(path: string, valid: (value: unknown) => boolean): Promise<ArtifactResponse<T>> {
    const artifact = await this.loader.readKnown<T>(path)
    if (artifact.status === 'available' && !valid(artifact.data)) return {status: 'invalid', path, error: 'Estructura de artefacto inválida.'}
    return artifact
  }
  private async buildIndex() {
    const entities: DiscoveredEntity[] = [], warnings: string[] = []
    const names = await this.names('content/discovered')
    const present = new Set(names)
    for (const name of this.files.keys()) if (!present.has(name)) this.files.delete(name)
    // Bounded I/O and a per-file metadata cache: unchanged records are not parsed again.
    for (let start = 0; start < names.length; start += 32) await Promise.all(names.slice(start, start + 32).map(async name => {
      if (!/^business-[a-z0-9][a-z0-9-]*\.json$/.test(name)) return
      const path = `content/discovered/${name}`
      const info = await stat(resolve(this.root, path))
      const signature = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`
      let item = this.files.get(name)
      if (item?.signature !== signature) {
        item = {signature, artifact: await this.checked<DiscoveredEntity>(path, validDiscovery)}
        if (item.artifact.data?.id !== name.slice(0, -5)) item.artifact = {status: 'invalid', path, error: 'businessId no coincide con el archivo.'}
        this.files.set(name, item)
      }
      if (item.artifact.status === 'invalid') warnings.push(`${path}: ${item.artifact.error}`)
      else if (item.artifact.data?.targetDocumentType === 'business') entities.push(item.artifact.data)
    }))
    entities.sort((a, b) => compare(normalize(a.raw.name), normalize(b.raw.name)) || compare(a.id, b.id))
    if (!names.length) warnings.push('No hay registros locales de Discovery. Restaura el catálogo existente para navegar por él.')
    return {entities, warnings: warnings.sort(compare)}
  }
  private async snapshot(force = false) {
    if (this.pending) return this.pending
    if (!force && this.index && Date.now() - this.checkedAt < 2000) return this.index
    this.pending = this.buildIndex()
    try {this.index = await this.pending; this.checkedAt = Date.now(); return this.index}
    finally {this.pending = undefined}
  }
  private summary(entity: DiscoveredEntity): BusinessSummary {
    const tags = entity.raw.tags
    const has = (keys: string[]) => keys.some(key => Boolean(tags[key]?.trim()))
    return {businessId: entity.id, name: entity.raw.name, municipality: entity.geography?.municipality ?? 'unknown',
      sector: entity.businessClassification?.sector ?? 'other', subsector: entity.businessClassification?.subsector ?? 'unknown',
      knownWebsite: has(['website', 'contact:website']), knownPhone: has(['phone', 'contact:phone', 'mobile', 'contact:mobile'])}
  }
  async list(query: BusinessQuery): Promise<BusinessList> {
    const allowed = ['q', 'municipality', 'sector', 'subsector', 'page', 'pageSize', 'refresh']
    for (const [key, value] of Object.entries(query)) if (!allowed.includes(key) || typeof value !== 'string' || value.length > 200) throw new BusinessError(400, 'Filtro inválido.')
    if (query.refresh && query.refresh !== '1') throw new BusinessError(400, 'Filtro inválido.')
    const page = Number(query.page ?? 1), pageSize = Number(query.pageSize ?? 25)
    if (!/^\d+$/.test(query.page ?? '1') || !/^\d+$/.test(query.pageSize ?? '25') || !Number.isSafeInteger(page) || page < 1 || pageSize < 1 || pageSize > 100) throw new BusinessError(400, 'Paginación inválida (page >= 1, pageSize de 1 a 100).')
    const index = await this.snapshot(query.refresh === '1')
    const all = index.entities.map(entity => this.summary(entity))
    const items = all.filter(item => (!query.q || normalize(`${item.name} ${item.businessId}`).includes(normalize(query.q.trim())))
      && (!query.municipality || item.municipality === query.municipality) && (!query.sector || item.sector === query.sector)
      && (!query.subsector || item.subsector === query.subsector))
    const unique = (values: string[]) => [...new Set(values)].sort(compare)
    return {items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, catalogTotal: all.length,
      page, pageSize, pages: Math.ceil(items.length / pageSize), warnings: index.warnings,
      facets: {municipalities: unique(all.map(item => item.municipality)), sectors: unique(all.map(item => item.sector)), subsectors: unique(all.filter(item => !query.sector || item.sector === query.sector).map(item => item.subsector))}}
  }
  async requireBusiness(id: string) {
    validateBusinessId(id)
    const entity = await this.checked<DiscoveredEntity>(`content/discovered/${id}.json`, value => validDiscovery(value) && value.id === id && value.targetDocumentType === 'business')
    if (entity.status === 'invalid') throw new BusinessError(422, 'El registro del negocio es inválido.')
    if (!entity.data) throw new BusinessError(404, 'Negocio no encontrado en el catálogo local.')
    return entity.data
  }
  async detail(id: string): Promise<BusinessDetail> {
    const entity = await this.requireBusiness(id)
    const [enriched, manifest] = await Promise.all([
      this.checked<EnrichedEntity>(`content/enriched/${id}.json`, value => validEnriched(value) && (value as Json).id === id),
      this.checked<Json>('content/manifest.json', value => object(value) && Array.isArray(value.entries)),
    ])
    const warnings = [enriched, manifest].filter(item => item.status === 'invalid').map(item => `${item.path}: ${item.error}`)
    const sources = [...new Map([entity.sources, enriched.data?.sources ?? []].flat().map((source: SourceProvenance) => [source.key, source])).values()]
    const contacts: BusinessContact[] = []
    function contact(kind: BusinessContact['kind'], value: unknown, sourceKeys: string[], origin: BusinessContact['origin'], observedAt: string | null) {
      if (typeof value === 'string' && value.trim()) contacts.push({kind, value, sourceKeys, origin, observedAt})
    }
    const tags = entity.raw.tags
    for (const [kind, keys] of [['website', ['website', 'contact:website']], ['phone', ['phone', 'contact:phone', 'mobile', 'contact:mobile']], ['email', ['email', 'contact:email']]] as const) {
      for (const key of keys) contact(kind, tags[key], entity.sources.map(source => source.key), 'Discovery', entity.sources[0]?.retrievedAt ?? null)
      const fact = enriched.data?.facts[kind as 'website' | 'phone']
      if (fact) contact(kind, fact.value, fact.sources, 'Enrichment', null)
    }
    const addressFact = enriched.data?.facts.address.value
    const address = [addressFact?.street ?? tags['addr:street'], tags['addr:housenumber'], addressFact?.postalCode ?? tags['addr:postcode'], addressFact?.locality ?? tags['addr:city']].filter(Boolean).join(', ') || tags['addr:full'] || null
    const location = enriched.data?.facts.location.value
    const latitude = location?.lat ?? entity.raw.latitude, longitude = location?.lng ?? entity.raw.longitude
    const coordinates = typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90 && typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180 ? {latitude, longitude} : null
    const business = {...this.summary(entity), knownWebsite: contacts.some(item => item.kind === 'website'), knownPhone: contacts.some(item => item.kind === 'phone')}
    const identity = {entry: manifest.data?.entries.find((item: Json) => item.id === id) ?? null, enriched: enriched.data ?? null}
    return {business, address, coordinates, contacts, sources, identity, warnings}
  }
}
