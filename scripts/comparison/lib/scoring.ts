import {normalizeText} from '../../content/lib/normalize'
import type {EnrichedEntity, Fact, QualityTier} from '../../content/lib/types'
import {topicConfig} from './topic-config'
import type {
  CandidateEvidence, ComparisonEvidence, ComparisonEvidenceValue, ComparisonScores,
  PotentialCandidateScore,
} from './types'

const DIRECT_FACT_FIELDS = ['cuisine', 'specialties', 'concept', 'services', 'distinctiveFeatures'] as const
const SUPPORTING_FACT_FIELDS = DIRECT_FACT_FIELDS
const DIRECT_EVIDENCE_CATEGORIES = ['cuisine', 'specialties', 'featuredItems', 'services'] as const

export interface TopicMatch {
  matchType: 'direct' | 'potential' | 'excluded'
  evidence: CandidateEvidence[]
}

/** Kept for QA and callers that used the legacy alias API. */
export function topicAliases(topic: string): string[] {
  return [...topicConfig(topic).directEvidence]
}

export function normalizedPhraseMatch(value: string, term: string): boolean {
  const normalizedValue = normalizeText(value)
  const normalizedTerm = normalizeText(term)
  if (!normalizedValue || !normalizedTerm) return false
  return ` ${normalizedValue} `.includes(` ${normalizedTerm} `)
}

export function matchingTopicTerms(value: string, terms: readonly string[]): string[] {
  const matches = terms.filter((term) => normalizedPhraseMatch(value, term))
  return matches.filter((term) => !matches.some((candidate) => candidate !== term
    && normalizeText(candidate).length > normalizeText(term).length
    && normalizedPhraseMatch(candidate, term)))
}

export function classifyTopicMatch(entity: EnrichedEntity, topic: string): TopicMatch {
  const config = topicConfig(topic)
  const direct: CandidateEvidence[] = []
  const supporting: CandidateEvidence[] = []

  for (const field of DIRECT_FACT_FIELDS) {
    const fact = entity.facts[field]
    for (const value of factStrings(fact)) {
      for (const term of matchingTerms(value, config.directEvidence)) {
        direct.push(candidateEvidence(field, value, 'direct', term, fact.sources, 'existing'))
      }
    }
  }
  if (direct.length) return {matchType: 'direct', evidence: deduplicateCandidateEvidence(direct)}

  for (const field of SUPPORTING_FACT_FIELDS) {
    const fact = entity.facts[field]
    for (const value of factStrings(fact)) {
      for (const term of matchingTerms(value, config.supportingEvidence)) {
        supporting.push(candidateEvidence(field, value, 'supporting', term, fact.sources, 'existing'))
      }
    }
  }

  // A commercial name can nominate a business for research, but never prove the topic.
  for (const value of factStrings(entity.facts.name)) {
    for (const term of matchingTerms(value, [...config.directEvidence, ...config.supportingEvidence])) {
      supporting.push(candidateEvidence('name', value, 'supporting', term, entity.facts.name.sources, 'existing'))
    }
  }

  const businessKind = entity.facts.businessKind
  if (businessKind.value && businessKind.sources.length > 0 && config.compatibleBusinessKinds.includes(businessKind.value)) {
    supporting.push(candidateEvidence('businessKind', businessKind.value, 'supporting', businessKind.value, businessKind.sources, 'existing'))
  }

  const evidence = deduplicateCandidateEvidence(supporting)
  return {matchType: evidence.length ? 'potential' : 'excluded', evidence}
}

export function directEvidenceFromComparisonEvidence(evidence: ComparisonEvidence, topic: string): CandidateEvidence[] {
  const terms = topicConfig(topic).directEvidence
  const matches: CandidateEvidence[] = []
  for (const field of DIRECT_EVIDENCE_CATEGORIES) {
    for (const fact of evidence[field]) {
      const value = evidenceText(fact.value)
      if (!value) continue
      for (const term of matchingTerms(value, terms)) {
        matches.push(candidateEvidence(field, value, 'direct', term, fact.sourceKeys, fact.sourceStage ?? 'existing'))
      }
    }
  }
  return deduplicateCandidateEvidence(matches)
}

export function topicEvidence(entity: EnrichedEntity, topic: string): string[] {
  return classifyTopicMatch(entity, topic).evidence
    .filter((item) => item.strength === 'direct')
    .map(legacyEvidenceLabel)
}

export function potentialCandidateScore(
  entity: EnrichedEntity,
  qualityTier: QualityTier,
  evidence: readonly CandidateEvidence[],
): PotentialCandidateScore {
  const supportingSignals = Math.min(12, evidence.length * 3)
  const dataQuality = qualityTier === 'rich' ? 3 : qualityTier === 'basic' ? 2 : 0
  const relevantFacts = Math.min(3, DIRECT_FACT_FIELDS.filter((field) => factStrings(entity.facts[field]).length > 0).length)
  const officialWebsite = entity.facts.website.value && entity.facts.website.sources.length > 0 ? 2 : 0
  const provenance = Math.min(2, new Set(evidence.flatMap((item) => item.sourceKeys)).size)
  const specificity = Math.min(3,
    (factStrings(entity.facts.specialties).length ? 1 : 0)
    + (factStrings(entity.facts.concept).length ? 1 : 0)
    + (factStrings(entity.facts.distinctiveFeatures).length ? 1 : 0),
  )
  return withPotentialTotal({supportingSignals, dataQuality, relevantFacts, officialWebsite, provenance, specificity})
}

