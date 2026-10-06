import assert from 'node:assert/strict'
import test from 'node:test'
import {validateGeneratedEditorial} from './ai'
import {enrichEntity} from './enrichment'
import {buildBusinessDocument} from './generation'
import {inspectCandidates, jaccard} from './qa'
import type {OfficialWebsiteResult} from './adapters'
import type {DiscoveredEntity, GeneratedEditorial} from './types'

const discovered: DiscoveredEntity = {
  schemaVersion: 1, id: 'business-cafe-sol', type: 'cafe', targetDocumentType: 'business', slug: 'cafe-sol', priority: 60,
  sources: [{
    key: 'openstreetmap:node/1', provider: 'openstreetmap', identifier: 'node/1',
    url: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-06T10:00:00.000Z',
    attribution: '© OpenStreetMap contributors', licenseUrl: 'https://www.openstreetmap.org/copyright',
  }],
  raw: {name: 'Café Sol', tags: {amenity: 'cafe', website: 'https://example.com'}, latitude: 38.54, longitude: -0.13},
}

const editorial: GeneratedEditorial = {
  contentQuality: 'sufficient',
  shortDescription: 'Café Sol combina cocina mediterránea y servicio de desayuno.',
  whatIsIt: 'Una cafetería de cocina mediterránea con servicio de desayuno.',
  whatToExpect: 'La propuesta documentada combina recetas mediterráneas y desayunos.',
  whyGo: 'Interesa por reunir cocina mediterránea y desayuno en una misma propuesta.',
  goodFor: ['Desayunar con cocina mediterránea'],
  highlights: ['Cocina mediterránea', 'Servicio de desayuno'],
  seo: {metaTitle: 'Café Sol: cocina mediterránea', metaDescription: 'Café Sol ofrece una propuesta de cocina mediterránea con servicio de desayuno documentado.'},
}

const official: OfficialWebsiteResult = {
  sources: [{key: 'official-website:https://example.com/', provider: 'official-website', identifier: 'https://example.com/', url: 'https://example.com/', retrievedAt: '2026-10-06T10:00:00.000Z', attribution: 'Sitio web oficial (example.com)', licenseUrl: null}],
  facts: {
    cuisine: {value: ['mediterránea'], sources: ['official-website:https://example.com/']}, concept: {value: null, sources: []},
    specialties: {value: null, sources: []}, services: {value: ['desayuno'], sources: ['official-website:https://example.com/']},
    bookingAvailability: {value: null, sources: []}, takeaway: {value: null, sources: []}, delivery: {value: null, sources: []},
    terrace: {value: null, sources: []}, accessibility: {value: null, sources: []}, openingInformation: {value: null, sources: []},
    locationContext: {value: null, sources: []}, distinctiveFeatures: {value: null, sources: []},
  },
}

test('el schema de generación rechaza campos factuales o longitudes inválidas', () => {
  assert.deepEqual(validateGeneratedEditorial(editorial), [])
  assert.match(validateGeneratedEditorial({...editorial, phone: '123'})[0]!, /campos no editoriales/)
  assert.ok(validateGeneratedEditorial({...editorial, shortDescription: 'corta'}).length > 0)
})

test('QA aprueba un documento completo y detecta alteración factual', () => {
  const enriched = enrichEntity(discovered, official)
  const document = buildBusinessDocument(enriched, editorial)
  const initial = inspectCandidates([{document, enriched}])[0]
  assert.equal(initial?.outcome, 'PASS', JSON.stringify(initial?.issues))
  const altered = {...document, website: 'https://inventado.example'}
  const result = inspectCandidates([{document: altered, enriched}])[0]
  assert.equal(result?.outcome, 'FAIL')
  assert.ok(result?.issues.some((issue) => issue.code === 'factual-integrity'))
})

test('QA mide contenido excesivamente similar', () => {
  assert.equal(jaccard('uno dos tres', 'uno dos tres'), 1)
  assert.equal(jaccard('uno dos', 'tres cuatro'), 0)
})

test('QA bloquea relleno genérico y una salida marcada como insuficiente', () => {
  const enriched = enrichEntity(discovered, official)
  const generic = buildBusinessDocument(enriched, editorial)
  generic.shortDescription = 'Café Sol es un restaurante situado en Benidorm.'
  assert.ok(inspectCandidates([{document: generic, enriched}])[0]?.issues.some((issue) => issue.code === 'GENERIC_EDITORIAL_CONTENT'))

  const insufficient: GeneratedEditorial = {
    contentQuality: 'insufficient', shortDescription: null, whatIsIt: null, whatToExpect: null, whyGo: null,
    goodFor: [], highlights: [], seo: null,
  }
  assert.deepEqual(validateGeneratedEditorial(insufficient), [])
  const result = inspectCandidates([{document: buildBusinessDocument(enriched, insufficient), enriched}])[0]
  assert.ok(result?.issues.some((issue) => issue.code === 'INSUFFICIENT_FACTS'))
})
