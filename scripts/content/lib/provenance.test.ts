import assert from 'node:assert/strict'
import test from 'node:test'
import {enrichEntity, sourceIsComplete, validateFactProvenance} from './enrichment'
import type {DiscoveredEntity} from './types'

const discovered: DiscoveredEntity = {
  schemaVersion: 1,
  id: 'business-cafe-sol',
  type: 'cafe',
  targetDocumentType: 'business',
  slug: 'cafe-sol',
  priority: 60,
  sources: [{
    key: 'openstreetmap:node/1', provider: 'openstreetmap', identifier: 'node/1',
    url: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-06T10:00:00.000Z',
    attribution: '© OpenStreetMap contributors', licenseUrl: 'https://www.openstreetmap.org/copyright',
  }],
  raw: {name: 'Café Sol', tags: {amenity: 'cafe', 'addr:street': 'Calle Sol', phone: '+34 900 000 000'}, latitude: 38.54, longitude: -0.13},
}

test('cada fact presente conserva una referencia a una fuente declarada', () => {
  const enriched = enrichEntity(discovered)
  assert.deepEqual(validateFactProvenance(enriched), [])
  assert.deepEqual(enriched.facts.phone.sources, ['openstreetmap:node/1'])
  assert.equal(enriched.facts.website.value, null)
  assert.deepEqual(enriched.facts.website.sources, [])
  assert.equal(sourceIsComplete(enriched.sources[0]!), true)
})

test('detecta facts sin procedencia', () => {
  const enriched = enrichEntity(discovered)
  enriched.facts.phone.sources = []
  assert.match(validateFactProvenance(enriched)[0]!, /requiere al menos una fuente/)
})
