import type {CommercialItem, EnrichedEntity, Fact, SourceProvenance} from '../../content/lib/types'
import {sourceIntegrity, withSourceIntegrity} from '../../content/lib/source-integrity'
import {compareScores, directEvidenceFromComparisonEvidence, legacyEvidenceLabel, scoreBusiness} from './scoring'
import {
  EVIDENCE_CATEGORIES, type CandidateEvidence, type ComparisonCandidateArtifact, type ComparisonEvidence,
  type ComparisonEvidenceFact, type ComparisonFeaturedItem, type ComparisonSourceConflict,
  type ComparisonIntegrityIssue, type EnrichedComparisonArtifact, type EvidenceCategory,
} from './types'
import type {ManualComparisonData} from './manual-adapter'
import {EMPTY_MANUAL_OBSERVATIONS, type ManualObservationData} from './manual-observations'
import type {ComparisonResearchBundle} from './research'
import {assessOperationalStatus, checkEstablishmentIdentity} from './integrity'

export function enrichComparison(
  candidates: ComparisonCandidateArtifact,
  entities: ReadonlyMap<string, EnrichedEntity>,
  manual: ManualComparisonData,
  now: string,
  researchByBusiness = new Map<string, ComparisonResearchBundle>(),
  manualObservations: ManualObservationData = EMPTY_MANUAL_OBSERVATIONS,
): EnrichedComparisonArtifact {
  if (manual.topic !== candidates.topic) throw new Error(`La fuente manual corresponde a ${manual.topic}, no a ${candidates.topic}.`)
  const manualById = new Map(manual.businesses.map((business) => [business.businessId, business]))
  const observationsById = new Map(manualObservations.businesses.map((business) => [business.businessId, business]))
  const sourceConflicts: ComparisonSourceConflict[] = []
  const integrityIssues: ComparisonIntegrityIssue[] = []
  const investigations: NonNullable<EnrichedComparisonArtifact['investigations']> = []
  const businesses = candidates.candidates.flatMap((candidate) => {
    const entity = entities.get(candidate.businessId)
    if (!entity) throw new Error(`Falta Business enriquecido: ${candidate.businessId}.`)
    const evidence = emptyEvidence()
    addCuisineAndSpecialties(evidence, localFact(entity.facts.cuisine, entity.sources), candidate.businessId)
    addFact(evidence, 'specialties', localFact(entity.facts.specialties, entity.sources), candidate.businessId)
    addFact(evidence, 'services', localFact(entity.facts.services, entity.sources), candidate.businessId)
    addBoolean(evidence, 'services', 'Acepta reservas', localFact(entity.facts.bookingAvailability, entity.sources), candidate.businessId)
    addBoolean(evidence, 'services', 'Servicio para llevar', localFact(entity.facts.takeaway, entity.sources), candidate.businessId)
    addBoolean(evidence, 'services', 'Entrega a domicilio', localFact(entity.facts.delivery, entity.sources), candidate.businessId)
    addBoolean(evidence, 'services', 'Terraza', localFact(entity.facts.terrace, entity.sources), candidate.businessId)
    addFact(evidence, 'services', localFact(entity.facts.accessibility, entity.sources), candidate.businessId)
    addFact(evidence, 'location', localFact(entity.facts.locationContext, entity.sources), candidate.businessId)
    const conflict = openingHoursConflict(entity, candidate.businessId)
    if (conflict) sourceConflicts.push(conflict)
    const officialOpening = entity.factsBySource.officialWebsite.openingInformation
    if (officialOpening?.value && localFact(officialOpening, entity.sources).sources.length) addFact(evidence, 'practical', localFact(officialOpening, entity.sources), candidate.businessId)
    else {
      addFact(evidence, 'practical', localFact(entity.facts.openingInformation, entity.sources), candidate.businessId)
      addFact(evidence, 'practical', localFact(entity.facts.openingHoursRaw, entity.sources), candidate.businessId)
    }
    addFact(evidence, 'location', localFact(entity.facts.distinctiveFeatures, entity.sources), candidate.businessId)
    addCommercialEvidence(evidence, localCommercialItems(entity.facts.commercialItems, entity.sources), candidate.businessId)
    const research = researchByBusiness.get(candidate.businessId)
    const manualBusiness = manualById.get(candidate.businessId)
    const availableSources = mergeSources(entity.sources, manual.sources, manualObservations.sources, research?.research.sources ?? [])
    for (const category of EVIDENCE_CATEGORIES) {
      for (const fact of manualBusiness?.evidence[category] ?? []) {
        const acceptance = externalFactAcceptance(fact, manualBusiness?.identity, entity, availableSources)
        if (!acceptance.accepted) {
          integrityIssues.push({businessId: candidate.businessId, code: acceptance.code!, sourceKeys: fact.sourceKeys, message: acceptance.message!})
          continue
        }
        evidence[category].push({...fact, sourceStage: fact.sourceStage ?? 'existing' as const})
      }
      evidence[category].push(...(observationsById.get(candidate.businessId)?.evidence[category] ?? []))
    }
    if (research) for (const category of EVIDENCE_CATEGORIES) evidence[category].push(...research.evidence[category])
    addManualObservationConflicts(sourceConflicts, candidate.businessId, evidence)
    ensureEvidenceProvenance(evidence)
    normalizeFeaturedItems(evidence, availableSources)
    deduplicateEvidence(evidence)
    ensureUniqueEvidenceIds(evidence)
    const sourceKeys = new Set(Object.values(evidence).flat().flatMap((fact) => fact.sourceKeys))
    const brandSources = entity.sources.filter((source) => sourceIntegrity(source).claimScope === 'brand')
    const sources = availableSources.filter((source) => sourceKeys.has(source.key) || brandSources.some((brand) => brand.key === source.key))
    if (brandSources.length && Object.values(entity.factsBySource.officialWebsite).some((fact) => fact.value !== null)) integrityIssues.push({
      businessId: candidate.businessId,
      code: 'BRAND_SCOPE_NOT_LOCAL',
      sourceKeys: brandSources.map((source) => source.key),
      message: 'Los facts corporativos se conservan en factsBySource, pero no se promueven como hechos del establecimiento.',
    })
    const operationalStatus = assessOperationalStatus(entity, manualBusiness?.operationalSignals ?? [], availableSources, now)
    for (const signal of operationalStatus.signals) for (const key of signal.sourceKeys) {
      const source = availableSources.find((item) => item.key === key)
      if (source && !sources.some((item) => item.key === key)) sources.push(source)
    }
    if (operationalStatus.needsVerification) integrityIssues.push({
      businessId: candidate.businessId, code: 'OPERATIONAL_STATUS_REVIEW', sourceKeys: operationalStatus.signals.flatMap((signal) => signal.sourceKeys),
      message: operationalStatus.reasons.join(' '),
    })
    const origin = candidate.matchType ?? 'direct'
    const enrichedDirectEvidence = directEvidenceFromComparisonEvidence(evidence, candidates.topic)
    const selectionEvidence = (candidate.evidence ?? candidate.topicEvidence.map((value) => legacyCandidateEvidence(value)))
      .map((item) => ({...item, sourceStage: item.sourceStage ?? 'existing' as const}))
      .filter((item) => candidateEvidenceIsLocal(item, availableSources))
    const investigationEvidence = uniqueCandidateEvidence([
      ...selectionEvidence,
      ...(research?.research.newEvidence ?? []),
      ...enrichedDirectEvidence,
    ])
    if (candidate.qualityTier === 'insufficient') {
      investigations.push({
        businessId: candidate.businessId,
        name: entity.facts.name.value ?? candidate.businessId,
        origin,
        outcome: 'rejected',
        qualityTier: candidate.qualityTier,
        evidence: investigationEvidence,
        reasons: ['El Business no supera el quality gate existente.'],
        ...(research ? {research: research.research} : {}),
      })
      return []
    }
    if (origin === 'direct' && !investigationEvidence.some((item) => item.strength === 'direct')) {
      investigations.push({
        businessId: candidate.businessId,
        name: entity.facts.name.value ?? candidate.businessId,
        origin,
        outcome: 'rejected',
        qualityTier: candidate.qualityTier,
        evidence: investigationEvidence,
        reasons: ['La evidencia temática previa tiene alcance de marca y no confirma este establecimiento.'],
        ...(research ? {research: research.research} : {}),
      })
      return []
    }
    if (origin === 'potential' && enrichedDirectEvidence.length === 0) {
      investigations.push({
        businessId: candidate.businessId,
        name: entity.facts.name.value ?? candidate.businessId,
        origin,
        outcome: 'rejected',
        qualityTier: candidate.qualityTier,
        evidence: investigationEvidence,
        reasons: [researchRejectionReason(research?.research.status)],
        ...(research ? {research: research.research} : {}),
      })
      return []
    }
    const scores = scoreBusiness(entity, candidates.topic, evidence)
    investigations.push({
      businessId: candidate.businessId,
      name: entity.facts.name.value ?? candidate.businessId,
      origin,
      outcome: 'confirmed',
      qualityTier: candidate.qualityTier,
      evidence: investigationEvidence,
      reasons: origin === 'potential' ? ['Enrichment encontró evidencia temática directa y verificable.'] : ['Direct match conservado.'],
      ...(research ? {research: research.research} : {}),
    })
    return [{
      businessId: candidate.businessId, name: entity.facts.name.value ?? candidate.businessId,
      qualityTier: candidate.qualityTier,
      origin,
      enrichmentOutcome: 'confirmed' as const,
      confirmationEvidence: origin === 'potential' ? enrichedDirectEvidence : investigationEvidence.filter((item) => item.strength === 'direct'),
      topicEvidence: origin === 'potential' ? enrichedDirectEvidence.map(legacyEvidenceLabel) : candidate.topicEvidence,
      scores, evidence, sources: sources.map((source) => withSourceIntegrity(source)), operationalStatus,
    }]
  }).sort(compareScores)
  const integritySourceKeys = new Set(integrityIssues.flatMap((issue) => issue.sourceKeys))
  const knownSources = mergeSources(
    ...[...entities.values()].map((entity) => entity.sources),
    manual.sources,
    manualObservations.sources,
    ...[...researchByBusiness.values()].map((bundle) => bundle.research.sources),
  )
  const sources = mergeSources(
    ...businesses.map((business) => business.sources),
    knownSources.filter((source) => integritySourceKeys.has(source.key)).map((source) => withSourceIntegrity(source)),
  )
  return {
    schemaVersion: 2, id: candidates.id, topic: candidates.topic, searchIntent: candidates.searchIntent,
    slug: candidates.slug, enrichedAt: now, businesses, investigations, sources, sourceConflicts, integrityIssues,
  }
}

