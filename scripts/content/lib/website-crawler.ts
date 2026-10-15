import {lookup} from 'node:dns/promises'
import {isIP} from 'node:net'
import {sourceKey} from './normalize'
import {extractPdfText} from './pdf-extractor'
import type {SourceProvenance} from './types'

export interface CrawledWebsitePage {
  url: string
  html: string
  text: string
  source: SourceProvenance
}

export interface CrawledPdfPage {
  pageNumber: number
  text: string
  source: SourceProvenance
}

export interface CrawledWebsiteDocument {
  url: string
  mediaType: 'application/pdf'
  byteLength: number
  totalPages: number
  truncated: boolean
  status: 'processed' | 'no-extractable-text'
  pages: CrawledPdfPage[]
}

export interface OfficialWebsiteCrawlResult {
  website: string
  pages: CrawledWebsitePage[]
  documents: CrawledWebsiteDocument[]
  diagnostics: WebsiteCrawlDiagnostics
}

export interface WebsiteCrawlDiagnostics {
  requests: number
  cacheHits: number
  durationMs: number
  attemptedUrls: string[]
  discardedUrls: Array<{url: string; reason: string}>
  documentsProcessed: number
  documentPages: number
  documentBytes: number
}

export class WebsiteCrawlError extends Error {
  constructor(message: string, readonly diagnostics: WebsiteCrawlDiagnostics) { super(message) }
}

export interface WebsiteCrawlerOptions {
  fetcher?: typeof fetch
  cache?: Map<string, Promise<CrawledWebsitePage | null>>
  documentCache?: Map<string, Promise<CrawledWebsiteDocument | null>>
  linkHints?: readonly string[]
  maxPages?: number
  maxDepth?: number
  timeoutMs?: number
  maxRedirects?: number
  maxDocuments?: number
  maxPdfBytes?: number
  maxPdfPages?: number
  dnsLookup?: (hostname: string) => Promise<readonly string[]>
}

export const WEBSITE_CRAWLER_VERSION = '3'

const DEFAULT_LINK_HINTS = [
  'menu', 'menus', 'menú', 'carta', 'food', 'eat', 'restaurant', 'restaurante',
  'cafeteria', 'servicios', 'services', 'about', 'nosotros', 'contact', 'reservas',
  'productos', 'products', 'catalogo', 'catálogo', 'tarifas', 'prices', 'horarios', 'hours', 'pdf',
] as const
const TRACKING_PARAMETERS = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i

