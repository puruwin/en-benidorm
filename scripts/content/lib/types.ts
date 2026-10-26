export const ENTITY_TYPES = ['restaurant', 'bar', 'cafe', 'hotel', 'attraction', 'shop', 'service'] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

export const DISCOVERY_CATEGORIES = ['hospitality', 'professional-services', 'retail', 'attractions'] as const
export type DiscoveryCategory = (typeof DISCOVERY_CATEGORIES)[number]

export interface GeographicScope {
  name: string
  /** South, west, north, east (Overpass order). */
  bbox: [number, number, number, number]
  /** Optional OSM relation used to exclude bbox neighbours with an official boundary. */
  boundaryRelationId?: number
}

export interface DiscoveredBusinessClassification {
  sector: import('./business-taxonomy').BusinessSector
  subsector: string
  matches: Array<{sector: import('./business-taxonomy').BusinessSector; subsector: string; osmTag: string}>
}

export interface DiscoveredGeography {
  municipality: 'Benidorm' | 'La Nucía' | "l'Alfàs del Pi" | 'unknown'
  zone: 'Benidorm' | 'La Nucía' | "l'Alfàs del Pi" | 'Albir' | 'unknown'
  confidence: 'tag' | 'coordinates' | 'unknown'
}

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
  /** Transport/dataset metadata. It never replaces provider identity. */
  dataset?: {
    kind: 'overpass-api' | 'local-osm-extract' | 'manual'
    name: string
    sourceUrl: string | null
    downloadedAt?: string
  }
}

export type DiscoveryRunStatus = 'success' | 'partial' | 'failed' | 'anomalous-empty'
export type DiscoveryUnitStatus = 'success' | 'failed' | 'checkpoint'

export interface DiscoveryAttempt {
  endpoint: string
  startedAt: string
  finishedAt: string
  outcome: 'success' | 'http-error' | 'timeout' | 'network-error' | 'invalid-response'
  statusCode?: number
  retryAfterMs?: number
  message?: string
}

export interface DiscoveryUnitResult {
  key: string
  query?: string
  type: EntityType | 'mixed'
  primitive: 'node' | 'way' | 'relation' | 'extract'
  bbox: GeographicScope['bbox']
  status: DiscoveryUnitStatus
  recordCount: number
  attempts: DiscoveryAttempt[]
}

export interface ProbableDuplicate {
  incomingSourceKeys: string[]
  existingBusinessId: string
  confidence: 'exact' | 'strong-probable' | 'probable' | 'unresolved'
  signals: Array<'name' | 'phone' | 'domain' | 'address' | 'coordinates'>
  distanceMeters?: number
}

export interface DiscoveryRun {
  schemaVersion: 1
  id: string
  provider: string
  status: DiscoveryRunStatus
  startedAt: string
  finishedAt: string
  geography: GeographicScope
  categories: DiscoveryCategory[]
  units: DiscoveryUnitResult[]
  checkpointPath: string | null
  resumedUnits: number
  totals: {
    queries: number
    attempts: number
    retries: number
    found: number
    unique: number
    new: number
    existing: number
    exactDuplicates: number
    probableDuplicates: number
  }
  probableDuplicates: ProbableDuplicate[]
  coverageByCategory: Partial<Record<DiscoveryCategory, {units: number; completed: number; records: number}>>
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
  /** Optional so manifests created before P3A.1 remain readable. */
  discovery?: DiscoveryLifecycle
}

export type DiscoveryPurpose = 'editorial-comparison' | 'editorial-business'

export interface DiscoveryResearchSelection {
  purpose: DiscoveryPurpose
  contextId: string
  selectedAt: string
  researchedAt: string | null
}

export interface EditorialEligibilityAssessment {
  contextId: string
  status: 'eligible' | 'ineligible' | 'unassessed'
  assessedAt: string
  reason?: string
}

export interface DiscoveryHistoryEvent {
  at: string
  kind: 'discovered' | 'seen' | 'source-added' | 'selected-for-research' | 'researched' | 'editorial-assessed'
  sourceKeys: string[]
  contextId?: string
}

/** Reusable discovery contract. Consumers may read it but do not own or mutate identity. */
export interface DiscoveryLifecycle {
  state: 'discovered'
  firstSeenAt: string
  lastSeenAt: string
  categories: DiscoveryCategory[]
  geographicScopes: string[]
  sourceIdentifiers: Array<{provider: string; identifier: string}>
  researchSelections: DiscoveryResearchSelection[]
  editorialEligibility: EditorialEligibilityAssessment[]
  history: DiscoveryHistoryEvent[]
}

export interface ContentManifest {
  version: 1
  updatedAt: string | null
  entries: ManifestEntry[]
}

export interface DiscoveredEntity {
  schemaVersion: 1 | 2
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
  /** Commercial classification is additive and is not consumed by Selection/Comparison. */
  businessClassification?: DiscoveredBusinessClassification
  geography?: DiscoveredGeography
  /** Snapshot metadata; the manifest is the canonical lifecycle/identity index. */
  discovery?: Pick<DiscoveryLifecycle, 'firstSeenAt' | 'lastSeenAt' | 'categories' | 'geographicScopes'>
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