export function emptyEvidence(): ComparisonEvidence {
  return Object.fromEntries(EVIDENCE_CATEGORIES.map((category) => [category, []])) as unknown as ComparisonEvidence
}

function addFact(evidence: ComparisonEvidence, category: EvidenceCategory, fact: Fact<unknown>, businessId: string): void {
  if (fact.value === null || fact.sources.length === 0) return
  const values = Array.isArray(fact.value) ? fact.value : [fact.value]
  const start = evidence[category].length
  for (const [index, value] of values.entries()) {
    if (typeof value !== 'string' || !value.trim()) continue
    evidence[category].push({id: `${businessId}:${category}:business-${start + index}`, value, nature: 'factual', sourceStage: 'existing', sourceKeys: [...fact.sources]})
  }
}

function localFact<T>(fact: Fact<T>, sources: readonly SourceProvenance[]): Fact<T> {
  const sourceByKey = new Map(sources.map((source) => [source.key, source]))
  const localSources = fact.sources.filter((key) => {
    const source = sourceByKey.get(key)
    return !source || sourceIntegrity(source).claimScope !== 'brand'
  })
  return localSources.length ? {...fact, sources: localSources} : {value: null, sources: []}
}

function localCommercialItems(fact: Fact<CommercialItem[]> | undefined, sources: readonly SourceProvenance[]): CommercialItem[] {
  const sourceByKey = new Map(sources.map((source) => [source.key, source]))
  return (fact?.value ?? []).filter((item) => {
    const source = sourceByKey.get(item.sourceKey)
    return !source || sourceIntegrity(source).claimScope !== 'brand'
  })
}

