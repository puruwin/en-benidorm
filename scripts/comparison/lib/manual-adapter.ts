import {readFile} from 'node:fs/promises'
import {EVIDENCE_CATEGORIES, type ComparisonEvidenceFact, type ComparisonEvidenceValue, type EstablishmentIdentity, type EvidenceCategory, type EvidenceNature, type OperationalStatusSignal} from './types'
import {CLAIM_SCOPES, SOURCE_CLASSES, type SourceProvenance} from '../../content/lib/types'
import {withSourceIntegrity} from '../../content/lib/source-integrity'

export interface ManualComparisonBusiness {
  businessId: string
  evidence: Partial<Record<EvidenceCategory, ComparisonEvidenceFact[]>>
  identity?: EstablishmentIdentity
  operationalSignals?: OperationalStatusSignal[]
}

export interface ManualComparisonData {
  topic: string
  sources: SourceProvenance[]
  businesses: ManualComparisonBusiness[]
}

/** Loads manually curated comparison facts without treating editorial claims as objective facts. */
export class ManualJsonAdapter {
  readonly provider = 'manual-json'

  constructor(private readonly path: string) {}

  async load(): Promise<ManualComparisonData> {
    const value: unknown = JSON.parse(await readFile(this.path, 'utf8'))
    if (!isRecord(value) || typeof value.topic !== 'string' || !Array.isArray(value.sources) || !Array.isArray(value.businesses)) {
      throw new Error('ManualJsonAdapter: topic, sources y businesses son obligatorios.')
    }
    const sources = value.sources.map(parseSource)
    const sourceKeys = new Set(sources.map((source) => source.key))
    const businesses = value.businesses.map((business, index) => parseBusiness(business, index, sourceKeys))
    return {topic: value.topic, sources, businesses}
  }
}

function parseSource(value: unknown, index: number): SourceProvenance {
  if (!isRecord(value)) throw new Error(`ManualJsonAdapter: sources[${index}] debe ser un objeto.`)
  for (const field of ['key', 'provider', 'identifier', 'url', 'retrievedAt', 'attribution']) {
    if (typeof value[field] !== 'string' || !(value[field] as string).trim()) throw new Error(`ManualJsonAdapter: sources[${index}].${field} es obligatorio.`)
  }
  if (!isHttpUrl(value.url as string)) throw new Error(`ManualJsonAdapter: sources[${index}].url no es HTTP(S).`)
  if (value.sourceClass !== undefined && (typeof value.sourceClass !== 'string' || !SOURCE_CLASSES.includes(value.sourceClass as never))) {
    throw new Error(`ManualJsonAdapter: sources[${index}].sourceClass no es válido.`)
  }
  if (value.claimScope !== undefined && (typeof value.claimScope !== 'string' || !CLAIM_SCOPES.includes(value.claimScope as never))) {
    throw new Error(`ManualJsonAdapter: sources[${index}].claimScope no es válido.`)
  }
  return withSourceIntegrity({
    key: value.key as string, provider: value.provider as string, identifier: value.identifier as string,
    url: value.url as string, retrievedAt: value.retrievedAt as string, attribution: value.attribution as string,
    licenseUrl: typeof value.licenseUrl === 'string' ? value.licenseUrl : null,
    ...(typeof value.sourceClass === 'string' && SOURCE_CLASSES.includes(value.sourceClass as never) ? {sourceClass: value.sourceClass as NonNullable<SourceProvenance['sourceClass']>} : {}),
    ...(typeof value.claimScope === 'string' && CLAIM_SCOPES.includes(value.claimScope as never) ? {claimScope: value.claimScope as NonNullable<SourceProvenance['claimScope']>} : {}),
  })
}

