import assert from 'node:assert/strict'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import {runOpportunityAnalysis} from '../analyze'
import {analyzeOpportunity, type OpportunityEvidence} from './analysis'
import {evaluateOpportunityReview, saveOpportunityReview, validateOpportunityReview} from './reviews'
import type {OpportunityReview} from './types'

const NOW = '2026-10-15T12:00:00.000Z'
const KEY = 'openstreetmap:node/1'

test('review válida conserva autor, evidencia y política de caducidad', () => {
  const review = validateOpportunityReview(validReview(), 'business-uno', new Set([KEY]))
  assert.equal(review.reviewedBy, 'Ana')
  assert.deepEqual(review.reviewedSourceKeys, [KEY])
  const evaluation = evaluateOpportunityReview(review, NOW)
  assert.equal(evaluation.workflowStatus, 'verified')
  assert.equal(evaluation.expires.operationalStatus, '2027-01-13T12:00:00.000Z')
  assert.equal(evaluation.expires.website, '2027-04-13T12:00:00.000Z')
})

test('review expirada se marca stale sin eliminarse', () => {
  const review = validateOpportunityReview({...validReview(), reviewedAt: '2026-01-01T00:00:00.000Z'}, 'business-uno', new Set([KEY]))
  const evaluation = evaluateOpportunityReview(review, NOW)
  assert.equal(evaluation.workflowStatus, 'stale')
  assert.ok(evaluation.staleFields.includes('operationalStatus'))
  assert.equal(review.workflowStatus, 'verified')
})

test('closed e identity conflict producen do-not-contact y ninguna hipótesis', () => {
  for (const review of [
    {...validReview(), workflowStatus: 'rejected', operationalStatus: 'confirmed-closed'},
    {...validReview(), workflowStatus: 'rejected', identityStatus: 'conflict'},
  ] as OpportunityReview[]) {
    const result = analyzeOpportunity(evidence(review), NOW)
    assert.equal(result.status, 'not-actionable')
    assert.equal(result.hypotheses.length, 0)
    assert.ok(result.suggestedActions.some((item) => item.type === 'do-not-contact'))
  }
})

test('análisis automático nunca sustituye campos manuales', () => {
  const review = validReview() as OpportunityReview
  const before = structuredClone(review)
  analyzeOpportunity(evidence(review), NOW)
  assert.deepEqual(review, before)
})

test('reanálisis tras review invalida fingerprint y conserva manifest', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'opportunity-review-rerun-'))
  try {
    await mkdir(resolve(root, 'content/discovered'), {recursive: true})
    const item = evidence()
    const manifest = {version: 1, updatedAt: NOW, entries: [item.entry]}
    await writeFile(resolve(root, 'content/manifest.json'), JSON.stringify(manifest))
    await writeFile(resolve(root, 'content/discovered/business-uno.json'), JSON.stringify(item.discovered))
    const first = await runOpportunityAnalysis({root, businessId: 'business-uno', now: NOW})
    assert.equal(first.analyses[0]?.reviewState, 'unreviewed')
    await saveOpportunityReview(root, validReview() as OpportunityReview)
    const second = await runOpportunityAnalysis({root, businessId: 'business-uno', now: NOW})
    assert.equal(second.reusedUnchanged, 0)
    assert.equal(second.analyses[0]?.reviewState, 'verified')
    assert.ok((second.analyses[0]?.hypotheses.length ?? 0) > 0)
    assert.equal(JSON.parse(await readFile(resolve(root, 'content/manifest.json'), 'utf8')).entries[0].id, 'business-uno')
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('negocio sin review mantiene compatibilidad y queda unreviewed', () => {
  const result = analyzeOpportunity(evidence(), NOW)
  assert.equal(result.status, 'needs-review')
  assert.equal(result.hypotheses.length, 0)
})

function validReview() {
  return {
    schemaVersion: 1 as const, businessId: 'business-uno', reviewedAt: NOW, reviewedBy: 'Ana', workflowStatus: 'verified' as const,
    operationalStatus: 'confirmed-open' as const, identityStatus: 'confirmed' as const,
    officialPresence: {website: 'not-found' as const, googleProfile: 'not-checked' as const, socialProfiles: 'not-checked' as const},
    contactChannels: {}, reviewedSourceKeys: [KEY], notes: 'Verificado contra la fuente indicada.',
  }
}

function evidence(review?: OpportunityReview): OpportunityEvidence {
  const source = {key: KEY, provider: 'openstreetmap', identifier: 'node/1', url: 'https://www.openstreetmap.org/node/1', retrievedAt: NOW, attribution: '© OpenStreetMap contributors', licenseUrl: 'https://www.openstreetmap.org/copyright', sourceClass: 'open-data' as const, claimScope: 'establishment' as const}
  const entry: any = {id: 'business-uno', type: 'service', slug: 'uno', status: 'discovered', priority: 1, sources: [source], discoveredAt: NOW, enrichedAt: null, generatedAt: null, validatedAt: null, importedAt: null, reviewedAt: null, publishedAt: null, qualityTier: null, qualityAssessedAt: null, qualityReasons: [], missingUsefulFacts: [], lastError: null, discovery: {state: 'discovered', firstSeenAt: NOW, lastSeenAt: NOW, categories: ['professional-services'], geographicScopes: ['Benidorm'], sourceIdentifiers: [{provider: 'openstreetmap', identifier: 'node/1'}], researchSelections: [], editorialEligibility: [], history: []}}
  const discovered: any = {schemaVersion: 2, id: 'business-uno', type: 'service', targetDocumentType: 'business', slug: 'uno', priority: 1, sources: [source], raw: {name: 'Uno', tags: {name: 'Uno', office: 'accountant', 'addr:city': 'Benidorm'}, latitude: 38.53, longitude: -0.13}}
  return {entry, discovered, ...(review ? {review} : {})}
}
