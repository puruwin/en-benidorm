import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import type {ContentDocument} from '../../content-validation'
import {validateContent} from '../../content-validation'
import {writeJsonAtomic} from '../../content/lib/files'
import {evaluateBusinessQualityTier} from '../../content/lib/quality'
import type {BusinessFacts, EnrichedEntity, Fact} from '../../content/lib/types'
import {selectComparisonCandidates} from './selection'
import {compareScores, scoreBusiness, topicEvidence} from './scoring'
import {inspectComparison} from './qa'
import type {EnrichedComparisonArtifact, GeneratedComparisonArtifact} from './types'
import {emptyEvidence} from './enrichment'

test('candidate filtering excluye insufficient e irrelevantes', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-comparison-'))
  try {
    const eligible = entity('business-italiano', ['italiana'])
    const irrelevant = entity('business-indio', ['india'])
    const insufficient = entity('business-vacio', null)
    for (const item of [eligible, irrelevant, insufficient]) await writeJsonAtomic(resolve(root, `content/enriched/${item.id}.json`), item)
    await writeJsonAtomic(resolve(root, 'content/manifest.json'), {version: 1, updatedAt: null, entries: [
      manifest(eligible), manifest(irrelevant), {...manifest(insufficient), qualityTier: 'insufficient'},
    ]})
    const result = await selectComparisonCandidates({topic: 'italiano', id: 'comparison-italiano', dryRun: false, force: false}, root, '2026-10-06T00:00:00.000Z')
    assert.deepEqual(result.candidates.map((candidate) => candidate.businessId), ['business-italiano'])
    assert.deepEqual(new Set(result.excluded.map((item) => item.reason)), new Set(['insufficient', 'not-relevant']))
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('topic relevance sólo usa facts con provenance y ranking es determinista', () => {
  const italian = entity('business-z', ['italiana'])
  assert.deepEqual(topicEvidence(italian, 'italiano'), ['cuisine=italiana'])
  italian.facts.cuisine.sources = []
  assert.deepEqual(topicEvidence(italian, 'italiano'), [])
  const a = {businessId: 'business-a', scores: scoreBusiness(entity('business-a', ['italiana']), 'italiano')}
  const b = {businessId: 'business-b', scores: scoreBusiness(entity('business-b', ['italiana']), 'italiano')}
  assert.deepEqual([b, a].sort(compareScores).map((item) => item.businessId), ['business-a', 'business-b'])
})

test('QA promociona PASS o WARNING cuando la Comparison está respaldada', () => {
  const fixture = comparisonFixture()
  const result = inspectComparison(fixture.generated, fixture.enriched, fixture.businesses)
  assert.notEqual(result.outcome, 'FAIL', JSON.stringify(result.issues))
  assert.equal(result.claimsRejected, 0)
})

test('QA detecta claims sin soporte, ranks duplicados y refs ausentes', () => {
  const unsupported = comparisonFixture()
  unsupported.generated.editorial.claims[0]!.claim = 'Sirve chocolate belga'
  assert.ok(inspectComparison(unsupported.generated, unsupported.enriched, unsupported.businesses).issues.some((issue) => issue.code === 'UNSUPPORTED_COMPARISON_CLAIM'))

  const duplicate = comparisonFixture()
  duplicate.generated.editorial.entries[1]!.rank = 1
  assert.ok(inspectComparison(duplicate.generated, duplicate.enriched, duplicate.businesses).issues.some((issue) => issue.code === 'DUPLICATE_RANK'))

  const missing = comparisonFixture()
  missing.businesses.delete('business-uno')
  assert.ok(inspectComparison(missing.generated, missing.enriched, missing.businesses).issues.some((issue) => issue.code === 'MISSING_BUSINESS_REF'))
})

test('QA exige provenance de evidence, precios, featured items y weaknesses', () => {
  const provenance = comparisonFixture()
  provenance.enriched.businesses[0]!.evidence.cuisine[0]!.sourceKeys = []
  assert.ok(inspectComparison(provenance.generated, provenance.enriched, provenance.businesses).issues.some((issue) => issue.code === 'INVALID_EVIDENCE_PROVENANCE'))

  const price = comparisonFixture()
  price.generated.editorial.entries[0]!.featuredPrice = '12 €'
  price.generated.editorial.claims.push({path: 'entries.business-uno.featuredPrice', claim: '12 €', supportedBy: ['business-uno:cuisine:0']})
  assert.ok(inspectComparison(price.generated, price.enriched, price.businesses).issues.some((issue) => issue.code === 'PRICE_PROVENANCE'))

  const item = comparisonFixture()
  item.generated.editorial.entries[0]!.featuredItem = 'Pasta fresca'
  item.generated.editorial.claims.push({path: 'entries.business-uno.featuredItem', claim: 'Pasta fresca', supportedBy: ['business-uno:cuisine:0']})
  assert.ok(inspectComparison(item.generated, item.enriched, item.businesses).issues.some((issue) => issue.code === 'FEATURED_ITEM_PROVENANCE'))

  const weakness = comparisonFixture()
  weakness.generated.editorial.entries[0]!.weaknesses = ['No abre los martes']
  weakness.generated.editorial.claims.push({path: 'entries.business-uno.weaknesses.0', claim: 'No abre los martes', supportedBy: ['business-uno:cuisine:0']})
  assert.ok(inspectComparison(weakness.generated, weakness.enriched, weakness.businesses).issues.some((issue) => issue.code === 'UNSUPPORTED_WEAKNESS'))
})

test('QA detecta experiencia personal inventada', () => {
  const fixture = comparisonFixture()
  fixture.generated.editorial.intro = `He probado los cuatro restaurantes. ${fixture.generated.editorial.intro}`
  assert.ok(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues.some((issue) => issue.code === 'FAKE_FIRST_PERSON_EXPERIENCE'))
})

test('el documento Comparison cumple schema local y referencias tipadas', () => {
  const fixture = comparisonFixture()
  const result = validateContent([{document: fixture.generated.document, source: 'test', expectedType: 'comparison'}], {allowUnresolvedReferences: true})
  assert.deepEqual(result.issues, [])
  assert.ok(result.references.some((reference) => reference.path === 'entries[0].business' && reference.allowedTypes?.includes('business')))
})

function comparisonFixture(): {generated: GeneratedComparisonArtifact; enriched: EnrichedComparisonArtifact; businesses: Map<string, ContentDocument>} {
  const ids = ['business-uno', 'business-dos', 'business-tres', 'business-cuatro']
  const names = ['Trattoria Uno', 'Trattoria Dos', 'Trattoria Tres', 'Trattoria Cuatro']
  const enrichedBusinesses = ids.map((businessId, index) => {
    const evidence = emptyEvidence()
    evidence.cuisine.push({id: `${businessId}:cuisine:0`, value: 'Pasta fresca', nature: 'factual', sourceKeys: [`source:${businessId}`]})
    return {businessId, name: names[index]!, qualityTier: 'basic' as const, topicEvidence: ['cuisine=italiana'], scores: {topicRelevance: 5, specificity: 1, comparisonCoverage: 1, distinctiveValue: 0, practicalUsefulness: 1, total: 8}, evidence, sources: [source(`source:${businessId}`)]}
  })
  const enriched: EnrichedComparisonArtifact = {schemaVersion: 1, id: 'comparison-italiano', topic: 'italiano', slug: 'italiano', enrichedAt: '2026-10-06T00:00:00.000Z', businesses: enrichedBusinesses, sources: enrichedBusinesses.flatMap((item) => item.sources)}
  const entries = ids.map((businessId, index) => ({businessId, rank: index + 1, verdict: `${names[index]} centra su propuesta documentada en pasta fresca.`, strengths: ['Pasta fresca documentada'], weaknesses: [], bestFor: ['Pasta fresca'], featuredItem: null, featuredPrice: null, practicalNotes: []}))
  const claims = [
    {path: 'quickVerdict', claim: 'Trattoria Uno y Trattoria Dos se centran en pasta fresca; Trattoria Tres y Trattoria Cuatro publican la misma especialidad como referencia.', supportedBy: ids.map((businessId) => `${businessId}:cuisine:0`)},
    ...ids.flatMap((businessId, index) => [
    {path: `entries.${businessId}.verdict`, claim: `${names[index]} centra su propuesta documentada en pasta fresca.`, supportedBy: [`${businessId}:cuisine:0`]},
    {path: `entries.${businessId}.strengths.0`, claim: 'Pasta fresca documentada', supportedBy: [`${businessId}:cuisine:0`]},
    {path: `entries.${businessId}.bestFor.0`, claim: 'Pasta fresca', supportedBy: [`${businessId}:cuisine:0`]},
    ]),
  ]
  const editorial = {
    title: 'Cuatro restaurantes italianos en Benidorm, comparados',
    intro: 'Esta comparativa contrasta cuatro restaurantes italianos de Benidorm a partir de información pública y verificable sobre sus propuestas.',
    quickVerdict: 'Trattoria Uno y Trattoria Dos se centran en pasta fresca; Trattoria Tres y Trattoria Cuatro publican la misma especialidad como referencia.',
    entries, methodology: 'Consultamos datos abiertos y webs oficiales. No todos los locales han sido visitados personalmente. Los precios pueden cambiar y deben comprobarse antes de reservar.',
    criteria: ['Relevancia directa para cocina italiana', 'Especificidad de platos documentados', 'Cobertura de información práctica'],
    seo: {metaTitle: 'Restaurantes italianos en Benidorm comparados', metaDescription: 'Comparamos cuatro restaurantes italianos de Benidorm con platos, diferencias prácticas, fuentes oficiales y una metodología editorial transparente.'}, claims,
  }
  const document: ContentDocument = {
    _id: 'comparison-italiano', _type: 'comparison', title: editorial.title, slug: {_type: 'slug', current: 'italiano'}, language: 'es', topic: 'italiano', category: 'donde-comer', intro: editorial.intro, quickVerdict: editorial.quickVerdict,
    entries: entries.map((entry) => ({_type: 'comparisonEntry', business: {_type: 'reference', _ref: entry.businessId}, rank: entry.rank, verdict: entry.verdict, strengths: entry.strengths, weaknesses: [], bestFor: entry.bestFor, practicalNotes: []})),
    methodology: editorial.methodology, criteria: editorial.criteria, author: {_type: 'reference', _ref: 'author-david'}, sources: [{_type: 'source', title: 'Fuente', url: 'https://example.com', accessedAt: '2026-10-06'}], lastVerified: '2026-10-06', seo: editorial.seo,
  }
  const generated: GeneratedComparisonArtifact = {schemaVersion: 1, id: 'comparison-italiano', topic: 'italiano', generatedAt: '2026-10-06T00:00:00.000Z', editorial, document}
  return {generated, enriched, businesses: new Map(ids.map((id) => [id, {_id: id, _type: 'business'}]))}
}

function entity(id: string, cuisine: string[] | null): EnrichedEntity {
  const sourceKey = `source:${id}`
  const sourced = <T>(value: T): Fact<T> => ({value, sources: [sourceKey]})
  const empty = <T>(): Fact<T> => ({value: null, sources: []})
  const facts: BusinessFacts = {
    name: sourced(id), businessKind: sourced('restaurant'), address: sourced({locality: 'Benidorm'}), location: empty(), phone: sourced('+34 900 000 000'), website: sourced('https://example.com'), openingHoursRaw: empty(),
    cuisine: cuisine ? sourced(cuisine) : empty(), concept: empty(), specialties: empty(), services: empty(), bookingAvailability: empty(), takeaway: empty(), delivery: empty(), terrace: empty(), accessibility: empty(), openingInformation: empty(), locationContext: empty(), distinctiveFeatures: empty(),
  }
  return {schemaVersion: 2, id, type: 'restaurant', targetDocumentType: 'business', slug: id.replace('business-', ''), facts, factsBySource: {openStreetMap: facts, officialWebsite: {cuisine: empty(), concept: empty(), specialties: empty(), services: empty(), bookingAvailability: empty(), takeaway: empty(), delivery: empty(), terrace: empty(), accessibility: empty(), openingInformation: empty(), locationContext: empty(), distinctiveFeatures: empty()}}, editorial: {}, sources: [source(sourceKey)]}
}
function source(key: string) { return {key, provider: 'manual-json', identifier: key, url: 'https://example.com', retrievedAt: '2026-10-06T00:00:00.000Z', attribution: 'Test', licenseUrl: null} }
function manifest(entity: EnrichedEntity) { const assessment = evaluateBusinessQualityTier(entity.facts); return {id: entity.id, type: entity.type, slug: entity.slug, status: 'enriched', priority: 50, sources: entity.sources, discoveredAt: '2026-10-06T00:00:00.000Z', enrichedAt: '2026-10-06T00:00:00.000Z', generatedAt: null, validatedAt: null, importedAt: null, reviewedAt: null, publishedAt: null, qualityTier: assessment.tier, qualityAssessedAt: '2026-10-06T00:00:00.000Z', qualityReasons: assessment.reasons, missingUsefulFacts: assessment.missingUsefulFacts, lastError: null} }
