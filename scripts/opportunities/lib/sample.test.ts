import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import type {DiscoveredEntity} from '../../content/lib/types'
import type {OpportunityReview} from './types'
import {describeCandidate, emptyHumanReview, prepareSample, STRATA} from './sample'
import {runOpportunitySample} from '../sample'

function catalog(): DiscoveredEntity[] {
  let counter = 0
  return STRATA.flatMap(stratum => stratum.sectors.flatMap(sector => ['Benidorm', "l'Alfàs del Pi", 'La Nucía'].flatMap((municipality, city) => Array.from({length: 5}, (_, index) => {
    const id = `fixture-${++counter}`
    const tags: Record<string, string> = index % 3 === 0 ? {} : {
      website: `https://${id}.example.com`, phone: `+34 600${String(counter).padStart(6, '0')}`,
      'addr:street': `street-${counter}`, 'addr:city': municipality,
      ...(index % 3 === 2 ? {email: `${id}@example.com`, opening_hours: 'Mo-Fr 09:00-17:00', description: 'Fixture description', check_date: '2026-10-15'} : {}),
    }
    return {schemaVersion: 2, id, slug: id, type: 'service', targetDocumentType: 'business', priority: 0,
      sources: [{key: `fixture:${id}`, provider: 'fixture', identifier: id, url: null, retrievedAt: '2026-10-15', attribution: 'test', licenseUrl: null}],
      raw: {name: id, tags, latitude: 38.53 + city * 0.03 + counter * 0.00001, longitude: -0.12},
      businessClassification: {sector, subsector: 'fixture', matches: []}, geography: {municipality: municipality as 'Benidorm', zone: municipality as 'Benidorm', confidence: 'tag'},
    } satisfies DiscoveredEntity
  }))))
}
const now = '2026-10-15T00:00:00.000Z'
const ids = (report: ReturnType<typeof prepareSample>) => report.businesses.map(item => item.businessId)

