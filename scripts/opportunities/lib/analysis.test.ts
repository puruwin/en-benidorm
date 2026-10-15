import assert from 'node:assert/strict'
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import type {DiscoveredEntity, EnrichedEntity, ManifestEntry, SourceProvenance} from '../../content/lib/types'
import {runOpportunityAnalysis} from '../analyze'
import {analyzeOpportunity} from './analysis'
import type {OpportunityReview} from './types'
import type {VerificationArtifact} from './verification-types'

const NOW = '2026-10-15T12:00:00.000Z'
const osm: SourceProvenance = {key: 'openstreetmap:node/1', provider: 'openstreetmap', identifier: 'node/1', url: 'https://www.openstreetmap.org/node/1', retrievedAt: NOW, attribution: '© OpenStreetMap contributors', licenseUrl: 'https://www.openstreetmap.org/copyright', sourceClass: 'open-data', claimScope: 'establishment'}
const official: SourceProvenance = {key: 'official-website:https://example.test/', provider: 'official-website', identifier: 'https://example.test/', url: 'https://example.test/', retrievedAt: NOW, attribution: 'Sitio oficial', licenseUrl: null, sourceClass: 'official-location', claimScope: 'establishment'}
const brand: SourceProvenance = {...official, key: 'official-website:https://brand.test/', identifier: 'https://brand.test/', url: 'https://brand.test/', sourceClass: 'official-brand', claimScope: 'brand'}

test('web not-found no genera hipótesis sin review confirmed-open', () => {
  const result = analyzeOpportunity(fixture({website: null, comparison: openStatus()}), NOW)
  assert.ok(result.signals.some((signal) => signal.type === 'no_official_website_found'))
  assert.equal(result.hypotheses.length, 0)
  assert.equal(result.status, 'needs-review')
})

test('review válida desbloquea hipótesis y conserva referencias a signals y review', () => {
  const result = analyzeOpportunity(fixture({website: null, comparison: openStatus(), review: verifiedReview()}), NOW)
  const hypothesis = result.hypotheses.find((item) => item.area === 'web-presence')
  assert.match(hypothesis?.hypothesis ?? '', /confirmado como operativo/)
  assert.deepEqual(hypothesis?.basedOnSignalIds, ['signal:no_official_website_found'])
  assert.equal(hypothesis?.basedOnReview?.reviewedBy, 'reviewer@example.test')
  assert.ok(hypothesis?.basedOnReview?.fields.includes('operationalStatus'))
  assert.ok(hypothesis?.limitations.some((item) => /No implica/.test(item)))
  assert.equal(result.status, 'analyzed')
})

test('negocio con web oficial confirmada no genera hipótesis de necesidad web', () => {
  const result = analyzeOpportunity(fixture({website: official, comparison: openStatus(), review: verifiedReview({website: 'confirmed'})}), NOW)
  assert.ok(result.signals.some((signal) => signal.type === 'official_website_found'))
  assert.ok(!result.hypotheses.some((item) => item.area === 'web-presence'))
})

test('web exclusivamente de marca se distingue de web local', () => {
  const result = analyzeOpportunity(fixture({website: brand, comparison: openStatus()}), NOW)
  assert.ok(result.signals.some((signal) => signal.type === 'brand_website_only'))
  assert.ok(!result.signals.some((signal) => signal.type === 'official_website_found'))
  assert.equal(result.hypotheses.length, 0)
})

test('ausencia de datos no se convierte en necesidad comercial si el estado es desconocido', () => {
  const result = analyzeOpportunity(fixture({website: null}), NOW)
  assert.equal(result.status, 'needs-review')
  assert.equal(result.hypotheses.length, 0)
  assert.ok(result.suggestedActions.some((action) => action.type === 'do-not-contact'))
})