export async function crawlOfficialWebsite(
  website: string,
  retrievedAt: string,
  options: WebsiteCrawlerOptions = {},
): Promise<OfficialWebsiteCrawlResult> {
  const startedAt = Date.now()
  const fetcher = options.fetcher ?? fetch
  const diagnostics: WebsiteCrawlDiagnostics = {
    requests: 0, cacheHits: 0, durationMs: 0, attemptedUrls: [], discardedUrls: [],
    documentsProcessed: 0, documentPages: 0, documentBytes: 0,
  }
  try {
  const initial = requestWebsiteUrl(await validatePublicWebsiteUrl(website, options, fetcher))
  const expectedHost = new URL(initial).hostname
  const maxPages = options.maxPages ?? 5
  const maxDepth = options.maxDepth ?? 1
  const maxDocuments = options.maxDocuments ?? 2
  const maxDurationMs = options.timeoutMs ?? 12_000
  const deadlineAt = startedAt + maxDurationMs
  const cache = options.cache ?? new Map<string, Promise<CrawledWebsitePage | null>>()
  const documentCache = options.documentCache ?? new Map<string, Promise<CrawledWebsiteDocument | null>>()
  const hints = uniqueNormalized([...DEFAULT_LINK_HINTS, ...(options.linkHints ?? [])])
  const queue: Array<{url: string; depth: number; score: number}> = [{url: initial, depth: 0, score: Number.MAX_SAFE_INTEGER}]
  const queued = new Set([canonicalWebsiteUrl(initial)])
  const visited = new Set<string>()
  const pages: CrawledWebsitePage[] = []
  const documents: CrawledWebsiteDocument[] = []

  while (queue.length && (pages.length < maxPages || documents.length < maxDocuments)) {
    if (Date.now() >= deadlineAt) {
      for (const pending of queue) diagnostics.discardedUrls.push({url: pending.url, reason: `Límite de tiempo de ${maxDurationMs} ms alcanzado.`})
      queue.length = 0
      break
    }
    queue.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    const next = queue.shift()!
    const canonical = canonicalWebsiteUrl(next.url)
    if (visited.has(canonical)) continue
    visited.add(canonical)
    if (isPdfUrl(next.url)) {
      if (documents.length >= maxDocuments) {
        diagnostics.discardedUrls.push({url: next.url, reason: `Límite de ${maxDocuments} documentos PDF alcanzado.`})
        continue
      }
      try {
        if (documentCache.has(canonical)) diagnostics.cacheHits += 1
        const document = await cachedDocument(documentCache, canonical, () => fetchPdfDocument(
          next.url, expectedHost, retrievedAt, options, fetcher, deadlineAt, (url) => {
            diagnostics.requests += 1
            diagnostics.attemptedUrls.push(url)
          },
        ))
        if (document) {
          documents.push(document)
          diagnostics.documentsProcessed += 1
          diagnostics.documentPages += document.pages.length
          diagnostics.documentBytes += document.byteLength
          if (document.status === 'no-extractable-text') diagnostics.discardedUrls.push({url: document.url, reason: 'PDF válido sin texto extraíble; no se aplicó OCR.'})
          if (document.truncated) diagnostics.discardedUrls.push({url: document.url, reason: `PDF truncado al límite de ${options.maxPdfPages ?? 10} páginas.`})
        }
      } catch (error) {
        diagnostics.discardedUrls.push({url: next.url, reason: `Error de descarga o parseo PDF: ${error instanceof Error ? error.message : String(error)}`})
      }
      continue
    }
    if (pages.length >= maxPages) {
      diagnostics.discardedUrls.push({url: next.url, reason: `Límite de ${maxPages} páginas HTML alcanzado.`})
      continue
    }
    if (cache.has(canonical)) diagnostics.cacheHits += 1
    const page = await cachedPage(cache, canonical, () => fetchHtmlPage(next.url, expectedHost, retrievedAt, options, fetcher, deadlineAt, (url) => {
      diagnostics.requests += 1
      diagnostics.attemptedUrls.push(url)
    }))
    if (!page) {
      diagnostics.discardedUrls.push({url: next.url, reason: 'La respuesta no era HTML utilizable.'})
      continue
    }
    const finalCanonical = canonicalWebsiteUrl(page.url)
    if (!visited.has(finalCanonical)) visited.add(finalCanonical)
    if (!pages.some((item) => canonicalWebsiteUrl(item.url) === finalCanonical)) pages.push(page)
    if (next.depth >= maxDepth || pages.length >= maxPages) continue
    const links = rankedInternalLinks(page.html, page.url, expectedHost, hints)
    diagnostics.discardedUrls.push(...links.discarded)
    for (const link of links.ranked) {
      const linkKey = canonicalWebsiteUrl(link.url)
      if (queued.has(linkKey) || visited.has(linkKey)) {
        diagnostics.discardedUrls.push({url: link.url, reason: 'URL duplicada o ya visitada.'})
        continue
      }
      queued.add(linkKey)
      queue.push({url: link.url, depth: next.depth + 1, score: link.score})
    }
  }

  for (const pending of queue) diagnostics.discardedUrls.push({url: pending.url, reason: `Límite de ${maxPages} páginas alcanzado.`})

  if (pages.length === 0) throw new Error('La web oficial no devolvió ninguna página HTML pública utilizable.')
  diagnostics.durationMs = Date.now() - startedAt
  diagnostics.discardedUrls = uniqueDiscarded(diagnostics.discardedUrls)
  return {website: initial, pages, documents, diagnostics}
  } catch (error) {
    diagnostics.durationMs = Date.now() - startedAt
    const failedUrl = diagnostics.attemptedUrls.at(-1)
    if (failedUrl) diagnostics.discardedUrls.push({url: failedUrl, reason: error instanceof Error ? error.message : String(error)})
    diagnostics.discardedUrls = uniqueDiscarded(diagnostics.discardedUrls)
    if (error instanceof WebsiteCrawlError) throw error
    throw new WebsiteCrawlError(error instanceof Error ? error.message : String(error), diagnostics)
  }
}

export function canonicalWebsiteUrl(value: string): string {
  const url = new URL(requestWebsiteUrl(value))
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString()
}

