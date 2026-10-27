import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import {loadPracticalFactsContext} from '../../content-validation'
import {writeJsonAtomic} from '../../content/lib/files'
import {
  collaborationNotice, formatObservationDate, isCreatorObservationPath, isPublishable, parseCreatorObservation, priceSeenText,
  videoUrlProblem,
} from '../../../src/lib/creator-observations'
import {processCreatorObservation} from '../process-creator'
import {
  EMPTY_CREATOR_OBSERVATIONS, attachCreatorObservations, creatorObservationSummary, loadCreatorObservations,
  withoutCreatorObservations,
} from './creator-observations'
import {evaluateComparisonDataGate} from './gate'
import {EVIDENCE_CATEGORIES, type EnrichedComparisonArtifact, type EnrichedComparisonBusiness} from './types'

const TODAY = '2026-10-27'
const businessId = 'business-cucina-italiana'

function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'creator-observation',
    businessId,
    sourceType: 'third-party-creator-video',
    urlVideo: 'https://www.instagram.com/reel/ABC123/',
    creador: '@comeenbenidorm',
    publicadoEl: '2026-09-12',
    registradoPor: 'David',
    registradoEl: '2026-10-20',
    resumen: 'Enseña la pasta fresca y la pizza de burrata; dice que conviene reservar en fin de semana.',
    loQueSeMuestra: {
      platos: ['Pasta fresca', 'Pizza de burrata'],
      precios: [{concepto: 'Pizza de burrata', importe: 14.5, moneda: 'EUR', unidad: 'per-unit', vistoEl: '2026-09-12'}],
      ambiente: 'Terraza llena a mediodía.',
    },
    colaboracionPagada: 'desconocido',
    permisoCreador: 'pendiente',
    ...overrides,
  }
}

function issuePaths(raw: unknown): string[] {
  return parseCreatorObservation(raw, 'test.json', TODAY).issues.map((issue) => issue.path)
}

test('una observación de creador completa es válida', () => {
  const {observation: parsed, issues} = parseCreatorObservation(observation(), 'test.json', TODAY)
  assert.deepEqual(issues, [])
  assert.equal(parsed?.creador, '@comeenbenidorm')
})

test('exige los campos del contrato y rechaza los que no son suyos', () => {
  const raw = observation({transcripcion: 'texto literal'})
  delete raw.registradoPor
  delete raw.colaboracionPagada
  const paths = issuePaths(raw)
  assert.ok(paths.includes('transcripcion'))
  assert.ok(paths.includes('registradoPor'))
  assert.ok(paths.includes('colaboracionPagada'))
})

test('solo admite los valores cerrados de colaboración y permiso', () => {
  assert.ok(issuePaths(observation({colaboracionPagada: 'si'})).includes('colaboracionPagada'))
  assert.ok(issuePaths(observation({permisoCreador: 'quizá'})).includes('permisoCreador'))
  for (const value of ['sí', 'no', 'desconocido']) assert.deepEqual(issuePaths(observation({colaboracionPagada: value})), [])
  for (const value of ['sí', 'no', 'pendiente']) assert.deepEqual(issuePaths(observation({permisoCreador: value})), [])
})

test('registradoPor debe ser una persona, no un asistente ni un modelo', () => {
  for (const name of ['Claude', 'ChatGPT', 'IA', 'bot de contenido', 'Asistente']) {
    assert.ok(issuePaths(observation({registradoPor: name})).includes('registradoPor'), name)
  }
  assert.deepEqual(issuePaths(observation({registradoPor: 'Laura (creadora)'})), [])
})

test('las fechas son reales, no futuras y en orden publicación → registro', () => {
  assert.ok(issuePaths(observation({publicadoEl: '2026-02-30'})).includes('publicadoEl'))
  assert.ok(issuePaths(observation({registradoEl: '2026-11-01'})).includes('registradoEl'))
  assert.ok(issuePaths(observation({registradoEl: '2026-09-01'})).includes('registradoEl'))
})

test('un precio visto lleva unidad, moneda y una fecha no posterior al vídeo', () => {
  const price = (overrides: Record<string, unknown>) => observation({loQueSeMuestra: {precios: [{concepto: 'Menú', importe: 15, moneda: 'EUR', unidad: 'per-person', vistoEl: '2026-09-10', ...overrides}]}})
  assert.deepEqual(issuePaths(price({})), [])
  assert.ok(issuePaths(price({unidad: undefined})).includes('loQueSeMuestra.precios[0].unidad'))
  assert.ok(issuePaths(price({unidad: 'por persona'})).includes('loQueSeMuestra.precios[0].unidad'))
  assert.ok(issuePaths(price({moneda: 'USD'})).includes('loQueSeMuestra.precios[0].moneda'))
  assert.ok(issuePaths(price({importe: '15 €'})).includes('loQueSeMuestra.precios[0].importe'))
  assert.ok(issuePaths(price({vistoEl: '2026-09-20'})).includes('loQueSeMuestra.precios[0].vistoEl'))
})

