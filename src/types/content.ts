import type {ImageMetadata} from 'astro'
import type {SanityImageSource} from '@sanity/image-url'

export type LocalizedLanguage = 'es'

export interface EditorialImage {
  alt: string
  caption?: string
  credit?: string
  local?: ImageMetadata
  url?: string
  sanity?: SanityImageSource
  width?: number
  height?: number
}

export interface SeoData {
  title: string
  description: string
  image?: EditorialImage
  noIndex?: boolean
}

export interface LinkItem {
  label: string
  href: string
}

export interface SiteSettingsData {
  siteName: string
  tagline: string
  navigation: LinkItem[]
  footerText: string
}

export interface SourceItem {
  title: string
  url: string
  publisher?: string
  accessedAt?: string
}

export interface CategorySummary {
  title: string
  slug: string
  description: string
  href: string
  count?: number
}

export interface GuideSummary {
  title: string
  slug: string
  excerpt: string
  href: string
  kicker?: string
  image?: EditorialImage
}

export interface BusinessSummary {
  name: string
  slug: string
  shortDescription: string
  href: string
  kind: string
  area?: string
  priceRange?: string
  categories: string[]
  recommended?: boolean
  sponsored?: boolean
  image?: EditorialImage
}

export interface BusinessDetail extends BusinessSummary {
  description: string[]
  address: {
    street: string
    postalCode: string
    locality: string
    province: string
    country: string
  }
  phone?: string
  website?: string
  googleMapsUrl?: string
  location?: {lat: number; lng: number}
  hours: Array<{day: string; value: string}>
  features: string[]
  images: EditorialImage[]
  lastVerified?: string
  sources: SourceItem[]
  seo: SeoData
}

export interface HomeContent {
  eyebrow: string
  title: string
  intro: string
  heroImage: EditorialImage
  primaryLinks: Array<LinkItem & {description: string; accent: string}>
  guides: GuideSummary[]
  recommendations: BusinessSummary[]
  recent: GuideSummary[]
  seo: SeoData
}

export interface DiningPageContent {
  title: string
  intro: string
  categories: CategorySummary[]
  businesses: BusinessSummary[]
  seo: SeoData
}

export interface BreadcrumbItem {
  label: string
  href?: string
}
