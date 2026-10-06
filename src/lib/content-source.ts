import {sanityClient} from 'sanity:client'
import {demoBusinesses, demoDining, demoHome, demoSettings} from '../data/demo/content'
import {authors} from '../../content/seed/authors'
import type {AuthorDetail, BusinessDetail, BusinessSummary, CategorySummary, ComparisonDetail, ComparisonLink, DiningPageContent, GuideSummary, HomeContent, SiteSettingsData} from '../types/content'
import {AUTHOR_QUERY, COMPARISON_QUERY, COMPARISON_SLUGS_QUERY, DINING_QUERY, HOME_QUERY, RESTAURANT_QUERY, RESTAURANT_SLUGS_QUERY, SETTINGS_QUERY} from './sanity/queries'

type LocalDocument = Record<string, unknown> & {_id: string; _type: string}
const localBusinessModules = import.meta.glob('../../content/generated/businesses/*.json', {eager: true, import: 'default'}) as Record<string, LocalDocument>
const localComparisonModules = import.meta.glob('../../content/generated/comparisons/*.json', {eager: true, import: 'default'}) as Record<string, LocalDocument>
const localBusinesses = Object.values(localBusinessModules)
const localComparisons = Object.values(localComparisonModules)

export const isDemoMode = import.meta.env.CONTENT_SOURCE !== 'sanity'

function assertSanityConfigured(): void {
  if (!import.meta.env.PUBLIC_SANITY_PROJECT_ID) {
    throw new Error('CONTENT_SOURCE=sanity requiere PUBLIC_SANITY_PROJECT_ID.')
  }
}

export async function getHomeContent(): Promise<HomeContent> {
  if (isDemoMode) return demoHome
  assertSanityConfigured()
  const result = await sanityClient.fetch<{page: Omit<HomeContent, 'recent'> | null; recent: GuideSummary[]}>(HOME_QUERY)
  if (!result.page) throw new Error('No existe el documento singleton homePage en Sanity.')
  return {...result.page, recent: result.recent}
}

export async function getDiningContent(): Promise<DiningPageContent> {
  if (isDemoMode) return {...demoDining, comparisons: localComparisonLinks()}
  assertSanityConfigured()
  const result = await sanityClient.fetch<{page: Pick<DiningPageContent, 'title' | 'intro' | 'seo'> | null; businesses: BusinessSummary[]; categories: CategorySummary[]; comparisons: ComparisonLink[]}>(DINING_QUERY)
  if (!result.page) throw new Error('Falta siteSettings.diningPage en Sanity.')
  return {
    ...result.page,
    businesses: result.businesses,
    categories: result.categories,
    comparisons: result.comparisons,
  }
}

export async function getSiteSettings(): Promise<SiteSettingsData> {
  if (isDemoMode) return demoSettings
  assertSanityConfigured()
  const result = await sanityClient.fetch<SiteSettingsData | null>(SETTINGS_QUERY)
  if (!result) throw new Error('No existe el documento singleton siteSettings en Sanity.')
  return result
}

export async function getRestaurantSlugs(): Promise<string[]> {
  if (isDemoMode) return [...new Set([...demoBusinesses.map(({slug}) => slug), ...localBusinesses.map((document) => slugValue(document.slug)).filter((slug): slug is string => Boolean(slug))])]
  assertSanityConfigured()
  return sanityClient.fetch<string[]>(RESTAURANT_SLUGS_QUERY)
}

export async function getRestaurantBySlug(slug: string): Promise<BusinessDetail | null> {
  if (isDemoMode) {
    const demo = demoBusinesses.find((business) => business.slug === slug)
    if (demo) return demo
    const document = localBusinesses.find((item) => slugValue(item.slug) === slug)
    return document ? localBusinessDetail(document) : null
  }
  assertSanityConfigured()
  const business = await sanityClient.fetch<BusinessDetail | null>(RESTAURANT_QUERY, {slug})
  if (!business) return null

  return {
    ...business,
    categories: business.categories ?? [],
    description: business.description ?? [],
    hours: business.hours ?? [],
    features: business.features ?? [],
    images: business.images ?? [],
    sources: business.sources ?? [],
    comparisons: business.comparisons ?? [],
  }
}

export async function getComparisonSlugs(): Promise<string[]> {
  if (isDemoMode) return localComparisons.map((document) => slugValue(document.slug)).filter((slug): slug is string => Boolean(slug))
  assertSanityConfigured()
  return sanityClient.fetch<string[]>(COMPARISON_SLUGS_QUERY)
}

export async function getComparisonBySlug(slug: string): Promise<ComparisonDetail | null> {
  if (isDemoMode) {
    const document = localComparisons.find((item) => slugValue(item.slug) === slug)
    return document ? localComparisonDetail(document) : null
  }
  assertSanityConfigured()
  const comparison = await sanityClient.fetch<ComparisonDetail | null>(COMPARISON_QUERY, {slug})
  if (!comparison) return null
  return {...comparison, entries: comparison.entries ?? [], criteria: comparison.criteria ?? [], sources: comparison.sources ?? []}
}

export async function getAuthorBySlug(slug: string): Promise<AuthorDetail | null> {
  if (isDemoMode) return localAuthor(slug)
  assertSanityConfigured()
  return await sanityClient.fetch<AuthorDetail | null>(AUTHOR_QUERY, {slug}) ?? localAuthor(slug)
}