function addCommercialEvidence(evidence: ComparisonEvidence, items: CommercialItem[], businessId: string): void {
  for (const item of items) {
    const category: EvidenceCategory = item.kind === 'service' ? 'services' : item.kind === 'specialty' ? 'specialties' : 'featuredItems'
    evidence[category].push({
      id: `${businessId}:${category}:commercial-${evidence[category].length}`,
      value: category === 'featuredItems' ? {
        name: item.name,
        ...(item.price ? {
          price: item.price.amount, currency: item.price.currency,
          ...(item.price.priceQualifier === 'from' ? {priceQualifier: 'desde'} : {}),
        } : {}),
        source: item.sourceKey, retrievedAt: item.observedAt,
      } satisfies ComparisonFeaturedItem : item.name,
      nature: 'self_claim', sourceStage: 'existing', sourceKeys: [item.sourceKey],
      ...(item.description ? {excerpt: item.description} : {}),
    })
  }
}

function externalFactAcceptance(
  fact: ComparisonEvidenceFact,
  identity: import('./types').EstablishmentIdentity | undefined,
  entity: EnrichedEntity,
  sources: readonly SourceProvenance[],
): {accepted: boolean; code?: ComparisonIntegrityIssue['code']; message?: string} {
  const referenced = fact.sourceKeys.map((key) => sources.find((source) => source.key === key)).filter((source): source is SourceProvenance => Boolean(source))
  if (referenced.some((source) => sourceIntegrity(source).claimScope === 'brand')) {
    return {accepted: false, code: 'BRAND_SCOPE_NOT_LOCAL', message: 'Una afirmación de marca no se ha convertido en hecho del establecimiento.'}
  }
  if (!referenced.some((source) => sourceIntegrity(source).sourceClass === 'third-party')) return {accepted: true}
  const check = checkEstablishmentIdentity(identity, entity)
  if (check.outcome === 'confirmed') return {accepted: true}
  return {accepted: false, code: check.outcome === 'mismatch' ? 'IDENTITY_MISMATCH' : 'AMBIGUOUS_EXTERNAL_IDENTITY', message: check.reason}
}

