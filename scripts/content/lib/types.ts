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

export interface SourceProvenance {
  key: string
  provider: string
  identifier: string
  url: string | null
  retrievedAt: string
  attribution: string
  licenseUrl: string | null
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

export interface FactualAddress {
  street?: string
  postalCode?: string
  locality?: string
  province?: string
  country?: string
}

export interface EnrichedEntity {
  schemaVersion: 1
  id: string
  type: EntityType
  targetDocumentType: 'business' | 'place'
  slug: string
  facts: {
    name: Fact<string>
    businessKind: Fact<BusinessKind>
    address: Fact<FactualAddress>
    location: Fact<{lat: number; lng: number}>
    phone: Fact<string>
    website: Fact<string>
    openingHoursRaw: Fact<string>
  }
  editorial: Record<string, never>
  sources: SourceProvenance[]
}

export interface GeneratedEditorial {
  shortDescription: string
  description: string
  highlights: string[]
  seo: {
    metaTitle: string
    metaDescription: string
  }
}

export interface QAIssue {
  severity: 'WARNING' | 'FAIL'
  code: string
  path: string
  message: string
}

export type QAOutcome = 'PASS' | 'WARNING' | 'FAIL'

export interface PhaseReportItem {
  id?: string
  outcome: 'processed' | 'skipped' | 'error' | QAOutcome
  message?: string
  issues?: QAIssue[]
}

export interface PhaseReport {
  phase: PipelineStage
  dryRun: boolean
  startedAt: string
  finishedAt: string
  totals: Record<string, number>
  items: PhaseReportItem[]
}
