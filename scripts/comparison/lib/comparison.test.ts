import assert from 'node:assert/strict'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import type {ContentDocument} from '../../content-validation'
import {validateContent} from '../../content-validation'
import {writeJsonAtomic} from '../../content/lib/files'
import {evaluateBusinessQualityTier} from '../../content/lib/quality'
import type {BusinessFacts, EnrichedEntity, Fact} from '../../content/lib/types'
import {compactPracticalLines, hasDuplicateSectionHeadings} from '../../../src/lib/comparison-presentation'
import {enrichComparison, emptyEvidence} from './enrichment'
import {evaluateComparisonDataGate} from './gate'
import {ManualJsonAdapter} from './manual-adapter'
import {inspectComparison} from './qa'
import {selectComparisonCandidates} from './selection'
import {compareScores, scoreBusiness, topicEvidence} from './scoring'
import type {ComparisonCandidateArtifact, EnrichedComparisonArtifact, GeneratedComparisonArtifact} from './types'

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
    assert.equal(result.searchIntent, 'elegir restaurante italiano en Benidorm')
    assert.deepEqual(result.candidates.map((candidate) => candidate.businessId), ['business-italiano'])
    assert.deepEqual(new Set(result.excluded.map((item) => item.reason)), new Set(['insufficient', 'not-relevant']))
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('topic arroces usa configuración data-driven y exige evidencia explícita', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-comparison-arroces-'))
  try {
    const rice = entity('business-arroces', ['mediterránea'])
    rice.facts.specialties = sourced(['Arroz a banda'], 'source:business-arroces')
    const mediterranean = entity('business-mediterraneo', ['mediterránea'])
    await mkdir(resolve(root, 'content/enriched'), {recursive: true})
    await writeJsonAtomic(resolve(root, 'content/enriched/rice.json'), rice)
    await writeJsonAtomic(resolve(root, 'content/enriched/mediterranean.json'), mediterranean)
    await writeJsonAtomic(resolve(root, 'content/manifest.json'), {version: 1, updatedAt: null, entries: [manifest(rice), manifest(mediterranean)]})

    const result = await selectComparisonCandidates({topic: 'arroces', id: 'comparison-arroces', dryRun: false, force: false}, root, '2026-10-07T00:00:00.000Z')

    assert.equal(result.searchIntent, 'elegir dónde comer arroz en Benidorm')
    assert.deepEqual(result.candidates.map((candidate) => candidate.businessId), ['business-arroces'])
    assert.deepEqual(result.candidates[0]?.topicEvidence, ['specialties=Arroz a banda'])
    assert.ok(result.excluded.some((candidate) => candidate.businessId === 'business-mediterraneo' && candidate.reason === 'not-relevant'))
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('el adapter manual conserva el contexto genérico de un precio', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-comparison-price-'))
  const path = resolve(root, 'comparison.json')
  try {
    await writeJsonAtomic(path, {
      topic: 'test',
      sources: [{key: 'official:test', provider: 'official-website', identifier: 'https://example.com/menu', url: 'https://example.com/menu', retrievedAt: '2026-10-07T00:00:00.000Z', attribution: 'Web oficial', licenseUrl: null}],
      businesses: [{businessId: 'business-test', evidence: {prices: [{id: 'price:test', value: {item: 'Menú de grupo', value: 34.75, currency: 'EUR', priceQualifier: 'por persona; mínimo 8 personas', retrievedAt: '2026-10-07'}, nature: 'factual', sourceKeys: ['official:test']}]}}],
    })

    const manual = await new ManualJsonAdapter(path).load()

    assert.deepEqual(manual.businesses[0]?.evidence.prices?.[0]?.value, {item: 'Menú de grupo', value: 34.75, currency: 'EUR', priceQualifier: 'por persona; mínimo 8 personas', retrievedAt: '2026-10-07'})
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('selectionScore ordena candidatos pero no crea ranking público obligatorio', () => {
  const italian = entity('business-z', ['italiana'])
  assert.deepEqual(topicEvidence(italian, 'italiano'), ['cuisine=italiana'])
  const a = {businessId: 'business-a', scores: scoreBusiness(entity('business-a', ['italiana']), 'italiano')}
  const b = {businessId: 'business-b', scores: scoreBusiness(entity('business-b', ['italiana']), 'italiano')}
  assert.deepEqual([b, a].sort(compareScores).map((item) => item.businessId), ['business-a', 'business-b'])
  const fixture = comparisonFixture()
  assert.ok(fixture.generated.editorial.entries.every((entry) => !('rank' in entry)))
  assert.ok((fixture.generated.document.entries as Array<Record<string, unknown>>).every((entry) => !('rank' in entry)))
})

test('choiceGuide cubre cada Business y exige evidence', () => {
  const fixture = comparisonFixture()
  assert.equal(fixture.generated.editorial.choiceGuide.length, 4)
  assert.equal(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).indexability, 'index')
  fixture.generated.editorial.claims = fixture.generated.editorial.claims.filter((claim) => !claim.path.startsWith('choiceGuide.business-uno'))
  assert.ok(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues.some((issue) => issue.path === 'choiceGuide.business-uno.reason' && issue.code === 'MISSING_CLAIM_DECLARATION'))
})

test('quickVerdict usa comparación cruzada y searchIntent falla ante una enumeración', () => {
  const fixture = comparisonFixture()
  assert.equal(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).searchIntentSatisfied, true)
  fixture.generated.editorial.quickVerdict = 'Trattoria Uno sirve pasta fresca. Trattoria Dos sirve focaccia. Trattoria Tres sirve pinsa. Trattoria Cuatro sirve pizza.'
  fixture.generated.editorial.claims = fixture.generated.editorial.claims.filter((claim) => claim.path !== 'quickVerdict')
  fixture.generated.editorial.claims.push({path: 'quickVerdict', claim: fixture.generated.editorial.quickVerdict, supportedBy: fixture.enriched.businesses.flatMap((business) => business.evidence.specialties.map((fact) => fact.id))})
  assert.ok(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues.some((issue) => issue.code === 'SEARCH_INTENT_NOT_SATISFIED'))
})

test('QA detecta bajo valor comparativo y cobertura insuficiente', () => {
  const fixture = comparisonFixture()
  for (const business of fixture.enriched.businesses) for (const dimension of ['specialties', 'featuredItems', 'prices', 'services', 'practical', 'limitations'] as const) business.evidence[dimension] = []
  const issues = inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues
  assert.ok(issues.some((issue) => issue.code === 'LOW_COMPARATIVE_VALUE'))
  assert.ok(issues.some((issue) => issue.code === 'INSUFFICIENT_EVIDENCE_COVERAGE'))
})

test('el gate previo detiene datasets insuficientes y deja pasar cobertura comparativa', () => {
  const fixture = comparisonFixture()
  assert.equal(evaluateComparisonDataGate(fixture.enriched).pass, true)

  fixture.enriched.businesses = fixture.enriched.businesses.slice(0, 1)
  const stopped = evaluateComparisonDataGate(fixture.enriched)

  assert.equal(stopped.pass, false)
  assert.deepEqual(new Set(stopped.issues.map((issue) => issue.code)), new Set(['MINIMUM_BUSINESSES', 'LOW_COMPARATIVE_VALUE', 'INSUFFICIENT_EVIDENCE_COVERAGE']))
})

test('QA avisa cuando se repite una afirmación larga entre secciones', () => {
  const fixture = comparisonFixture()
  fixture.generated.editorial.choiceGuide[0]!.reason = fixture.generated.editorial.entries[0]!.verdict
  fixture.generated.editorial.claims.push({path: 'choiceGuide.business-uno.reason', claim: fixture.generated.editorial.choiceGuide[0]!.reason, supportedBy: ['business-uno:specialty:0', 'business-uno:service:0']})
  assert.ok(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues.some((issue) => issue.code === 'REPETITIVE_COMPARISON_CONTENT'))
})

test('QA editorial detecta lenguaje técnico, fuentes raw, secciones vacías, repetición pública y celdas largas', () => {
  const fixture = comparisonFixture()
  fixture.generated.editorial.entries[0]!.strengths[0] = 'Pasta fresca artesanal documentada en la evidencia pública'
  fixture.generated.editorial.entries[0]!.bestFor = ['Una etiqueta deliberadamente demasiado larga para una celda de comparación rápida en cualquier dispositivo']
  fixture.generated.editorial.criteria = []
  fixture.generated.editorial.quickVerdict += ' La referencia figuraba a 12 €.'
  fixture.generated.document.sources = [{_type: 'source', title: 'official-website: https://example.com', publisher: 'manual-json: source', url: 'https://example.com'}]
  const issues = inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues
  const codes = new Set(issues.map((issue) => issue.code))
  assert.ok(codes.has('TECHNICAL_LANGUAGE_EXPOSED'))
  assert.ok(codes.has('RAW_SOURCE_IDENTIFIER_EXPOSED'))
  assert.ok(codes.has('EMPTY_PUBLIC_SECTION'))
  assert.ok(codes.has('PUBLIC_INFORMATION_REPETITION'))
  assert.ok(codes.has('OVERLONG_TABLE_CELL'))
  assert.equal(issues.find((issue) => issue.code === 'RAW_SOURCE_IDENTIFIER_EXPOSED')?.severity, 'FAIL')
  assert.equal(issues.find((issue) => issue.code === 'EMPTY_PUBLIC_SECTION')?.severity, 'FAIL')
  assert.equal(issues.find((issue) => issue.code === 'TECHNICAL_LANGUAGE_EXPOSED')?.severity, 'WARNING')
})

test('QA detecta un precio publicado sin su contexto', () => {
  const fixture = comparisonFixture()
  const price = fixture.enriched.businesses[0]!.evidence.prices[0]!.value
  if (typeof price !== 'object' || !('item' in price)) throw new Error('Fixture de precio no válido')
  price.priceQualifier = 'por persona; mínimo 2 personas'
  fixture.generated.editorial.entries[0]!.strengths[0] += ' por 12 €'

  const issues = inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues

  assert.ok(issues.some((issue) => issue.code === 'PRICE_CONTEXT_LOST' && issue.severity === 'FAIL'))
})

test('helpers de presentación compactan horarios y detectan headings duplicados sin depender del topic', () => {
  assert.deepEqual(compactPracticalLines(['Horario publicado: miércoles a sábado de 13:30 a 16:30 y de 20:30 a 23:00; domingo de 13:00 a 16:30.']), ['Mi–Sá: 13:30–16:30 / 20:30–23:00', 'Do: 13:00–16:30'])
  assert.equal(hasDuplicateSectionHeadings(['Comparación rápida', 'Fuentes', 'Comparación rápida']), true)
  assert.equal(hasDuplicateSectionHeadings(), false)
})

test('enrichment separa cuisine de specialties y registra conflictos de fuentes', () => {
  const item = entity('business-italiano', ['italiana', 'Focaccia'])
  item.facts.distinctiveFeatures = sourced(['vistas al mar'], 'official:item')
  item.facts.openingInformation = sourced(['Mo-Su 10:00-22:00'], 'official:item')
  item.factsBySource.openStreetMap.openingInformation = sourced(['Mo-Su 09:00-21:00'], 'osm:item')
  item.factsBySource.officialWebsite.openingInformation = sourced(['Mo-Su 10:00-22:00'], 'official:item')
  item.sources = [source('source:business-italiano'), source('osm:item', 'openstreetmap'), source('official:item', 'official-website')]
  const candidate: ComparisonCandidateArtifact = {
    schemaVersion: 1, id: 'comparison-italiano', topic: 'italiano', searchIntent: 'elegir restaurante italiano en Benidorm', slug: 'italiano', generatedAt: '2026-10-06T00:00:00.000Z', candidateCount: 1,
    candidates: [{businessId: item.id, qualityTier: 'basic', topicEvidence: ['cuisine=italiana'], scores: scoreBusiness(item, 'italiano')}], excluded: [],
  }
  const enriched = enrichComparison(candidate, new Map([[item.id, item]]), {topic: 'italiano', sources: [], businesses: []}, '2026-10-06T00:00:00.000Z')
  assert.ok(enriched.businesses[0]!.evidence.cuisine.every((fact) => fact.value !== 'Focaccia'))
  assert.ok(enriched.businesses[0]!.evidence.specialties.some((fact) => fact.value === 'Focaccia'))
  assert.ok(enriched.businesses[0]!.evidence.location.some((fact) => fact.value === 'vistas al mar'))
  assert.ok(enriched.businesses[0]!.evidence.specialties.every((fact) => fact.value !== 'vistas al mar'))
  assert.equal(enriched.sourceConflicts.length, 1)
  assert.deepEqual(enriched.businesses[0]!.evidence.practical.map((fact) => fact.value), ['Mo-Su 10:00-22:00'])
})

test('QA emite SOURCE_CONFLICT como warning', () => {
  const fixture = comparisonFixture()
  fixture.enriched.sourceConflicts.push({businessId: 'business-uno', dimension: 'practical', preferredSourceKeys: ['source:business-uno'], conflictingSourceKeys: ['osm:uno'], resolution: 'Se prioriza la web oficial.'})
  const result = inspectComparison(fixture.generated, fixture.enriched, fixture.businesses)
  assert.ok(result.issues.some((issue) => issue.code === 'SOURCE_CONFLICT' && issue.severity === 'WARNING'))
  assert.equal(result.indexability, 'index')
})

test('featured item conserva nombre, precio, fuente y fecha exactos', () => {
  const fixture = comparisonFixture()
  fixture.generated.editorial.entries[0]!.featuredItem!.source = 'source:inventada'
  assert.ok(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues.some((issue) => issue.code === 'FEATURED_ITEM_PROVENANCE'))
})

test('QA rechaza claims sin soporte y experiencia personal inventada', () => {
  const unsupported = comparisonFixture()
  unsupported.generated.editorial.claims[0]!.claim = 'Sirve chocolate belga'
  assert.ok(inspectComparison(unsupported.generated, unsupported.enriched, unsupported.businesses).issues.some((issue) => issue.code === 'UNSUPPORTED_COMPARISON_CLAIM'))
  const personal = comparisonFixture()
  personal.generated.editorial.intro = `He probado los cuatro restaurantes. ${personal.generated.editorial.intro}`
  assert.ok(inspectComparison(personal.generated, personal.enriched, personal.businesses).issues.some((issue) => issue.code === 'FAKE_FIRST_PERSON_EXPERIENCE'))
})

test('indexability sólo es index con intención, valor, cobertura, claims y SEO válidos', () => {
  const fixture = comparisonFixture()
  assert.equal(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).indexability, 'index')
  fixture.generated.editorial.seo.metaTitle = 'Guía gastronómica genérica'
  assert.equal(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).indexability, 'noindex')
})

