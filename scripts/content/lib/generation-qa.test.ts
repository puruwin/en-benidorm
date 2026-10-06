import assert from 'node:assert/strict'
import test from 'node:test'
import {validateGeneratedEditorial} from './ai'
import {enrichEntity} from './enrichment'
import {buildBusinessDocument} from './generation'
import {inspectCandidates, jaccard} from './qa'
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
  shortDescription: 'Una cafetería de Benidorm identificada en la fuente disponible, pendiente de revisión editorial.',
  description: 'Café Sol figura como cafetería en Benidorm según la fuente consultada. Esta ficha resume únicamente la información disponible y debe revisarse antes de publicarse.',
  highlights: ['Ficha basada exclusivamente en la fuente indicada y pendiente de revisión manual.'],
  seo: {metaTitle: 'Café Sol en Benidorm | enBenidorm', metaDescription: 'Información verificada disponible sobre Café Sol en Benidorm, con ubicación y enlace oficial cuando constan en la fuente.'},
}

test('el schema de generación rechaza campos factuales o longitudes inválidas', () => {
  assert.deepEqual(validateGeneratedEditorial(editorial), [])
  assert.match(validateGeneratedEditorial({...editorial, phone: '123'})[0]!, /campos no editoriales/)
  assert.ok(validateGeneratedEditorial({...editorial, shortDescription: 'corta'}).length > 0)
})

test('QA aprueba un documento completo y detecta alteración factual', () => {
  const enriched = enrichEntity(discovered)
  const document = buildBusinessDocument(enriched, editorial)
  assert.equal(inspectCandidates([{document, enriched}])[0]?.outcome, 'PASS')
  const altered = {...document, website: 'https://inventado.example'}
  const result = inspectCandidates([{document: altered, enriched}])[0]
  assert.equal(result?.outcome, 'FAIL')
  assert.ok(result?.issues.some((issue) => issue.code === 'factual-integrity'))
})

test('QA mide contenido excesivamente similar', () => {
  assert.equal(jaccard('uno dos tres', 'uno dos tres'), 1)
  assert.equal(jaccard('uno dos', 'tres cuatro'), 0)
})
