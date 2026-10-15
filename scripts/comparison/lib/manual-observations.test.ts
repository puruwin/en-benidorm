import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import {writeJsonAtomic} from '../../content/lib/files'
import type {EnrichedEntity} from '../../content/lib/types'
import {loadManualComparisonObservations} from './manual-observations'

const businessId = 'business-my-bakery'
const entities = new Map([[businessId, {id: businessId} as EnrichedEntity]])

test('manual observations conserva autor, fecha y una fuente sin URL', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-manual-observations-'))
  try {
    await writeJsonAtomic(resolve(root, 'business-my-bakery.json'), observation())
    const loaded = await loadManualComparisonObservations(root, entities)

    assert.equal(loaded.records.length, 1)
    assert.equal(loaded.sources[0]?.url, null)
    assert.equal(loaded.sources[0]?.provider, 'manual-observation')
    const fact = loaded.businesses[0]?.evidence.services?.[0]
    assert.equal(fact?.sourceStage, 'manual-observation')
    assert.equal(fact?.nature, 'first_party_observation')
    assert.deepEqual(fact?.provenance?.[0], {
      sourceStage: 'manual-observation',
      nature: 'first_party_observation',
      sourceType: 'first-party-observation',
      sourceKey: 'manual-observation:business-my-bakery:2026-10-08:david',
      observer: 'David',
      observedAt: '2026-10-08',
    })
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('manual observations permite que el directorio no exista', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-manual-observations-missing-'))
  try {
    const loaded = await loadManualComparisonObservations(resolve(root, 'missing'), entities)
    assert.deepEqual(loaded.records, [])
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('manual observations rechaza Business inexistente, fecha inválida y observations vacías', async () => {
  const invalidCases = [
    ["business inexistente", {...observation(), businessId: 'business-no-existe'}, /businessId inexistente/],
    ['fecha inválida', {...observation(), observedAt: '2026-02-30'}, /observedAt/],
    ['observations vacías', {...observation(), observations: []}, /observations/],
  ] as const
  for (const [label, value, expected] of invalidCases) {
    const root = await mkdtemp(resolve(tmpdir(), `enbenidorm-manual-invalid-${label.replaceAll(' ', '-')}-`))
    try {
      await writeJsonAtomic(resolve(root, 'invalid.json'), value)
      await assert.rejects(loadManualComparisonObservations(root, entities), expected)
    } finally { await rm(root, {recursive: true, force: true}) }
  }
})

test('manual observations rechaza businessId, dimension y value vacíos o inválidos', async () => {
  const invalidCases = [
    [{...observation(), businessId: ''}, /businessId/],
    [{...observation(), observations: [{dimension: 'parallelDimension', value: 'desayunos'}]}, /dimension/],
    [{...observation(), observations: [{dimension: 'services', value: '  '}]}, /value/],
  ] as const
  for (const [value, expected] of invalidCases) {
    const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-manual-invalid-field-'))
    try {
      await writeJsonAtomic(resolve(root, 'invalid.json'), value)
      await assert.rejects(loadManualComparisonObservations(root, entities), expected)
    } finally { await rm(root, {recursive: true, force: true}) }
  }
})

function observation() {
  return {
    businessId,
    observedAt: '2026-10-08',
    observer: 'David',
    sourceType: 'first-party-observation',
    observations: [{dimension: 'services', value: 'desayunos'}],
  }
}
