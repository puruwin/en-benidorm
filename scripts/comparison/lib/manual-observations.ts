import {basename} from 'node:path'
import {loadJsonDirectory} from '../../content/lib/files'
import type {EnrichedEntity, SourceProvenance} from '../../content/lib/types'
import {
  EVIDENCE_CATEGORIES, type ComparisonEvidenceFact, type EvidenceCategory,
} from './types'

export interface ManualObservationRecord {
  businessId: string
  observedAt: string
  observer: string
  sourceType: 'first-party-observation'
  observations: Array<{dimension: EvidenceCategory; value: string}>
}

export interface ManualObservationBusiness {
  businessId: string
  evidence: Partial<Record<EvidenceCategory, ComparisonEvidenceFact[]>>
}

export interface ManualObservationData {
  records: ManualObservationRecord[]
  sources: SourceProvenance[]
  businesses: ManualObservationBusiness[]
}

export const EMPTY_MANUAL_OBSERVATIONS: ManualObservationData = {records: [], sources: [], businesses: []}

/** Loads repo-versioned first-hand observations. A missing directory intentionally means no observations. */
export async function loadManualComparisonObservations(
  directory: string,
  entities: ReadonlyMap<string, EnrichedEntity>,
): Promise<ManualObservationData> {
  const files = await loadJsonDirectory<unknown>(directory)
  if (files.length === 0) return EMPTY_MANUAL_OBSERVATIONS

  const records = files.map(({path, value}) => parseRecord(value, basename(path), entities))
  const sources: SourceProvenance[] = []
  const businesses = new Map<string, ManualObservationBusiness>()

  for (const record of records) {
    const sourceKey = manualSourceKey(record)
    if (!sources.some((source) => source.key === sourceKey)) sources.push({
      key: sourceKey,
      provider: 'manual-observation',
      identifier: `${record.businessId}:${record.observedAt}:${record.observer}`,
      url: null,
      retrievedAt: `${record.observedAt}T00:00:00.000Z`,
      attribution: `Observación local de primera mano · ${record.observer}`,
      licenseUrl: null,
      sourceClass: 'manual-first-party',
      claimScope: 'establishment',
    })
    const business = businesses.get(record.businessId) ?? {businessId: record.businessId, evidence: {}}
    for (const [index, observation] of record.observations.entries()) {
      const facts = business.evidence[observation.dimension] ?? []
      facts.push({
        id: `${record.businessId}:${observation.dimension}:manual-${record.observedAt}-${slug(record.observer)}-${index}`,
        value: observation.value,
        nature: 'first_party_observation',
        sourceStage: 'manual-observation',
        sourceKeys: [sourceKey],
        provenance: [{
          sourceStage: 'manual-observation',
          nature: 'first_party_observation',
          sourceType: 'first-party-observation',
          sourceKey,
          observer: record.observer,
          observedAt: record.observedAt,
        }],
      })
      business.evidence[observation.dimension] = facts
    }
    businesses.set(record.businessId, business)
  }

  return {records, sources, businesses: [...businesses.values()]}
}

function parseRecord(value: unknown, filename: string, entities: ReadonlyMap<string, EnrichedEntity>): ManualObservationRecord {
  if (!isRecord(value)) throw invalid(filename, 'el documento debe ser un objeto.')
  const businessId = value.businessId
  const observedAt = value.observedAt
  const observer = value.observer
  const rawObservations = value.observations
  if (typeof businessId !== 'string' || !businessId.trim()) throw invalid(filename, 'businessId es obligatorio.')
  if (!entities.has(businessId)) throw invalid(filename, `businessId inexistente: ${businessId}.`)
  if (!validDate(observedAt)) throw invalid(filename, 'observedAt debe ser una fecha real con formato YYYY-MM-DD.')
  if (typeof observer !== 'string' || !observer.trim()) throw invalid(filename, 'observer es obligatorio.')
  if (value.sourceType !== 'first-party-observation') throw invalid(filename, 'sourceType debe ser first-party-observation.')
  if (!Array.isArray(rawObservations) || rawObservations.length === 0) throw invalid(filename, 'observations debe contener al menos una observación.')
  const observations = rawObservations.map((item: unknown, index: number) => {
    if (!isRecord(item) || typeof item.dimension !== 'string' || !EVIDENCE_CATEGORIES.includes(item.dimension as EvidenceCategory)) {
      throw invalid(filename, `observations[${index}].dimension no es una dimensión Comparison válida.`)
    }
    if (typeof item.value !== 'string' || !item.value.trim()) throw invalid(filename, `observations[${index}].value es obligatorio.`)
    return {dimension: item.dimension as EvidenceCategory, value: item.value.trim()}
  })
  return {
    businessId,
    observedAt,
    observer: observer.trim(),
    sourceType: 'first-party-observation',
    observations,
  }
}

function invalid(filename: string, message: string): Error {
  return new Error(`Manual observation ${filename}: ${message}`)
}

function manualSourceKey(record: ManualObservationRecord): string {
  return `manual-observation:${record.businessId}:${record.observedAt}:${slug(record.observer)}`
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function slug(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
