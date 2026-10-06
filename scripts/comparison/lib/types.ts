import type {ContentDocument} from '../../content-validation'
import type {QualityTier, SourceProvenance} from '../../content/lib/types'

export type ComparisonTopic = string
export type EvidenceNature = 'factual' | 'self_claim' | 'external_observation'
export type ComparisonOutcome = 'PASS' | 'WARNING' | 'FAIL'

export interface ComparisonOptions {
  topic?: string
  id?: string
  limit?: number
  force: boolean
  dryRun: boolean
}

export interface ComparisonScores {
  topicRelevance: number
  specificity: number
  comparisonCoverage: number
  distinctiveValue: number
  practicalUsefulness: number
  total: number
}

export interface ComparisonCandidate {
  businessId: string
  qualityTier: Exclude<QualityTier, 'insufficient'>
  topicEvidence: string[]
  scores: ComparisonScores
}

export interface ExcludedCandidate {
  businessId: string
  reason: 'insufficient' | 'not-relevant' | 'missing-business' | 'outside-limit'
  details: string[]
}

export interface ComparisonCandidateArtifact {
  schemaVersion: 1
  id: string
  topic: string
  slug: string
  generatedAt: string
  candidateCount: number
  candidates: ComparisonCandidate[]
  excluded: ExcludedCandidate[]
}

export interface ComparisonPrice {
  item: string
  value: number
  currency: 'EUR'
  retrievedAt: string
}

export type ComparisonEvidenceValue = string | boolean | ComparisonPrice

export interface ComparisonEvidenceFact {
  id: string
  value: ComparisonEvidenceValue
  nature: EvidenceNature
  sourceKeys: string[]
}

export const EVIDENCE_CATEGORIES = [
  'cuisine', 'specialties', 'featuredItems', 'prices', 'services', 'location', 'practical', 'limitations',
] as const
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number]
export type ComparisonEvidence = Record<EvidenceCategory, ComparisonEvidenceFact[]>

export interface EnrichedComparisonBusiness {
  businessId: string
  name: string
  qualityTier: Exclude<QualityTier, 'insufficient'>
  topicEvidence: string[]
  scores: ComparisonScores
  evidence: ComparisonEvidence
  sources: SourceProvenance[]
}

export interface EnrichedComparisonArtifact {
  schemaVersion: 1
  id: string
  topic: string
  slug: string
  enrichedAt: string
  businesses: EnrichedComparisonBusiness[]
  sources: SourceProvenance[]
}

export interface ComparisonEntryEditorial {
  businessId: string
  rank: number
  verdict: string
  strengths: string[]
  weaknesses: string[]
  bestFor: string[]
  featuredItem: string | null
  featuredPrice: string | null
  practicalNotes: string[]
}

export interface ComparisonClaim {
  path: string
  claim: string
  supportedBy: string[]
}

export interface GeneratedComparisonEditorial {
  title: string
  intro: string
  quickVerdict: string
  entries: ComparisonEntryEditorial[]
  methodology: string
  criteria: string[]
  seo: {metaTitle: string; metaDescription: string}
  claims: ComparisonClaim[]
}

export interface GeneratedComparisonArtifact {
  schemaVersion: 1
  id: string
  topic: string
  generatedAt: string
  editorial: GeneratedComparisonEditorial
  document: ContentDocument
}

export interface ComparisonQAIssue {
  severity: 'WARNING' | 'FAIL'
  code: string
  path: string
  message: string
}

export interface ComparisonQAResult {
  id: string
  topic: string
  outcome: ComparisonOutcome
  issues: ComparisonQAIssue[]
  claimsGenerated: number
  claimsRejected: number
}