function requestWebsiteUrl(value: string): string {
  const url = new URL(value)
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMETERS.test(key)) url.searchParams.delete(key)
  url.searchParams.sort()
  return url.toString()
}

export function htmlToText(html: string): string {
  return decodeHtmlEntities(html
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, ' $1 ')
    .replace(/<(?:script|style|noscript|svg|nav|header|footer|aside)\b[\s\S]*?<\/(?:script|style|noscript|svg|nav|header|footer|aside)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()).slice(0, 300_000)
}

/** Text safe for factual matching: navigation/link labels alone are not treated as claims. */
export function htmlToEvidenceText(html: string): string {
  return decodeHtmlEntities(html
    .replace(/<a\b[\s\S]*?<\/a>/gi, ' ')
    .replace(/<(?:script|style|noscript|svg|nav|header|footer|aside)\b[\s\S]*?<\/(?:script|style|noscript|svg|nav|header|footer|aside)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()).slice(0, 300_000)
}

function isPdfUrl(value: string): boolean {
  try { return /\.pdf$/i.test(new URL(value).pathname) } catch { return false }
}

export async function assertPublicWebsiteUrl(
  value: string,
  dnsLookup: (hostname: string) => Promise<readonly string[]> = resolveHostname,
): Promise<string> {
  const url = basicPublicWebsiteUrl(value)
  const hostname = unbracket(url.hostname.toLowerCase())
  if (isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new Error('La web oficial no puede usar una dirección IP privada o reservada.')
  } else {
    const addresses = await dnsLookup(hostname)
    if (addresses.length === 0 || addresses.some((address) => !isPublicIp(address))) {
      throw new Error('La web oficial resuelve a una dirección privada, reservada o desconocida.')
    }
  }
  return url.toString()
}

function basicPublicWebsiteUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('La web oficial debe usar HTTP o HTTPS.')
  if (url.username || url.password) throw new Error('La web oficial no puede incluir credenciales.')
  const hostname = unbracket(url.hostname.toLowerCase())
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('La web oficial debe ser una URL pública.')
  }
  return url
}

async function validatePublicWebsiteUrl(value: string, options: WebsiteCrawlerOptions, fetcher: typeof fetch): Promise<string> {
  const basic = basicPublicWebsiteUrl(value).toString()
  const resolver = options.dnsLookup ?? (fetcher === fetch ? resolveHostname : async () => ['93.184.216.34'])
  return assertPublicWebsiteUrl(basic, resolver)
}

async function fetchHtmlPage(
  requested: string,
  expectedHost: string,
  retrievedAt: string,
  options: WebsiteCrawlerOptions,
  fetcher: typeof fetch,
  deadlineAt: number,
  onRequest: (url: string) => void,
): Promise<CrawledWebsitePage | null> {
  let current = requested
  const maxRedirects = options.maxRedirects ?? 5
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const remainingMs = deadlineAt - Date.now()
    if (remainingMs <= 0) throw new Error(`La web oficial superó el límite total de ${options.timeoutMs ?? 12_000} ms.`)
    current = await validatePublicWebsiteUrl(current, options, fetcher)
    if (!compatibleOfficialHost(new URL(current).hostname, expectedHost)) throw new Error('La web oficial redirige a un dominio distinto.')
    onRequest(current)
    const response = await fetcher(current, {
      headers: {'accept': 'text/html,application/xhtml+xml', 'user-agent': 'enBenidorm-content-pipeline/1.0'},
      redirect: 'manual',
      signal: AbortSignal.timeout(remainingMs),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`Redirect ${response.status} sin cabecera Location.`)
      current = requestWebsiteUrl(new URL(location, current).toString())
      continue
    }
    if (!response.ok) throw new Error(`La web oficial respondió ${response.status} ${response.statusText}.`)
    const contentType = response.headers.get('content-type') ?? ''
    if (!/(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) return null
    const finalUrl = response.url ? requestWebsiteUrl(response.url) : requestWebsiteUrl(current)
    const validatedFinal = await validatePublicWebsiteUrl(finalUrl, options, fetcher)
    if (!compatibleOfficialHost(new URL(validatedFinal).hostname, expectedHost)) throw new Error('La web oficial respondió desde un dominio distinto.')
    const html = (await response.text()).slice(0, 1_500_000)
    return {url: validatedFinal, html, text: htmlToText(html), source: websiteSource(validatedFinal, retrievedAt)}
  }
  throw new Error(`La web oficial superó el máximo de ${maxRedirects} redirects.`)
}