function candidateEvidenceIsLocal(evidence: CandidateEvidence, sources: readonly SourceProvenance[]): boolean {
  if (evidence.sourceKeys.length === 0) return true
  const sourceByKey = new Map(sources.map((source) => [source.key, source]))
  return evidence.sourceKeys.some((key) => {
    const source = sourceByKey.get(key)
    return !source || sourceIntegrity(source).claimScope !== 'brand'
  })
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
      value, nature: 'factual', sourceStage: 'existing', sourceKeys: [...fact.sources],
    })
  }
}

function addBoolean(evidence: ComparisonEvidence, category: EvidenceCategory, label: string, fact: Fact<boolean>, businessId: string): void {
  if (fact.value !== true || fact.sources.length === 0) return
  evidence[category].push({id: `${businessId}:${category}:business-${evidence[category].length}`, value: label, nature: 'factual', sourceStage: 'existing', sourceKeys: [...fact.sources]})
}

function deduplicateEvidence(evidence: ComparisonEvidence): void {
  for (const category of EVIDENCE_CATEGORIES) {
    const seen = new Map<string, ComparisonEvidence[typeof category][number]>()
    evidence[category] = evidence[category].filter((fact) => {
      const key = JSON.stringify(fact.value).toLocaleLowerCase('es')
      const previous = seen.get(key)
      if (previous) {
        previous.sourceKeys = [...new Set([...previous.sourceKeys, ...fact.sourceKeys])]
        previous.provenance = uniqueProvenance([...(previous.provenance ?? []), ...(fact.provenance ?? [])])
        return false
      }
      seen.set(key, fact)
      return true
    })
  }
}

function ensureUniqueEvidenceIds(evidence: ComparisonEvidence): void {
  const seen = new Map<string, number>()
  for (const category of EVIDENCE_CATEGORIES) for (const fact of evidence[category]) {
    const occurrence = (seen.get(fact.id) ?? 0) + 1
    seen.set(fact.id, occurrence)
    if (occurrence > 1) fact.id = `${fact.id}~${occurrence}`
  }
}

function ensureEvidenceProvenance(evidence: ComparisonEvidence): void {
  for (const category of EVIDENCE_CATEGORIES) for (const fact of evidence[category]) {
    if (fact.provenance?.length) continue
    fact.provenance = fact.sourceKeys.map((sourceKey) => ({
      sourceStage: fact.sourceStage ?? 'existing',
      nature: fact.nature,
      sourceKey,
    }))
  }
}

