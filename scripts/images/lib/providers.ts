import {htmlToText} from '../../content/lib/website-crawler'
import {distanceMeters, type Coordinates, type ImageCandidate, type PlaceBasis, type RejectedCandidate} from './candidates'
import {commonsLicense, PEXELS_LICENSE, PIXABAY_LICENSE} from './licenses'

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const BITMAPS = new Set(['image/jpeg', 'image/png', 'image/webp'])
const AMBIENT_WARNING = 'No verifica el lugar: úsala como ambiental; ni el alt ni el pie pueden nombrar un lugar.'

export type JsonGetter = <T>(url: string, headers?: Record<string, string>) => Promise<T>

export interface ProviderResult {
  candidates: ImageCandidate[]
  rejected: RejectedCandidate[]
}

interface CommonsPage {
  title: string
  missing?: boolean
  coordinates?: Array<{lat: number; lon: number}>
  imageinfo?: Array<{
    url: string
    descriptionurl: string
    thumburl?: string
    width?: number
    height?: number
    mime?: string
    extmetadata?: Record<string, {value?: unknown}>
  }>
}

interface CommonsResponse {
  query?: {pages?: CommonsPage[]; geosearch?: Array<{title: string}>; search?: Array<{title: string}>}
}

function commonsUrl(params: Record<string, string>): string {
  const url = new URL(COMMONS_API)
  for (const [key, value] of Object.entries({action: 'query', format: 'json', formatversion: '2', ...params})) url.searchParams.set(key, value)
  return url.toString()
}

const IMAGE_INFO = {prop: 'imageinfo|coordinates', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '480', iiextmetadatalanguage: 'es'}

