export const ENTITY_TYPES = ['restaurant', 'bar', 'cafe', 'hotel', 'attraction', 'shop'] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

export const BUSINESS_KINDS = ['restaurant', 'bar', 'pub', 'cafe', 'hotel', 'shop', 'service'] as const
export type BusinessKind = (typeof BUSINESS_KINDS)[number]

export const PIPELINE_STATUSES = [
  'discovered',
  'enriched',
  'generated',
  'validated',
  'imported',
  'reviewed',
  'published',
  'error',
] as const
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number]
export type PipelineStage = 'discovery' | 'enrichment' | 'generation' | 'qa' | 'import'
export type QualityTier = 'insufficient' | 'basic' | 'rich'

export const SOURCE_CLASSES = ['official-location', 'official-brand', 'open-data', 'manual-first-party', 'third-party'] as const
export type SourceClass = (typeof SOURCE_CLASSES)[number]
export const CLAIM_SCOPES = ['establishment', 'brand', 'unknown'] as const
export type ClaimScope = (typeof CLAIM_SCOPES)[number]

export interface BusinessQualityAssessment {
  tier: QualityTier
  reasons: string[]
  distinctiveFacts: string[]
  missingUsefulFacts: string[]
  score?: number
}

export interface SourceProvenance {
  key: string
  provider: string
  identifier: string
  url: string | null
  retrievedAt: string
  attribution: string
  licenseUrl: string | null
  /** Optional for backwards compatibility; consumers normalize legacy records. */
  sourceClass?: SourceClass
  /** The entity level supported by claims from this source. */
  claimScope?: ClaimScope
}

export interface ManifestEntry {
  id: string
  type: EntityType
  slug: string
  status: PipelineStatus
  priority: number
  sources: SourceProvenance[]
  discoveredAt: string | null
  enrichedAt: string | null
  generatedAt: string | null
  validatedAt: string | null
  importedAt: string | null
  reviewedAt: string | null
  publishedAt: string | null
  qualityTier: QualityTier | null
  qualityAssessedAt: string | null
  qualityReasons: string[]
  missingUsefulFacts: string[]
  lastError: {stage: PipelineStage; message: string; at: string} | null
}

export interface ContentManifest {
  version: 1
  updatedAt: string | null
  entries: ManifestEntry[]
}

export interface DiscoveredEntity {
  schemaVersion: 1
  id: string
  type: EntityType
  targetDocumentType: 'business' | 'place'
  slug: string
  priority: number
  sources: SourceProvenance[]
  raw: {
    name: string
    tags: Record<string, string>
    latitude: number | null
    longitude: number | null
  }
}

export interface Fact<T> {
  value: T | null
  sources: string[]
}

export type CommercialFactFormat = 'html' | 'json-ld' | 'embedded-json' | 'pdf'
export type CommercialItemKind = 'product' | 'service' | 'specialty'

export interface CommercialPrice {
  amount: number
  currency: 'EUR'
  raw: string
  observedAt: string
  confidence: 'explicit'
  priceQualifier?: 'from'
}

/** A page-scoped commercial claim. sourceKey identifies the exact HTML page or PDF page. */
export interface CommercialItem {
  name: string
  kind: CommercialItemKind
  description?: string
  price?: CommercialPrice
  url?: string
  sourceKey: string
  observedAt: string
  format: CommercialFactFormat
  pageNumber?: number
}

export interface FactualAddress {
  street?: string
  postalCode?: string
  locality?: string
  province?: string
  country?: string
}

export interface BusinessFacts {
  name: Fact<string>
  businessKind: Fact<BusinessKind>
  address: Fact<FactualAddress>
  location: Fact<{lat: number; lng: number}>
  phone: Fact<string>
  website: Fact<string>
  openingHoursRaw: Fact<string>
  cuisine: Fact<string[]>
  concept: Fact<string>
  specialties: Fact<string[]>
  services: Fact<string[]>
  bookingAvailability: Fact<boolean>
  takeaway: Fact<boolean>
  delivery: Fact<boolean>
  terrace: Fact<boolean>
  accessibility: Fact<string[]>
  openingInformation: Fact<string[]>
  locationContext: Fact<string>
  distinctiveFeatures: Fact<string[]>
  /** Optional on legacy artifacts. */
  commercialItems?: Fact<CommercialItem[]>
}

export interface EnrichedEntity {
  schemaVersion: 2
  id: string
  type: EntityType
  targetDocumentType: 'business' | 'place'
  slug: string
  facts: BusinessFacts
  factsBySource: {
    openStreetMap: BusinessFacts
    officialWebsite: Pick<BusinessFacts,
      | 'cuisine' | 'concept' | 'specialties' | 'services' | 'bookingAvailability'
      | 'takeaway' | 'delivery' | 'terrace' | 'accessibility' | 'openingInformation'
      | 'locationContext' | 'distinctiveFeatures' | 'commercialItems'>
  }
  editorial: Record<string, never>
  sources: SourceProvenance[]
}

export interface GeneratedEditorial {
  qualityTier: QualityTier
  shortDescription: string | null
  description: Array<{
    section: EditorialSection
    text: string
  }>
  highlights: string[]
  seo: {
    metaTitle: string
    metaDescription: string
  } | null
}

export type EditorialSection =
  | 'overview'
  | 'food'
  | 'experience'
  | 'location'
  | 'services'
  | 'practical'
  | 'goodFor'
  | 'highlights'

export interface GeneratedBusinessArtifact {
  schemaVersion: 1
  id: string
  type: EntityType
  qualityTier: QualityTier
  qualityAssessment: BusinessQualityAssessment
  generationSkipped: boolean
  reason: 'insufficient-facts' | null
  document: Record<string, unknown> | null
}

export interface QAIssue {
  severity: 'WARNING' | 'FAIL' | 'SKIPPED'
  code: string
  path: string
  message: string
}

export type QAOutcome = 'PASS' | 'WARNING' | 'FAIL' | 'SKIPPED'

export interface PhaseReportItem {
  id?: string
  outcome: 'processed' | 'skipped' | 'error' | QAOutcome
  message?: string
  issues?: QAIssue[]
  qualityTier?: QualityTier
  reasons?: string[]
  distinctiveFacts?: string[]
  missingUsefulFacts?: string[]
  generationSkipped?: boolean
}

export interface PhaseReport {
  phase: PipelineStage
  dryRun: boolean
  startedAt: string
  finishedAt: string
  totals: Record<string, number>
  summary?: Record<string, unknown>
  items: PhaseReportItem[]
}