function parseBusiness(value: unknown, index: number, sources: Set<string>): ManualComparisonBusiness {
  if (!isRecord(value) || typeof value.businessId !== 'string' || !isRecord(value.evidence)) {
    throw new Error(`ManualJsonAdapter: businesses[${index}] no es válido.`)
  }
  const evidence: Partial<Record<EvidenceCategory, ComparisonEvidenceFact[]>> = {}
  for (const category of EVIDENCE_CATEGORIES) {
    const items = value.evidence[category]
    if (items === undefined) continue
    if (!Array.isArray(items)) throw new Error(`ManualJsonAdapter: ${value.businessId}.${category} debe ser un array.`)
    evidence[category] = items.map((item, factIndex) => parseFact(item, value.businessId as string, category, factIndex, sources))
  }
  const identity = value.identity === undefined ? undefined : parseIdentity(value.identity, `businesses[${index}].identity`)
  const operationalSignals = value.operationalSignals === undefined ? undefined
    : parseOperationalSignals(value.operationalSignals, value.businessId, sources, identity)
  return {businessId: value.businessId, evidence, ...(identity ? {identity} : {}), ...(operationalSignals ? {operationalSignals} : {})}
}

function parseOperationalSignals(value: unknown, businessId: unknown, sources: Set<string>, defaultIdentity?: EstablishmentIdentity): OperationalStatusSignal[] {
  if (!Array.isArray(value)) throw new Error(`ManualJsonAdapter: ${String(businessId)}.operationalSignals debe ser un array.`)
  return value.map((item, index) => {
    if (!isRecord(item) || !['open', 'closed', 'temporarily_closed'].includes(String(item.status))
      || !isCalendarDate(item.observedAt) || !Array.isArray(item.sourceKeys) || item.sourceKeys.length === 0
      || item.sourceKeys.some((key) => typeof key !== 'string' || !sources.has(key))) {
      throw new Error(`ManualJsonAdapter: ${String(businessId)}.operationalSignals[${index}] no es válido.`)
    }
    const identity = item.identity === undefined ? defaultIdentity : parseIdentity(item.identity, `${String(businessId)}.operationalSignals[${index}].identity`)
    return {
      status: item.status as OperationalStatusSignal['status'], observedAt: item.observedAt,
      sourceKeys: item.sourceKeys as string[], ...(identity ? {identity} : {}),
    }
  })
}

function parseIdentity(value: unknown, path: string): EstablishmentIdentity {
  if (!isRecord(value)) throw new Error(`ManualJsonAdapter: ${path} debe ser un objeto.`)
  const identity: EstablishmentIdentity = {}
  for (const field of ['businessId', 'name', 'address', 'phone', 'domain'] as const) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || !(value[field] as string).trim())) throw new Error(`ManualJsonAdapter: ${path}.${field} no es válido.`)
    if (typeof value[field] === 'string') identity[field] = value[field] as never
  }
  for (const field of ['latitude', 'longitude'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'number') throw new Error(`ManualJsonAdapter: ${path}.${field} no es válido.`)
    if (typeof value[field] === 'number') identity[field] = value[field]
  }
  return identity
}

function parseFact(value: unknown, businessId: string, category: EvidenceCategory, index: number, sources: Set<string>): ComparisonEvidenceFact {
  if (!isRecord(value) || !validValue(value.value) || !isNature(value.nature) || !Array.isArray(value.sourceKeys) || value.sourceKeys.length === 0) {
    throw new Error(`ManualJsonAdapter: ${businessId}.${category}[${index}] no es válido.`)
  }
  const sourceKeys = value.sourceKeys.filter((key): key is string => typeof key === 'string')
  if (sourceKeys.length !== value.sourceKeys.length || sourceKeys.some((key) => !sources.has(key))) {
    throw new Error(`ManualJsonAdapter: ${businessId}.${category}[${index}] referencia una fuente desconocida.`)
  }
  return {
    id: typeof value.id === 'string' ? value.id : `${businessId}:${category}:${index}`,
    value: value.value, nature: value.nature, sourceKeys,
  }
}

function validValue(value: unknown): value is ComparisonEvidenceValue {
  if (typeof value === 'string') return Boolean(value.trim())
  if (typeof value === 'boolean') return true
  return isRecord(value) && typeof value.item === 'string' && typeof value.value === 'number' && value.currency === 'EUR'
    && (value.priceQualifier === undefined || (typeof value.priceQualifier === 'string' && Boolean(value.priceQualifier.trim())))
    && typeof value.retrievedAt === 'string'
}
function isNature(value: unknown): value is EvidenceNature { return value === 'factual' || value === 'self_claim' || value === 'external_observation' }
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isHttpUrl(value: string): boolean { try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false } }