export const commonsQueries = {
  geosearch: (point: Coordinates, radius: number) => commonsUrl({list: 'geosearch', gscoord: `${point.lat}|${point.lng}`, gsradius: String(radius), gsnamespace: '6', gslimit: '50'}),
  files: (titles: string[]) => commonsUrl({titles: titles.join('|'), ...IMAGE_INFO}),
  category: (category: string) => commonsUrl({generator: 'categorymembers', gcmtitle: category, gcmtype: 'file', gcmlimit: '50', ...IMAGE_INFO}),
  searchCategory: (name: string) => commonsUrl({list: 'search', srsearch: name, srnamespace: '14', srlimit: '5'}),
  searchFiles: (term: string) => commonsUrl({generator: 'search', gsrsearch: `${term} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '50', ...IMAGE_INFO}),
}

function metaText(metadata: Record<string, {value?: unknown}> | undefined, key: string): string {
  const value = metadata?.[key]?.value
  return typeof value === 'string' ? htmlToText(value) : ''
}

function firstHref(metadata: Record<string, {value?: unknown}> | undefined, key: string): string | undefined {
  const value = metadata?.[key]?.value
  const href = typeof value === 'string' ? /href="([^"]+)"/.exec(value)?.[1] : undefined
  if (!href) return undefined
  const absolute = href.startsWith('//') ? `https:${href}` : href
  return /^https:\/\//.test(absolute) ? absolute : undefined
}

/** Pasa una página de `imageinfo` de Commons a candidata, o explica por qué se descarta. */
export function commonsCandidate(page: CommonsPage, context: {retrievedAt: string; center?: Coordinates; radius?: number; basis: PlaceBasis; warnings?: string[]}): ImageCandidate | RejectedCandidate {
  const id = `commons:${page.title}`
  const info = page.imageinfo?.[0]
  if (!info) return {id, reason: 'sin imageinfo'}
  if (!BITMAPS.has(info.mime ?? '')) return {id, reason: `formato no admitido: ${info.mime ?? 'desconocido'}`}
  const metadata = info.extmetadata
  const license = commonsLicense({license: metaText(metadata, 'License'), shortName: metaText(metadata, 'LicenseShortName'), url: metaText(metadata, 'LicenseUrl')})
  if (!license.ok) return {id, reason: license.reason}
  const author = metaText(metadata, 'Artist')
  if (!author) return {id, reason: 'sin autor'}

  const point = page.coordinates?.[0]
  const distance = point && context.center ? distanceMeters(context.center, {lat: point.lat, lng: point.lon}) : undefined
  const withinRadius = distance !== undefined && context.radius !== undefined && distance <= context.radius
  const basis: PlaceBasis = context.basis === 'coordinates' ? (withinRadius ? 'coordinates' : null) : context.basis
  const warnings = [...(context.warnings ?? [])]
  if (!basis) warnings.push(AMBIENT_WARNING)
  if (context.center && distance === undefined) warnings.push('El fichero no tiene coordenadas.')
  const takenAt = /\d{4}-\d{2}-\d{2}/.exec(metaText(metadata, 'DateTimeOriginal'))?.[0]
  const description = metaText(metadata, 'ImageDescription')
  const authorUrl = firstHref(metadata, 'Artist')

  return {
    id,
    provider: 'commons',
    title: page.title.replace(/^File:/, ''),
    thumbnailUrl: info.thumburl ?? info.url,
    sourceUrl: info.descriptionurl,
    originalUrl: info.url,
    author,
    ...(authorUrl ? {authorUrl} : {}),
    license: license.license,
    ...(description ? {sourceDescription: description} : {}),
    ...(takenAt ? {takenAt} : {}),
    retrievedAt: context.retrievedAt,
    ...(info.width ? {width: info.width} : {}),
    ...(info.height ? {height: info.height} : {}),
    ...(distance !== undefined ? {distanceMeters: distance} : {}),
    use: basis ? 'lugar' : 'ambiental',
    placeBasis: basis,
    warnings,
  }
}

export function splitResults(items: Array<ImageCandidate | RejectedCandidate>): ProviderResult {
  const result: ProviderResult = {candidates: [], rejected: []}
  for (const item of items) {
    if ('reason' in item) result.rejected.push(item)
    else result.candidates.push(item)
  }
  return result
}

export function commonsPages(response: CommonsResponse): CommonsPage[] {
  return (response.query?.pages ?? []).filter((page) => !page.missing)
}

interface PixabayResponse {
  hits?: Array<{id: number; pageURL: string; previewURL?: string; webformatURL: string; largeImageURL: string; user: string; user_id: number; tags?: string; imageWidth?: number; imageHeight?: number}>
}

export const pixabaySearchUrl = (term: string, key: string) => {
  const url = new URL('https://pixabay.com/api/')
  for (const [name, value] of Object.entries({key, q: term.slice(0, 100), image_type: 'photo', safesearch: 'true', per_page: '20', lang: 'es'})) url.searchParams.set(name, value)
  return url.toString()
}

export function pixabayCandidates(response: PixabayResponse, retrievedAt: string): ImageCandidate[] {
  return (response.hits ?? []).map((hit) => ({
    id: `pixabay:${hit.id}`,
    provider: 'pixabay',
    title: hit.tags ?? `Pixabay ${hit.id}`,
    thumbnailUrl: hit.webformatURL,
    sourceUrl: hit.pageURL,
    originalUrl: hit.largeImageURL,
    author: hit.user,
    authorUrl: `https://pixabay.com/users/${encodeURIComponent(hit.user)}-${hit.user_id}/`,
    license: PIXABAY_LICENSE,
    ...(hit.tags ? {sourceDescription: hit.tags} : {}),
    retrievedAt,
    ...(hit.imageWidth ? {width: hit.imageWidth} : {}),
    ...(hit.imageHeight ? {height: hit.imageHeight} : {}),
    use: 'ambiental',
    placeBasis: null,
    warnings: [AMBIENT_WARNING],
  }))
}

interface PexelsResponse {
  photos?: Array<{id: number; url: string; photographer: string; photographer_url?: string; alt?: string; width?: number; height?: number; src: {original: string; medium?: string; large?: string}}>
}

export const pexelsSearchUrl = (term: string) => {
  const url = new URL('https://api.pexels.com/v1/search')
  url.searchParams.set('query', term)
  url.searchParams.set('per_page', '20')
  return url.toString()
}

export function pexelsCandidates(response: PexelsResponse, retrievedAt: string): ImageCandidate[] {
  return (response.photos ?? []).map((photo) => ({
    id: `pexels:${photo.id}`,
    provider: 'pexels',
    title: photo.alt || `Pexels ${photo.id}`,
    thumbnailUrl: photo.src.medium ?? photo.src.large ?? photo.src.original,
    sourceUrl: photo.url,
    originalUrl: photo.src.original,
    author: photo.photographer,
    ...(photo.photographer_url ? {authorUrl: photo.photographer_url} : {}),
    license: PEXELS_LICENSE,
    ...(photo.alt ? {sourceDescription: photo.alt} : {}),
    retrievedAt,
    ...(photo.width ? {width: photo.width} : {}),
    ...(photo.height ? {height: photo.height} : {}),
    use: 'ambiental',
    placeBasis: null,
    warnings: [AMBIENT_WARNING],
  }))
}

export type {CommonsResponse, PexelsResponse, PixabayResponse}
