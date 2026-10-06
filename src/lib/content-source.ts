import {sanityClient} from 'sanity:client'
import {demoBusinesses, demoDining, demoHome, demoSettings} from '../data/demo/content'
import type {BusinessDetail, BusinessSummary, CategorySummary, DiningPageContent, GuideSummary, HomeContent, SiteSettingsData} from '../types/content'
import {DINING_QUERY, HOME_QUERY, RESTAURANT_QUERY, RESTAURANT_SLUGS_QUERY, SETTINGS_QUERY} from './sanity/queries'

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
  if (isDemoMode) return demoDining
  assertSanityConfigured()
  const result = await sanityClient.fetch<{page: Pick<DiningPageContent, 'title' | 'intro' | 'seo'> | null; businesses: BusinessSummary[]; categories: CategorySummary[]}>(DINING_QUERY)
  if (!result.page) throw new Error('Falta siteSettings.diningPage en Sanity.')
  return {
    ...result.page,
    businesses: result.businesses,
    categories: result.categories,
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
  if (isDemoMode) return demoBusinesses.map(({slug}) => slug)
  assertSanityConfigured()
  return sanityClient.fetch<string[]>(RESTAURANT_SLUGS_QUERY)
}

export async function getRestaurantBySlug(slug: string): Promise<BusinessDetail | null> {
  if (isDemoMode) return demoBusinesses.find((business) => business.slug === slug) ?? null
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
  }
}