test('SEO específico se valida con la configuración genérica del topic', () => {
  const fixture = comparisonFixture()
  fixture.enriched.topic = 'arroces'
  fixture.enriched.searchIntent = 'elegir dónde comer arroz en Benidorm'
  fixture.generated.topic = 'arroces'
  fixture.generated.searchIntent = fixture.enriched.searchIntent
  fixture.generated.editorial.seo.metaTitle = 'Dónde comer arroz en Benidorm: comparativa'
  fixture.generated.editorial.seo.metaDescription = 'Comparativa de restaurantes para elegir dónde comer arroz en Benidorm según platos, servicios y precios publicados.'

  assert.ok(!inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues.some((issue) => issue.code === 'GENERIC_SEO'))
})

test('claims comparativos toleran plurales sin reglas ligadas a una cocina', () => {
  const fixture = comparisonFixture()
  fixture.generated.editorial.quickVerdict = 'Mientras Trattoria Uno ofrece cocina italiana, Trattoria Dos presenta propuestas italianas.'
  fixture.generated.editorial.claims[0] = {
    path: 'quickVerdict',
    claim: fixture.generated.editorial.quickVerdict,
    supportedBy: ['business-uno:cuisine:0', 'business-dos:cuisine:0'],
  }

  const issues = inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues
  assert.ok(!issues.some((issue) => issue.code === 'UNSUPPORTED_COMPARISON_CLAIM' && issue.path === 'claims[0]'))
})

