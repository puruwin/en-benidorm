import assert from 'node:assert/strict'
import test from 'node:test'
import type {BusinessFacts, EnrichedEntity, Fact, SourceProvenance} from '../../content/lib/types'
import {sourceIntegrity, withSourceIntegrity} from '../../content/lib/source-integrity'
import {assessOperationalStatus, checkEstablishmentIdentity, isConfirmedCurrentClosure} from './integrity'

test('clasifica provenance legacy sin romper artefactos existentes', () => {
  assert.deepEqual(sourceIntegrity(source('osm', 'openstreetmap')), {sourceClass: 'open-data', claimScope: 'establishment', inferred: true})
  assert.deepEqual(sourceIntegrity(source('official', 'official-website')), {sourceClass: 'official-location', claimScope: 'establishment', inferred: true})
  assert.equal(withSourceIntegrity(source('brand', 'official-website'), {sourceClass: 'official-brand', claimScope: 'brand'}).claimScope, 'brand')
})

test('la identidad no se confirma por nombre aislado y rechaza identificadores incompatibles', () => {
  const item = entity()
  assert.equal(checkEstablishmentIdentity({name: 'My Bakery'}, item).outcome, 'ambiguous')
  assert.equal(checkEstablishmentIdentity({businessId: 'business-otra', name: 'My Bakery'}, item).outcome, 'mismatch')
  assert.equal(checkEstablishmentIdentity({phone: '+34966889185'}, item).outcome, 'confirmed')
})

test('señales de terceros contradictorias quedan unknown y needsVerification', () => {
  const item = entity()
  const sources = [
    {...source('directory:a', 'directory'), sourceClass: 'third-party' as const, claimScope: 'establishment' as const},
    {...source('directory:b', 'directory'), sourceClass: 'third-party' as const, claimScope: 'establishment' as const},
  ]
  const identity = {businessId: item.id, address: 'Avenida del Doctor Orts Llorca 19, 03503 Benidorm'}
  const status = assessOperationalStatus(item, [
    {status: 'closed', observedAt: '2026-10-15', sourceKeys: ['directory:a'], identity},
    {status: 'temporarily_closed', observedAt: '2026-10-15', sourceKeys: ['directory:b'], identity},
  ], sources, '2026-10-15T10:00:00.000Z')
  assert.equal(status.status, 'unknown')
  assert.equal(status.needsVerification, true)
  assert.equal(isConfirmedCurrentClosure(status), false)
})

test('sólo un cierre local fiable, vigente e identificado se considera confirmado', () => {
  const item = entity()
  const official = {...source('official:location', 'official-website'), sourceClass: 'official-location' as const, claimScope: 'establishment' as const}
  const status = assessOperationalStatus(item, [{
    status: 'temporarily_closed', observedAt: '2026-10-15', sourceKeys: [official.key], identity: {businessId: item.id},
  }], [official], '2026-10-15T10:00:00.000Z')
  assert.equal(status.status, 'temporarily_closed')
  assert.equal(status.needsVerification, false)
  assert.equal(isConfirmedCurrentClosure(status), true)
})

function entity(): EnrichedEntity {
  const key = 'openstreetmap:node/7992549855'
  const empty = <T>(): Fact<T> => ({value: null, sources: []})
  const fact = <T>(value: T): Fact<T> => ({value, sources: [key]})
  const facts: BusinessFacts = {
    name: fact('My Bakery'), businessKind: fact('cafe'),
    address: fact({street: 'Avenida del Doctor Orts Llorca 19', postalCode: '03503', locality: 'Benidorm'}),
    location: fact({lat: 38.5407596, lng: -0.1235102}), phone: fact('+34 966 88 91 85'), website: fact('https://mybakerybenidorm.com/'),
    openingHoursRaw: empty(), cuisine: empty(), concept: empty(), specialties: empty(), services: empty(), bookingAvailability: empty(),
    takeaway: empty(), delivery: empty(), terrace: empty(), accessibility: empty(), openingInformation: empty(), locationContext: empty(), distinctiveFeatures: empty(),
  }
  return {schemaVersion: 2, id: 'business-my-bakery', type: 'cafe', targetDocumentType: 'business', slug: 'my-bakery', facts,
    factsBySource: {openStreetMap: facts, officialWebsite: {cuisine: empty(), concept: empty(), specialties: empty(), services: empty(), bookingAvailability: empty(), takeaway: empty(), delivery: empty(), terrace: empty(), accessibility: empty(), openingInformation: empty(), locationContext: empty(), distinctiveFeatures: empty()}}, editorial: {}, sources: [source(key, 'openstreetmap')]}
}

function source(key: string, provider: string): SourceProvenance {
  return {key, provider, identifier: key, url: 'https://example.com', retrievedAt: '2026-10-15T00:00:00.000Z', attribution: 'Test', licenseUrl: null}
}
