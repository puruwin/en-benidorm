import assert from 'node:assert/strict'
import test from 'node:test'
import type {ContentDocument} from '../../content-validation'
import {validateGeneratedEditorial} from './ai'
import type {OfficialWebsiteResult} from './adapters'
import {enrichEntity} from './enrichment'
import {buildBusinessDocument, buildGenerationArtifact} from './generation'
import {evaluateBusinessQualityTier} from './quality'
import {inspectCandidates, jaccard, type QACandidate} from './qa'
import type {DiscoveredEntity, EnrichedEntity, GeneratedEditorial} from './types'

const discovered: DiscoveredEntity = {
  schemaVersion: 1, id: 'business-cafe-sol', type: 'cafe', targetDocumentType: 'business', slug: 'cafe-sol', priority: 60,
  sources: [{key: 'openstreetmap:node/1', provider: 'openstreetmap', identifier: 'node/1', url: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-06T10:00:00.000Z', attribution: '© OpenStreetMap contributors', licenseUrl: 'https://www.openstreetmap.org/copyright'}],
  raw: {name: 'Café Sol', tags: {amenity: 'cafe', website: 'https://example.com', 'addr:street': 'Calle Sol'}, latitude: 38.54, longitude: -0.13},
}

const editorial: GeneratedEditorial = {
  qualityTier: 'basic',
  shortDescription: 'Café Sol es una cafetería de cocina india situada en la calle Sol.',
  description: [{section: 'overview', text: 'Su propuesta se identifica de forma verificable con la cocina india.'}],
  highlights: ['Cocina india'],
  seo: {metaTitle: 'Café Sol: cocina india en Benidorm', metaDescription: 'Café Sol es una cafetería de cocina india situada en la calle Sol de Benidorm.'},
}

const emptyOfficial = officialFacts({})
const basicOfficial = officialFacts({
  cuisine: sourced(['india']),
  concept: sourced('Indian restaurant'),
})
const richOfficial = officialFacts({
  cuisine: sourced(['mediterránea']), specialties: sourced(['arroces']), terrace: sourced(true),
  locationContext: sourced('primera línea de Levante'), distinctiveFeatures: sourced(['vistas al mar']),
  bookingAvailability: sourced(true),
})

test('A: facts administrativos quedan insufficient y omiten generation', () => {
  const enriched = enrichEntity(discovered, emptyOfficial)
  const assessment = evaluateBusinessQualityTier(enriched.facts)
  assert.equal(assessment.tier, 'insufficient')
  const artifact = buildGenerationArtifact(enriched, assessment)
  assert.equal(artifact.generationSkipped, true)
  assert.equal(artifact.document, null)
})

test('B: cuisine y concept con provenance producen basic', () => {
  assert.equal(evaluateBusinessQualityTier(enrichEntity(discovered, basicOfficial).facts).tier, 'basic')
})

test('C: varias dimensiones editoriales producen rich', () => {
  assert.equal(evaluateBusinessQualityTier(enrichEntity(discovered, richOfficial).facts).tier, 'rich')
})

test('el Structured Output nuevo valida tier, secciones y campos permitidos', () => {
  assert.deepEqual(validateGeneratedEditorial(editorial, 'basic'), [])
  assert.deepEqual(validateGeneratedEditorial({qualityTier: 'insufficient', shortDescription: null, description: [], highlights: [], seo: null}), [])
  assert.match(validateGeneratedEditorial({...editorial, phone: '123'}, 'basic').at(-1)!, /campos no editoriales/)
  assert.ok(validateGeneratedEditorial({...editorial, shortDescription: 'corta'}, 'basic').length > 0)
  assert.ok(validateGeneratedEditorial({...editorial, qualityTier: 'rich'}, 'basic').some((error) => error.includes('evaluado por código')))
})

test('D: insufficient genera exclusivamente INSUFFICIENT_FACTS y outcome SKIPPED', () => {
  const enriched = enrichEntity(discovered, emptyOfficial)
  const assessment = evaluateBusinessQualityTier(enriched.facts)
  const result = inspectCandidates([{id: enriched.id, document: null, enriched, qualityAssessment: assessment, generationSkipped: true}])[0]!
  assert.equal(result.outcome, 'SKIPPED')
  assert.deepEqual(result.issues.map((issue) => issue.code), ['INSUFFICIENT_FACTS'])
})

test('E: basic pasa con una descripción, un highlight y SEO', () => {
  const enriched = enrichEntity(discovered, basicOfficial)
  const candidate = makeCandidate(enriched, editorial)
  const result = inspectCandidates([candidate])[0]!
  assert.equal(result.outcome, 'PASS', JSON.stringify(result.issues))
})

test('F: rich falla si un fact editorial carece de provenance', () => {
  const enriched = enrichEntity(discovered, richOfficial)
  const assessment = evaluateBusinessQualityTier(enriched.facts)
  enriched.facts.specialties.sources = []
  const richEditorial: GeneratedEditorial = {...editorial, qualityTier: 'rich', description: [
    {section: 'overview', text: 'Café Sol propone cocina mediterránea con especialidad documentada en arroces.'},
    {section: 'experience', text: 'Cuenta con terraza en primera línea de Levante y vistas al mar.'},
    {section: 'services', text: 'La disponibilidad de reservas figura entre sus servicios verificados.'},
  ]}
  const document = buildBusinessDocument(enriched, richEditorial)
  const result = inspectCandidates([{id: enriched.id, document, enriched, qualityAssessment: assessment, generationSkipped: false}])[0]!
  assert.equal(result.outcome, 'FAIL')
  assert.ok(result.issues.some((issue) => issue.code === 'fact-provenance'))
})

test('G: dos fichas casi idénticas generan WARNING similar-content', () => {
  const firstEnriched = enrichEntity(discovered, basicOfficial)
  const secondEnriched = structuredClone(firstEnriched)
  secondEnriched.id = 'business-cafe-luna'; secondEnriched.slug = 'cafe-luna'; secondEnriched.facts.name.value = 'Café Luna'
  const secondEditorial = {...editorial, shortDescription: editorial.shortDescription!.replace('Sol', 'Luna'), seo: {metaTitle: 'Café Luna: cocina india en Benidorm', metaDescription: editorial.seo!.metaDescription.replace('Sol', 'Luna')}}
  const results = inspectCandidates([makeCandidate(firstEnriched, editorial), makeCandidate(secondEnriched, secondEditorial)])
  assert.ok(results.every((result) => result.issues.some((issue) => issue.code === 'similar-content' && issue.severity === 'WARNING')))
})

test('H: texto largo que ignora facts distintivos falla por LOW_INFORMATION_DENSITY', () => {
  const enriched = enrichEntity(discovered, richOfficial)
  const assessment = evaluateBusinessQualityTier(enriched.facts)
  const document = buildBusinessDocument(enriched, {...editorial, qualityTier: 'rich', description: [
    {section: 'overview', text: 'Café Sol es un restaurante ubicado en Benidorm. Dispone de sitio web y teléfono para obtener información básica disponible.'},
    {section: 'practical', text: 'El establecimiento de restauración está incluido en la oferta local y es una opción para quienes buscan un negocio en la ciudad.'},
  ]})
  const result = inspectCandidates([{id: enriched.id, document, enriched, qualityAssessment: assessment, generationSkipped: false}])[0]!
  assert.ok(result.issues.some((issue) => issue.code === 'LOW_INFORMATION_DENSITY'))
})

test('QA detecta alteración factual y jaccard conserva su contrato', () => {
  const enriched = enrichEntity(discovered, basicOfficial)
  const candidate = makeCandidate(enriched, editorial)
  const altered = {...candidate, document: {...candidate.document, website: 'https://inventado.example'} as ContentDocument}
  assert.ok(inspectCandidates([altered])[0]?.issues.some((issue) => issue.code === 'factual-integrity'))
  assert.equal(jaccard('uno dos tres', 'uno dos tres'), 1)
  assert.equal(jaccard('uno dos', 'tres cuatro'), 0)
})

function makeCandidate(enriched: EnrichedEntity, generated: GeneratedEditorial): QACandidate {
  const qualityAssessment = evaluateBusinessQualityTier(enriched.facts)
  return {id: enriched.id, document: buildBusinessDocument(enriched, generated), enriched, qualityAssessment, generationSkipped: false}
}

function sourced<T>(value: T) { return {value, sources: ['official-website:https://example.com/']} }

function officialFacts(overrides: Partial<OfficialWebsiteResult['facts']>): OfficialWebsiteResult {
  const none = <T>() => ({value: null as T | null, sources: [] as string[]})
  return {
    sources: [{key: 'official-website:https://example.com/', provider: 'official-website', identifier: 'https://example.com/', url: 'https://example.com/', retrievedAt: '2026-10-06T10:00:00.000Z', attribution: 'Sitio web oficial (example.com)', licenseUrl: null}],
    facts: {
      cuisine: none<string[]>(), concept: none<string>(), specialties: none<string[]>(), services: none<string[]>(),
      bookingAvailability: none<boolean>(), takeaway: none<boolean>(), delivery: none<boolean>(), terrace: none<boolean>(),
      accessibility: none<string[]>(), openingInformation: none<string[]>(), locationContext: none<string>(), distinctiveFeatures: none<string[]>(),
      ...overrides,
    },
  }
}
