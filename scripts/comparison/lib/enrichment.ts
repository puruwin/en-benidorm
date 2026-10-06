import type {EnrichedEntity, Fact, SourceProvenance} from '../../content/lib/types'
import {compareScores, scoreBusiness} from './scoring'
import {EVIDENCE_CATEGORIES, type ComparisonCandidateArtifact, type ComparisonEvidence, type EnrichedComparisonArtifact, type EvidenceCategory} from './types'
import type {ManualComparisonData} from './manual-adapter'

export function enrichComparison(
  candidates: ComparisonCandidateArtifact,
  entities: ReadonlyMap<string, EnrichedEntity>,
  manual: ManualComparisonData,
  now: string,
): EnrichedComparisonArtifact {
  if (manual.topic !== candidates.topic) throw new Error(`La fuente manual corresponde a ${manual.topic}, no a ${candidates.topic}.`)
  const manualById = new Map(manual.businesses.map((business) => [business.businessId, business]))
  const businesses = candidates.candidates.map((candidate) => {
    const entity = entities.get(candidate.businessId)
    if (!entity) throw new Error(`Falta Business enriquecido: ${candidate.businessId}.`)
    const evidence = emptyEvidence()
    addFact(evidence, 'cuisine', entity.facts.cuisine, candidate.businessId)
    addFact(evidence, 'specialties', entity.facts.specialties, candidate.businessId)
    addFact(evidence, 'services', entity.facts.services, candidate.businessId)
    addBoolean(evidence, 'services', 'Acepta reservas', entity.facts.bookingAvailability, candidate.businessId)
    addBoolean(evidence, 'services', 'Servicio para llevar', entity.facts.takeaway, candidate.businessId)
    addBoolean(evidence, 'services', 'Entrega a domicilio', entity.facts.delivery, candidate.businessId)
    addBoolean(evidence, 'services', 'Terraza', entity.facts.terrace, candidate.businessId)
    addFact(evidence, 'services', entity.facts.accessibility, candidate.businessId)
    addFact(evidence, 'location', entity.facts.locationContext, candidate.businessId)
    addFact(evidence, 'practical', entity.facts.openingInformation, candidate.businessId)
    addFact(evidence, 'practical', entity.facts.openingHoursRaw, candidate.businessId)
    addFact(evidence, 'specialties', entity.facts.distinctiveFeatures, candidate.businessId)
    for (const category of EVIDENCE_CATEGORIES) evidence[category].push(...(manualById.get(candidate.businessId)?.evidence[category] ?? []))
    deduplicateEvidence(evidence)
    const sourceKeys = new Set(Object.values(evidence).flat().flatMap((fact) => fact.sourceKeys))
    const sources = mergeSources(entity.sources, manual.sources).filter((source) => sourceKeys.has(source.key))
    const scores = scoreBusiness(entity, candidates.topic, evidence)
    return {
      businessId: candidate.businessId, name: entity.facts.name.value ?? candidate.businessId,
      qualityTier: candidate.qualityTier, topicEvidence: candidate.topicEvidence, scores, evidence, sources,
    }
  }).sort(compareScores)
  const sources = mergeSources(...businesses.map((business) => business.sources))
  return {schemaVersion: 1, id: candidates.id, topic: candidates.topic, slug: candidates.slug, enrichedAt: now, businesses, sources}
}

export function emptyEvidence(): ComparisonEvidence {
  return Object.fromEntries(EVIDENCE_CATEGORIES.map((category) => [category, []])) as unknown as ComparisonEvidence
}

function addFact(evidence: ComparisonEvidence, category: EvidenceCategory, fact: Fact<unknown>, businessId: string): void {
  if (fact.value === null || fact.sources.length === 0) return
  const values = Array.isArray(fact.value) ? fact.value : [fact.value]
  for (const [index, value] of values.entries()) {
    if (typeof value !== 'string' || !value.trim()) continue
    evidence[category].push({id: `${businessId}:${category}:business-${evidence[category].length + index}`, value, nature: 'factual', sourceKeys: [...fact.sources]})
  }
}

function addBoolean(evidence: ComparisonEvidence, category: EvidenceCategory, label: string, fact: Fact<boolean>, businessId: string): void {
  if (fact.value !== true || fact.sources.length === 0) return
  evidence[category].push({id: `${businessId}:${category}:business-${evidence[category].length}`, value: label, nature: 'factual', sourceKeys: [...fact.sources]})
}

function deduplicateEvidence(evidence: ComparisonEvidence): void {
  for (const category of EVIDENCE_CATEGORIES) {
    const seen = new Set<string>()
    evidence[category] = evidence[category].filter((fact) => {
      const key = JSON.stringify(fact.value).toLocaleLowerCase('es')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
}

function mergeSources(...groups: readonly SourceProvenance[][]): SourceProvenance[] {
  return [...new Map(groups.flat().map((source) => [source.key, source])).values()]
}
