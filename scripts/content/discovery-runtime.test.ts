import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import {FileDiscoveryCheckpointStore, LocalOsmExtractAdapter, OpenStreetMapAdapter} from './lib/adapters'
import {findProbableDuplicates} from './lib/discovery-identity'
import type {DiscoveredEntity} from './lib/types'

const geography = {name: 'test', bbox: [38.5, -0.18, 38.6, -0.06] as [number, number, number, number]}
const retrievedAt = '2026-10-15T10:00:00.000Z'

test('Overpass reintenta con Retry-After y registra consultas e intentos', async () => {
  const attempts = new Map<string, number>()
  const waits: number[] = []
  const fetcher = (async (_input: string | URL | globalThis.Request, init?: RequestInit) => {
    const query = String((init?.body as URLSearchParams).get('data'))
    const count = (attempts.get(query) ?? 0) + 1
    attempts.set(query, count)
    if (count === 1) return new Response('', {status: 429, headers: {'retry-after': '1'}})
    return Response.json({elements: query.includes('node') ? [{type: 'node', id: 1, lat: 38.54, lon: -0.13, tags: {name: 'Uno', amenity: 'restaurant'}}] : []})
  }) as typeof fetch
  const adapter = new OpenStreetMapAdapter('https://overpass.test/api', fetcher, {
    concurrency: 2, maxAttempts: 2, sleep: async (milliseconds) => { waits.push(milliseconds) },
  })
  const output = await adapter.discoverDetailed({type: 'restaurant', geography, retrievedAt})
  assert.equal(output.status, 'success')
  assert.equal(output.units.length, 3)
  assert.ok(output.units.every((unit) => unit.attempts.length === 2 && unit.query?.includes('[out:json]')))
  assert.deepEqual(waits, [1000, 1000, 1000])
})

test('checkpoint reanuda sólo unidades fallidas y conserva las completadas vacías', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-checkpoint-'))
  try {
    const store = new FileDiscoveryCheckpointStore(root)
    const firstFetcher = (async (_input: string | URL | globalThis.Request, init?: RequestInit) => {
      const query = String((init?.body as URLSearchParams).get('data'))
      return query.includes('way[') ? new Response('', {status: 503}) : Response.json({elements: []})
    }) as typeof fetch
    const first = await new OpenStreetMapAdapter('https://overpass.test/api', firstFetcher, {
      checkpointStore: store, maxAttempts: 1, concurrency: 1,
    }).discoverDetailed({type: 'restaurant', geography, retrievedAt})
    assert.equal(first.status, 'partial')
    assert.equal(first.units.filter((unit) => unit.status === 'success').length, 2)

    let calls = 0
    const secondFetcher = (async (_input: string | URL | globalThis.Request, init?: RequestInit) => {
      calls += 1
      const query = String((init?.body as URLSearchParams).get('data'))
      assert.match(query, /way\[/)
      return Response.json({elements: [{type: 'way', id: 2, center: {lat: 38.55, lon: -0.14}, tags: {name: 'Dos', amenity: 'restaurant'}}]})
    }) as typeof fetch
    const second = await new OpenStreetMapAdapter('https://overpass.test/api', secondFetcher, {
      checkpointStore: store, resume: true, maxAttempts: 1, concurrency: 2,
    }).discoverDetailed({type: 'restaurant', geography, retrievedAt: '2026-10-16T10:00:00.000Z'})
    assert.equal(second.status, 'success')
    assert.equal(second.resumedUnits, 2)
    assert.equal(calls, 1)
    assert.equal(second.records.length, 1)
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('distingue failed de anomalous-empty sin convertirlos en catálogo vacío', async () => {
  const failedFetcher = (async () => new Response('', {status: 502})) as typeof fetch
  const failed = await new OpenStreetMapAdapter('https://overpass.test/api', failedFetcher, {
    maxAttempts: 1, concurrency: 1,
  }).discoverDetailed({type: 'service', geography, retrievedAt})
  assert.equal(failed.status, 'failed')
  assert.equal(failed.units.filter((unit) => unit.status === 'failed').length, 3)

  const emptyFetcher = (async () => Response.json({elements: []})) as typeof fetch
  const empty = await new OpenStreetMapAdapter('https://overpass.test/api', emptyFetcher, {
    maxAttempts: 1, concurrency: 1,
  }).discoverDetailed({type: 'service', geography, retrievedAt})
  assert.equal(empty.status, 'anomalous-empty')
  assert.equal(empty.records.length, 0)
})

test('extracto OSM local reutiliza normalización, filtros y provenance', async () => {
  const path = resolve(process.cwd(), 'scripts/content/fixtures/discovery/benidorm-osm-sample.json')
  const adapter = new LocalOsmExtractAdapter(path, {sourceUrl: 'https://example.test/benidorm.osm.json', downloadedAt: retrievedAt})
  assert.equal(adapter.id, 'openstreetmap')
  assert.equal(adapter.provider, 'openstreetmap')
  const output = await adapter.discoverDetailed({categories: ['hospitality'], geography, retrievedAt})
  assert.equal(output.status, 'success')
  assert.equal(output.records.length, 3)
  assert.ok(output.records.every((record) => record.sources[0]?.dataset?.kind === 'local-osm-extract'))
  assert.ok(output.records.every((record) => record.sources[0]?.attribution === '© OpenStreetMap contributors'))
  assert.equal(output.records[0]?.sources[0]?.dataset?.sourceUrl, 'https://example.test/benidorm.osm.json')
  assert.equal(output.records[0]?.sources[0]?.dataset?.downloadedAt, retrievedAt)
})

test('coincidencias entre proveedores se registran por señales y no cambian businessId', () => {
  const entity: DiscoveredEntity = {
    schemaVersion: 2, id: 'business-amigos-bistro', type: 'restaurant', targetDocumentType: 'business', slug: 'amigos-bistro', priority: 60,
    sources: [{key: 'openstreetmap:node/1', provider: 'openstreetmap', identifier: 'node/1', url: null, retrievedAt, attribution: 'OSM', licenseUrl: null}],
    raw: {name: 'Amigos Bistro', latitude: 38.5369484, longitude: -0.1480133, tags: {phone: '+34 965 856 199', website: 'https://amigosbistro.com'}},
  }
  const incoming = [{
    type: 'restaurant' as const, priority: 50,
    sources: [{key: 'municipal:42', provider: 'municipal', identifier: '42', url: null, retrievedAt, attribution: 'Datos abiertos municipales', licenseUrl: null}],
    raw: {name: 'Amigos Bistró', latitude: 38.53695, longitude: -0.14801, tags: {phone: '965856199', website: 'http://www.amigosbistro.com/menu'}},
  }]
  const matches = findProbableDuplicates(incoming, [entity])
  assert.equal(matches.length, 1)
  assert.equal(matches[0]?.existingBusinessId, entity.id)
  assert.equal(matches[0]?.confidence, 'exact')
  assert.deepEqual(new Set(matches[0]?.signals), new Set(['name', 'coordinates', 'phone', 'domain']))
})