async function fetchPdfDocument(
  requested: string,
  expectedHost: string,
  retrievedAt: string,
  options: WebsiteCrawlerOptions,
  fetcher: typeof fetch,
  deadlineAt: number,
  onRequest: (url: string) => void,
): Promise<CrawledWebsiteDocument | null> {
  let current = requested
  const maxRedirects = options.maxRedirects ?? 5
  const maxBytes = options.maxPdfBytes ?? 5_000_000
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const remainingMs = deadlineAt - Date.now()
    if (remainingMs <= 0) throw new Error(`El PDF superó el límite total de ${options.timeoutMs ?? 12_000} ms.`)
    current = await validatePublicWebsiteUrl(current, options, fetcher)
    if (!compatibleOfficialHost(new URL(current).hostname, expectedHost)) throw new Error('El PDF redirige a un dominio distinto.')
    onRequest(current)
    const response = await fetcher(current, {
      headers: {'accept': 'application/pdf', 'user-agent': 'enBenidorm-content-pipeline/1.0'},
      redirect: 'manual', signal: AbortSignal.timeout(remainingMs),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`Redirect ${response.status} sin cabecera Location.`)
      current = requestWebsiteUrl(new URL(location, current).toString())
      continue
    }
    if (!response.ok) throw new Error(`El PDF respondió ${response.status} ${response.statusText}.`)
    const declaredSize = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new Error(`El PDF supera el límite de ${maxBytes} bytes.`)
    const contentType = response.headers.get('content-type') ?? ''
    if (!/(?:application\/pdf|application\/octet-stream)/i.test(contentType)) throw new Error(`Tipo de contenido no PDF: ${contentType || 'desconocido'}.`)
    const finalUrl = response.url ? requestWebsiteUrl(response.url) : requestWebsiteUrl(current)
    const validatedFinal = await validatePublicWebsiteUrl(finalUrl, options, fetcher)
    if (!compatibleOfficialHost(new URL(validatedFinal).hostname, expectedHost)) throw new Error('El PDF respondió desde un dominio distinto.')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new Error(`El PDF supera el límite de ${maxBytes} bytes.`)
    if (bytes.byteLength < 5 || new TextDecoder('ascii').decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('El archivo no tiene una firma PDF válida.')
    const byteLength = bytes.byteLength
    const parsed = await extractPdfText(bytes, options.maxPdfPages ?? 10)
    const pages = parsed.pages.filter((page) => page.text.length > 0).map((page) => ({
      pageNumber: page.pageNumber,
      text: page.text.slice(0, 100_000),
      source: pdfPageSource(validatedFinal, page.pageNumber, retrievedAt),
    }))
    return {
      url: validatedFinal, mediaType: 'application/pdf', byteLength,
      totalPages: parsed.totalPages, truncated: parsed.truncated,
      status: pages.length ? 'processed' : 'no-extractable-text', pages,
    }
  }
  throw new Error(`El PDF superó el máximo de ${maxRedirects} redirects.`)
}

function rankedInternalLinks(
  html: string,
  base: string,
  expectedHost: string,
  hints: readonly string[],
): {ranked: Array<{url: string; score: number}>; discarded: Array<{url: string; reason: string}>} {
  const ranked = new Map<string, {url: string; score: number}>()
  const discarded: Array<{url: string; reason: string}> = []
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = requestWebsiteUrl(new URL(decodeHtmlEntities(match[1] ?? ''), base).toString())
      const parsed = basicPublicWebsiteUrl(url)
      if (!compatibleOfficialHost(parsed.hostname, expectedHost)) {
        discarded.push({url, reason: 'Enlace descartado por pertenecer a otro dominio.'})
        continue
      }
      const anchor = htmlToText(match[2] ?? '')
      const haystack = normalizeComparable(`${parsed.pathname} ${anchor}`)
      const matches = hints.filter((hint) => phraseMatch(haystack, hint)).length
      if (matches === 0) {
        discarded.push({url, reason: 'Enlace sin hints de investigación relevantes.'})
        continue
      }
      const score = matches * 10 + Math.max(0, 5 - parsed.pathname.split('/').filter(Boolean).length)
      const key = canonicalWebsiteUrl(url)
      const previous = ranked.get(key)
      if (!previous || score > previous.score) ranked.set(key, {url, score})
    } catch { /* URLs no resolubles no son candidatas visitables. */ }
  }
  return {ranked: [...ranked.values()].sort((a, b) => b.score - a.score || a.url.localeCompare(b.url)), discarded: uniqueDiscarded(discarded)}
}