test('el documento Comparison cumple schema local y referencias tipadas', () => {
  const fixture = comparisonFixture()
  const result = validateContent([{document: fixture.generated.document, source: 'test', expectedType: 'comparison'}], {allowUnresolvedReferences: true})
  assert.deepEqual(result.issues, [])
  assert.ok(result.references.some((reference) => reference.path === 'entries[0].business' && reference.allowedTypes?.includes('business')))
  assert.ok(result.references.some((reference) => reference.path === 'choiceGuide[0].business' && reference.allowedTypes?.includes('business')))
})

function comparisonFixture(): {generated: GeneratedComparisonArtifact; enriched: EnrichedComparisonArtifact; businesses: Map<string, ContentDocument>} {
  const ids = ['business-uno', 'business-dos', 'business-tres', 'business-cuatro']
  const names = ['Trattoria Uno', 'Trattoria Dos', 'Trattoria Tres', 'Trattoria Cuatro']
  const specialties = ['Pasta fresca', 'Focaccia', 'Pinsa', 'Pizza casera']
  const services = ['Servicio para llevar', 'Reservas online', 'Reservas por WhatsApp', 'Menú del día']
  const enrichedBusinesses = ids.map((businessId, index) => {
    const evidence = emptyEvidence()
    const key = `source:${businessId}`
    evidence.cuisine.push({id: `${businessId}:cuisine:0`, value: 'italiana', nature: 'factual', sourceKeys: [key]})
    evidence.specialties.push({id: `${businessId}:specialty:0`, value: specialties[index]!, nature: 'factual', sourceKeys: [key]})
    evidence.featuredItems.push({id: `${businessId}:item:0`, value: {name: specialties[index]!, price: 12 + index, currency: 'EUR', source: key, retrievedAt: '2026-10-06'}, nature: 'factual', sourceKeys: [key]})
    evidence.prices.push({id: `${businessId}:price:0`, value: {item: specialties[index]!, value: 12 + index, currency: 'EUR', retrievedAt: '2026-10-06'}, nature: 'factual', sourceKeys: [key]})
    evidence.services.push({id: `${businessId}:service:0`, value: services[index]!, nature: 'factual', sourceKeys: [key]})
    evidence.practical.push({id: `${businessId}:practical:0`, value: `Horario ${12 + index}:00-22:00`, nature: 'factual', sourceKeys: [key]})
    return {businessId, name: names[index]!, qualityTier: 'basic' as const, topicEvidence: ['cuisine=italiana'], scores: {topicRelevance: 5, specificity: 3, comparisonCoverage: 5, distinctiveValue: 2, practicalUsefulness: 4, total: 19}, evidence, sources: [source(key)]}
  })
  const enriched: EnrichedComparisonArtifact = {schemaVersion: 1, id: 'comparison-italiano', topic: 'italiano', searchIntent: 'elegir restaurante italiano en Benidorm', slug: 'italiano', enrichedAt: '2026-10-06T00:00:00.000Z', businesses: enrichedBusinesses, sources: enrichedBusinesses.flatMap((item) => item.sources), sourceConflicts: []}
  const choiceGuide = ids.map((businessId, index) => ({businessId, label: `Para ${specialties[index]}`, reason: `${names[index]} documenta ${specialties[index]} en su propuesta publicada.`}))
  const entries = ids.map((businessId, index) => ({
    businessId, verdict: `${names[index]} se diferencia por ${specialties[index]} y por disponer de ${services[index]}.`,
    strengths: [`${specialties[index]} documentada`, `${services[index]} disponible`], limitations: [], bestFor: [specialties[index]!],
    featuredItem: {name: specialties[index]!, price: 12 + index, currency: 'EUR' as const, source: `source:${businessId}`, retrievedAt: '2026-10-06'},
    practicalNotes: [`Horario ${12 + index}:00-22:00`],
  }))
  const claims = [
    {path: 'quickVerdict', claim: 'Trattoria Uno documenta pasta fresca, mientras Trattoria Dos publica focaccia.', supportedBy: ['business-uno:specialty:0', 'business-dos:specialty:0']},
    ...ids.flatMap((businessId, index) => [
      {path: `choiceGuide.${businessId}.reason`, claim: choiceGuide[index]!.reason, supportedBy: [`${businessId}:specialty:0`]},
      {path: `entries.${businessId}.verdict`, claim: entries[index]!.verdict, supportedBy: [`${businessId}:specialty:0`, `${businessId}:service:0`]},
      {path: `entries.${businessId}.strengths.0`, claim: entries[index]!.strengths[0]!, supportedBy: [`${businessId}:specialty:0`]},
      {path: `entries.${businessId}.strengths.1`, claim: entries[index]!.strengths[1]!, supportedBy: [`${businessId}:service:0`]},
      {path: `entries.${businessId}.bestFor.0`, claim: entries[index]!.bestFor[0]!, supportedBy: [`${businessId}:specialty:0`]},
      {path: `entries.${businessId}.featuredItem`, claim: `${specialties[index]} ${12 + index} EUR`, supportedBy: [`${businessId}:item:0`]},
      {path: `entries.${businessId}.practicalNotes.0`, claim: entries[index]!.practicalNotes[0]!, supportedBy: [`${businessId}:practical:0`]},
    ]),
  ]
  const editorial = {
    title: 'Restaurantes italianos en Benidorm: pasta, pizza y más',
    intro: 'Esta comparativa contrasta platos concretos, precios publicados, formas de reserva y horarios para ayudar a elegir un restaurante italiano en Benidorm según cada necesidad.',
    quickVerdict: 'Trattoria Uno documenta pasta fresca, mientras Trattoria Dos publica focaccia. Para pinsa está Trattoria Tres; Trattoria Cuatro se distingue por pizza casera y menú del día.',
    choiceGuide, entries,
    methodology: 'Se consultaron datos abiertos, webs oficiales y cartas públicas. No todos los establecimientos han sido visitados personalmente. Los precios pueden cambiar y conviene confirmarlos antes de reservar.',
    criteria: ['Propuesta y especialidades documentadas', 'Precios publicados y fechados', 'Reservas, horarios y servicios', 'Diferencias útiles sin posiciones'],
    seo: {metaTitle: 'Restaurantes italianos en Benidorm: opciones y precios', metaDescription: 'Comparación de restaurantes italianos en Benidorm con platos, precios publicados, reservas y horarios para elegir según lo que buscas.'}, claims,
  }
  const document: ContentDocument = {
    _id: 'comparison-italiano', _type: 'comparison', title: editorial.title, slug: {_type: 'slug', current: 'italiano'}, language: 'es', topic: 'italiano', category: 'donde-comer', intro: editorial.intro, quickVerdict: editorial.quickVerdict,
    choiceGuide: choiceGuide.map((choice) => ({_type: 'comparisonChoice', business: {_type: 'reference', _ref: choice.businessId}, label: choice.label, reason: choice.reason})),
    entries: entries.map((entry) => ({_type: 'comparisonEntry', business: {_type: 'reference', _ref: entry.businessId}, verdict: entry.verdict, strengths: entry.strengths, limitations: [], bestFor: entry.bestFor, featuredItem: {_type: 'comparisonFeaturedItem', ...entry.featuredItem}, practicalNotes: entry.practicalNotes})),
    methodology: editorial.methodology, criteria: editorial.criteria, author: {_type: 'reference', _ref: 'author-david'}, sources: [{_type: 'source', title: 'Fuente', url: 'https://example.com', accessedAt: '2026-10-06'}], lastVerified: '2026-10-06', seo: {...editorial.seo, noIndex: true},
  }
  const generated: GeneratedComparisonArtifact = {schemaVersion: 1, id: 'comparison-italiano', topic: 'italiano', searchIntent: enriched.searchIntent, indexability: 'noindex', generatedAt: '2026-10-06T00:00:00.000Z', editorial, document}
  return {generated, enriched, businesses: new Map(ids.map((id) => [id, {_id: id, _type: 'business'}]))}
}

