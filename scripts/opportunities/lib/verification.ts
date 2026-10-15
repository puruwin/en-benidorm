import {createHash} from 'node:crypto'
import type {DiscoveredEntity, EnrichedEntity, ManifestEntry, SourceProvenance} from '../../content/lib/types'
import {extractCommercialInformation} from '../../content/lib/commercial-extractor'
import {crawlOfficialWebsite, type OfficialWebsiteCrawlResult} from '../../content/lib/website-crawler'
import type {PresenceValue, VerificationArtifact, VerificationSignal, VerificationSignalType} from './verification-types'

export const VERIFICATION_ENRICHER_VERSION = 'p3a4-v1'
export const VERIFICATION_TTL_DAYS = {websiteReachability: 30, operationalEvidence: 30, identity: 180, contactChannels: 90} as const

export interface VerificationInput {entry: ManifestEntry; discovered?: DiscoveredEntity; enriched?: EnrichedEntity}
export interface VerificationOptions {now?: string; crawler?: typeof crawlOfficialWebsite}

export function verificationFingerprint(input: VerificationInput): string {
  return createHash('sha256').update(JSON.stringify({version: VERIFICATION_ENRICHER_VERSION, entry: input.entry, discovered: input.discovered, enriched: input.enriched})).digest('hex')
}

export function verificationIsFresh(artifact: VerificationArtifact, input: VerificationInput, now: string): boolean {
  return artifact.schemaVersion === 1 && artifact.fingerprint === verificationFingerprint(input)
    && Object.values(artifact.expiresAt).every((date) => Date.parse(date) > Date.parse(now))
}