test('seed reproducible y orden de archivos no altera muestra ni fingerprint', () => {
  const data = catalog()
  const first = prepareSample({catalog: data}, 'pilot', now)
  const second = prepareSample({catalog: [...data].reverse()}, 'pilot', now)
  assert.deepEqual(first, second)
  assert.equal(first.selectedSize, 20)
  assert.notDeepEqual(ids(first), ids(prepareSample({catalog: data}, 'different', now)))
  assert.equal(first.catalogFingerprint, prepareSample({catalog: data}, 'different', now).catalogFingerprint)
})
test('distribución sectorial exacta, grupos representados y municipios cuando hay suficientes', () => {
  const report = prepareSample({catalog: catalog()}, 'pilot', now)
  assert.ok(report.ready)
  for (const stratum of report.strata) assert.equal(stratum.selected, stratum.size)
  assert.ok(report.metrics.sectors['home-services'])
  assert.ok(report.metrics.sectors['real-estate'])
  assert.equal(report.metrics.sectors.retail, 1)
  assert.equal(report.metrics.sectors['b2b-services'], 1)
  assert.deepEqual(report.metrics.municipalities, {'Benidorm': 13, 'La Nucía': 3, "l'Alfàs del Pi": 4})
})
test('closed, conflictos, ubicación inválida y no comerciales quedan excluidos', () => {
  const data = catalog()
  data[0]!.raw.tags.operational_status = 'closed'
  data[1]!.raw.latitude = null; data[1]!.raw.longitude = null; data[1]!.raw.tags = {}
  data[2]!.raw.tags.commercial = 'no'
  const review = {businessId: data[3]!.id, identityStatus: 'conflict'} as OpportunityReview
  const report = prepareSample({catalog: data, reviews: [review]}, 'pilot', now)
  for (const entity of data.slice(0, 4)) assert.ok(!ids(report).includes(entity.id))
  assert.deepEqual(describeCandidate(data[0]!).exclusionReasons, ['closed'])
  assert.deepEqual(describeCandidate(data[1]!).exclusionReasons, ['invalid-location'])
  assert.deepEqual(describeCandidate(data[3]!, [review]).exclusionReasons, ['identity-conflict'])
})
test('web y teléfono no afectan elegibilidad ni tamaño y metadata es descriptiva', () => {
  const entity = catalog()[0]!
  assert.deepEqual(describeCandidate(entity).exclusionReasons, [])
  const sparse = describeCandidate(entity)
  entity.raw.tags.website = 'https://fixture.example.com'; entity.raw.tags.phone = '+34900123456'
  assert.deepEqual(describeCandidate(entity).exclusionReasons, [])
  assert.equal(sparse.metadataLevel, 'sparse')
  assert.equal(describeCandidate(entity).metadataLevel, 'moderate')
  const data = catalog()
  for (const entity of data) entity.raw.tags = {}
  const report = prepareSample({catalog: data}, 'pilot', now)
  assert.equal(report.selectedSize, 20)
  assert.equal(report.metrics.withoutWebsite, 20)
  assert.equal(report.metrics.withoutPhone, 20)
})
test('exact y strong-probable sin identidad canónica se excluyen en ambos sentidos', () => {
  const data = catalog()
  const a = data[0]!, b = data[1]!
  a.raw.tags = {phone: '+34900123456', website: 'https://duplicate.example.com'}
  b.raw.tags = {...a.raw.tags}
  const report = prepareSample({catalog: data}, 'pilot', now)
  assert.ok(!ids(report).includes(a.id)); assert.ok(!ids(report).includes(b.id))
  delete b.raw.tags.website
  b.raw.name = a.raw.name
  const strong = prepareSample({catalog: data}, 'pilot', now)
  assert.ok(!ids(strong).includes(a.id)); assert.ok(!ids(strong).includes(b.id))
})
test('probable impide seleccionar dos representaciones de la misma identidad', () => {
  const data = catalog()
  for (const entity of data.filter(item => item.businessClassification?.sector === 'education')) {
    entity.raw.name = 'identical-name'; entity.raw.tags = {}; entity.raw.latitude = 38.55; entity.raw.longitude = -0.12
  }
  const report = prepareSample({catalog: data}, 'pilot', now)
  assert.equal(report.businesses.filter(item => item.sector === 'education').length, 1)
  assert.equal(report.ready, false)
  assert.ok(report.duplicateReplacements.length)
})
test('fallback no roba cuota de sectores escasos y registra desviación geográfica', () => {
  const data = catalog().filter(item => item.businessClassification?.sector !== 'education')
  for (const entity of data) entity.geography = {municipality: 'Benidorm', zone: 'Benidorm', confidence: 'tag'}
  const report = prepareSample({catalog: data}, 'pilot', now)
  assert.equal(report.selectedSize, 18)
  assert.equal(report.ready, false)
  assert.equal(report.geographicTargetMet, false)
  assert.ok(report.deviations.some(value => value.includes('education: 0/2')))
  assert.equal(report.strata[0]!.selected, 3)
})
test('plantilla humana contiene exclusivamente campos vacíos', () => {
  const report = prepareSample({catalog: catalog()}, 'pilot', now)
  assert.deepEqual(emptyHumanReview(report), report.businesses.map(({businessId}) => ({businessId, wouldContact: null, commercialAngle: '', usefulWithoutExtraResearch: null, estimatedManualMinutesSaved: null, comments: ''})))
})
test('fingerprint cambia con catálogo o evidencia de identidad; fecha no altera sorteo', () => {
  const data = catalog()
  const original = prepareSample({catalog: data}, 'pilot', now)
  assert.deepEqual(ids(original), ids(prepareSample({catalog: data}, 'pilot', '2027-01-01T00:00:00.000Z')))
  data[0]!.raw.tags.email = 'changed@example.com'
  assert.notEqual(original.catalogFingerprint, prepareSample({catalog: data}, 'pilot', now).catalogFingerprint)
})
test('escritura aislada: manifest y pipelines intactos, review preservada, cambio de muestra protegido', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'opportunity-sample-'))
  try {
    const protectedPaths = ['content/manifest.json', 'content/comparisons/candidates/desayunos.json', 'content/enriched/existing.json', 'content/opportunities/existing.json', 'content/verification/existing.json', 'content/manual/opportunity-reviews/existing.json']
    for (const path of protectedPaths) {
      await mkdir(dirnameFor(path), {recursive: true})
      await writeFile(resolve(root, path), JSON.stringify({businessId: 'existing', marker: 'unchanged'}))
    }
    function dirnameFor(path: string) {return resolve(root, path, '..')}
    await mkdir(resolve(root, 'content/discovered'), {recursive: true})
    for (const entity of catalog()) await writeFile(resolve(root, `content/discovered/${entity.id}.json`), JSON.stringify(entity))
    const report = await runOpportunitySample({root, seed: 'pilot', now})
    assert.equal(report.selectedSize, 20)
    const reviewPath = resolve(root, 'content/manual/opportunity-experiment/sample-20-review.json')
    const review = JSON.parse(await readFile(reviewPath, 'utf8'))
    review[0].wouldContact = false; review[0].comments = 'David evaluation'
    const human = JSON.stringify(review)
    await writeFile(reviewPath, human)
    const again = await runOpportunitySample({root, seed: 'pilot', now})
    assert.deepEqual(ids(again), ids(report))
    assert.equal(await readFile(reviewPath, 'utf8'), human)
    await assert.rejects(runOpportunitySample({root, seed: 'other-seed', now}), /otra muestra/)
    assert.equal(await readFile(reviewPath, 'utf8'), human)
    for (const path of protectedPaths) assert.equal(await readFile(resolve(root, path), 'utf8'), JSON.stringify({businessId: 'existing', marker: 'unchanged'}))
  } finally {await rm(root, {recursive: true, force: true})}
})
test('catálogo ausente o parcial aborta sin fabricar artefactos', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'opportunity-empty-'))
  try {
    await assert.rejects(runOpportunitySample({root}), /Catálogo ausente/)
    await mkdir(resolve(root, 'content/reports/discovery-coverage'), {recursive: true})
    await writeFile(resolve(root, 'content/reports/discovery-coverage/latest.json'), JSON.stringify({totalBusinesses: 3103}))
    await assert.rejects(runOpportunitySample({root}), /Catálogo incompleto/)
    await assert.rejects(readFile(resolve(root, 'content/manual/opportunity-experiment/sample-20-review.json')), {code: 'ENOENT'})
    await assert.rejects(runOpportunitySample({root, size: 10}), /--size/)
  } finally {await rm(root, {recursive: true, force: true})}
})

test('shared source keys y pistas strong de Discovery son simétricas', () => {
  const data = catalog()
  data[1]!.sources = data[0]!.sources
  const report = prepareSample({catalog: data}, 'pilot', now)
  assert.ok(!ids(report).includes(data[0]!.id))
  assert.ok(!ids(report).includes(data[1]!.id))
  const report2 = prepareSample({catalog: catalog(), duplicates: [{existingBusinessId: data[2]!.id, incomingSourceKeys: [data[3]!.sources[0]!.key], confidence: 'strong-probable', signals: ['phone', 'name']}]}, 'pilot', now)
  assert.ok(!ids(report2).includes(data[2]!.id))
  assert.ok(!ids(report2).includes(data[3]!.id))
})
