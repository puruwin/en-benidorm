import type {EnrichedEntity, Fact, SourceProvenance} from '../../content/lib/types'
import {compareScores, scoreBusiness} from './scoring'
import {
  EVIDENCE_CATEGORIES, type ComparisonCandidateArtifact, type ComparisonEvidence,
  type ComparisonFeaturedItem, type ComparisonSourceConflict, type EnrichedComparisonArtifact, type EvidenceCategory,
} from './types'
import type {ManualComparisonData} from './manual-adapter'

export function enrichComparison(
  candidates: ComparisonCandidateArtifact,
  entities: ReadonlyMap<string, EnrichedEntity>,
  manual: ManualComparisonData,
  now: string,
): EnrichedComparisonArtifact {
  if (manual.topic !== candidates.topic) throw new Error(`La fuente manual corresponde a ${manual.topic}, no a ${candidates.topic}.`)
  const manualById = new Map(manual.businesses.map((business) => [business.businessId, business]))
  const sourceConflicts: ComparisonSourceConflict[] = []
  const businesses = candidates.candidates.map((candidate) => {
    const entity = entities.get(candidate.businessId)
    if (!entity) throw new Error(`Falta Business enriquecido: ${candidate.businessId}.`)
    const evidence = emptyEvidence()
    addCuisineAndSpecialties(evidence, entity.facts.cuisine, candidate.businessId)
    addFact(evidence, 'specialties', entity.facts.specialties, candidate.businessId)
    addFact(evidence, 'services', entity.facts.services, candidate.businessId)
    addBoolean(evidence, 'services', 'Acepta reservas', entity.facts.bookingAvailability, candidate.businessId)
    addBoolean(evidence, 'services', 'Servicio para llevar', entity.facts.takeaway, candidate.businessId)
    addBoolean(evidence, 'services', 'Entrega a domicilio', entity.facts.delivery, candidate.businessId)
    addBoolean(evidence, 'services', 'Terraza', entity.facts.terrace, candidate.businessId)
    addFact(evidence, 'services', entity.facts.accessibility, candidate.businessId)
    addFact(evidence, 'location', entity.facts.locationContext, candidate.businessId)
    const conflict = openingHoursConflict(entity, candidate.businessId)
    if (conflict) sourceConflicts.push(conflict)
    const officialOpening = entity.factsBySource.officialWebsite.openingInformation
    if (officialOpening?.value && officialOpening.sources.length) addFact(evidence, 'practical', officialOpening, candidate.businessId)
    else {
      addFact(evidence, 'practical', entity.facts.openingInformation, candidate.businessId)
      addFact(evidence, 'practical', entity.facts.openingHoursRaw, candidate.businessId)
    }
    addFact(evidence, 'location', entity.facts.distinctiveFeatures, candidate.businessId)
    for (const category of EVIDENCE_CATEGORIES) evidence[category].push(...(manualById.get(candidate.businessId)?.evidence[category] ?? []))
    normalizeFeaturedItems(evidence, mergeSources(entity.sources, manual.sources))
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
  return {
    schemaVersion: 1, id: candidates.id, topic: candidates.topic, searchIntent: candidates.searchIntent,
    slug: candidates.slug, enrichedAt: now, businesses, sources, sourceConflicts,
  }
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

const CUISINE_TERMS = /^(?:italian[oa]?|mediterr[aá]ne[oa]|japonesa?|japanese|india|indian)$/i
const SPECIALTY_TERMS = /^(?:pasta|pizza|focaccia|focaccias|pinsa|carbonara)$/i

function addCuisineAndSpecialties(evidence: ComparisonEvidence, fact: Fact<unknown>, businessId: string): void {
  if (!Array.isArray(fact.value) || fact.sources.length === 0) return
  for (const value of fact.value) {
    if (typeof value !== 'string' || !value.trim()) continue
    const category = SPECIALTY_TERMS.test(value.trim()) ? 'specialties' : CUISINE_TERMS.test(value.trim()) ? 'cuisine' : 'cuisine'
    evidence[category].push({
      id: `${businessId}:${category}:business-${evidence[category].length}`,
      value, nature: 'factual', sourceKeys: [...fact.sources],
    })
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

function normalizeFeaturedItems(evidence: ComparisonEvidence, sources: readonly SourceProvenance[]): void {
  const sourceByKey = new Map(sources.map((source) => [source.key, source]))
  for (const fact of evidence.featuredItems) {
    if (typeof fact.value !== 'string') continue
    const source = fact.sourceKeys[0]
    if (!source) continue
    const price = evidence.prices.find((candidate) => {
      if (typeof candidate.value !== 'object' || !('item' in candidate.value)) return false
      return normalize(candidate.value.item) === normalize(fact.value as string)
    })
    const priceValue = price && typeof price.value === 'object' && 'item' in price.value ? price.value : undefined
    fact.value = {
      name: fact.nature === 'self_claim' && !/(?:seg[uú]n|indica|web)/i.test(fact.value) ? `${fact.value} (según su web)` : fact.value,
      ...(priceValue ? {
        price: priceValue.value,
        currency: priceValue.currency,
        ...(priceValue.priceQualifier ? {priceQualifier: priceValue.priceQualifier} : {}),
      } : {}),
      source,
      retrievedAt: priceValue?.retrievedAt ?? sourceByKey.get(source)?.retrievedAt.slice(0, 10) ?? '',
    } satisfies ComparisonFeaturedItem
  }
}

function openingHoursConflict(entity: EnrichedEntity, businessId: string): ComparisonSourceConflict | null {
  const osm = entity.factsBySource.openStreetMap.openingInformation
  const official = entity.factsBySource.officialWebsite.openingInformation
  if (!osm?.value || !official?.value || osm.sources.length === 0 || official.sources.length === 0) return null
  const osmValue = (Array.isArray(osm.value) ? osm.value : [osm.value]).map(String).map(normalize).sort().join('|')
  const officialValue = (Array.isArray(official.value) ? official.value : [official.value]).map(String).map(normalize).sort().join('|')
  if (!osmValue || !officialValue || osmValue === officialValue) return null
  return {
    businessId, dimension: 'practical', preferredSourceKeys: [...official.sources], conflictingSourceKeys: [...osm.sources],
    resolution: 'Se prioriza el horario de la web oficial, al ser la fuente directa más reciente.',
  }
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function mergeSources(...groups: readonly SourceProvenance[][]): SourceProvenance[] {
  return [...new Map(groups.flat().map((source) => [source.key, source])).values()]
}
