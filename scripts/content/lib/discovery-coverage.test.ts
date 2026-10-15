import assert from 'node:assert/strict'
import test from 'node:test'
import {calculateDiscoveryCoverage} from './discovery-coverage'
import {classifyGeography} from './discovery-geography'
import type {DiscoveredEntity} from './types'

const now = '2026-10-15T10:00:00.000Z'

test('municipio prioriza tags, reconoce Albir y deja coordenadas ambiguas sin forzar', () => {
  assert.deepEqual(classifyGeography({'addr:city': 'La Nucía'}, 0, 0), {municipality: 'La Nucía', zone: 'La Nucía', confidence: 'tag'})
  assert.deepEqual(classifyGeography({'addr:place': 'El Albir'}, 0, 0), {municipality: "l'Alfàs del Pi", zone: 'Albir', confidence: 'tag'})
  assert.equal(classifyGeography({}, 38.59, -0.15).municipality, 'unknown')
})

test('métricas agregan sector, municipio, provider y metadatos operativos', () => {
  const entity: DiscoveredEntity = {
    schemaVersion: 2, id: 'business-one', type: 'service', targetDocumentType: 'business', slug: 'one', priority: 60,
    sources: [{key: 'openstreetmap:node/1', provider: 'openstreetmap', identifier: 'node/1', url: null, retrievedAt: now, attribution: 'OSM', licenseUrl: null}],
    raw: {name: 'One', latitude: 38.61, longitude: -0.12, tags: {office: 'lawyer', website: 'https://one.test', phone: '965000000', email: 'hi@one.test', 'addr:street': 'Major', opening_hours: 'Mo-Fr 09:00-17:00'}},
    businessClassification: {sector: 'professional-services', subsector: 'lawyer', matches: []},
    geography: {municipality: 'La Nucía', zone: 'La Nucía', confidence: 'tag'},
  }
  const report = calculateDiscoveryCoverage([entity], [], now, 'test', 0)
  assert.equal(report.totalBusinesses, 1)
  assert.equal(report.businessesBySector['professional-services'], 1)
  assert.equal(report.businessesByMunicipality['La Nucía'], 1)
  assert.equal(report.websiteCoverage.count, 1)
  assert.equal(report.phoneCoverage.count, 1)
  assert.equal(report.emailCoverage.count, 1)
  assert.equal(report.operationalMetadataCoverage.openingHours.count, 1)
  assert.equal(report.providerDistribution.openstreetmap, 1)
})