function cachedPage(
  cache: Map<string, Promise<CrawledWebsitePage | null>>,
  url: string,
  load: () => Promise<CrawledWebsitePage | null>,
): Promise<CrawledWebsitePage | null> {
  const cached = cache.get(url)
  if (cached) return cached
  const pending = load()
  cache.set(url, pending)
  return pending
}

function cachedDocument(
  cache: Map<string, Promise<CrawledWebsiteDocument | null>>,
  url: string,
  load: () => Promise<CrawledWebsiteDocument | null>,
): Promise<CrawledWebsiteDocument | null> {
  const cached = cache.get(url)
  if (cached) return cached
  const pending = load()
  cache.set(url, pending)
  return pending
}

function websiteSource(url: string, retrievedAt: string): SourceProvenance {
  const exact = requestWebsiteUrl(url)
  const canonical = canonicalWebsiteUrl(exact)
  return {
    key: sourceKey('official-website', canonical),
    provider: 'official-website',
    identifier: exact,
    url: exact,
    retrievedAt,
    attribution: `Sitio web oficial (${new URL(exact).hostname})`,
    licenseUrl: null,
    sourceClass: 'official-location',
    claimScope: 'establishment',
  }
}

function pdfPageSource(url: string, pageNumber: number, retrievedAt: string): SourceProvenance {
  const exact = requestWebsiteUrl(url)
  const identifier = `${exact}#page=${pageNumber}`
  return {
    key: sourceKey('official-document', identifier), provider: 'official-document', identifier,
    url: identifier, retrievedAt, attribution: `Documento PDF oficial (${new URL(exact).hostname}), página ${pageNumber}`,
    licenseUrl: null, sourceClass: 'official-location', claimScope: 'establishment',
  }
}

function compatibleOfficialHost(candidate: string, expected: string): boolean {
  return normalizedHost(candidate) === normalizedHost(expected)
}

function normalizedHost(value: string): string {
  return value.toLowerCase().replace(/^www\./, '')
}

async function resolveHostname(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, {all: true, verbatim: true})
  return [...new Set(records.map((record) => record.address))]
}

function isPublicIp(value: string): boolean {
  value = unbracket(value)
  if (isIP(value) === 4) {
    const parts = value.split('.').map(Number)
    const [a = 0, b = 0] = parts
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19)))
  }
  if (isIP(value) === 6) {
    const normalized = value.toLowerCase()
    return normalized !== '::' && normalized !== '::1'
      && !normalized.startsWith('fc') && !normalized.startsWith('fd')
      && !/^fe[89ab]/.test(normalized)
      && !normalized.startsWith('ff')
      && !normalized.startsWith('::ffff:127.')
      && !normalized.startsWith('::ffff:10.')
      && !normalized.startsWith('::ffff:192.168.')
  }
  return false
}

function unbracket(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
}

function phraseMatch(normalizedValue: string, term: string): boolean {
  const normalizedTerm = normalizeComparable(term)
  return Boolean(normalizedValue && normalizedTerm && ` ${normalizedValue} `.includes(` ${normalizedTerm} `))
}

function normalizeComparable(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function uniqueNormalized(values: readonly string[]): string[] {
  return [...new Map(values.map((value) => [normalizeComparable(value), value])).values()].filter(Boolean)
}

function uniqueDiscarded(values: Array<{url: string; reason: string}>): Array<{url: string; reason: string}> {
  return [...new Map(values.map((value) => [`${value.url}|${value.reason}`, value])).values()]
}

function decodeHtmlEntities(value: string): string {
  const entities: Record<string, string> = {amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' '}
  return value.replace(/&(#x?[\da-f]+|\w+);/gi, (original, entity: string) => {
    if (entity.startsWith('#')) {
      const hex = entity[1]?.toLowerCase() === 'x'
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : original
    }
    return entities[entity.toLowerCase()] ?? original
  })
}
