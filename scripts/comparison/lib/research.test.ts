import assert from 'node:assert/strict'
import test from 'node:test'
import {assertPublicWebsiteUrl, crawlOfficialWebsite} from '../../content/lib/website-crawler'
import type {BusinessFacts, EnrichedEntity, Fact, SourceProvenance} from '../../content/lib/types'
import {enrichComparison} from './enrichment'
import {researchPotentialCandidates} from './research'
import type {ResearchResultCache} from './research-cache'
import {scoreBusiness} from './scoring'
import type {ComparisonCandidateArtifact} from './types'

test('potential se confirma con breakfast en una página oficial enlazada y conserva provenance', async () => {
  const item = entity('business-breakfast', 'https://breakfast.example/')
  const calls: string[] = []
  const fetcher = mockFetch((url) => {
    calls.push(url)
    if (new URL(url).pathname === '/') return html('<a href="/breakfast-menu">Breakfast Menu</a>')
    return html('<main>We serve breakfast every day.</main>')
  })
  const candidates = artifact([item])

  const research = await researchPotentialCandidates(candidates, new Map([[item.id, item]]), NOW, {fetcher})
  const bundle = research.get(item.id)!
  const enriched = enrichComparison(candidates, new Map([[item.id, item]]), manual(), NOW, research)

  assert.equal(bundle.research.status, 'confirmed')
  assert.deepEqual(bundle.research.pagesVisited, ['https://breakfast.example/', 'https://breakfast.example/breakfast-menu'])
  assert.ok(bundle.research.newEvidence.some((evidence) => evidence.value === 'breakfast' && evidence.sourceStage === 'comparison-research'))
  assert.equal(enriched.businesses[0]?.origin, 'potential')
  const fact = enriched.businesses[0]?.evidence.services.find((evidence) => evidence.sourceStage === 'comparison-research')
  assert.equal(fact?.nature, 'self_claim')
  assert.equal(enriched.businesses[0]?.sources.find((source) => source.key === fact?.sourceKeys[0])?.url, 'https://breakfast.example/breakfast-menu')
  assert.equal(calls.length, 2)
})

test('supporting evidence no confirma por sí sola un potential', async () => {
  const item = entity('business-croissants', 'https://croissants.example/')
  const research = await researchPotentialCandidates(artifact([item]), new Map([[item.id, item]]), NOW, {
    fetcher: mockFetch(() => html('<main>Coffee, croissants and cakes.</main>')),
  })
  const bundle = research.get(item.id)!
  const enriched = enrichComparison(artifact([item]), new Map([[item.id, item]]), manual(), NOW, research)

  assert.equal(bundle.research.status, 'no-direct-evidence')
  assert.ok(bundle.research.newEvidence.some((evidence) => evidence.strength === 'supporting' && evidence.value === 'croissants'))
  assert.equal(enriched.businesses.length, 0)
  assert.equal(enriched.investigations?.[0]?.outcome, 'rejected')
})

test('Entrecot Café de París no produce direct evidence durante research', async () => {
  const item = entity('business-tepuy-research', 'https://tepuy.example/')
  const research = await researchPotentialCandidates(artifact([item]), new Map([[item.id, item]]), NOW, {
    fetcher: mockFetch(() => html('<main>Burgers y Entrecot Café de París.</main>')),
  })

  assert.equal(research.get(item.id)?.research.status, 'no-direct-evidence')
  assert.equal(research.get(item.id)?.research.newEvidence.some((evidence) => evidence.strength === 'direct'), false)
})

test('potential sin website queda rechazado sin ejecutar fetch', async () => {
  const item = entity('business-no-website', null)
  let calls = 0
  const research = await researchPotentialCandidates(artifact([item]), new Map([[item.id, item]]), NOW, {
    fetcher: mockFetch(() => { calls += 1; return html('unused') }),
  })

  assert.equal(research.get(item.id)?.research.status, 'no-official-website')
  assert.equal(calls, 0)
})

