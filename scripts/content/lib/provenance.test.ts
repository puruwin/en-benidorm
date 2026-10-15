import assert from 'node:assert/strict'
import test from 'node:test'
import {enrichEntity, sourceIsComplete, validateFactProvenance} from './enrichment'
import type {DiscoveredEntity, Fact} from './types'

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

test('una web corporativa conserva facts de marca pero no los promueve al establecimiento', () => {
  const branded: DiscoveredEntity = {
    ...discovered,
    id: 'business-chain',
    raw: {...discovered.raw, tags: {...discovered.raw.tags, brand: 'Cadena', 'brand:wikidata': 'Q123', website: 'https://example.com'}},
  }
  const empty = <T>(): Fact<T> => ({value: null, sources: []})
  const official = {
    facts: {
      cuisine: empty<string[]>(), concept: empty<string>(), specialties: empty<string[]>(),
      services: {value: ['desayuno'], sources: ['official:brand']}, bookingAvailability: empty<boolean>(), takeaway: empty<boolean>(), delivery: empty<boolean>(), terrace: empty<boolean>(), accessibility: empty<string[]>(), openingInformation: empty<string[]>(), locationContext: empty<string>(), distinctiveFeatures: empty<string[]>(),
    },
    sources: [{key: 'official:brand', provider: 'official-website', identifier: 'https://example.com', url: 'https://example.com', retrievedAt: '2026-10-15T00:00:00.000Z', attribution: 'Web corporativa', licenseUrl: null}],
  }
  const enriched = enrichEntity(branded, official)
  assert.equal(enriched.sources.find((source) => source.key === 'official:brand')?.sourceClass, 'official-brand')
  assert.equal(enriched.sources.find((source) => source.key === 'official:brand')?.claimScope, 'brand')
  assert.deepEqual(enriched.factsBySource.officialWebsite.services.value, ['desayuno'])
  assert.equal(enriched.facts.services.value, null)
})