function uniqueProvenance(items: NonNullable<ComparisonEvidenceFact['provenance']>): NonNullable<ComparisonEvidenceFact['provenance']> {
  return [...new Map(items.map((item) => [
    `${item.sourceStage}|${item.nature}|${item.sourceKey}|${item.observedAt ?? ''}|${item.observer ?? ''}`,
    item,
  ])).values()]
}

function addManualObservationConflicts(
  conflicts: ComparisonSourceConflict[],
  businessId: string,
  evidence: ComparisonEvidence,
): void {
  for (const dimension of EVIDENCE_CATEGORIES) {
    const manual = evidence[dimension].filter((fact) => fact.sourceStage === 'manual-observation')
    const other = evidence[dimension].filter((fact) => fact.sourceStage !== 'manual-observation')
    for (const observed of manual) for (const published of other) {
      if (!textsConflict(evidenceString(observed), evidenceString(published))) continue
      conflicts.push({
        businessId,
        dimension,
        manualSourceKeys: [...observed.sourceKeys],
        conflictingSourceKeys: [...published.sourceKeys],
        resolution: 'Conflicto no resuelto entre una observación manual y una fuente publicada; requiere revisión editorial.',
      })
    }
  }
}

function evidenceString(fact: ComparisonEvidenceFact): string {
  if (fact.excerpt) return fact.excerpt
  if (typeof fact.value === 'string') return fact.value
  if (typeof fact.value === 'boolean') return String(fact.value)
  return 'name' in fact.value ? fact.value.name : fact.value.item
}

function textsConflict(left: string, right: string): boolean {
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  const leftNegated = NEGATED_AVAILABILITY.test(normalizedLeft)
  const rightNegated = NEGATED_AVAILABILITY.test(normalizedRight)
  if (leftNegated === rightNegated) return false
  const terms = (leftNegated ? normalizedRight : normalizedLeft).split(' ').filter((term) => term.length >= 4 && !CONFLICT_STOP_WORDS.has(term))
  return terms.some((term) => (` ${leftNegated ? normalizedLeft : normalizedRight} `).includes(` ${term} `))
}

const NEGATED_AVAILABILITY = /\b(?:no|ya no|deja de|dejado de|retirad[oa]s?|suspendid[oa]s?|no disponible|sin servicio)\b/
const CONFLICT_STOP_WORDS = new Set(['servicio', 'disponible', 'ofrece', 'tiene', 'para', 'segun', 'desde'])

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
  const sourceByKey = new Map(entity.sources.map((source) => [source.key, source]))
  if (official.sources.every((key) => sourceByKey.get(key) && sourceIntegrity(sourceByKey.get(key)!).claimScope === 'brand')) return null
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

function legacyCandidateEvidence(value: string): CandidateEvidence {
  const separator = value.indexOf('=')
  return {
    field: separator >= 0 ? value.slice(0, separator) : 'legacy',
    value: separator >= 0 ? value.slice(separator + 1) : value,
    strength: 'direct',
    sourceStage: 'existing',
    sourceKeys: [],
  }
}

function uniqueCandidateEvidence(evidence: CandidateEvidence[]): CandidateEvidence[] {
  return [...new Map(evidence.map((item) => [
    `${item.field}|${item.strength}|${item.value.toLocaleLowerCase('es')}|${item.matchedTerm ?? ''}`,
    item,
  ])).values()]
}

function researchRejectionReason(status: ComparisonResearchBundle['research']['status'] | undefined): string {
  if (status === 'no-official-website') return 'No existe una web oficial verificable para investigar.'
  if (status === 'no-verifiable-source') return 'Las fuentes disponibles no tienen alcance local verificable.'
  if (status === 'unreachable') return 'La web oficial no fue accesible de forma segura.'
  if (status === 'no-usable-content') return 'La web oficial no devolvió contenido HTML utilizable.'
  if (status === 'no-direct-evidence') return 'La investigación no encontró evidencia temática directa.'
  return 'Enrichment no encontró evidencia temática directa y verificable.'
}
