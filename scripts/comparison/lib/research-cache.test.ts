import assert from 'node:assert/strict'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {FileResearchResultCache, researchFingerprint} from './research-cache'
import type {ComparisonResearchBundle} from './research'
import {EVIDENCE_CATEGORIES, type ComparisonEvidence} from './types'

test('la cache persistente respeta fingerprint estable y caducidad', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'comparison-research-cache-'))
  const cache = new FileResearchResultCache(directory)
  const first = researchFingerprint({topic: 'desayunos', hints: ['brunch'], limits: {pages: 6, depth: 1}})
  const reordered = researchFingerprint({limits: {depth: 1, pages: 6}, hints: ['brunch'], topic: 'desayunos'})
  assert.equal(first, reordered)

  const bundle: ComparisonResearchBundle = {
    research: {status: 'confirmed', website: 'https://example.com/', pagesVisited: [], sources: [], newEvidence: []},
    evidence: Object.fromEntries(EVIDENCE_CATEGORIES.map((dimension) => [dimension, []])) as unknown as ComparisonEvidence,
  }
  await cache.save(first, '2026-10-01T00:00:00.000Z', bundle)
  assert.equal((await cache.load(first, '2026-10-30T00:00:00.000Z', 30))?.research.status, 'confirmed')
  assert.equal(await cache.load(first, '2026-11-01T00:00:00.001Z', 30), null)
})

test('la versión del extractor invalida el fingerprint de research', () => {
  const base = {businessId: 'business-test', topic: 'desayunos', crawlerVersion: '3'}
  assert.notEqual(researchFingerprint({...base, extractorVersion: '2'}), researchFingerprint({...base, extractorVersion: '3-commercial-1'}))
})
