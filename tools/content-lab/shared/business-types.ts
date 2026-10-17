import type {SourceProvenance} from '../../../scripts/content/lib/types'
import type {OpportunityReviewContext} from './types'

export type ProspectingStatus = 'unmanaged' | 'following' | 'archived'
export interface ProspectingRecord {
  schemaVersion: 1
  businessId: string
  status: ProspectingStatus
  notes: string
  updatedAt: string | null
}
export interface ProspectingView {
  record: ProspectingRecord
  revision: string | null
}
export interface BusinessSummary {
  businessId: string
  name: string
  municipality: string
  sector: string
  subsector: string
  knownWebsite: boolean
  knownPhone: boolean
  analysisStatus: 'available' | 'missing' | 'invalid'
  inExperimentSample: boolean
}
export interface BusinessList {
  items: BusinessSummary[]
  total: number
  catalogTotal: number
  page: number
  pageSize: number
  pages: number
  facets: {municipalities: string[]; sectors: string[]; subsectors: string[]}
  warnings: string[]
}
export interface BusinessQuery {
  q?: string
  municipality?: string
  sector?: string
  subsector?: string
  analysis?: 'all' | 'available' | 'missing' | 'invalid'
  sample?: 'all' | 'yes' | 'no'
  page?: string
  pageSize?: string
  refresh?: string
}
export interface BusinessContact {
  kind: 'website' | 'phone' | 'email'
  value: string
  sourceKeys: string[]
  origin: 'Discovery' | 'Enrichment' | 'Verification'
  observedAt: string | null
}
export interface BusinessDetail {
  business: BusinessSummary
  address: string | null
  coordinates: {latitude: number; longitude: number} | null
  contacts: BusinessContact[]
  sources: SourceProvenance[]
  context: OpportunityReviewContext
  tracking: ProspectingView | null
  warnings: string[]
}