export function scoreBusiness(entity: EnrichedEntity, topic: string, evidence?: ComparisonEvidence): ComparisonScores {
  const relevant = topicEvidence(entity, topic)
  const enrichedRelevant = evidence ? directEvidenceFromComparisonEvidence(evidence, topic) : []
  const exactCuisine = relevant.some((item) => item.startsWith('cuisine=')) || enrichedRelevant.some((item) => item.field === 'cuisine')
  const topicRelevance = exactCuisine ? 5
    : relevant.some((item) => item.startsWith('concept=')) ? 4
      : relevant.length || enrichedRelevant.length ? 3 : 0
  const facts = entity.facts
  const sourced = (field: keyof typeof facts) => Boolean(facts[field]?.value !== null && facts[field]?.sources.length)
  const specificity = Math.min(5,
    (sourced('concept') ? 1 : 0) + (sourced('specialties') ? 2 : 0) + Math.min(2, facts.cuisine.value?.length ?? 0)
    + Math.min(2, evidence?.featuredItems.length ?? 0),
  )
  const coverageGroups = [
    sourced('cuisine') || sourced('specialties'),
    sourced('services') || sourced('takeaway') || sourced('delivery') || sourced('terrace'),
    sourced('locationContext'),
    sourced('openingInformation') || sourced('openingHoursRaw') || sourced('bookingAvailability'),
    Boolean(evidence?.prices.length),
  ]
  const comparisonCoverage = coverageGroups.filter(Boolean).length
  const distinctiveValue = Math.min(5,
    (facts.specialties.value?.length ?? 0) + (facts.distinctiveFeatures.value?.length ?? 0)
    + (sourced('takeaway') ? 1 : 0) + (sourced('delivery') ? 1 : 0) + Math.min(2, evidence?.featuredItems.length ?? 0),
  )
  const practicalUsefulness = Math.min(5,
    (sourced('phone') ? 1 : 0) + (sourced('website') ? 1 : 0)
    + (sourced('address') || sourced('location') ? 1 : 0)
    + (sourced('openingInformation') || sourced('openingHoursRaw') ? 1 : 0)
    + (sourced('bookingAvailability') ? 1 : 0) + (evidence?.prices.length ? 1 : 0),
  )
  return withTotal({topicRelevance, specificity, comparisonCoverage, distinctiveValue, practicalUsefulness})
}

export function compareScores(a: {businessId: string; scores: ComparisonScores}, b: {businessId: string; scores: ComparisonScores}): number {
  return b.scores.total - a.scores.total
    || b.scores.topicRelevance - a.scores.topicRelevance
    || b.scores.comparisonCoverage - a.scores.comparisonCoverage
    || a.businessId.localeCompare(b.businessId)
}

export function comparePotentialCandidates(
  a: {businessId: string; potentialScore?: PotentialCandidateScore; scores: ComparisonScores},
  b: {businessId: string; potentialScore?: PotentialCandidateScore; scores: ComparisonScores},
): number {
  return (b.potentialScore?.total ?? 0) - (a.potentialScore?.total ?? 0)
    || b.scores.specificity - a.scores.specificity
    || b.scores.practicalUsefulness - a.scores.practicalUsefulness
    || a.businessId.localeCompare(b.businessId)
}

export function legacyEvidenceLabel(item: CandidateEvidence): string {
  const value = item.field === 'concept' && item.value.length > 120 ? item.value.slice(0, 120) : item.value
  return `${item.field}=${value}`
}

function factStrings(fact: Fact<unknown>): string[] {
  if (!fact || fact.sources.length === 0 || fact.value === null) return []
  return (Array.isArray(fact.value) ? fact.value : [fact.value]).filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
}

function matchingTerms(value: string, terms: readonly string[]): string[] {
  const matches = matchingTopicTerms(value, terms)
  if (matches.length < 2) return matches
  return [matches.sort((a, b) => normalizeText(b).length - normalizeText(a).length)[0]!]
}

function candidateEvidence(
  field: string,
  value: string,
  strength: CandidateEvidence['strength'],
  matchedTerm: string,
  sourceKeys: readonly string[],
  sourceStage: NonNullable<CandidateEvidence['sourceStage']>,
): CandidateEvidence {
  return {field, value, strength, matchedTerm, sourceStage, sourceKeys: [...sourceKeys]}
}

function deduplicateCandidateEvidence(evidence: CandidateEvidence[]): CandidateEvidence[] {
  const seen = new Set<string>()
  return evidence.filter((item) => {
    const key = `${item.field}|${normalizeText(item.value)}|${normalizeText(item.matchedTerm ?? '')}|${item.strength}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function evidenceText(value: ComparisonEvidenceValue): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return null
  return 'name' in value ? value.name : value.item
}

function withTotal(scores: Omit<ComparisonScores, 'total'>): ComparisonScores {
  return {...scores, total: Object.values(scores).reduce((sum, value) => sum + value, 0)}
}

function withPotentialTotal(scores: Omit<PotentialCandidateScore, 'total'>): PotentialCandidateScore {
  return {...scores, total: Object.values(scores).reduce((sum, value) => sum + value, 0)}
}
