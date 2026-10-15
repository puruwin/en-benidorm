import type {CommercialItem, SourceProvenance} from '../../content/lib/types'

export type VerificationSignalType =
  | 'official_site_active' | 'official_location_page_active' | 'recent_first_party_content'
  | 'explicit_open_status' | 'explicit_closed_status' | 'stale_official_presence'
  | 'third_party_open_signal' | 'third_party_closed_signal'
  | 'name_match' | 'address_match' | 'coordinates_match' | 'phone_match' | 'domain_match' | 'identity_mismatch'
  | 'website_reachable' | 'website_unreachable' | 'valid_tls' | 'mobile_viewport_present'
  | 'contact_page_present' | 'booking_page_present' | 'structured_data_present' | 'sitemap_present' | 'recent_content_detected'

export interface VerificationSignal {
  id: string
  type: VerificationSignalType
  observation: string
  sourceKeys: string[]
  observedAt: string
  evidenceRole: 'primary' | 'supporting'
  url?: string
}

export interface PresenceValue {
  value: string
  sourceKeys: string[]
  observedAt: string
  scope: 'location' | 'brand' | 'unknown'
}

export interface VerificationArtifact {
  schemaVersion: 1
  businessId: string
  generatedAt: string
  fingerprint: string
  expiresAt: {websiteReachability: string; operationalEvidence: string; identity: string; contactChannels: string}
  identityEvidence: {status: 'strong-match' | 'probable-match' | 'conflict' | 'insufficient'; signals: VerificationSignal[]}
  operationalEvidence: {status: 'supported-open' | 'supported-closed' | 'conflicting' | 'insufficient'; signals: VerificationSignal[]}
  digitalPresence: {
    website?: PresenceValue
    officialLocationPage?: PresenceValue
    googleProfileReference?: PresenceValue
    phones: PresenceValue[]
    emails: PresenceValue[]
    forms: PresenceValue[]
    bookingUrls: PresenceValue[]
    quoteRequestUrls: PresenceValue[]
    ecommerceUrls: PresenceValue[]
    socialProfiles: PresenceValue[]
  }
  websiteSignals: VerificationSignal[]
  commercialInformation: {
    items: CommercialItem[]
    openingHours: Array<{value: string; sourceKey: string; format: string}>
    counts: {services: number; products: number; prices: number; openingHours: number}
  }
  sources: SourceProvenance[]
  sourceKeys: string[]
  errors: Array<{url: string; message: string}>
}

export interface VerificationReport {
  schemaVersion: 1
  generatedAt: string
  selection: {method: 'deterministic-category-round-robin'; area?: string; categories: string[]; limit?: number; businessIds: string[]; description: string}
  businessesProcessed: number
  reusedFresh: number
  crawlErrors: number
  newOperationalEvidence: number
  newIdentityEvidence: number
  officialWebsites: number
  phones: number
  forms: number
  booking: number
  insufficient: number
  identityStatusCounts: Record<string, number>
  operationalStatusCounts: Record<string, number>
  results: Array<{businessId: string; identity: VerificationArtifact['identityEvidence']['status']; operational: VerificationArtifact['operationalEvidence']['status']; website: string | null; phoneCount: number; formCount: number; bookingCount: number; errors: number; reused: boolean}>
}
