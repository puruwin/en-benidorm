import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {verificationIsFresh, verifyBusiness, type VerificationInput} from './verification'

const NOW = '2026-10-15T12:00:00.000Z'
const osmSource = {key: 'openstreetmap:node/1', provider: 'openstreetmap', identifier: 'node/1', url: 'https://www.openstreetmap.org/node/1', retrievedAt: NOW, attribution: '© OpenStreetMap contributors', licenseUrl: 'https://www.openstreetmap.org/copyright', sourceClass: 'open-data', claimScope: 'establishment'} as const

function input(tags: Record<string, string> = {}, coordinates = true): VerificationInput {
  return {
    entry: {id: 'business-test', type: 'restaurant', slug: 'test', status: 'discovered', priority: 1, sources: [osmSource], discoveredAt: NOW, enrichedAt: null, generatedAt: null, validatedAt: null, importedAt: null, reviewedAt: null, publishedAt: null, qualityTier: null, qualityAssessedAt: null, qualityReasons: [], missingUsefulFacts: [], lastError: null},
    discovered: {schemaVersion: 2, id: 'business-test', type: 'restaurant', targetDocumentType: 'business', slug: 'test', priority: 1, sources: [osmSource], raw: {name: 'Test Local', tags: {name: 'Test Local', 'addr:street': 'Calle Uno', 'addr:city': 'Benidorm', ...tags}, latitude: coordinates ? 38.53 : null, longitude: coordinates ? -0.13 : null}},
  }
}

function crawler(html: string, url = 'https://test.example/contacto') {
  return async () => ({website: url, pages: [{url, html, text: html.replace(/<[^>]+>/g, ' '), source: {key: `official-website:${url}`, provider: 'official-website', identifier: url, url, retrievedAt: NOW, attribution: 'Web oficial', licenseUrl: null, sourceClass: 'official-location' as const, claimScope: 'establishment' as const}}], documents: [], diagnostics: {requests: 1, cacheHits: 0, durationMs: 1, attemptedUrls: [url], discardedUrls: [], documentsProcessed: 0, documentPages: 0, documentBytes: 0}})
}

test('una web activa aporta señal técnica pero no implica negocio abierto', async () => {
  const artifact = await verifyBusiness(input({website: 'https://test.example'}), {now: NOW, crawler: crawler('<meta name="viewport" content="width=device-width"><h1>Test Local</h1>') as any})
  assert.ok(artifact.websiteSignals.some((signal) => signal.type === 'website_reachable'))
  assert.equal(artifact.operationalEvidence.status, 'insufficient')
})

test('una fuente de marca no se presenta como página del local', async () => {
  const artifact = await verifyBusiness(input({brand: 'Cadena Test', website: 'https://brand.example'}), {now: NOW, crawler: crawler('<h1>Cadena Test</h1>', 'https://brand.example/') as any})
  assert.equal(artifact.digitalPresence.website?.scope, 'brand')
  assert.equal(artifact.digitalPresence.officialLocationPage, undefined)
})

test('se conserva conflicto operativo sin resolverlo por mayoría', async () => {
  const artifact = await verifyBusiness(input({opening_hours: 'Mo-Fr 09:00-18:00', shop: 'vacant'}), {now: NOW})
  assert.equal(artifact.operationalEvidence.status, 'conflicting')
})

test('teléfono más dirección produce identidad fuerte y nombre más coordenadas probable', async () => {
  const strong = await verifyBusiness(input({phone: '+34 965 000 000'}), {now: NOW})
  const probable = await verifyBusiness(input(), {now: NOW})
  assert.equal(strong.identityEvidence.status, 'strong-match')
  assert.equal(probable.identityEvidence.status, 'probable-match')
})

test('detecta contacto y booking explícitos y nunca inventa email', async () => {
  const html = '<h1>Test Local</h1><form action="/send"></form><a href="tel:+34965000000">Call</a><a href="/reservas">Reservar</a>'
  const artifact = await verifyBusiness(input({website: 'https://test.example'}), {now: NOW, crawler: crawler(html) as any})
  assert.equal(artifact.digitalPresence.forms.length, 1)
  assert.equal(artifact.digitalPresence.bookingUrls.length, 1)
  assert.equal(artifact.digitalPresence.emails.length, 0)
})

test('una señal de directorio o fuente abierta es sólo supporting', async () => {
  const artifact = await verifyBusiness(input({opening_hours: 'Mo-Fr 09:00-18:00'}), {now: NOW})
  const open = artifact.operationalEvidence.signals.find((signal) => signal.type === 'third_party_open_signal')
  assert.equal(open?.evidenceRole, 'supporting')
})

test('cache exige fingerprint igual y todos los TTL vigentes', async () => {
  const sourceInput = input()
  const artifact = await verifyBusiness(sourceInput, {now: NOW})
  assert.equal(verificationIsFresh(artifact, sourceInput, '2026-11-01T00:00:00.000Z'), true)
  assert.equal(verificationIsFresh(artifact, sourceInput, '2027-01-01T00:00:00.000Z'), false)
  assert.equal(verificationIsFresh(artifact, input({phone: '1'}), '2026-11-01T00:00:00.000Z'), false)
})

test('Verification no importa ni modifica Selection o Comparison', async () => {
  const code = await readFile(resolve(process.cwd(), 'scripts/opportunities/lib/verification.ts'), 'utf8')
  assert.doesNotMatch(code, /comparison\/|\/select|selection/i)
})
