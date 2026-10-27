import assert from 'node:assert/strict'
import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import {validateContent} from '../content-validation'
import {writeJsonAtomic} from '../content/lib/files'
import {evaluateBusinessQualityTier} from '../content/lib/quality'
import type {BusinessFacts, EnrichedEntity, Fact} from '../content/lib/types'
import {emptyEvidence} from '../comparison/lib/enrichment'
import {evaluateComparisonDataGate} from '../comparison/lib/gate'
import {selectComparisonCandidates} from '../comparison/lib/selection'
import {classifyTopicMatch, scoreBusiness} from '../comparison/lib/scoring'
import type {EnrichedComparisonArtifact} from '../comparison/lib/types'
import {isIndexable, restaurantIndexability} from '../../src/lib/indexability'
import type {BusinessDetail} from '../../src/types/content'

// La relación comercial con Frappé Tech (#22) solo muestra un aviso en la ficha: no puede
// intervenir en selección, scoring, gates ni indexación.
const CLIENT = {commercialRelationship: 'frappe-tech-client'} as const
const ROOT = resolve(import.meta.dirname, '../..')

test('selección: marcar un negocio como cliente no cambia candidatos, orden ni exclusiones', async () => {
  const select = async (marked: boolean) => {
    const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-commercial-'))
    try {
      const items = [entity('business-uno', ['italiana']), entity('business-dos', ['italiana']), entity('business-tres', ['india'])]
      for (const item of items) await writeJsonAtomic(resolve(root, `content/enriched/${item.id}.json`), marked ? {...item, ...CLIENT} : item)
      await writeJsonAtomic(resolve(root, 'content/manifest.json'), {version: 1, updatedAt: null, entries: items.map(manifest)})
      return await selectComparisonCandidates({topic: 'italiano', id: 'comparison-italiano', dryRun: false, force: false}, root, '2026-10-06T00:00:00.000Z')
    } finally { await rm(root, {recursive: true, force: true}) }
  }
  const [plain, marked] = await Promise.all([select(false), select(true)])
  assert.deepEqual(marked, plain)
  assert.deepEqual(plain.candidates.map((candidate) => candidate.businessId), ['business-dos', 'business-uno'])
})

test('scoring: el mismo negocio puntúa y encaja igual con o sin la marca de cliente', () => {
  const plain = entity('business-uno', ['italiana'])
  const marked = {...plain, ...CLIENT} as EnrichedEntity
  assert.deepEqual(classifyTopicMatch(marked, 'italiano'), classifyTopicMatch(plain, 'italiano'))
  assert.deepEqual(scoreBusiness(marked, 'italiano'), scoreBusiness(plain, 'italiano'))
})

test('gate: la marca de cliente no ayuda a pasar ni cambia la cobertura', () => {
  for (const size of [3, 4]) {
    const plain = comparison(size, false)
    assert.deepEqual(evaluateComparisonDataGate(comparison(size, true)), evaluateComparisonDataGate(plain))
  }
  assert.equal(evaluateComparisonDataGate(comparison(3, true)).pass, false)
})

test('indexación: la ficha de un cliente se indexa o no por las mismas razones', () => {
  for (const sources of [[{title: 'official-website: https://local.test/', url: 'https://local.test/', accessedAt: '2026-10-06'}], []]) {
    const plain = business({sources})
    const signals = restaurantIndexability(plain, {demo: false})
    assert.deepEqual(restaurantIndexability({...plain, ...CLIENT}, {demo: false}), signals)
    const input = {...signals, route: plain.href, title: plain.seo.title ?? null, incomingContextualLinks: 2}
    assert.deepEqual(isIndexable({...input, ...CLIENT} as typeof input), isIndexable(input))
  }
})

test('el campo no aparece en el código de selección, scoring, gates ni indexación', async () => {
  const files = [
    ...await sourceFiles('scripts/comparison'),
    ...await sourceFiles('scripts/content/lib'),
    resolve(ROOT, 'src/lib/indexability.ts'),
  ]
  assert.ok(files.length > 10)
  for (const file of files) {
    assert.ok(!(await readFile(file, 'utf8')).includes('commercialRelationship'), `${file} no debe leer commercialRelationship`)
  }
})

test('la relación comercial no puede venir de contenido local o generado: solo se marca a mano en Studio', () => {
  const document = {_id: 'business-local', _type: 'business', name: 'Local', slug: {_type: 'slug', current: 'local'}, businessKind: 'restaurant', shortDescription: 'Local.', language: 'es'}
  const issues = (doc: Record<string, unknown>) => validateContent([{document: doc as typeof document, source: 'test', expectedType: 'business'}], {allowUnresolvedReferences: true}).issues.map((issue) => issue.path)
  assert.deepEqual(issues(document), [])
  assert.deepEqual(issues({...document, ...CLIENT}), ['commercialRelationship'])
})

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(resolve(ROOT, directory), {recursive: true, withFileTypes: true})
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.ts')).map((entry) => resolve(entry.parentPath, entry.name))
}