test('conflictos de identidad y estado priorizan revisión, no oportunidad', () => {
  const identity = analyzeOpportunity(fixture({comparison: {integrityIssues: [{code: 'IDENTITY_MISMATCH', sourceKeys: [osm.key], message: 'No coincide'}], operationalStatus: openStatus().operationalStatus}}), NOW)
  assert.ok(identity.signals.some((signal) => signal.type === 'identity_conflict'))
  assert.equal(identity.status, 'needs-review')
  assert.equal(identity.hypotheses.length, 0)
  const operational = analyzeOpportunity(fixture({comparison: {integrityIssues: [{code: 'OPERATIONAL_STATUS_REVIEW', sourceKeys: [osm.key], message: 'Señales contradictorias'}], operationalStatus: {status: 'open', assessedAt: NOW, sourceKeys: [osm.key], needsVerification: true, reasons: ['Señales contradictorias']}}}), NOW)
  assert.ok(operational.signals.some((signal) => signal.type === 'operational_status_conflict'))
  assert.equal(operational.status, 'needs-review')
})

test('cada hipótesis referencia señales existentes', () => {
  const result = analyzeOpportunity(fixture({website: null, comparison: openStatus(), review: verifiedReview()}), NOW)
  const ids = new Set(result.signals.map((signal) => signal.id))
  assert.ok(result.hypotheses.every((item) => item.basedOnSignalIds.every((id) => ids.has(id))))
})

test('ausencia de provenance impide evidencia fuerte', () => {
  const input = fixture({website: null, comparison: openStatus()})
  input.entry.sources = []
  input.discovered!.sources = []
  input.enriched!.sources = []
  const result = analyzeOpportunity(input, NOW)
  assert.equal(result.summary.evidenceStrength, 'weak')
  assert.equal(result.provenance.coverage, 0)
})

