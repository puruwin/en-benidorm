import {sanityClient} from 'sanity:client'
import {demoBusinesses, demoDining, demoHome, demoSettings} from '../data/demo/content'
import {areas} from '../../content/seed/areas'
import {authors} from '../../content/seed/authors'
import {settings as seedSettings} from '../../content/seed/settings'
import type {AuthorDetail, BeachContrast, BeachDetail, BeachesPageContent, BusinessDetail, DescriptionBlock, BusinessSummary, CategorySummary, ComparisonDetail, ComparisonLink, DiningPageContent, GuideDetail, GuideLink, GuideSummary, HomeContent, InformationPageContent, NearbyDining, PracticalFactView, SeoData, SiteSettingsData, SourceItem} from '../types/content'
import {type CreatorObservation, isCreatorObservationPath, isPublishable, parseCreatorObservation, sortCreatorObservations} from './creator-observations'
import {AUTHOR_QUERY, BEACH_QUERY, BEACH_SLUGS_QUERY, BEACHES_QUERY, COMPARISON_QUERY, COMPARISON_SLUGS_QUERY, DINING_QUERY, HOME_QUERY, GUIDE_QUERY, GUIDE_SLUGS_QUERY, INFORMATION_QUERY, THINGS_TO_DO_QUERY, RESTAURANT_QUERY, RESTAURANT_SLUGS_QUERY, SETTINGS_QUERY} from './sanity/queries'

type LocalDocument = Record<string, unknown> & {_id: string; _type: string}
const localBusinessModules = import.meta.glob('../../content/generated/businesses/*.json', {eager: true, import: 'default'}) as Record<string, LocalDocument>
const localBeachModules = import.meta.glob('../../content/generated/beaches/*.json', {eager: true, import: 'default'}) as Record<string, LocalDocument>
const localArticleModules = import.meta.glob('../../content/generated/articles/*.json', {eager: true, import: 'default'}) as Record<string, LocalDocument>
const localComparisonModules = import.meta.glob('../../content/generated/comparisons/*.json', {eager: true, import: 'default'}) as Record<string, LocalDocument>
// Notas de personas que vieron el vídeo de un creador; se leen del repositorio en cualquier CONTENT_SOURCE.
const creatorObservationModules = import.meta.glob('../../content/manual/creator-observations/*.json', {eager: true, import: 'default'}) as Record<string, unknown>
const localBusinesses = Object.values(localBusinessModules)
const localComparisons = Object.values(localComparisonModules)
const localBeaches = Object.values(localBeachModules)
// Guías con ruta (docs/arquitectura-seo.md §3): las de Información práctica y las de Qué hacer.
export type GuideSection = 'informationPractical' | 'thingsToDo'
const GUIDE_PATHS: Record<GuideSection, string> = {informationPractical: '/informacion-practica/', thingsToDo: '/que-hacer/'}
const localGuides = Object.values(localArticleModules).filter((document) => typeof document.section === 'string' && document.section in GUIDE_PATHS)
const localGuidesOf = (section: GuideSection) => localGuides.filter((document) => document.section === section)
const guidePath = (document: LocalDocument) => GUIDE_PATHS[document.section as GuideSection]

export const isDemoMode = import.meta.env.CONTENT_SOURCE !== 'sanity'

/** Ficha ficticia de `src/data/demo`: nunca se indexa. */
export function isDemoBusiness(slug: string): boolean {
  return isDemoMode && demoBusinesses.some((business) => business.slug === slug)
}

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
  const fetched = await sanityClient.fetch<(Omit<BusinessDetail, 'commercialRelationship'> & {commercialRelationship?: string | null}) | null>(RESTAURANT_QUERY, {slug})
  if (!fetched) return null
  // Solo el valor explícito activa el aviso; Sanity devuelve `null` si el campo no está marcado.
  const {commercialRelationship, ...business} = fetched

  return {
    ...business,
    ...(commercialRelationship === 'frappe-tech-client' ? {commercialRelationship} : {}),
    categories: business.categories ?? [],
    // Sanity devuelve `text: null` en bloques sin spans.
    description: (business.description ?? []).filter((block) => typeof block.text === 'string' && block.text.length > 0),
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
  return {...comparison, choiceGuide: comparison.choiceGuide ?? [], entries: (comparison.entries ?? []).map((entry) => ({...entry, conditions: entry.conditions ?? [], limitations: entry.limitations ?? []})), criteria: comparison.criteria ?? [], sources: comparison.sources ?? []}
}