function comparison(size: number, marked: boolean): EnrichedComparisonArtifact {
  const businesses = Array.from({length: size}, (_, index) => {
    const businessId = `business-${index}`
    const key = `source:${businessId}`
    const evidence = emptyEvidence()
    evidence.cuisine.push({id: `${businessId}:cuisine`, value: 'italiana', nature: 'factual', sourceKeys: [key]})
    evidence.specialties.push({id: `${businessId}:specialty`, value: `Plato ${index}`, nature: 'factual', sourceKeys: [key]})
    evidence.services.push({id: `${businessId}:service`, value: `Servicio ${index}`, nature: 'factual', sourceKeys: [key]})
    evidence.practical.push({id: `${businessId}:practical`, value: `Horario ${12 + index}:00-22:00`, nature: 'factual', sourceKeys: [key]})
    const item = {businessId, name: `Local ${index}`, qualityTier: 'basic' as const, topicEvidence: ['cuisine=italiana'], scores: {topicRelevance: 5, specificity: 3, comparisonCoverage: 4, distinctiveValue: 2, practicalUsefulness: 3, total: 17}, evidence, sources: [source(key)]}
    return marked ? {...item, ...CLIENT} : item
  })
  return {schemaVersion: 1, id: 'comparison-italiano', topic: 'italiano', searchIntent: 'elegir restaurante italiano en Benidorm', slug: 'italiano', enrichedAt: '2026-10-06T00:00:00.000Z', businesses, sources: businesses.flatMap((item) => item.sources), sourceConflicts: []}
}

function business(overrides: Partial<BusinessDetail> = {}): BusinessDetail {
  return {
    name: 'Casa Local', slug: 'local', href: '/restaurantes/local/', shortDescription: 'Arroces.', kind: 'Restaurante', categories: [],
    description: [], address: {street: 'Calle Mayor 1', postalCode: '03501', locality: 'Benidorm', province: 'Alicante', country: 'España'},
    hours: [], features: [], images: [], sources: [], seo: {title: 'Casa Local en Benidorm', description: 'D'},
    ...overrides,
  }
}

function entity(id: string, cuisine: string[]): EnrichedEntity {
  const key = `source:${id}`
  const empty = <T>(): Fact<T> => ({value: null, sources: []})
  const sourced = <T>(value: T): Fact<T> => ({value, sources: [key]})
  const facts: BusinessFacts = {
    name: sourced(id), businessKind: sourced('restaurant'), address: sourced({locality: 'Benidorm'}), location: empty(), phone: sourced('+34 900 000 000'), website: sourced('https://example.com'), openingHoursRaw: empty(),
    cuisine: sourced(cuisine), concept: empty(), specialties: id.endsWith('dos') ? sourced(['Pasta fresca', 'Pinsa']) : empty(), services: empty(), bookingAvailability: empty(), takeaway: empty(), delivery: empty(), terrace: empty(), accessibility: empty(), openingInformation: empty(), locationContext: empty(), distinctiveFeatures: empty(),
  }
  return {schemaVersion: 2, id, type: 'restaurant', targetDocumentType: 'business', slug: id.replace('business-', ''), facts, factsBySource: {openStreetMap: facts, officialWebsite: {cuisine: empty(), concept: empty(), specialties: empty(), services: empty(), bookingAvailability: empty(), takeaway: empty(), delivery: empty(), terrace: empty(), accessibility: empty(), openingInformation: empty(), locationContext: empty(), distinctiveFeatures: empty()}}, editorial: {}, sources: [source(key)]}
}

function source(key: string) { return {key, provider: 'manual-json', identifier: key, url: 'https://example.com', retrievedAt: '2026-10-06T00:00:00.000Z', attribution: 'Test', licenseUrl: null} }

function manifest(item: EnrichedEntity) {
  const assessment = evaluateBusinessQualityTier(item.facts)
  return {id: item.id, type: item.type, slug: item.slug, status: 'enriched', priority: 50, sources: item.sources, discoveredAt: '2026-10-06T00:00:00.000Z', enrichedAt: '2026-10-06T00:00:00.000Z', generatedAt: null, validatedAt: null, importedAt: null, reviewedAt: null, publishedAt: null, qualityTier: assessment.tier, qualityAssessedAt: '2026-10-06T00:00:00.000Z', qualityReasons: assessment.reasons, missingUsefulFacts: assessment.missingUsefulFacts, lastError: null}
}