test('persistencia incremental conserva artefacto, manifest y módulos editoriales', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'opportunity-incremental-'))
  try {
    await mkdir(resolve(root, 'content/discovered'), {recursive: true})
    const input = fixture({website: null, comparison: openStatus()})
    const manifest = {version: 1, updatedAt: NOW, entries: [input.entry]}
    await writeFile(resolve(root, 'content/manifest.json'), JSON.stringify(manifest, null, 2))
    await writeFile(resolve(root, `content/discovered/${input.entry.id}.json`), JSON.stringify(input.discovered))
    const manifestBefore = await readFile(resolve(root, 'content/manifest.json'), 'utf8')
    const selectionBefore = await readFile(resolve(process.cwd(), 'scripts/comparison/lib/selection.ts'), 'utf8')
    const gateBefore = await readFile(resolve(process.cwd(), 'scripts/comparison/lib/gate.ts'), 'utf8')
    const first = await runOpportunityAnalysis({root, limit: 1, now: NOW})
    const second = await runOpportunityAnalysis({root, limit: 1, now: '2026-10-16T12:00:00.000Z'})
    assert.equal(first.reusedUnchanged, 0)
    assert.equal(second.reusedUnchanged, 1)
    assert.equal(await readFile(resolve(root, 'content/manifest.json'), 'utf8'), manifestBefore)
    assert.equal(await readFile(resolve(process.cwd(), 'scripts/comparison/lib/selection.ts'), 'utf8'), selectionBefore)
    assert.equal(await readFile(resolve(process.cwd(), 'scripts/comparison/lib/gate.ts'), 'utf8'), gateBefore)
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('negocio legacy sin lifecycle sigue siendo analizable', () => {
  const input = fixture({website: official, comparison: openStatus()})
  delete input.entry.discovery
  const result = analyzeOpportunity(input, NOW)
  assert.equal(result.businessId, input.entry.id)
  assert.equal(result.category, 'hospitality')
})

test('Opportunity Analysis consume una referencia compacta de Verification sin alterar la review', () => {
  const review = verifiedReview()
  const before = structuredClone(review)
  const input = fixture({website: null, comparison: openStatus(), review})
  input.verification = {
    schemaVersion: 1, businessId: input.entry.id, generatedAt: NOW, fingerprint: 'verification-fingerprint',
    expiresAt: {websiteReachability: NOW, operationalEvidence: NOW, identity: NOW, contactChannels: NOW},
    identityEvidence: {status: 'probable-match', signals: []}, operationalEvidence: {status: 'supported-open', signals: []},
    digitalPresence: {phones: [], emails: [], forms: [], bookingUrls: [], quoteRequestUrls: [], ecommerceUrls: [], socialProfiles: []},
    websiteSignals: [], commercialInformation: {items: [], openingHours: [], counts: {services: 0, products: 0, prices: 0, openingHours: 0}},
    sources: [osm], sourceKeys: [osm.key], errors: [],
  }
  const result = analyzeOpportunity(input, NOW)
  assert.deepEqual(review, before)
  assert.deepEqual(result.verification, {artifact: `content/verification/${input.entry.id}.json`, generatedAt: NOW, fingerprint: 'verification-fingerprint', identityEvidence: 'probable-match', operationalEvidence: 'supported-open'})
  assert.equal('digitalPresence' in (result.verification as object), false)
})

function fixture(options: {website?: SourceProvenance | null; comparison?: OpportunityFixture['comparison']; review?: OpportunityReview} = {}): OpportunityFixture {
  const websiteSource = options.website && typeof options.website === 'object' ? options.website : undefined
  const sources = [osm, ...(websiteSource ? [websiteSource] : [])]
  const entry = {
    id: 'business-fixture', type: 'restaurant', slug: 'fixture', status: 'enriched', priority: 1, sources,
    discoveredAt: NOW, enrichedAt: NOW, generatedAt: null, validatedAt: null, importedAt: null, reviewedAt: null, publishedAt: null,
    qualityTier: 'basic', qualityAssessedAt: NOW, qualityReasons: [], missingUsefulFacts: [], lastError: null,
    discovery: {state: 'discovered', firstSeenAt: NOW, lastSeenAt: NOW, categories: ['hospitality'], geographicScopes: ['Benidorm'], sourceIdentifiers: sources.map(({provider, identifier}) => ({provider, identifier})), researchSelections: [], editorialEligibility: [], history: []},
  } satisfies ManifestEntry
  const facts = Object.fromEntries(['name', 'businessKind', 'address', 'location', 'phone', 'website', 'openingHoursRaw', 'cuisine', 'concept', 'specialties', 'services', 'bookingAvailability', 'takeaway', 'delivery', 'terrace', 'accessibility', 'openingInformation', 'locationContext', 'distinctiveFeatures'].map((key) => [key, {value: null, sources: []}])) as any
  facts.name = {value: 'Fixture', sources: [osm.key]}
  facts.businessKind = {value: 'restaurant', sources: [osm.key]}
  facts.address = {value: {locality: 'Benidorm'}, sources: [osm.key]}
  facts.website = websiteSource ? {value: websiteSource.url, sources: [websiteSource.key]} : {value: null, sources: []}
  const discovered: DiscoveredEntity = {schemaVersion: 2, id: entry.id, type: 'restaurant', targetDocumentType: 'business', slug: entry.slug, priority: 1, sources, raw: {name: 'Fixture', tags: {amenity: 'restaurant', 'addr:city': 'Benidorm'}, latitude: 38.54, longitude: -0.13}}
  const enriched = {schemaVersion: 2, id: entry.id, type: 'restaurant', targetDocumentType: 'business', slug: entry.slug, facts, factsBySource: {openStreetMap: facts, officialWebsite: {}}, editorial: {}, sources} as EnrichedEntity
  return {entry, discovered, enriched, ...(options.comparison ? {comparison: options.comparison} : {}), ...(options.review ? {review: options.review} : {})}
}

type OpportunityFixture = {entry: ManifestEntry; discovered: DiscoveredEntity; enriched: EnrichedEntity; comparison?: {integrityIssues: Array<{code: string; sourceKeys: string[]; message: string}>; operationalStatus?: any}; review?: OpportunityReview; verification?: VerificationArtifact}
function openStatus() { return {integrityIssues: [], operationalStatus: {status: 'open', assessedAt: NOW, sourceKeys: [osm.key], needsVerification: false, reasons: []}} }
function verifiedReview(override: {website?: OpportunityReview['officialPresence']['website']} = {}): OpportunityReview {
  return {
    schemaVersion: 1, businessId: 'business-fixture', reviewedAt: NOW, reviewedBy: 'reviewer@example.test', workflowStatus: 'verified',
    operationalStatus: 'confirmed-open', identityStatus: 'confirmed',
    officialPresence: {website: override.website ?? 'not-found', googleProfile: 'not-checked', socialProfiles: 'not-checked'},
    contactChannels: {}, reviewedSourceKeys: [osm.key], notes: 'Revisión de fixture.',
  }
}
