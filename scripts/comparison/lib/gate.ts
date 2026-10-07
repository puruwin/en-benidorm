import {normalizeText} from '../../content/lib/normalize'
import {EVIDENCE_CATEGORIES, type ComparisonCoverageReport, type ComparisonEvidenceValue, type EnrichedComparisonArtifact} from './types'

const COMPARATIVE_DIMENSIONS = ['specialties', 'featuredItems', 'prices', 'services', 'location', 'practical', 'limitations'] as const

export interface ComparisonDataGateResult {
  pass: boolean
  coverage: ComparisonCoverageReport
  differentiatedDimensions: string[]
  issues: Array<{code: 'MINIMUM_BUSINESSES' | 'LOW_COMPARATIVE_VALUE' | 'INSUFFICIENT_EVIDENCE_COVERAGE'; message: string}>
}

export function evaluateComparisonDataGate(enriched: EnrichedComparisonArtifact): ComparisonDataGateResult {
  const coverage = comparisonCoverage(enriched)
  const differentiatedDimensions = COMPARATIVE_DIMENSIONS.filter((dimension) => {
    const businesses = enriched.businesses.filter((business) => business.evidence[dimension].length > 0)
    const values = new Set(businesses.flatMap((business) => business.evidence[dimension].map((fact) => normalizedValue(fact.value))))
    return businesses.length >= 2 && values.size >= 2
  })
  const issues: ComparisonDataGateResult['issues'] = []

  if (enriched.businesses.length < 4) {
    issues.push({code: 'MINIMUM_BUSINESSES', message: `Hay ${enriched.businesses.length} Business relevante(s); se requieren al menos 4.`})
  }
  const underCovered = coverage.perBusiness.filter((business) => business.coveredDimensions.length < 3).map((business) => business.businessId)
  const globallyCovered = Object.values(coverage.perDimension).filter((dimension) => dimension.businessesCovered > 0).length
  const businessesWithComparativeEvidence = enriched.businesses.filter((business) =>
    COMPARATIVE_DIMENSIONS.some((dimension) => business.evidence[dimension].length > 0)).length
  if (underCovered.length || globallyCovered < 4 || businessesWithComparativeEvidence < 3) {
    issues.push({
      code: 'INSUFFICIENT_EVIDENCE_COVERAGE',
      message: underCovered.length
        ? `Menos de 3 dimensiones útiles en: ${underCovered.join(', ')}.`
        : globallyCovered < 4
          ? `Sólo hay ${globallyCovered} dimensiones con cobertura global; se requieren al menos 4.`
          : `Sólo ${businessesWithComparativeEvidence} Business aportan evidence comparativa; se requieren al menos 3.`,
    })
  }
  if (differentiatedDimensions.length < 3) {
    issues.push({
      code: 'LOW_COMPARATIVE_VALUE',
      message: `Sólo ${differentiatedDimensions.length} dimensiones permiten contrastar al menos dos Businesses; se requieren 3.`,
    })
  }

  return {pass: issues.length === 0, coverage, differentiatedDimensions, issues}
}

export function comparisonCoverage(enriched: EnrichedComparisonArtifact): ComparisonCoverageReport {
  return {
    perBusiness: enriched.businesses.map((business) => {
      const counts = Object.fromEntries(EVIDENCE_CATEGORIES.map((dimension) => [dimension, business.evidence[dimension].length])) as Record<(typeof EVIDENCE_CATEGORIES)[number], number>
      return {businessId: business.businessId, coveredDimensions: EVIDENCE_CATEGORIES.filter((dimension) => counts[dimension] > 0), counts}
    }),
    perDimension: Object.fromEntries(EVIDENCE_CATEGORIES.map((dimension) => [dimension, {
      businessesCovered: enriched.businesses.filter((business) => business.evidence[dimension].length > 0).length,
      factCount: enriched.businesses.reduce((sum, business) => sum + business.evidence[dimension].length, 0),
    }])) as ComparisonCoverageReport['perDimension'],
  }
}

function normalizedValue(value: ComparisonEvidenceValue): string {
  if (typeof value !== 'object') return normalizeText(String(value))
  if ('name' in value) return normalizeText(value.name)
  return normalizeText(`${value.item} ${value.value} ${value.currency} ${value.priceQualifier ?? ''}`)
}