export async function getBeachSlugs(): Promise<string[]> {
  if (isDemoMode) return localBeaches.map((document) => slugValue(document.slug)).filter((slug): slug is string => Boolean(slug))
  assertSanityConfigured()
  return sanityClient.fetch<string[]>(BEACH_SLUGS_QUERY)
}

export async function getBeachBySlug(slug: string): Promise<BeachDetail | null> {
  if (isDemoMode) {
    const document = localBeaches.find((item) => slugValue(item.slug) === slug)
    return document ? localBeachDetail(document) : null
  }
  assertSanityConfigured()
  const beach = await sanityClient.fetch<BeachDetail | null>(BEACH_QUERY, {slug})
  return beach ? normalizeBeach(beach) : null
}

/** Hub de Playas. En demo, la intro y el SEO salen del seed de siteSettings; las fichas, del repositorio. */
export async function getBeachesContent(): Promise<BeachesPageContent> {
  if (isDemoMode) {
    const page = seedSettings.beachesPage
    return {
      title: page.title, intro: page.intro, seo: ownSeo(page.seo),
      beaches: localBeaches.map(localBeachDetail).sort((a, b) => a.name.localeCompare(b.name, 'es')),
    }
  }
  assertSanityConfigured()
  const result = await sanityClient.fetch<{page: Pick<BeachesPageContent, 'title' | 'intro' | 'seo'> | null; beaches: BeachDetail[]}>(BEACHES_QUERY)
  if (!result.page) throw new Error('Falta siteSettings.beachesPage en Sanity.')
  return {...result.page, beaches: result.beaches.map(normalizeBeach)}
}

function normalizeBeach(beach: BeachDetail): BeachDetail {
  return {
    ...beach,
    // Sanity devuelve `text: null` en bloques sin spans.
    description: (beach.description ?? []).filter((block) => typeof block.text === 'string' && block.text.length > 0),
    facts: beach.facts ?? [], contrasts: beach.contrasts ?? [], nearbyDining: beach.nearbyDining ?? [], sources: beach.sources ?? [],
  }
}

export async function getGuideSlugs(section: GuideSection): Promise<string[]> {
  if (isDemoMode) return localGuidesOf(section).map((document) => slugValue(document.slug)).filter((slug): slug is string => Boolean(slug))
  assertSanityConfigured()
  return sanityClient.fetch<string[]>(GUIDE_SLUGS_QUERY, {section})
}

export async function getGuideBySlug(section: GuideSection, slug: string): Promise<GuideDetail | null> {
  if (isDemoMode) {
    const document = localGuidesOf(section).find((item) => slugValue(item.slug) === slug)
    return document ? localGuideDetail(document) : null
  }
  assertSanityConfigured()
  const guide = await sanityClient.fetch<GuideDetail | null>(GUIDE_QUERY, {section, slug})
  return guide ? normalizeGuide(guide) : null
}

const GUIDE_HUB_PAGES = {informationPractical: 'informationPage', thingsToDo: 'thingsToDoPage'} as const

/** Hub de guías. En demo, la intro y el SEO salen del seed de siteSettings; las guías, del repositorio. */
export async function getGuideHubContent(section: GuideSection): Promise<InformationPageContent> {
  const pageField = GUIDE_HUB_PAGES[section]
  if (isDemoMode) {
    const page = seedSettings[pageField]
    const guides = localGuidesOf(section).map(localGuideDetail).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.title.localeCompare(b.title, 'es'))
    return {title: page.title, intro: page.intro, seo: ownSeo(page.seo), guides}
  }
  assertSanityConfigured()
  const result = await sanityClient.fetch<{page: Pick<InformationPageContent, 'title' | 'intro' | 'seo'> | null; guides: GuideDetail[]}>(section === 'thingsToDo' ? THINGS_TO_DO_QUERY : INFORMATION_QUERY)
  if (!result.page) throw new Error(`Falta siteSettings.${pageField} en Sanity.`)
  return {...result.page, guides: result.guides.map(normalizeGuide)}
}

