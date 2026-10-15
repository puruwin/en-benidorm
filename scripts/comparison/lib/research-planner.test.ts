import assert from 'node:assert/strict'
import test from 'node:test'
import type {BusinessFacts, EnrichedEntity, Fact, SourceProvenance} from '../../content/lib/types'
import {planBusinessResearch} from './research-planner'
import {topicConfig} from './topic-config'

test('planifica sólo dimensiones requeridas y ausentes con justificación', () => {
  const item = entity('https://local.example/')
  item.facts.services = sourced(['desayuno'], 'osm:test')
  const plan = planBusinessResearch({entity: item, config: topicConfig('desayunos'), requiredDimensions: ['services', 'location', 'practical'], minimumCoveredDimensions: 3})
  assert.deepEqual(plan.coverage.coveredDimensions, ['services'])
  assert.deepEqual(plan.priorityDimensions, ['location', 'practical'])
  assert.ok(plan.actions.every((action) => action.reason.includes(action.dimension)))
  assert.equal(plan.shouldResearch, true)
})

test('compatibilidad legacy permite una web local sin sourceClass explícita', () => {
  const plan = planBusinessResearch({entity: entity('https://legacy.example/'), requiredDimensions: ['services'], minimumCoveredDimensions: 1})
  assert.equal(plan.sources[0]?.usable, true)
  assert.equal(plan.sources[0]?.claimScope, 'establishment')
})

test('no convierte una fuente official-brand en fuente local', () => {
  const item = entity('https://brand.example/')
  const brandKey = 'brand:web'
  item.sources.push({...source(brandKey), provider: 'official-website', url: 'https://brand.example/', sourceClass: 'official-brand', claimScope: 'brand'})
  item.facts.services = sourced(['desayunos'], brandKey)
  const plan = planBusinessResearch({entity: item, requiredDimensions: ['services'], minimumCoveredDimensions: 1})
  assert.deepEqual(plan.coverage.coveredDimensions, [])
  assert.deepEqual(plan.coverage.missingDimensions, ['services'])
  assert.equal(plan.shouldResearch, false)
  assert.equal(plan.sources[0]?.usable, false)
  assert.match(plan.reason, /alcance/i)
})

function entity(website: string | null): EnrichedEntity {
  const key = 'osm:test'; const empty = <T>(): Fact<T> => ({value: null, sources: []})
  const facts: BusinessFacts = {name: sourced('Test', key), businessKind: sourced('cafe', key), address: sourced({locality: 'Benidorm'}, key), location: empty(), phone: empty(), website: website ? sourced(website, key) : empty(), openingHoursRaw: empty(), cuisine: empty(), concept: empty(), specialties: empty(), services: empty(), bookingAvailability: empty(), takeaway: empty(), delivery: empty(), terrace: empty(), accessibility: empty(), openingInformation: empty(), locationContext: empty(), distinctiveFeatures: empty()}
  return {schemaVersion: 2, id: 'business-test', type: 'cafe', targetDocumentType: 'business', slug: 'test', facts, factsBySource: {openStreetMap: facts, officialWebsite: {cuisine: empty(), concept: empty(), specialties: empty(), services: empty(), bookingAvailability: empty(), takeaway: empty(), delivery: empty(), terrace: empty(), accessibility: empty(), openingInformation: empty(), locationContext: empty(), distinctiveFeatures: empty()}}, editorial: {}, sources: [source(key)]}
}
function sourced<T>(value: T, key: string): Fact<T> { return {value, sources: [key]} }
function source(key: string): SourceProvenance { return {key, provider: 'openstreetmap', identifier: key, url: 'https://www.openstreetmap.org/', retrievedAt: '2026-10-15T00:00:00.000Z', attribution: 'Test', licenseUrl: null} }