function localAuthor(slug: string): AuthorDetail | null {
  const author = authors.find((item) => item.slug.current === slug)
  if (!author) return null
  return {name: author.name, slug, role: author.role, bio: author.bio, methodology: [...author.methodology], personalVisitDisclosure: author.personalVisitDisclosure, seo: {title: author.seo.metaTitle, description: author.seo.metaDescription}}
}

function localComparisonLinks(): ComparisonLink[] {
  return localComparisons.flatMap((document) => {
    const slug = slugValue(document.slug)
    return slug && typeof document.title === 'string' ? [{title: document.title, slug, href: `/donde-comer/${slug}/`}] : []
  })
}

function localComparisonDetail(document: LocalDocument): ComparisonDetail {
  const slug = slugValue(document.slug)!
  const entries = Array.isArray(document.entries) ? document.entries : []
  const authorReference = isRecord(document.author) ? document.author : undefined
  const author = authors.find((item) => item._id === authorReference?._ref)
  return {
    title: String(document.title), slug, href: `/donde-comer/${slug}/`, topic: String(document.topic),
    intro: String(document.intro), quickVerdict: String(document.quickVerdict),
    entries: entries.flatMap((entry) => {
      if (!isRecord(entry)) return []
      const businessReference = isRecord(entry.business) ? entry.business : undefined
      if (typeof businessReference?._ref !== 'string') return []
      const business = localBusinesses.find((item) => item._id === businessReference._ref)
      if (!business) return []
      const businessSlug = slugValue(business.slug)!
      return [{
        rank: Number(entry.rank), verdict: String(entry.verdict), strengths: stringList(entry.strengths), weaknesses: stringList(entry.weaknesses),
        bestFor: stringList(entry.bestFor), ...(typeof entry.featuredItem === 'string' ? {featuredItem: entry.featuredItem} : {}),
        ...(typeof entry.featuredPrice === 'string' ? {featuredPrice: entry.featuredPrice} : {}), practicalNotes: stringList(entry.practicalNotes),
        business: {name: String(business.name), slug: businessSlug, href: `/restaurantes/${businessSlug}/`, kind: String(business.businessKind), ...(typeof business.phone === 'string' ? {phone: business.phone} : {}), ...(typeof business.website === 'string' ? {website: business.website} : {})},
      }]
    }),
    methodology: String(document.methodology), criteria: stringList(document.criteria),
    author: {name: author?.name ?? 'David', slug: author?.slug.current ?? 'david', ...(author?.role ? {role: author.role} : {})},
    sources: Array.isArray(document.sources) ? document.sources.flatMap((source) => isRecord(source) && typeof source.title === 'string' && typeof source.url === 'string' ? [{title: source.title, url: source.url, ...(typeof source.publisher === 'string' ? {publisher: source.publisher} : {}), ...(typeof source.accessedAt === 'string' ? {accessedAt: source.accessedAt} : {})}] : []) : [],
    lastVerified: String(document.lastVerified), seo: seoValue(document.seo, String(document.title), String(document.intro)),
  }
}

function localBusinessDetail(document: LocalDocument): BusinessDetail {
  const slug = slugValue(document.slug)!
  const address = isRecord(document.address) ? document.address : {}
  const location = isRecord(document.location) && typeof document.location.lat === 'number' && typeof document.location.lng === 'number' ? {lat: document.location.lat, lng: document.location.lng} : undefined
  return {
    name: String(document.name), slug, href: `/restaurantes/${slug}/`, kind: String(document.businessKind), shortDescription: String(document.shortDescription),
    categories: [], description: portableTextStrings(document.body),
    address: {street: String(address.street ?? ''), postalCode: String(address.postalCode ?? ''), locality: String(address.locality ?? ''), province: String(address.province ?? ''), country: String(address.country ?? '')},
    hours: [], features: [], images: [], sources: [], ...(typeof document.phone === 'string' ? {phone: document.phone} : {}), ...(typeof document.website === 'string' ? {website: document.website} : {}),
    ...(location ? {location} : {}), ...(typeof document.lastVerified === 'string' ? {lastVerified: document.lastVerified} : {}),
    comparisons: localComparisonLinks().filter((comparison) => {
      const target = localComparisons.find((item) => slugValue(item.slug) === comparison.slug)
      return Array.isArray(target?.entries) && target.entries.some((entry) => isRecord(entry) && isRecord(entry.business) && entry.business._ref === document._id)
    }),
    seo: seoValue(document.seo, String(document.name), String(document.shortDescription)),
  }
}

function slugValue(value: unknown): string | undefined { return isRecord(value) && typeof value.current === 'string' ? value.current : undefined }
function stringList(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
function portableTextStrings(value: unknown): string[] { return Array.isArray(value) ? value.flatMap((block) => isRecord(block) && Array.isArray(block.children) ? [block.children.flatMap((child) => isRecord(child) && typeof child.text === 'string' ? [child.text] : []).join('')] : []).filter(Boolean) : [] }
function seoValue(value: unknown, title: string, description: string) { return isRecord(value) ? {title: String(value.metaTitle ?? title), description: String(value.metaDescription ?? description), ...(typeof value.noIndex === 'boolean' ? {noIndex: value.noIndex} : {})} : {title, description} }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
