import type {DiscoveryCategory, SourceProvenance} from '../../content/lib/types'

export const OPPORTUNITY_SIGNAL_TYPES = [
  'no_official_website_found', 'official_website_found', 'website_source_ambiguous', 'brand_website_only',
  'services_visible_online', 'commercial_items_visible_online', 'prices_visible_online', 'opening_hours_visible_online',
  'limited_structured_information', 'identity_conflict', 'probable_duplicate', 'operational_status_unknown',
  'operational_status_conflict', 'phone_available', 'email_available', 'contact_form_available',
  'booking_channel_available', 'booking_process_visible', 'quote_request_process_visible', 'manual_contact_only_visible',
] as const

export type OpportunitySignalType = (typeof OPPORTUNITY_SIGNAL_TYPES)[number]
export type EvidenceStrength = 'weak' | 'moderate' | 'strong'
export type OpportunityArea = 'web-presence' | 'local-seo' | 'content' | 'conversion' | 'booking' | 'automation' | 'unknown'
export type OpportunityStatus = 'not-analyzed' | 'analyzed' | 'needs-review' | 'not-actionable'

export interface OpportunitySignal {
  id: string
  type: OpportunitySignalType
  observation: string
  sourceKeys: string[]
  observedAt: string
  confidence: EvidenceStrength
}

export interface CommercialHypothesis {
  id: string
  area: OpportunityArea
  hypothesis: string
  basedOnSignalIds: string[]
  confidence: EvidenceStrength
  limitations: string[]
}

export interface SuggestedAction {
  type: 'manual-review' | 'visit-website' | 'verify-google-profile' | 'verify-contact-channel' | 'prepare-audit' | 'do-not-contact'
  reason: string
}

export interface OpportunityAnalysis {
  schemaVersion: 1
  businessId: string
  businessName: string
  category: DiscoveryCategory
  generatedAt: string
  status: OpportunityStatus
  signals: OpportunitySignal[]
  hypotheses: CommercialHypothesis[]
  suggestedActions: SuggestedAction[]
  summary: {
    evidenceStrength: EvidenceStrength
    opportunityAreas: OpportunityArea[]
    manualReviewRequired: boolean
  }
  provenance: {
    sources: SourceProvenance[]
    coveredSignals: number
    totalSignals: number
    coverage: number
  }
  inputFingerprint: string
}

export interface OpportunityReport {
  schemaVersion: 1
  generatedAt: string
  selection: {
    method: 'deterministic-category-round-robin'
    filters: {businessId?: string; area?: string; categories: DiscoveryCategory[]; limit?: number}
    description: string
    businessIds: string[]
  }
  businessesAnalyzed: number
  reusedUnchanged: number
  actionableHypotheses: number
  needsReview: number
  notActionable: number
  signalCounts: Partial<Record<OpportunitySignalType, number>>
  opportunityAreaCounts: Partial<Record<OpportunityArea, number>>
  businessesWithoutOfficialWebsite: string[]
  businessesWithIdentityOrStatusConflicts: string[]
  provenanceCoverage: {signals: number; coveredSignals: number; ratio: number}
  analyses: Array<Pick<OpportunityAnalysis, 'businessId' | 'businessName' | 'category' | 'status' | 'signals' | 'hypotheses' | 'suggestedActions' | 'summary'>>
}

