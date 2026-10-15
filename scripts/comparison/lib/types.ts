import type {ContentDocument} from '../../content-validation'
import type {QualityTier, SourceProvenance} from '../../content/lib/types'

export type ComparisonTopic = string
export type EvidenceNature = 'factual' | 'self_claim' | 'external_observation' | 'first_party_observation'
export type EvidenceSourceStage = 'existing' | 'comparison-research' | 'manual-observation'
export type ComparisonOutcome = 'PASS' | 'WARNING' | 'FAIL'
export type OperationalState = 'open' | 'closed' | 'temporarily_closed' | 'unknown'

export interface EstablishmentIdentity {
  businessId?: string
  name?: string
  address?: string
  latitude?: number
  longitude?: number
  phone?: string
  domain?: string
}

export interface OperationalStatusSignal {
  status: Exclude<OperationalState, 'unknown'>
  observedAt: string
  sourceKeys: string[]
  identity?: EstablishmentIdentity
}

export interface IdentityCheck {
  outcome: 'confirmed' | 'ambiguous' | 'mismatch'
  matched: string[]
  mismatched: string[]
  reason: string
}

export interface OperationalStatusAssessment {
  status: OperationalState
  assessedAt: string
  sourceKeys: string[]
  needsVerification: boolean
  reasons: string[]
  signals: Array<OperationalStatusSignal & {identityCheck: IdentityCheck; accepted: boolean}>
}

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

export type CandidateMatchType = 'direct' | 'potential'
export type CandidateEvidenceStrength = 'direct' | 'supporting'

export interface CandidateEvidence {
  field: string
  value: string
  strength: CandidateEvidenceStrength
  matchedTerm?: string
  excerpt?: string
  sourceStage?: EvidenceSourceStage
  sourceKeys: string[]
}

export interface PotentialCandidateScore {
  supportingSignals: number
  dataQuality: number
  relevantFacts: number
  officialWebsite: number
  provenance: number
  specificity: number
  total: number
}

export interface ComparisonCandidate {
  businessId: string
  qualityTier: QualityTier
  /** Missing only in schemaVersion=1 artifacts, where candidates were all direct. */
  matchType?: CandidateMatchType
  evidence?: CandidateEvidence[]
  potentialScore?: PotentialCandidateScore
  topicEvidence: string[]
  scores: ComparisonScores
}

export interface ExcludedCandidate {
  businessId: string
  reason: 'insufficient' | 'not-relevant' | 'missing-business' | 'missing-identity' | 'outside-limit' | 'outside-potential-limit'
  qualityTier?: QualityTier
  evidence?: CandidateEvidence[]
  potentialScore?: PotentialCandidateScore
  details: string[]
}

export interface ComparisonCandidateArtifact {
  schemaVersion: 1 | 2
  id: string
  topic: string
  searchIntent: string
  slug: string
  generatedAt: string
  candidateCount: number
  summary?: {
    considered: number
    direct: number
    potential: number
    excluded: number
    insufficient: number
  }
  candidates: ComparisonCandidate[]
  excluded: ExcludedCandidate[]
}

export interface ComparisonPrice {
  item: string
  value: number
  currency: 'EUR'
  priceQualifier?: string
  retrievedAt: string
}

export interface ComparisonFeaturedItem {
  name: string
  price?: number | null
  currency?: 'EUR' | null
  priceQualifier?: string | null
  source: string
  retrievedAt: string
}

export type ComparisonEvidenceValue = string | boolean | ComparisonPrice | ComparisonFeaturedItem

export interface ComparisonEvidenceFact {
  id: string
  value: ComparisonEvidenceValue
  nature: EvidenceNature
  sourceStage?: EvidenceSourceStage
  sourceKeys: string[]
  provenance?: ComparisonEvidenceProvenance[]
  excerpt?: string
}

export interface ComparisonEvidenceProvenance {
  sourceStage: EvidenceSourceStage
  nature: EvidenceNature
  sourceKey: string
  sourceType?: 'first-party-observation'
  observer?: string
  observedAt?: string
}

export const EVIDENCE_CATEGORIES = [
  'cuisine', 'specialties', 'featuredItems', 'prices', 'services', 'location', 'practical', 'limitations',
  'distinctiveFeatures',
] as const
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number]
export type ComparisonEvidence = Record<EvidenceCategory, ComparisonEvidenceFact[]>

