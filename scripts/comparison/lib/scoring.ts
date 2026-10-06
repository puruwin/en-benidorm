import {normalizeText} from '../../content/lib/normalize'
import type {EnrichedEntity} from '../../content/lib/types'
import type {ComparisonEvidence, ComparisonScores} from './types'

const TOPIC_ALIASES: Record<string, string[]> = {
  italiano: ['italiana', 'italiano', 'italian'],
  sushi: ['sushi', 'japonesa', 'japanese'],
  arroces: ['arroz', 'arroces', 'paella', 'paellas'],
}

export function topicEvidence(entity: EnrichedEntity, topic: string): string[] {
  const aliases = TOPIC_ALIASES[topic] ?? [topic]
  const evidence: string[] = []
  for (const field of ['cuisine', 'specialties'] as const) {
    if (entity.facts[field].sources.length === 0) continue
    const values = entity.facts[field].value ?? []
    for (const value of values) if (matches(value, aliases)) evidence.push(`${field}=${value}`)
  }
  const concept = entity.facts.concept.value
  if (concept && entity.facts.concept.sources.length > 0 && matches(concept, aliases)) evidence.push(`concept=${concept.slice(0, 120)}`)
  return [...new Set(evidence)]
}

export function scoreBusiness(entity: EnrichedEntity, topic: string, evidence?: ComparisonEvidence): ComparisonScores {
  const relevant = topicEvidence(entity, topic)
  const exactCuisine = relevant.some((item) => item.startsWith('cuisine='))
  const topicRelevance = exactCuisine ? 5 : relevant.some((item) => item.startsWith('concept=')) ? 4 : relevant.length ? 3 : 0
  const facts = entity.facts
  const sourced = (field: keyof typeof facts) => facts[field].value !== null && facts[field].sources.length > 0
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

function withTotal(scores: Omit<ComparisonScores, 'total'>): ComparisonScores {
  return {...scores, total: Object.values(scores).reduce((sum, value) => sum + value, 0)}
}

function matches(value: string, aliases: string[]): boolean {
  const normalized = normalizeText(value)
  return aliases.some((alias) => normalized.includes(normalizeText(alias)))
}
