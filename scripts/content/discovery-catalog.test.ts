import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import {selectComparisonCandidates} from '../comparison/lib/selection'
import {assignIdentities, deduplicateRecords, runDiscovery} from './discover'
import type {SourceAdapter, SourceRecord} from './lib/adapters'
import {readJson, writeJsonAtomic} from './lib/files'
import {emptyManifest, loadManifest} from './lib/manifest'
import type {ContentManifest, DiscoveredEntity} from './lib/types'

const now = '2026-10-15T10:00:00.000Z'

function record(identifier: string, name: string, latitude: number | null, longitude: number | null, tags: Record<string, string> = {}): SourceRecord {
  return {
    type: 'restaurant', priority: 50,
    sources: [{
      key: `openstreetmap:${identifier}`, provider: 'openstreetmap', identifier,
      url: `https://www.openstreetmap.org/${identifier}`, retrievedAt: now,
      attribution: '© OpenStreetMap contributors', licenseUrl: 'https://www.openstreetmap.org/copyright',
    }],
    raw: {name, tags: {amenity: 'restaurant', ...tags}, latitude, longitude},
  }
}

test('deduplicación exige identidad comprobable y no fusiona homónimos sin ubicación', () => {
  const homonyms = deduplicateRecords([record('node/1', 'Bar Sol', null, null), record('node/2', 'Bar Sol', null, null)])
  assert.equal(homonyms.length, 2)
  const samePlace = deduplicateRecords([record('node/3', 'Bar Sol', 38.54, -0.13), record('way/4', 'Bár Sól', 38.540001, -0.130001)])
  assert.equal(samePlace.length, 1)
  assert.equal(samePlace[0]?.sources.length, 2)
  const secondProvider = record('municipal/4', 'Bár Sól', 38.540001, -0.130001)
  secondProvider.sources[0] = {...secondProvider.sources[0]!, key: 'municipal:4', provider: 'municipal', identifier: '4'}
  assert.equal(deduplicateRecords([record('node/3', 'Bar Sol', 38.54, -0.13), secondProvider]).length, 2)
})

test('businessId usa source aliases existentes y distingue colisiones de nombre', () => {
  const existing = assignIdentities([record('node/1', 'Bar Sol', 38.54, -0.13)], emptyManifest())[0]!
  const manifest: ContentManifest = {version: 1, updatedAt: now, entries: [{
    id: existing.id, type: existing.type, slug: existing.slug, status: 'discovered', priority: 50, sources: existing.sources,
    discoveredAt: now, enrichedAt: null, generatedAt: null, validatedAt: null, importedAt: null, reviewedAt: null,
    publishedAt: null, qualityTier: null, qualityAssessedAt: null, qualityReasons: [], missingUsefulFacts: [], lastError: null,
  }]}
  const identities = assignIdentities([
    record('node/1', 'Bar Sol actualizado', 38.54, -0.13),
    record('node/2', 'Bar Sol', 38.55, -0.14),
  ], manifest)
  assert.equal(identities[0]?.id, existing.id)
  assert.notEqual(identities[1]?.id, existing.id)
})

test('Discovery persiste el catálogo completo aunque limite investigación y actualiza sin destruir campos previos', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-discovery-catalog-'))
  try {
    const firstRecords = [
      record('node/10', 'Uno', 38.54, -0.13), record('node/11', 'Dos', 38.55, -0.14), record('node/12', 'Tres', 38.56, -0.15),
    ]
    const adapter: SourceAdapter = {provider: 'fixture', discover: async () => firstRecords}
    await runDiscovery({dryRun: false, force: false, limit: 1, categories: ['hospitality']}, {root, now, adapter})
    let manifest = await loadManifest(root)
    assert.equal(manifest.entries.length, 3)
    assert.equal(manifest.entries.filter((entry) => entry.discovery?.researchSelections.length).length, 1)

    const id = manifest.entries.find((entry) => entry.sources.some((source) => source.identifier === 'node/10'))!.id
    const path = resolve(root, `content/discovered/${id}.json`)
    const artifact = await readJson<DiscoveredEntity & {manualNote?: string}>(path)
    await writeJsonAtomic(path, {...artifact, manualNote: 'conservar', raw: {...artifact.raw, tags: {...artifact.raw.tags, 'manual:review': 'sí'}}})

    const refreshed: SourceAdapter = {provider: 'fixture', discover: async () => [record('node/10', 'Uno', 38.54, -0.13, {website: 'https://uno.example'})]}
    await runDiscovery({dryRun: false, force: false, categories: ['hospitality']}, {root, now: '2026-10-16T10:00:00.000Z', adapter: refreshed})
    const updated = JSON.parse(await readFile(path, 'utf8')) as DiscoveredEntity & {manualNote?: string}
    assert.equal(updated.manualNote, 'conservar')
    assert.equal(updated.raw.tags['manual:review'], 'sí')
    assert.equal(updated.raw.tags.website, 'https://uno.example')
    manifest = await loadManifest(root)
    const entry = manifest.entries.find((item) => item.id === id)!
    assert.equal(entry.discovery?.firstSeenAt, now)
    assert.equal(entry.discovery?.lastSeenAt, '2026-10-16T10:00:00.000Z')
    assert.ok(entry.discovery!.history.length >= 2)
    assert.ok(entry.discovery!.history.some((event) => event.kind === 'seen'))
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('Comparison consume discovered sin enrichment y mantiene artefactos legacy compatibles', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-discovery-comparison-'))
  try {
    const adapter: SourceAdapter = {provider: 'fixture', discover: async () => [record('node/20', 'Italia', 38.54, -0.13, {cuisine: 'italian'})]}
    await runDiscovery({dryRun: false, force: false, categories: ['hospitality']}, {root, now, adapter})
    const result = await selectComparisonCandidates({topic: 'italiano', id: 'comparison-italiano', dryRun: false, force: false}, root, now)
    const legacySelection = await selectComparisonCandidates(
      {topic: 'italiano', id: 'comparison-italiano', dryRun: false, force: false}, root, now, {includeDiscovered: false},
    )
    assert.equal(result.summary?.considered, 1)
    assert.equal(result.candidates.length, 1)
    assert.equal(legacySelection.summary?.considered, 0)
    assert.equal(legacySelection.candidates.length, 0)

    const legacy = await readJson<ContentManifest>(resolve(root, 'content/manifest.json'))
    delete legacy.entries[0]!.discovery
    await writeJsonAtomic(resolve(root, 'content/manifest.json'), legacy)
    const loaded = await loadManifest(root)
    assert.equal(loaded.entries[0]?.discovery?.state, 'discovered')
  } finally { await rm(root, {recursive: true, force: true}) }
})