export interface EnrichedComparisonBusiness {
  businessId: string
  name: string
  qualityTier: Exclude<QualityTier, 'insufficient'>
  origin?: CandidateMatchType
  enrichmentOutcome?: 'confirmed'
  confirmationEvidence?: CandidateEvidence[]
  topicEvidence: string[]
  scores: ComparisonScores
  evidence: ComparisonEvidence
  sources: SourceProvenance[]
  operationalStatus?: OperationalStatusAssessment
}

export interface ComparisonInvestigation {
  businessId: string
  name: string
  origin: CandidateMatchType
  outcome: 'confirmed' | 'rejected'
  qualityTier: QualityTier
  evidence: CandidateEvidence[]
  reasons: string[]
  research?: ComparisonResearch
}

export type ComparisonResearchStatus =
  | 'not-required'
  | 'no-official-website'
  | 'no-verifiable-source'
  | 'unreachable'
  | 'no-usable-content'
  | 'no-direct-evidence'
  | 'no-new-evidence'
  | 'confirmed'

export interface ComparisonResearch {
  status: ComparisonResearchStatus
  website: string | null
  pagesVisited: string[]
  urlsAttempted?: string[]
  urlsDiscarded?: Array<{url: string; reason: string}>
  sources: SourceProvenance[]
  newEvidence: CandidateEvidence[]
  extraction?: {
    byFormat: Record<'html' | 'json-ld' | 'embedded-json' | 'pdf', number>
    byDimension: {products: number; services: number; specialties: number; prices: number; openingHours: number}
    discarded: Array<{sourceKey: string; reason: string}>
  }
  plan?: {
    coveredBefore: EvidenceCategory[]
    missingBefore: EvidenceCategory[]
    plannedDimensions?: EvidenceCategory[]
    attemptedDimensions: EvidenceCategory[]
    coveredAfter: EvidenceCategory[]
    missingAfter: EvidenceCategory[]
    hints: string[]
    justification: string
  }
  metrics?: {
    requests: number
    pages: number
    durationMs: number
    cacheHit: boolean
    crawlerCacheHits: number
    documents: number
    documentPages: number
    documentBytes: number
  }
  limitation?: 'none' | 'missing-source' | 'source-scope' | 'network' | 'non-html' | 'extractor-no-match'
  error?: string
}

export interface ComparisonSourceConflict {
  businessId: string
  dimension: EvidenceCategory
  preferredSourceKeys?: string[]
  manualSourceKeys?: string[]
  conflictingSourceKeys: string[]
  resolution: string
}

export interface EnrichedComparisonArtifact {
  schemaVersion: 1 | 2
  id: string
  topic: string
  searchIntent: string
  slug: string
  enrichedAt: string
  businesses: EnrichedComparisonBusiness[]
  investigations?: ComparisonInvestigation[]
  sources: SourceProvenance[]
  sourceConflicts: ComparisonSourceConflict[]
  integrityIssues?: ComparisonIntegrityIssue[]
}

export interface ComparisonIntegrityIssue {
  businessId: string
  code: 'BRAND_SCOPE_NOT_LOCAL' | 'AMBIGUOUS_EXTERNAL_IDENTITY' | 'IDENTITY_MISMATCH' | 'OPERATIONAL_STATUS_REVIEW'
  sourceKeys: string[]
  message: string
}

export interface ComparisonEntryEditorial {
  businessId: string
  verdict: string
  strengths: string[]
  limitations: string[]
  bestFor: string[]
  featuredItem: ComparisonFeaturedItem | null
  practicalNotes: string[]
}

export interface ComparisonChoiceGuideItem {
  businessId: string
  label: string
  reason: string
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
  choiceGuide: ComparisonChoiceGuideItem[]
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
  searchIntent: string
  indexability: 'index' | 'noindex'
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
  searchIntentSatisfied: boolean
  contentValueSatisfied: boolean
  indexability: 'index' | 'noindex'
  coverage: ComparisonCoverageReport
  issues: ComparisonQAIssue[]
  claimsGenerated: number
  claimsRejected: number
}

export interface ComparisonCoverageReport {
  perBusiness: Array<{businessId: string; coveredDimensions: EvidenceCategory[]; counts: Record<EvidenceCategory, number>}>
  perDimension: Record<EvidenceCategory, {businessesCovered: number; factCount: number}>
}
