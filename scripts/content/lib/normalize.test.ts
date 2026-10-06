import assert from 'node:assert/strict'
import test from 'node:test'
import {deduplicateBy, deterministicBusinessId, entityFingerprint, normalizeText, slugify, uniqueSlug} from './normalize'

test('normaliza texto y genera slugs estables en español', () => {
  assert.equal(normalizeText('  Café  Rincón & Mar '), 'cafe rincon mar')
  assert.equal(slugify('Café Rincón & Mar'), 'cafe-rincon-mar')
})

test('el ID determinista deriva exclusivamente del slug', () => {
  assert.equal(deterministicBusinessId('cafe-rincon-mar'), 'business-cafe-rincon-mar')
})

test('resuelve colisiones de slug de forma determinista', () => {
  assert.equal(uniqueSlug('bar-sol', new Set(), 'osm:node/1'), 'bar-sol')
  assert.match(uniqueSlug('bar-sol', new Set(['bar-sol']), 'osm:node/1'), /^bar-sol-[a-f0-9]{6}$/)
})

test('deduplica por clave y detecta entidades equivalentes', () => {
  const records = [{id: 1}, {id: 1}, {id: 2}]
  assert.deepEqual(deduplicateBy(records, (record) => String(record.id)), [{id: 1}, {id: 2}])
  assert.equal(
    entityFingerprint({type: 'cafe', name: 'Café Sol', latitude: 38.54001, longitude: -0.13001}),
    entityFingerprint({type: 'cafe', name: 'Cafe Sol', latitude: 38.54002, longitude: -0.13002}),
  )
})
