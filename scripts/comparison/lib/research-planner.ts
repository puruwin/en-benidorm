import {sourceIntegrity} from '../../content/lib/source-integrity'
import type {EnrichedEntity, SourceClass} from '../../content/lib/types'
import type {ComparisonTopicConfig} from './topic-config'
import {EVIDENCE_CATEGORIES, type ComparisonEvidence, type EvidenceCategory} from './types'

export interface ResearchSourcePolicy {
  allowedClasses: readonly SourceClass[]
  requireEstablishmentScope: boolean
}

export interface ResearchCoverageSnapshot {
  counts: Record<EvidenceCategory, number>
  coveredDimensions: EvidenceCategory[]
  missingDimensions: EvidenceCategory[]
}

export interface ResearchSourceCandidate {
  url: string
  sourceKeys: string[]
  sourceClass: SourceClass
  claimScope: 'establishment' | 'brand' | 'unknown'
  usable: boolean
  reason: string
}

export interface ResearchPlanAction {
  dimension: EvidenceCategory
  priority: number
  hints: string[]
  reason: string
}

export interface BusinessResearchPlan {
  businessId: string
  topic: string | null
  coverage: ResearchCoverageSnapshot
  priorityDimensions: EvidenceCategory[]
  actions: ResearchPlanAction[]
  sources: ResearchSourceCandidate[]
  hints: string[]
  shouldResearch: boolean
  coverageSufficient: boolean
  reason: string
}

export interface ResearchPlanInput {
  entity: EnrichedEntity
  config?: ComparisonTopicConfig
  evidence?: Partial<ComparisonEvidence>
  requiredDimensions: readonly EvidenceCategory[]
  sourcePolicy?: ResearchSourcePolicy
  minimumCoveredDimensions?: number
  forceResearch?: boolean
}

export const DEFAULT_RESEARCH_SOURCE_POLICY: ResearchSourcePolicy = {
  allowedClasses: ['official-location'],
  requireEstablishmentScope: true,
}

/** Pure planner: it decides what is worth researching, never extracts or creates facts. */
export function planBusinessResearch(input: ResearchPlanInput): BusinessResearchPlan {
  const policy = input.sourcePolicy ?? DEFAULT_RESEARCH_SOURCE_POLICY
  const relevant = [...new Set(input.requiredDimensions)]
    .filter((dimension) => EVIDENCE_CATEGORIES.includes(dimension))
    .filter((dimension) => !input.config || input.config.researchDimensions.includes(dimension))
  const coverage = coverageSnapshot(input.entity, input.evidence, relevant)
  const actions = coverage.missingDimensions.map((dimension, index) => ({
    dimension,
    priority: index + 1,
    hints: hintsForDimension(dimension, input.config),
    reason: `La dimensión ${dimension} es pertinente para este plan y no tiene evidence local utilizable.`,
  }))
  if (input.forceResearch && actions.length === 0 && input.config) actions.push({
    dimension: input.config.researchEvidenceCategory,
    priority: 1,
    hints: hintsForDimension(input.config.researchEvidenceCategory, input.config),
    reason: 'El candidato necesita confirmación temática aunque su cobertura general sea suficiente.',
  })
  const sources = researchSources(input.entity, policy)
  const usableSources = sources.filter((source) => source.usable)
  const minimum = Math.min(input.minimumCoveredDimensions ?? relevant.length, relevant.length)
  const incomplete = coverage.coveredDimensions.length < minimum
  const shouldResearch = Boolean(actions.length && usableSources.length && (incomplete || input.forceResearch))
  const reason = !actions.length
    ? 'Todas las dimensiones pertinentes para este plan ya están cubiertas.'
    : !usableSources.length
      ? 'No hay una fuente oficial del establecimiento que cumpla la política de alcance.'
      : !incomplete && !input.forceResearch
        ? `La cobertura ya alcanza el mínimo de ${minimum} dimensiones.`
        : `Faltan ${coverage.missingDimensions.length} dimensiones pertinentes y hay una fuente local verificable.`
  return {
    businessId: input.entity.id,
    topic: input.config?.topic ?? null,
    coverage,
    priorityDimensions: actions.map((action) => action.dimension),
    actions,
    sources,
    hints: [...new Set(actions.flatMap((action) => action.hints))],
    shouldResearch,
    coverageSufficient: !incomplete,
    reason,
  }
}

