import {readFile} from 'node:fs/promises'
import {EVIDENCE_CATEGORIES, type ComparisonEvidenceFact, type ComparisonEvidenceValue, type EvidenceCategory, type EvidenceNature} from './types'
import type {SourceProvenance} from '../../content/lib/types'

export interface ManualComparisonBusiness {
  businessId: string
  evidence: Partial<Record<EvidenceCategory, ComparisonEvidenceFact[]>>
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
  return {
    key: value.key as string, provider: value.provider as string, identifier: value.identifier as string,
    url: value.url as string, retrievedAt: value.retrievedAt as string, attribution: value.attribution as string,
    licenseUrl: typeof value.licenseUrl === 'string' ? value.licenseUrl : null,
  }
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
  return {businessId: value.businessId, evidence}
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
  return isRecord(value) && typeof value.item === 'string' && typeof value.value === 'number' && value.currency === 'EUR' && typeof value.retrievedAt === 'string'
}
function isNature(value: unknown): value is EvidenceNature { return value === 'factual' || value === 'self_claim' || value === 'external_observation' }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isHttpUrl(value: string): boolean { try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false } }