function normalizeGuide(guide: GuideDetail): GuideDetail {
  // Sanity devuelve null en los campos vacíos y `text: null` en bloques sin spans.
  const {updatedAt, ...rest} = guide
  return {
    ...rest,
    ...(updatedAt ? {updatedAt} : {}),
    description: (guide.description ?? []).filter((block) => typeof block.text === 'string' && block.text.length > 0),
    facts: guide.facts ?? [], links: guide.links ?? [], sources: guide.sources ?? [],
  }
}

export async function getAuthorBySlug(slug: string): Promise<AuthorDetail | null> {
  if (isDemoMode) return localAuthor(slug)
  assertSanityConfigured()
  return await sanityClient.fetch<AuthorDetail | null>(AUTHOR_QUERY, {slug}) ?? localAuthor(slug)
}

let creatorObservations: CreatorObservation[] | undefined

/**
 * Observaciones de creador publicables de un Business, más recientes primero. Una observación no
 * válida rompe el build: no se publica nada a medias. Las que tienen `permisoCreador: "no"` no se muestran.
 */
export function getCreatorObservations(businessId: string | undefined): CreatorObservation[] {
  if (!businessId) return []
  creatorObservations ??= Object.entries(creatorObservationModules).flatMap(([path, value]) => {
    const ref = path.replace(/^.*\/content\/manual\//, '')
    if (!isCreatorObservationPath(ref)) return []
    const {observation, issues} = parseCreatorObservation(value, `content/manual/${ref}`)
    if (!observation) throw new Error(`Observación de creador no válida: ${issues.map((issue) => `${issue.source} · ${issue.path}: ${issue.message}`).join(' ')}`)
    return isPublishable(observation) ? [observation] : []
  })
  return sortCreatorObservations(creatorObservations.filter((observation) => observation.businessId === businessId))
}

function localAuthor(slug: string): AuthorDetail | null {
  const author = authors.find((item) => item.slug.current === slug)
  if (!author) return null
  return {name: author.name, slug, role: author.role, bio: author.bio, methodology: [...author.methodology], personalVisitDisclosure: author.personalVisitDisclosure, seo: {title: author.seo.metaTitle, description: author.seo.metaDescription}}
}

function localComparisonLinks(): ComparisonLink[] {
  return localComparisons.flatMap((document) => {
    const slug = slugValue(document.slug)
    const seo = isRecord(document.seo) ? document.seo : undefined
    return slug && typeof document.title === 'string' && seo?.noIndex !== true ? [{title: document.title, slug, href: `/donde-comer/${slug}/`}] : []
  })
}

function localComparisonDetail(document: LocalDocument): ComparisonDetail {
  const slug = slugValue(document.slug)!
  const entries = Array.isArray(document.entries) ? document.entries : []
  const choices = Array.isArray(document.choiceGuide) ? document.choiceGuide : []
  const authorReference = isRecord(document.author) ? document.author : undefined
  const author = authors.find((item) => item._id === authorReference?._ref)
  return {
    title: String(document.title), slug, href: `/donde-comer/${slug}/`, topic: String(document.topic),
    intro: String(document.intro), quickVerdict: String(document.quickVerdict),
    choiceGuide: choices.flatMap((choice) => {
      if (!isRecord(choice) || !isRecord(choice.business)) return []
      const businessReference = choice.business
      if (typeof businessReference._ref !== 'string') return []
      const business = localBusinesses.find((item) => item._id === businessReference._ref)
      const businessSlug = business ? slugValue(business.slug) : undefined
      if (!business || !businessSlug) return []
      return [{label: String(choice.label), reason: String(choice.reason), business: {name: String(business.name), slug: businessSlug, href: `/restaurantes/${businessSlug}/`}}]
    }),
    entries: entries.flatMap((entry) => {
      if (!isRecord(entry)) return []
      const businessReference = isRecord(entry.business) ? entry.business : undefined
      if (typeof businessReference?._ref !== 'string') return []
      const business = localBusinesses.find((item) => item._id === businessReference._ref)
      if (!business) return []
      const businessSlug = slugValue(business.slug)!
      const featured = isRecord(entry.featuredItem) && typeof entry.featuredItem.name === 'string' && typeof entry.featuredItem.source === 'string' && typeof entry.featuredItem.retrievedAt === 'string'
        ? {name: entry.featuredItem.name, ...(typeof entry.featuredItem.price === 'number' ? {price: entry.featuredItem.price, ...(entry.featuredItem.currency === 'EUR' ? {currency: 'EUR' as const} : {}), ...(typeof entry.featuredItem.priceQualifier === 'string' ? {priceQualifier: entry.featuredItem.priceQualifier} : {}), ...(isPriceUnit(entry.featuredItem.priceUnit) ? {priceUnit: entry.featuredItem.priceUnit} : {})} : {}), source: entry.featuredItem.source, retrievedAt: entry.featuredItem.retrievedAt}
        : undefined
      return [{
        verdict: String(entry.verdict), strengths: stringList(entry.strengths), conditions: stringList(entry.conditions), limitations: stringList(entry.limitations),
        bestFor: stringList(entry.bestFor), ...(featured ? {featuredItem: featured} : {}), practicalNotes: stringList(entry.practicalNotes),
        business: {id: business._id, name: String(business.name), slug: businessSlug, href: `/restaurantes/${businessSlug}/`, kind: String(business.businessKind), ...(typeof business.phone === 'string' ? {phone: business.phone} : {}), ...(typeof business.website === 'string' ? {website: business.website} : {})},
      }]
    }),
    methodology: String(document.methodology), criteria: stringList(document.criteria),
    author: {name: author?.name ?? 'David', slug: author?.slug.current ?? 'david', ...(author?.role ? {role: author.role} : {})},
    sources: localSources(document.sources),
    lastVerified: String(document.lastVerified), seo: ownSeo(document.seo),
  }
}

function localBusinessDetail(document: LocalDocument): BusinessDetail {
  const slug = slugValue(document.slug)!
  const address = isRecord(document.address) ? document.address : {}
  const location = isRecord(document.location) && typeof document.location.lat === 'number' && typeof document.location.lng === 'number' ? {lat: document.location.lat, lng: document.location.lng} : undefined
  return {
    id: document._id, name: String(document.name), slug, href: `/restaurantes/${slug}/`, kind: String(document.businessKind), shortDescription: String(document.shortDescription),
    categories: [], description: portableTextBlocks(document.body),
    address: {street: String(address.street ?? ''), postalCode: String(address.postalCode ?? ''), locality: String(address.locality ?? ''), province: String(address.province ?? ''), country: String(address.country ?? '')},
    hours: [], features: [], images: [], sources: localSources(document.sources), ...(typeof document.phone === 'string' ? {phone: document.phone} : {}), ...(typeof document.website === 'string' ? {website: document.website} : {}),
    ...(location ? {location} : {}), ...(typeof document.lastVerified === 'string' ? {lastVerified: document.lastVerified} : {}),
    comparisons: localComparisonLinks().filter((comparison) => {
      const target = localComparisons.find((item) => slugValue(item.slug) === comparison.slug)
      return Array.isArray(target?.entries) && target.entries.some((entry) => isRecord(entry) && isRecord(entry.business) && entry.business._ref === document._id)
    }),
    seo: ownSeo(document.seo),
  }
}

function localBeachDetail(document: LocalDocument): BeachDetail {
  const slug = slugValue(document.slug)!
  const areaRef = isRecord(document.area) ? document.area._ref : undefined
  const area = areas.find((item) => item._id === areaRef)?.name
  return {
    id: document._id, name: String(document.name), slug, href: `/playas/${slug}/`, shortDescription: String(document.shortDescription), ...(typeof document.choiceNote === 'string' ? {choiceNote: document.choiceNote} : {}),
    description: portableTextBlocks(document.body), ...(area ? {area} : {}), municipality: String(document.municipality ?? ''),
    facts: Array.isArray(document.practicalFacts) ? document.practicalFacts.flatMap(localFact) : [],
    contrasts: Array.isArray(document.profileContrasts) ? document.profileContrasts.flatMap((item): BeachContrast[] => {
      if (!isRecord(item) || !isRecord(item.beach) || typeof item.reason !== 'string') return []
      const target = localBeaches.find((beach) => beach._id === (item.beach as Record<string, unknown>)._ref)
      const targetSlug = target ? slugValue(target.slug) : undefined
      return target && targetSlug ? [{name: String(target.name), href: `/playas/${targetSlug}/`, reason: item.reason}] : []
    }) : [],
    nearbyDining: Array.isArray(document.nearbyDining) ? document.nearbyDining.flatMap((item): NearbyDining[] => {
      if (!isRecord(item) || !isRecord(item.comparison) || typeof item.note !== 'string') return []
      const target = localComparisons.find((comparison) => comparison._id === (item.comparison as Record<string, unknown>)._ref)
      const targetSlug = target ? slugValue(target.slug) : undefined
      return target && targetSlug ? [{title: String(target.title), href: `/donde-comer/${targetSlug}/`, note: item.note}] : []
    }) : [],
    sources: localSources(document.sources), seo: ownSeo(document.seo),
  }
}

function localGuideDetail(document: LocalDocument): GuideDetail {
  const slug = slugValue(document.slug)!
  const authorReference = isRecord(document.author) ? document.author : undefined
  const author = authors.find((item) => item._id === authorReference?._ref)
  return {
    id: document._id, title: String(document.title), slug, href: `${guidePath(document)}${slug}/`, excerpt: String(document.excerpt),
    description: portableTextBlocks(document.body),
    facts: Array.isArray(document.practicalFacts) ? document.practicalFacts.flatMap(localFact) : [],
    links: Array.isArray(document.contextLinks) ? document.contextLinks.flatMap((item): GuideLink[] => {
      if (!isRecord(item) || !isRecord(item.target) || typeof item.note !== 'string') return []
      const ref = item.target._ref
      const guide = localGuides.find((candidate) => candidate._id === ref)
      const beach = localBeaches.find((candidate) => candidate._id === ref)
      const target = guide ?? beach
      const targetSlug = target ? slugValue(target.slug) : undefined
      if (!target || !targetSlug) return []
      return [{title: String(guide ? guide.title : beach!.name), href: guide ? `${guidePath(guide)}${targetSlug}/` : `/playas/${targetSlug}/`, note: item.note}]
    }) : [],
    author: {name: author?.name ?? 'David', slug: author?.slug.current ?? 'david'},
    publishedAt: String(document.publishedAt), ...(typeof document.updatedAt === 'string' ? {updatedAt: document.updatedAt} : {}),
    sources: localSources(document.sources), seo: ownSeo(document.seo),
  }
}

function localFact(value: unknown): PracticalFactView[] {
  if (!isRecord(value) || typeof value.factId !== 'string' || typeof value.unit !== 'string') return []
  const status = value.status
  if (status !== 'confirmed' && status !== 'unknown' && status !== 'needs verification' && status !== 'conflict') return []
  const text = (field: string) => typeof value[field] === 'string' ? value[field] as string : null
  return [{factId: value.factId, value: text('value'), unit: value.unit, status, sourceTitle: text('sourceTitle'), sourceUrl: text('sourceUrl'), sourceClass: text('sourceClass'), retrievedAt: text('retrievedAt')}]
}

function localSources(value: unknown): SourceItem[] {
  return Array.isArray(value) ? value.flatMap((source) => isRecord(source) && typeof source.title === 'string' && typeof source.url === 'string' ? [{title: source.title, url: source.url, ...(typeof source.publisher === 'string' ? {publisher: source.publisher} : {}), ...(typeof source.accessedAt === 'string' ? {accessedAt: source.accessedAt} : {})}] : []) : []
}
function slugValue(value: unknown): string | undefined { return isRecord(value) && typeof value.current === 'string' ? value.current : undefined }
function stringList(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
function isPriceUnit(value: unknown): value is 'per-person' | 'per-portion' | 'per-unit' | 'ambiguous' { return value === 'per-person' || value === 'per-portion' || value === 'per-unit' || value === 'ambiguous' }
function portableTextBlocks(value: unknown): DescriptionBlock[] {
  return Array.isArray(value) ? value.flatMap((block) => {
    if (!isRecord(block) || !Array.isArray(block.children)) return []
    const text = block.children.flatMap((child) => isRecord(child) && typeof child.text === 'string' ? [child.text] : []).join('')
    return text ? [{text, ...(typeof block.style === 'string' ? {style: block.style} : {}), ...(typeof block.listItem === 'string' ? {listItem: block.listItem} : {})}] : []
  }) : []
}
/** SEO tal como está en el documento, sin respaldo: `resolveSeo` decide si basta. */
function ownSeo(value: unknown): SeoData {
  if (!isRecord(value)) return {}
  return {
    ...(typeof value.metaTitle === 'string' ? {title: value.metaTitle} : {}),
    ...(typeof value.metaDescription === 'string' ? {description: value.metaDescription} : {}),
    ...(typeof value.noIndex === 'boolean' ? {noIndex: value.noIndex} : {}),
  }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