test('website unreachable no aborta el resto del run', async () => {
  const broken = entity('business-broken', 'https://broken.example/')
  const working = entity('business-working', 'https://working.example/')
  const fetcher = mockFetch((url) => {
    if (url.includes('broken.example')) throw new Error('connection refused')
    return html('<main>Breakfast served daily.</main>')
  })

  const research = await researchPotentialCandidates(artifact([broken, working]), new Map([[broken.id, broken], [working.id, working]]), NOW, {fetcher, concurrency: 2})

  assert.equal(research.get(broken.id)?.research.status, 'unreachable')
  assert.ok((research.get(broken.id)?.research.plan?.attemptedDimensions.length ?? 0) > 0)
  assert.equal(research.get(working.id)?.research.status, 'confirmed')
})

test('no sigue enlaces externos ni redirects a dominios ajenos', async () => {
  const externalLink = entity('business-external-link', 'https://official.example/')
  const redirected = entity('business-external-redirect', 'https://redirect.example/')
  const calls: string[] = []
  const fetcher = mockFetch((url) => {
    calls.push(url)
    if (url.includes('official.example')) return html('<a href="https://evil.example/breakfast">Breakfast</a>')
    return new Response(null, {status: 302, headers: {location: 'https://evil.example/breakfast'}})
  })

  const research = await researchPotentialCandidates(artifact([externalLink, redirected]), new Map([[externalLink.id, externalLink], [redirected.id, redirected]]), NOW, {fetcher})

  assert.equal(calls.some((url) => url.includes('evil.example')), false)
  assert.equal(research.get(externalLink.id)?.research.status, 'no-direct-evidence')
  assert.deepEqual(research.get(externalLink.id)?.research.urlsAttempted, ['https://official.example/'])
  assert.ok(research.get(externalLink.id)?.research.urlsDiscarded?.some((item) => item.reason.includes('otro dominio')))
  assert.equal(research.get(redirected.id)?.research.status, 'unreachable')
})

test('protección SSRF bloquea localhost, IP privadas y DNS privado', async () => {
  const publicDns = async () => ['93.184.216.34']
  for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'http://172.16.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/', 'http://[::1]/']) {
    await assert.rejects(assertPublicWebsiteUrl(url, publicDns), /pública|privada|reservada/)
  }
  await assert.rejects(assertPublicWebsiteUrl('https://looks-public.example/', async () => ['10.0.0.8']), /privada|reservada/)
  await assert.rejects(assertPublicWebsiteUrl('file:///etc/passwd', publicDns), /HTTP o HTTPS/)
})

test('crawl limita homepage más cinco páginas internas relevantes', async () => {
  const item = entity('business-many-links', 'https://many.example/')
  const calls: string[] = []
  const links = Array.from({length: 100}, (_, index) => `<a href="/menu-${index}">Menu ${index}</a>`).join('')
  const research = await researchPotentialCandidates(artifact([item]), new Map([[item.id, item]]), NOW, {
    fetcher: mockFetch((url) => { calls.push(url); return html(new URL(url).pathname === '/' ? links : '<main>Food only.</main>') }),
  })

  assert.equal(calls.length, 6)
  assert.equal(research.get(item.id)?.research.pagesVisited.length, 6)
  assert.equal(research.get(item.id)?.research.metrics?.requests, 6)
  assert.ok(research.get(item.id)?.research.urlsDiscarded?.some((entry) => entry.reason.includes('Límite')))
})

test('crawl aplica un límite de tiempo total y no continúa con páginas pendientes', async () => {
  let calls = 0
  const crawl = await crawlOfficialWebsite('https://time.example/', NOW, {
    timeoutMs: 5,
    linkHints: ['breakfast'],
    fetcher: mockFetch(async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 15))
      return html('<a href="/breakfast">Breakfast</a>')
    }),
  })
  assert.equal(calls, 1)
  assert.equal(crawl.pages.length, 1)
  assert.ok(crawl.diagnostics.discardedUrls.some((item) => item.reason.includes('Límite de tiempo')))
})

