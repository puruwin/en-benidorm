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
  /** Vacío solo si la página es noindex: `resolveSeo` hace fallar el build en las indexables. */
  title?: string
  description?: string
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

/** Bloque del cuerpo de una ficha: párrafo, encabezado (`style: 'h2'`) o elemento de lista. */
export interface DescriptionBlock {
  text: string
  style?: string
  listItem?: string
}

export interface BusinessDetail extends BusinessSummary {
  /** `_id` del documento; falta en el contenido demo. */
  id?: string
  description: DescriptionBlock[]
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
  comparisons?: ComparisonLink[]
}

export interface ComparisonLink {
  title: string
  slug: string
  href: string
}

export interface ComparisonEntryDetail {
  verdict: string
  strengths: string[]
  conditions: string[]
  limitations: string[]
  bestFor: string[]
  featuredItem?: {name: string; price?: number; currency?: 'EUR'; priceQualifier?: string; priceUnit?: 'per-person' | 'per-portion' | 'per-unit' | 'ambiguous'; source: string; retrievedAt: string}
  practicalNotes: string[]
  business: Pick<BusinessDetail, 'id' | 'name' | 'slug' | 'href' | 'kind' | 'phone' | 'website'>
}

export interface ComparisonChoiceDetail {
  label: string
  reason: string
  business: Pick<BusinessDetail, 'name' | 'slug' | 'href'>
}

export interface AuthorDetail {
  name: string
  slug: string
  role?: string
  bio: string
  methodology: string[]
  personalVisitDisclosure: string
  seo: SeoData
}

export interface ComparisonDetail extends ComparisonLink {
  topic: string
  intro: string
  quickVerdict: string
  choiceGuide: ComparisonChoiceDetail[]
  entries: ComparisonEntryDetail[]
  methodology: string
  criteria: string[]
  author: Pick<AuthorDetail, 'name' | 'slug' | 'role'>
  sources: SourceItem[]
  lastVerified: string
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
  comparisons: ComparisonLink[]
  seo: SeoData
}

export interface BreadcrumbItem {
  label: string
  href?: string
}

/** Copia de un hecho de content/facts/ que cita la página (PracticalFactSnapshot). */
export interface PracticalFactView {
  factId: string
  /** Solo relleno si `status` es `confirmed`. */
  value: string | null
  unit: string
  status: 'confirmed' | 'unknown' | 'needs verification' | 'conflict'
  sourceTitle: string | null
  sourceUrl: string | null
  sourceClass: string | null
  retrievedAt: string | null
}

/** Otra playa enlazada desde una ficha, con la diferencia de perfil que justifica el enlace. */
export interface BeachContrast {
  name: string
  href: string
  reason: string
}

/** Dónde comer cerca: una comparativa con locales en la zona, o nada si no hay ninguno registrado. */
export interface NearbyDining {
  title: string
  href: string
  note: string
}

export interface BeachDetail {
  id: string
  name: string
  slug: string
  href: string
  shortDescription: string
  /** «Si buscas…»: para quién es, en el hub. */
  choiceNote?: string
  description: DescriptionBlock[]
  area?: string
  municipality: string
  facts: PracticalFactView[]
  contrasts: BeachContrast[]
  nearbyDining: NearbyDining[]
  sources: SourceItem[]
  seo: SeoData
}

export interface BeachesPageContent {
  title: string
  intro: string
  seo: SeoData
  beaches: BeachDetail[]
}