test('las notas son breves: una transcripción no cabe', () => {
  assert.ok(issuePaths(observation({resumen: 'a'.repeat(301)})).includes('resumen'))
  assert.ok(issuePaths(observation({loQueSeMuestra: {espera: 'a'.repeat(201)}})).includes('loQueSeMuestra.espera'))
  assert.ok(issuePaths(observation({loQueSeMuestra: {}})).includes('loQueSeMuestra'))
  assert.ok(issuePaths(observation({loQueSeMuestra: {platos: []}})).includes('loQueSeMuestra.platos'))
})

test('la URL es https, de una plataforma admitida y sin parámetros de seguimiento', () => {
  assert.equal(videoUrlProblem('https://www.instagram.com/reel/ABC123/'), null)
  assert.equal(videoUrlProblem('https://www.youtube.com/watch?v=abc'), null)
  assert.match(videoUrlProblem('http://www.instagram.com/reel/ABC123/')!, /https/)
  assert.match(videoUrlProblem('https://www.instagram.com/reel/ABC123/?igsh=xyz')!, /seguimiento/)
  assert.match(videoUrlProblem('https://instagram.example.com/reel/ABC123/')!, /Host/)
  assert.ok(issuePaths(observation({creador: 'comeenbenidorm'})).includes('creador'))
})

test('presentación: fecha, aviso de colaboración, permiso y precio con unidad y fecha', () => {
  assert.equal(formatObservationDate('2026-09-12'), '12/09/2026')
  assert.match(collaborationNotice('sí')!, /colaboración pagada/)
  assert.match(collaborationNotice('desconocido')!, /No consta/)
  assert.equal(collaborationNotice('no'), null)
  const parsed = parseCreatorObservation(observation(), 'test.json', TODAY).observation!
  assert.equal(isPublishable(parsed), true)
  assert.equal(isPublishable({...parsed, permisoCreador: 'no'}), false)
  assert.match(priceSeenText(parsed.loQueSeMuestra.precios![0]!), /^Pizza de burrata — 14,50\s€ \(por unidad; visto en el vídeo, 12\/09\/2026\)$/)
  assert.equal(isCreatorObservationPath('creator-observations/x.json'), true)
  assert.equal(isCreatorObservationPath('creator-observations/_plantilla-creador.json'), false)
  assert.equal(isCreatorObservationPath('visits/x.json'), false)
})