export function coverageAfterResearch(plan: BusinessResearchPlan, evidence: Partial<ComparisonEvidence>): ResearchCoverageSnapshot {
  const counts = {...plan.coverage.counts}
  for (const dimension of EVIDENCE_CATEGORIES) counts[dimension] += evidence[dimension]?.length ?? 0
  const considered = [...new Set([...plan.coverage.coveredDimensions, ...plan.coverage.missingDimensions])]
  return {
    counts,
    coveredDimensions: considered.filter((dimension) => counts[dimension] > 0),
    missingDimensions: considered.filter((dimension) => counts[dimension] === 0),
  }
}

function coverageSnapshot(entity: EnrichedEntity, evidence: Partial<ComparisonEvidence> | undefined, required: EvidenceCategory[]): ResearchCoverageSnapshot {
  const counts = Object.fromEntries(EVIDENCE_CATEGORIES.map((dimension) => [dimension, evidence?.[dimension]?.length ?? 0])) as Record<EvidenceCategory, number>
  const sourceByKey = new Map(entity.sources.map((source) => [source.key, source]))
  counts.cuisine += localFactCount(entity.facts.cuisine, sourceByKey)
  counts.specialties += localFactCount(entity.facts.specialties, sourceByKey)
  counts.services += localFactCount(entity.facts.services, sourceByKey) + localFactCount(entity.facts.accessibility, sourceByKey)
    + localTrueCount(sourceByKey, entity.facts.bookingAvailability, entity.facts.takeaway, entity.facts.delivery, entity.facts.terrace)
  counts.location += localFactCount(entity.facts.locationContext, sourceByKey) + localFactCount(entity.facts.distinctiveFeatures, sourceByKey)
  counts.practical += localFactCount(entity.facts.openingInformation, sourceByKey) || localFactCount(entity.facts.openingHoursRaw, sourceByKey)
  for (const item of entity.facts.commercialItems?.value ?? []) {
    if (!hasLocalSource([item.sourceKey], sourceByKey)) continue
    if (item.kind === 'service') counts.services += 1
    else if (item.kind === 'specialty') counts.specialties += 1
    else counts.featuredItems += 1
  }
  return {
    counts,
    coveredDimensions: required.filter((dimension) => counts[dimension] > 0),
    missingDimensions: required.filter((dimension) => counts[dimension] === 0),
  }
}

function researchSources(entity: EnrichedEntity, policy: ResearchSourcePolicy): ResearchSourceCandidate[] {
  const website = entity.facts.website.value
  if (!website || entity.facts.website.sources.length === 0) return []
  const host = safeHost(website)
  const related = entity.sources.filter((source) => source.url && safeHost(source.url) === host)
  const explicit = related.find((source) => sourceIntegrity(source).sourceClass === 'official-brand')
    ?? related.find((source) => sourceIntegrity(source).sourceClass === 'official-location')
  const integrity = explicit ? sourceIntegrity(explicit) : {sourceClass: 'official-location' as const, claimScope: 'establishment' as const}
  const classAllowed = policy.allowedClasses.includes(integrity.sourceClass)
  const scopeAllowed = !policy.requireEstablishmentScope || integrity.claimScope === 'establishment'
  return [{
    url: website,
    sourceKeys: related.map((source) => source.key),
    sourceClass: integrity.sourceClass,
    claimScope: integrity.claimScope,
    usable: classAllowed && scopeAllowed,
    reason: !classAllowed
      ? `sourceClass=${integrity.sourceClass} no está permitida para investigación local.`
      : !scopeAllowed
        ? `claimScope=${integrity.claimScope} no confirma el establecimiento.`
        : 'Fuente oficial del establecimiento priorizada.',
  }]
}

function hintsForDimension(dimension: EvidenceCategory, config?: ComparisonTopicConfig): string[] {
  return [...new Set([...(config?.researchHintsByDimension[dimension] ?? []), ...(config?.researchHints ?? [])])]
}
function localFactCount(
  fact: {value: unknown; sources: string[]},
  sourceByKey: ReadonlyMap<string, EnrichedEntity['sources'][number]>,
): number {
  if (fact.value === null || !hasLocalSource(fact.sources, sourceByKey)) return 0
  return Array.isArray(fact.value) ? fact.value.length : 1
}
function localTrueCount(
  sourceByKey: ReadonlyMap<string, EnrichedEntity['sources'][number]>,
  ...facts: Array<{value: boolean | null; sources: string[]}>
): number {
  return facts.filter((fact) => fact.value === true && hasLocalSource(fact.sources, sourceByKey)).length
}
function hasLocalSource(
  sourceKeys: readonly string[],
  sourceByKey: ReadonlyMap<string, EnrichedEntity['sources'][number]>,
): boolean {
  return sourceKeys.some((key) => {
    const source = sourceByKey.get(key)
    return !source || sourceIntegrity(source).claimScope !== 'brand'
  })
}
function safeHost(value: string): string | null { try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase() } catch { return null } }