export async function verifyBusiness(input: VerificationInput, options: VerificationOptions = {}): Promise<VerificationArtifact> {
  const now = options.now ?? new Date().toISOString()
  const tags = input.discovered?.raw.tags ?? {}
  const baseSources = uniqueSources([...(input.entry.sources ?? []), ...(input.discovered?.sources ?? []), ...(input.enriched?.sources ?? [])])
  const sourceMap = new Map(baseSources.map((source) => [source.key, source]))
  const sourceKeys = () => [...sourceMap.keys()]
  const tagKeys = input.discovered?.sources.map((source) => source.key) ?? input.entry.sources.map((source) => source.key)
  const website = input.enriched?.facts.website.value ?? tags.website ?? tags['contact:website']
  const websiteKeys = input.enriched?.facts.website.sources.length ? input.enriched.facts.website.sources : tagKeys
  const matchingSources = website ? baseSources.filter((source) => source.url && sameHost(source.url, website) && source.provider === 'official-website') : []
  const matchesBrand = Boolean(tags.brand) || matchingSources.some((source) => source.sourceClass === 'official-brand' || source.claimScope === 'brand')
  const matchingOfficialSource = matchingSources.some((source) => source.sourceClass === 'official-location' || source.claimScope === 'establishment' || (!source.sourceClass && !source.claimScope && /oficial/i.test(source.attribution)))
  const scope: PresenceValue['scope'] = matchesBrand ? 'brand' : matchingOfficialSource ? 'location' : 'unknown'
  let crawl: OfficialWebsiteCrawlResult | undefined
  const errors: VerificationArtifact['errors'] = []
  if (website) {
    try { crawl = await (options.crawler ?? crawlOfficialWebsite)(website, now, {maxPages: 5, maxDepth: 1, timeoutMs: 12_000, maxDocuments: 2}) }
    catch (error) { errors.push({url: website, message: error instanceof Error ? error.message : String(error)}) }
  }
  for (const page of crawl?.pages ?? []) {
    const adjusted = {...page.source,
      sourceClass: scope === 'brand' ? 'official-brand' as const : scope === 'location' ? 'official-location' as const : 'third-party' as const,
      claimScope: scope === 'brand' ? 'brand' as const : scope === 'location' ? 'establishment' as const : 'unknown' as const,
      attribution: scope === 'brand' ? 'Página oficial de marca (soporte, no prueba de ubicación)' : scope === 'location' ? 'Web oficial del establecimiento' : 'Web candidata enlazada desde datos abiertos (oficialidad no confirmada)',
    }
    sourceMap.set(adjusted.key, adjusted)
  }
  for (const document of crawl?.documents ?? []) for (const page of document.pages) sourceMap.set(page.source.key, {...page.source,
    sourceClass: scope === 'brand' ? 'official-brand' : scope === 'location' ? 'official-location' : 'third-party',
    claimScope: scope === 'brand' ? 'brand' : scope === 'location' ? 'establishment' : 'unknown',
  })
  const signal = (type: VerificationSignalType, observation: string, keys: string[], evidenceRole: VerificationSignal['evidenceRole'], url?: string): VerificationSignal => ({
    id: `verification:${type}:${createHash('sha1').update(`${observation}|${keys.join('|')}`).digest('hex').slice(0, 10)}`,
    type, observation, sourceKeys: [...new Set(keys)], observedAt: now, evidenceRole, ...(url ? {url} : {}),
  })
  const identitySignals: VerificationSignal[] = []
  const hasName = Boolean(input.discovered?.raw.name || input.enriched?.facts.name.value)
  const address = input.enriched?.facts.address.value
  const hasAddress = Boolean(address && (address.street || address.locality)) || Boolean(tags['addr:street'] || tags['addr:city'])
  const hasCoordinates = input.discovered?.raw.latitude != null && input.discovered.raw.longitude != null
  const phone = input.enriched?.facts.phone.value ?? tags.phone ?? tags['contact:phone']
  if (hasName) identitySignals.push(signal('name_match', 'El nombre está vinculado a la identidad canónica mediante una fuente identificada.', tagKeys, 'supporting'))
  if (hasAddress) identitySignals.push(signal('address_match', 'La fuente publica una dirección para esta identidad.', input.enriched?.facts.address.sources.length ? input.enriched.facts.address.sources : tagKeys, 'supporting'))
  if (hasCoordinates) identitySignals.push(signal('coordinates_match', 'La fuente abierta sitúa esta identidad en las coordenadas catalogadas.', tagKeys, 'supporting'))
  if (phone && hasAddress) identitySignals.push(signal('phone_match', 'Teléfono y dirección aparecen asociados a la misma identidad de origen.', input.enriched?.facts.phone.sources.length ? [...new Set([...input.enriched.facts.phone.sources, ...tagKeys])] : tagKeys, 'supporting'))
  const nameOnSite = crawl?.pages.some((page) => normalize(page.text).includes(normalize(input.discovered?.raw.name ?? input.enriched?.facts.name.value ?? ''))) ?? false
  const phoneOnSite = phone && crawl?.pages.some((page) => digits(page.text).includes(digits(phone)))
  const addressOnSite = address?.street && crawl?.pages.some((page) => normalize(page.text).includes(normalize(address.street!)))
  if (nameOnSite && website) identitySignals.push(signal('domain_match', 'La web enlazada contiene el nombre del negocio.', crawl!.pages.map((page) => page.source.key), scope === 'brand' ? 'supporting' : 'primary', website))
  if (phoneOnSite && addressOnSite) identitySignals.push(signal('phone_match', 'La web y el catálogo coinciden en teléfono y dirección.', crawl!.pages.map((page) => page.source.key), 'primary', website))
  const conflict = identitySignals.some((item) => item.type === 'identity_mismatch')
  const strong = identitySignals.some((item) => item.type === 'phone_match' && item.evidenceRole === 'primary') || (Boolean(phone) && hasAddress)
  const probable = hasName && hasCoordinates
  const identityStatus = conflict ? 'conflict' : strong ? 'strong-match' : probable || nameOnSite ? 'probable-match' : 'insufficient'

  const operationalSignals: VerificationSignal[] = []
  const closedTag = tags.closed === 'yes' || tags.disused === 'yes' || tags.abandoned === 'yes' || tags.shop === 'vacant' || Object.keys(tags).some((key) => key.startsWith('disused:') || key.startsWith('abandoned:'))
  if (closedTag) operationalSignals.push(signal('third_party_closed_signal', 'La fuente abierta contiene una etiqueta explícita de cierre, desuso o vacante; requiere confirmación humana.', tagKeys, 'supporting'))
  if (tags.opening_hours) operationalSignals.push(signal('third_party_open_signal', 'La fuente abierta publica horarios; es sólo soporte de posible actividad.', tagKeys, 'supporting'))
  if (tags.check_date && isRecent(tags.check_date, now, 90)) operationalSignals.push(signal('third_party_open_signal', `La fuente abierta fue comprobada el ${tags.check_date}; sólo aporta soporte y no confirma apertura.`, tagKeys, 'supporting'))
  const expectedName = input.discovered?.raw.name
  const extraction = extractCommercialInformation(crawl?.pages ?? [], crawl?.documents ?? [], expectedName ? {expectedName} : {})
  if (extraction.openingHours.length && scope === 'location') operationalSignals.push(signal('explicit_open_status', 'La web atribuible al establecimiento publica horarios de apertura.', extraction.openingHours.map((item) => item.sourceKey), 'primary'))
  const pageText = (crawl?.pages ?? []).map((page) => page.text).join(' ')
  if (scope === 'location' && /\b(?:permanently closed|cerrado permanentemente|cierre definitivo)\b/i.test(pageText)) operationalSignals.push(signal('explicit_closed_status', 'La web atribuible al establecimiento publica un cierre explícito.', crawl!.pages.map((page) => page.source.key), 'primary'))
  const websiteSignals: VerificationSignal[] = []
  if (website && crawl?.pages.length) {
    const keys = crawl.pages.map((page) => page.source.key)
    websiteSignals.push(signal('website_reachable', 'La URL respondió con HTML público utilizable; esto no prueba que el negocio esté abierto.', keys, scope === 'location' ? 'primary' : 'supporting', website))
    websiteSignals.push(signal(scope === 'location' ? 'official_location_page_active' : 'official_site_active', scope === 'brand' ? 'La web de marca está activa, sin acreditar por sí sola esta ubicación.' : scope === 'location' ? 'La web atribuida al establecimiento está activa.' : 'La web candidata está activa, pero su oficialidad local no está confirmada.', keys, scope === 'location' ? 'primary' : 'supporting', website))
    if (crawl.pages.some((page) => new URL(page.url).protocol === 'https:')) websiteSignals.push(signal('valid_tls', 'Al menos una página se obtuvo correctamente mediante HTTPS.', keys, 'primary', website))
    if (crawl.pages.some((page) => /<meta[^>]+name=["']viewport["']/i.test(page.html))) websiteSignals.push(signal('mobile_viewport_present', 'La web declara un viewport para dispositivos móviles.', keys, 'primary', website))
    if (crawl.pages.some((page) => /<script[^>]+type=["']application\/ld\+json["']/i.test(page.html))) websiteSignals.push(signal('structured_data_present', 'La web contiene datos estructurados JSON-LD.', keys, 'primary', website))
    if (crawl.pages.some((page) => /(?:rel=["']sitemap["']|href=["'][^"']*sitemap[^"']*)/i.test(page.html))) websiteSignals.push(signal('sitemap_present', 'La web enlaza o declara un sitemap.', keys, 'primary', website))
    if (crawl.pages.some((page) => /(?:contact|contacto)/i.test(new URL(page.url).pathname))) websiteSignals.push(signal('contact_page_present', 'El crawler alcanzó una página de contacto.', keys, 'primary', website))
    if (crawl.pages.some((page) => /(?:reserv|booking)/i.test(new URL(page.url).pathname))) websiteSignals.push(signal('booking_page_present', 'El crawler alcanzó una página de reserva.', keys, 'primary', website))
    if (hasRecentDate(crawl.pages.map((page) => page.html).join(' '), now)) {
      websiteSignals.push(signal('recent_content_detected', 'Se observó una fecha pública reciente en contenido de primera parte.', keys, scope === 'brand' ? 'supporting' : 'primary', website))
      if (scope === 'location') operationalSignals.push(signal('recent_first_party_content', 'Se observó contenido reciente de primera parte; no confirma por sí solo la apertura del local.', keys, 'primary', website))
    }
  } else if (website) websiteSignals.push(signal('website_unreachable', 'No se obtuvo HTML público utilizable de la URL durante esta ejecución.', websiteKeys, 'supporting', website))
  const open = operationalSignals.some((item) => ['explicit_open_status', 'recent_first_party_content', 'third_party_open_signal'].includes(item.type))
  const closed = operationalSignals.some((item) => ['explicit_closed_status', 'third_party_closed_signal'].includes(item.type))
  const operationalStatus = open && closed ? 'conflicting' : closed ? 'supported-closed' : open ? 'supported-open' : 'insufficient'

  const presence = (value: string, keys: string[], itemScope: PresenceValue['scope'] = 'unknown'): PresenceValue => ({value, sourceKeys: [...new Set(keys)], observedAt: now, scope: itemScope})
  const pages = crawl?.pages ?? []
  const links = pages.flatMap((page) => extractLinks(page.html, page.url).map((value) => ({value, key: page.source.key})))
  const pageEmails = pages.flatMap((page) => [...page.html.matchAll(/mailto:([^?"'\s>]+)/gi)].map((match) => ({value: decodeURIComponent(match[1]!), key: page.source.key})))
  const explicitEmails = unique([tags.email, tags['contact:email'], ...pageEmails.map((item) => item.value)])
  const phones = unique([phone, ...pages.flatMap((page) => [...page.html.matchAll(/tel:([^?"'\s>]+)/gi)].map((match) => decodeURIComponent(match[1]!)))])
  const forms = unique(pages.filter((page) => /<form\b/i.test(page.html) && (
    /(?:contact|contacto)/i.test(new URL(page.url).pathname)
    || /<form\b[^>]*(?:action|id|class|name)=["'][^"']*(?:contact|contacto|presupuesto|quote|reserv|booking)[^"']*["']/i.test(page.html)
  )).map((page) => page.url))
  const bookingUrls = unique(links.filter((item) => /(?:reserv|booking)/i.test(item.value)).map((item) => item.value))
  const quoteUrls = unique(links.filter((item) => /(?:presupuesto|quote|cotiz)/i.test(item.value)).map((item) => item.value))
  const ecommerceUrls = unique(links.filter((item) => /(?:tienda|shop|cart|checkout)/i.test(item.value)).map((item) => item.value))
  const socialUrls = unique([tags.facebook, tags.instagram, tags['contact:facebook'], tags['contact:instagram'], ...links.filter((item) => /(?:facebook|instagram|linkedin|tiktok|youtube)\.com/i.test(item.value)).map((item) => item.value)])
  const keyForUrl = (url: string) => links.find((item) => item.value === url)?.key ? [links.find((item) => item.value === url)!.key] : tagKeys
  const allSources = uniqueSources([...sourceMap.values()])
  return {
    schemaVersion: 1, businessId: input.entry.id, generatedAt: now, fingerprint: verificationFingerprint(input),
    expiresAt: Object.fromEntries(Object.entries(VERIFICATION_TTL_DAYS).map(([key, days]) => [key, addDays(now, days)])) as VerificationArtifact['expiresAt'],
    identityEvidence: {status: identityStatus, signals: identitySignals},
    operationalEvidence: {status: operationalStatus, signals: operationalSignals},
    digitalPresence: {
      ...(website ? {website: presence(website, [...websiteKeys, ...(crawl?.pages.map((page) => page.source.key) ?? [])], scope)} : {}),
      ...(website && scope === 'location' ? {officialLocationPage: presence(website, [...websiteKeys, ...(crawl?.pages.map((page) => page.source.key) ?? [])], scope)} : {}),
      phones: phones.map((value) => presence(value, value === phone ? (input.enriched?.facts.phone.sources ?? tagKeys) : keyForUrl(`tel:${value}`))),
      emails: explicitEmails.map((value) => presence(value, [...(value === tags.email || value === tags['contact:email'] ? tagKeys : []), ...pageEmails.filter((item) => item.value === value).map((item) => item.key)])), forms: forms.map((value) => presence(value, keyForUrl(value), scope)),
      bookingUrls: bookingUrls.map((value) => presence(value, keyForUrl(value), scope)), quoteRequestUrls: quoteUrls.map((value) => presence(value, keyForUrl(value), scope)),
      ecommerceUrls: ecommerceUrls.map((value) => presence(value, keyForUrl(value), scope)), socialProfiles: socialUrls.map((value) => presence(value, keyForUrl(value), scope)),
    },
    websiteSignals,
    commercialInformation: {items: extraction.items, openingHours: extraction.openingHours, counts: {services: extraction.summary.byDimension.services, products: extraction.summary.byDimension.products, prices: extraction.summary.byDimension.prices, openingHours: extraction.summary.byDimension.openingHours}},
    sources: allSources, sourceKeys: sourceKeys(), errors,
  }
}

function extractLinks(html: string, base: string): string[] {
  return unique([...html.matchAll(/href=["']([^"']+)["']/gi)].map((match) => { try { return new URL(match[1]!, base).toString() } catch { return '' } }).filter(Boolean))
}
function hasRecentDate(html: string, now: string): boolean {
  const cutoff = Date.parse(now) - 366 * 86_400_000
  return [...html.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].some((match) => { const time = Date.parse(match[1]!); return Number.isFinite(time) && time >= cutoff && time <= Date.parse(now) })
}
function isRecent(value: string, now: string, days: number): boolean { const time = Date.parse(value); return Number.isFinite(time) && time <= Date.parse(now) && time >= Date.parse(now) - days * 86_400_000 }
function addDays(value: string, days: number): string { return new Date(Date.parse(value) + days * 86_400_000).toISOString() }
function normalize(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\W/g, '') }
function digits(value: string): string { return value.replace(/\D/g, '') }
function sameHost(left: string, right: string): boolean { try { return new URL(left).hostname.replace(/^www\./, '') === new URL(right).hostname.replace(/^www\./, '') } catch { return false } }
function unique<T>(values: Array<T | null | undefined>): T[] { return [...new Set(values.filter((value): value is T => value !== null && value !== undefined && value !== ''))] }
function uniqueSources(values: SourceProvenance[]): SourceProvenance[] { return [...new Map(values.map((source) => [source.key, source])).values()] }