test('el loader ignora plantillas, valida el businessId y crea una fuente de tercero', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-creator-'))
  try {
    await writeJsonAtomic(resolve(root, '_plantilla-creador.json'), {kind: 'plantilla'})
    await writeJsonAtomic(resolve(root, 'cucina.json'), observation())
    const loaded = await loadCreatorObservations(root, new Set([businessId]), TODAY)
    assert.equal(loaded.records.length, 1)
    const source = loaded.records[0]!.source
    assert.equal(source.sourceClass, 'third-party')
    assert.equal(source.provider, 'creator-observation')
    assert.equal(source.url, 'https://www.instagram.com/reel/ABC123/')
    assert.equal(source.attribution, 'Vídeo de @comeenbenidorm (12/09/2026) · notas de David')

    await assert.rejects(loadCreatorObservations(root, new Set(['business-otro']), TODAY), /businessId inexistente/)
    await writeJsonAtomic(resolve(root, 'rota.json'), observation({permisoCreador: 'tal vez'}))
    await assert.rejects(loadCreatorObservations(root, new Set([businessId]), TODAY), /permisoCreador/)
    assert.deepEqual(await loadCreatorObservations(resolve(root, 'no-existe'), new Set(), TODAY), EMPTY_CREATOR_OBSERVATIONS)
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('adjuntar observaciones no toca evidence, scores, sources ni el gate, y Generation no las recibe', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-creator-attach-'))
  try {
    await writeJsonAtomic(resolve(root, 'nueva.json'), observation({publicadoEl: '2026-10-01', urlVideo: 'https://www.instagram.com/reel/NEW/'}))
    await writeJsonAtomic(resolve(root, 'vieja.json'), observation({permisoCreador: 'no'}))
    const data = await loadCreatorObservations(root, new Set([businessId, 'business-otro']), TODAY)
    const artifact = enrichedArtifact()
    const before = structuredClone(artifact)
    const attached = attachCreatorObservations(artifact, data)

    assert.deepEqual(artifact, before, 'el artefacto original no se muta')
    const target = attached.businesses.find((business) => business.businessId === businessId)!
    assert.deepEqual(target.creatorObservations?.map((item) => [item.ref, item.publishable]), [
      ['creator-observations/nueva.json', true],
      ['creator-observations/vieja.json', false],
    ])
    for (const [index, business] of attached.businesses.entries()) {
      const original = before.businesses[index]!
      assert.deepEqual(business.evidence, original.evidence)
      assert.deepEqual(business.scores, original.scores)
      assert.deepEqual(business.sources, original.sources)
    }
    assert.equal(attached.businesses.find((business) => business.businessId === 'business-otro')!.creatorObservations, undefined)
    assert.deepEqual(evaluateComparisonDataGate(attached), evaluateComparisonDataGate(before))
    assert.deepEqual(withoutCreatorObservations(attached), before)
    assert.deepEqual(creatorObservationSummary(data, attached), {loaded: 2, attached: 2, publishable: 1, businesses: [businessId]})
    assert.equal(attachCreatorObservations(artifact, EMPTY_CREATOR_OBSERVATIONS), artifact)
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('creator:process valida y muestra dónde se conecta, sin escribir', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-creator-process-'))
  try {
    await writeJsonAtomic(resolve(root, 'content/manual/creator-observations/cucina.json'), observation())
    await writeJsonAtomic(resolve(root, 'content/generated/businesses/business-cucina-italiana.json'), {_id: businessId, _type: 'business', slug: {current: 'cucina-italiana'}})
    await writeJsonAtomic(resolve(root, 'content/generated/comparisons/comparison-italiano.json'), {_id: 'comparison-italiano', slug: {current: 'restaurantes-italianos-benidorm'}, entries: [{business: {_ref: businessId}}]})
    await writeJsonAtomic(resolve(root, 'content/comparisons/enriched/comparison-italiano.json'), enrichedArtifact())

    const {connection, issues} = await processCreatorObservation('content/manual/creator-observations/cucina.json', root, TODAY)
    assert.deepEqual(issues, [])
    assert.deepEqual(connection?.ficha, {source: 'content/generated/businesses/business-cucina-italiana.json', href: '/restaurantes/cucina-italiana/'})
    assert.deepEqual(connection?.comparisons, [{source: 'content/generated/comparisons/comparison-italiano.json', href: '/donde-comer/restaurantes-italianos-benidorm/'}])
    assert.deepEqual(connection?.enrichedComparisons, [{source: 'content/comparisons/enriched/comparison-italiano.json', attached: false}])

    await writeJsonAtomic(resolve(root, 'content/manual/creator-observations/otro.json'), observation({businessId: 'business-inexistente'}))
    const missing = await processCreatorObservation('content/manual/creator-observations/otro.json', root, TODAY)
    assert.equal(missing.connection, null)
    assert.equal(missing.issues[0]?.path, 'businessId')

    await assert.rejects(processCreatorObservation('content/manual/creator-observations/_plantilla-creador.json', root, TODAY), /no empezar por "_"/)
    await assert.rejects(processCreatorObservation('content/manual/visits/x.json', root, TODAY), /creator-observations/)
  } finally { await rm(root, {recursive: true, force: true}) }
})

function enrichedArtifact(): EnrichedComparisonArtifact {
  return {
    schemaVersion: 2, id: 'comparison-italiano', topic: 'italiano', searchIntent: 'italiano', slug: 'restaurantes-italianos-benidorm',
    enrichedAt: '2026-10-20T00:00:00.000Z', businesses: [business(businessId), business('business-otro')], sources: [], sourceConflicts: [],
  }
}

function business(id: string): EnrichedComparisonBusiness {
  const evidence = Object.fromEntries(EVIDENCE_CATEGORIES.map((category) => [category, []])) as unknown as EnrichedComparisonBusiness['evidence']
  evidence.cuisine.push({id: `${id}:cuisine:0`, value: 'italiana', nature: 'factual', sourceKeys: ['osm'], sourceStage: 'existing'})
  return {
    businessId: id, name: id, qualityTier: 'basic', topicEvidence: ['italiana'], evidence, sources: [],
    scores: {topicRelevance: 1, specificity: 1, comparisonCoverage: 1, distinctiveValue: 1, practicalUsefulness: 1, total: 5},
  }
}

test('content:validate reporta observaciones de creador rotas y no las usa como observación de un hecho', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-creator-validate-'))
  try {
    await writeJsonAtomic(resolve(root, 'content/manual/creator-observations/buena.json'), observation({registradoEl: '2026-09-12'}))
    await writeJsonAtomic(resolve(root, 'content/manual/creator-observations/rota.json'), observation({colaboracionPagada: 'quizá'}))
    await writeJsonAtomic(resolve(root, 'content/manual/creator-observations/_plantilla-creador.json'), {})
    const {context, issues} = await loadPracticalFactsContext(root)
    assert.deepEqual(issues.map((issue) => [issue.source, issue.path]), [['content/manual/creator-observations/rota.json', 'colaboracionPagada']])
    assert.deepEqual([...context.observations.keys()], [])
  } finally { await rm(root, {recursive: true, force: true}) }
})