test('cache compartida descarga una URL una sola vez durante el run', async () => {
  const one = entity('business-cache-one', 'https://shared.example/')
  const two = entity('business-cache-two', 'https://shared.example/?utm_source=duplicate')
  const calls: string[] = []
  const fetcher = mockFetch((url) => {
    calls.push(url)
    return html(new URL(url).pathname === '/' ? '<a href="/menu">Menu</a><a href="/menu/">Carta</a>' : '<main>Breakfast.</main>')
  })

  const research = await researchPotentialCandidates(artifact([one, two]), new Map([[one.id, one], [two.id, two]]), NOW, {fetcher, concurrency: 2})

  assert.equal(research.get(one.id)?.research.status, 'confirmed')
  assert.equal(research.get(two.id)?.research.status, 'confirmed')
  assert.equal(calls.length, 2)
  assert.equal(calls.some((url) => /^https:\/\/shared\.example\/menu\/?$/.test(url)), true)
})

test('un direct con cobertura incompleta recibe investigación dirigida', async () => {
  let calls = 0
  const item = entity('business-direct-incomplete', 'https://direct.example/')
  const value = artifact([item])
  value.candidates[0]!.matchType = 'direct'
  const research = await researchPotentialCandidates(value, new Map([[item.id, item]]), NOW, {
    fetcher: mockFetch(() => { calls += 1; return html('<main>Desayuno con terraza en el casco antiguo.</main>') }),
  })
  const result = research.get(item.id)!.research
  assert.equal(calls, 1)
  assert.equal(result.status, 'confirmed')
  assert.ok(result.plan?.attemptedDimensions.includes('services'))
  assert.ok(result.newEvidence.some((evidence) => evidence.field === 'location'))
})

test('un direct aprovecha un producto HTML con precio sin duplicarlo como dimensión prices', async () => {
  const item = entity('business-direct-commercial', 'https://commercial.example/')
  item.facts.services = sourced(['desayuno'], `source:${item.id}`)
  const value = artifact([item]); value.candidates[0]!.matchType = 'direct'
  const research = await researchPotentialCandidates(value, new Map([[item.id, item]]), NOW, {
    fetcher: mockFetch(() => html('<section class="menu"><h2>Carta</h2><li><strong>Tosta de tomate</strong> 4,50 €</li></section>')),
  })
  const bundle = research.get(item.id)!
  assert.equal(bundle.research.status, 'confirmed')
  assert.equal(bundle.evidence.featuredItems.length, 1)
  assert.equal(bundle.evidence.prices.length, 0)
  assert.deepEqual(bundle.evidence.featuredItems[0]?.sourceKeys, ['official-website:https://commercial.example/'])
  assert.equal(bundle.research.extraction?.byFormat.html, 1)
  assert.equal(bundle.research.plan?.coveredAfter.includes('featuredItems'), true)
})

test('un direct con cobertura suficiente evita crawls innecesarios', async () => {
  const item = entity('business-direct-complete', 'https://unused.example/')
  item.facts.services = sourced(['desayuno'], `source:${item.id}`)
  item.facts.locationContext = sourced('casco antiguo', `source:${item.id}`)
  item.facts.openingInformation = sourced(['Mo-Su 08:00-20:00'], `source:${item.id}`)
  const value = artifact([item]); value.candidates[0]!.matchType = 'direct'
  let calls = 0
  const research = await researchPotentialCandidates(value, new Map([[item.id, item]]), NOW, {fetcher: mockFetch(() => { calls += 1; return html('unused') })})
  assert.equal(calls, 0)
  assert.equal(research.get(item.id)?.research.status, 'not-required')
  assert.deepEqual(research.get(item.id)?.research.plan?.attemptedDimensions, [])
  assert.ok((research.get(item.id)?.research.plan?.plannedDimensions?.length ?? 0) > 0)
})

test('una fuente corporativa sin alcance local no se rastrea', async () => {
  const item = entity('business-brand', 'https://brand.example/')
  item.sources.push({...source('official:brand'), provider: 'official-website', url: 'https://brand.example/', sourceClass: 'official-brand', claimScope: 'brand'})
  const value = artifact([item]); value.candidates[0]!.matchType = 'direct'
  let calls = 0
  const research = await researchPotentialCandidates(value, new Map([[item.id, item]]), NOW, {fetcher: mockFetch(() => { calls += 1; return html('unused') })})
  assert.equal(calls, 0)
  assert.equal(research.get(item.id)?.research.status, 'no-verifiable-source')
  assert.equal(research.get(item.id)?.research.limitation, 'source-scope')
  assert.deepEqual(research.get(item.id)?.research.plan?.attemptedDimensions, [])
})

