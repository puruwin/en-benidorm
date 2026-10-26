import type {SourceProvenance} from '../../../scripts/content/lib/types'

export interface BusinessSummary {
  businessId: string
  name: string
  municipality: string
  sector: string
  subsector: string
  knownWebsite: boolean
  knownPhone: boolean
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
  page?: string
  pageSize?: string
  refresh?: string
}
export interface BusinessContact {
  kind: 'website' | 'phone' | 'email'
  value: string
  sourceKeys: string[]
  origin: 'Discovery' | 'Enrichment'
  observedAt: string | null
}
export interface BusinessDetail {
  business: BusinessSummary
  address: string | null
  coordinates: {latitude: number; longitude: number} | null
  contacts: BusinessContact[]
  sources: SourceProvenance[]
  identity: {entry: Record<string, unknown> | null; enriched: unknown | null}
  warnings: string[]
}
