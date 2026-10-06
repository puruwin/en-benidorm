import assert from 'node:assert/strict'
import test from 'node:test'
import {canRunStage, createManifestEntry, markEntryError, transitionEntry} from './manifest'
import type {SourceProvenance} from './types'

const source: SourceProvenance = {
  key: 'openstreetmap:node/1', provider: 'openstreetmap', identifier: 'node/1',
  url: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-06T10:00:00.000Z',
  attribution: '© OpenStreetMap contributors', licenseUrl: 'https://www.openstreetmap.org/copyright',
}

test('el manifest avanza de forma idempotente y --force invalida fases posteriores', () => {
  const entry = createManifestEntry({id: 'business-cafe-sol', type: 'cafe', slug: 'cafe-sol', priority: 50, sources: [source], now: source.retrievedAt})
  transitionEntry(entry, 'enriched', '2026-10-06T11:00:00.000Z')
  transitionEntry(entry, 'enriched', '2026-10-06T12:00:00.000Z')
  assert.equal(entry.enrichedAt, '2026-10-06T11:00:00.000Z')
  transitionEntry(entry, 'generated', '2026-10-06T12:00:00.000Z')
  transitionEntry(entry, 'validated', '2026-10-06T13:00:00.000Z')
  transitionEntry(entry, 'enriched', '2026-10-06T14:00:00.000Z', true)
  assert.equal(entry.status, 'enriched')
  assert.equal(entry.generatedAt, null)
  assert.equal(entry.validatedAt, null)
})

test('un error conserva etapa y permite reintentar sólo esa fase', () => {
  const entry = createManifestEntry({id: 'business-cafe-sol', type: 'cafe', slug: 'cafe-sol', priority: 50, sources: [source], now: source.retrievedAt})
  transitionEntry(entry, 'enriched', '2026-10-06T11:00:00.000Z')
  markEntryError(entry, 'generation', 'fallo', '2026-10-06T12:00:00.000Z')
  assert.equal(canRunStage(entry, 'generation', false), true)
  assert.equal(canRunStage(entry, 'enrichment', false), false)
})