function entity(id: string, cuisine: string[] | null): EnrichedEntity {
  const sourceKey = `source:${id}`
  const empty = <T>(): Fact<T> => ({value: null, sources: []})
  const facts: BusinessFacts = {
    name: sourced(id, sourceKey), businessKind: sourced('restaurant', sourceKey), address: sourced({locality: 'Benidorm'}, sourceKey), location: empty(), phone: sourced('+34 900 000 000', sourceKey), website: sourced('https://example.com', sourceKey), openingHoursRaw: empty(),
    cuisine: cuisine ? sourced(cuisine, sourceKey) : empty(), concept: empty(), specialties: empty(), services: empty(), bookingAvailability: empty(), takeaway: empty(), delivery: empty(), terrace: empty(), accessibility: empty(), openingInformation: empty(), locationContext: empty(), distinctiveFeatures: empty(),
  }
  return {schemaVersion: 2, id, type: 'restaurant', targetDocumentType: 'business', slug: id.replace('business-', ''), facts, factsBySource: {openStreetMap: facts, officialWebsite: {cuisine: empty(), concept: empty(), specialties: empty(), services: empty(), bookingAvailability: empty(), takeaway: empty(), delivery: empty(), terrace: empty(), accessibility: empty(), openingInformation: empty(), locationContext: empty(), distinctiveFeatures: empty()}}, editorial: {}, sources: [source(sourceKey)]}
}
function sourced<T>(value: T, key: string): Fact<T> { return {value, sources: [key]} }
function source(key: string, provider = 'manual-json') { return {key, provider, identifier: key, url: 'https://example.com', retrievedAt: '2026-10-06T00:00:00.000Z', attribution: 'Test', licenseUrl: null} }
function manifest(item: EnrichedEntity) { const assessment = evaluateBusinessQualityTier(item.facts); return {id: item.id, type: item.type, slug: item.slug, status: 'enriched', priority: 50, sources: item.sources, discoveredAt: '2026-10-06T00:00:00.000Z', enrichedAt: '2026-10-06T00:00:00.000Z', generatedAt: null, validatedAt: null, importedAt: null, reviewedAt: null, publishedAt: null, qualityTier: assessment.tier, qualityAssessedAt: '2026-10-06T00:00:00.000Z', qualityReasons: assessment.reasons, missingUsefulFacts: assessment.missingUsefulFacts, lastError: null} }