test('reutiliza una investigación versionada sin repetir peticiones', async () => {
  const item = entity('business-persistent-cache', 'https://cache.example/')
  const candidates = artifact([item])
  let calls = 0
  let stored: import('./research').ComparisonResearchBundle | null = null
  const cache: ResearchResultCache = {
    async load() { return stored ? structuredClone(stored) : null },
    async save(_fingerprint, _now, bundle) { stored = structuredClone(bundle) },
  }
  const options = {resultCache: cache, fetcher: mockFetch(() => { calls += 1; return html('<main>Breakfast every day.</main>') })}
  await researchPotentialCandidates(candidates, new Map([[item.id, item]]), NOW, options)
  const reused = await researchPotentialCandidates(candidates, new Map([[item.id, item]]), NOW, options)
  assert.equal(calls, 1)
  assert.equal(reused.get(item.id)?.research.metrics?.cacheHit, true)
  assert.equal(reused.get(item.id)?.research.metrics?.requests, 0)
  await researchPotentialCandidates(candidates, new Map([[item.id, item]]), NOW, {...options, force: true})
  assert.equal(calls, 2)
})

const NOW = '2026-10-08T10:00:00.000Z'

function artifact(items: EnrichedEntity[], topic = 'desayunos'): ComparisonCandidateArtifact {
  return {
    schemaVersion: 2,
    id: `comparison-${topic}`,
    topic,
    searchIntent: `elegir ${topic}`,
    slug: topic,
    generatedAt: NOW,
    candidateCount: items.length,
    candidates: items.map((item) => ({
      businessId: item.id,
      qualityTier: 'basic',
      matchType: 'potential',
      evidence: [{field: 'businessKind', value: 'cafe', strength: 'supporting', sourceStage: 'existing', sourceKeys: [`source:${item.id}`]}],
      topicEvidence: [],
      scores: scoreBusiness(item, topic),
    })),
    excluded: [],
  }
}

function entity(id: string, website: string | null): EnrichedEntity {
  const key = `source:${id}`
  const empty = <T>(): Fact<T> => ({value: null, sources: []})
  const facts: BusinessFacts = {
    name: sourced(id, key), businessKind: sourced('cafe', key), address: sourced({locality: 'Benidorm'}, key), location: empty(),
    phone: empty(), website: website ? sourced(website, key) : empty(), openingHoursRaw: empty(), cuisine: empty(), concept: empty(),
    specialties: empty(), services: empty(), bookingAvailability: empty(), takeaway: empty(), delivery: empty(), terrace: empty(),
    accessibility: empty(), openingInformation: empty(), locationContext: empty(), distinctiveFeatures: empty(),
  }
  return {
    schemaVersion: 2, id, type: 'cafe', targetDocumentType: 'business', slug: id.replace('business-', ''), facts,
    factsBySource: {
      openStreetMap: facts,
      officialWebsite: {cuisine: empty(), concept: empty(), specialties: empty(), services: empty(), bookingAvailability: empty(), takeaway: empty(), delivery: empty(), terrace: empty(), accessibility: empty(), openingInformation: empty(), locationContext: empty(), distinctiveFeatures: empty()},
    },
    editorial: {}, sources: [source(key)],
  }
}

function manual() { return {topic: 'desayunos', sources: [], businesses: []} }
function sourced<T>(value: T, key: string): Fact<T> { return {value, sources: [key]} }
function source(key: string): SourceProvenance { return {key, provider: 'openstreetmap', identifier: key, url: 'https://www.openstreetmap.org/', retrievedAt: NOW, attribution: 'Test', licenseUrl: null} }
function html(body: string): Response { return new Response(`<!doctype html><html><body>${body}</body></html>`, {status: 200, headers: {'content-type': 'text/html; charset=utf-8'}}) }
function mockFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (input) => handler(String(input))) as typeof fetch
}
