import assert from 'node:assert/strict'
import test from 'node:test'
import {assertExpectedPlan, buildPlanArtifact, draftMutations, draftWriter, planDraftWrites, type DocumentState, type DraftMutation, type SanityDoc} from './lib/draft-import'
import {executeImports, type PlanResult, type PlannedImport, type TargetDocument} from './lib/importer'

const NOW = new Date('2026-10-29T10:00:00Z')
const levante: TargetDocument = {type: 'beach', id: 'beach-levante', slug: 'playa-levante', name: 'Playa de Levante'}
const rincon: TargetDocument = {type: 'area', id: 'area-rincon', slug: 'rincon', name: 'Rincón de Loix'}

const planned = (key: string, document: TargetDocument, overrides: Partial<PlannedImport> = {}): PlannedImport => {
  const isArray = document.type !== 'area'
  return {
    key, document, field: isArray ? 'images' : 'image', isArray,
    source: {kind: 'url', url: `https://upload.wikimedia.org/${key}.jpg`}, filename: `${key}.jpg`,
    value: {_type: 'imageWithAlt', alt: 'Arena y hamacas', origin: 'stock', provider: 'commons', sourceUrl: `https://commons.wikimedia.org/wiki/File:${key}.jpg`, placeVerified: true, approvedBy: 'david'},
    credit: 'Ana / commons · cc-by-sa-4.0', ...overrides,
  }
}
const plan = (...imports: PlannedImport[]): PlanResult => ({imports, skipped: [], issues: []})
const published = (id: string, fields: Record<string, unknown> = {}): SanityDoc => ({_id: id, _type: id.replace(/^drafts\./, '').split('-')[0]!, _rev: 'rev-pub', _createdAt: '2026-01-01', _updatedAt: '2026-02-01', name: 'X', ...fields})
const existing = {_type: 'imageWithAlt', alt: 'Otra', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Otra.jpg', asset: {_type: 'reference', _ref: 'image-otra'}}

function fakeClient() {
  const sent: DraftMutation[][] = []
  return {sent, writer: draftWriter({mutate: async (mutations) => { sent.push(mutations) }})}
}

/** Recorre plan → importación → mutaciones como hace el script, con un cliente falso. */
async function run(states: Map<string, DocumentState>, imports: PlannedImport[]) {
  const result = planDraftWrites(plan(...imports), states)
  const {sent, writer} = fakeClient()
  await executeImports(result.imports, {
    read: async () => Buffer.from('original'),
    strip: async (bytes) => ({bytes}),
    upload: async (_bytes, item) => `image-${item.key}`,
    commit: async (document, entries) => { await writer.mutate(draftMutations(states.get(document.id)!, entries), {visibility: 'sync'}) },
    now: () => NOW,
  })
  return {result, sent}
}

test('draftWriter solo deja pasar createIfNotExists y patch sobre drafts.*', async () => {
  const {sent, writer} = fakeClient()
  const rejects = (mutation: unknown, message: RegExp) => assert.rejects(writer.mutate([mutation as DraftMutation], {visibility: 'sync'}), message)
  await rejects({patch: {id: 'beach-levante', set: {name: 'x'}}}, /Solo se escriben borradores/)
  await rejects({patch: {id: 'drafts.', set: {}}}, /Solo se escriben borradores/)
  await rejects({createIfNotExists: {_id: 'beach-levante'}}, /Solo se escriben borradores/)
  await rejects({createOrReplace: {_id: 'drafts.beach-levante'}}, /no permitida/)
  await rejects({delete: {id: 'drafts.beach-levante'}}, /no permitida/)
  await rejects({patch: {id: 'drafts.a'}, delete: {id: 'a'}}, /no permitida/)
  // Una mutación mala en un lote no deja pasar las buenas.
  await assert.rejects(writer.mutate([{patch: {id: 'drafts.a'}}, {patch: {id: 'a'}}], {visibility: 'sync'}))
  assert.equal(sent.length, 0)
  await writer.mutate([{createIfNotExists: {_id: 'drafts.a'}}, {patch: {id: 'drafts.a', set: {}}}], {visibility: 'sync'})
  assert.equal(sent.length, 1)
})

test('sin borrador: lo crea como copia del publicado en la misma transacción y nunca muta el publicado', async () => {
  const states = new Map([[levante.id, {published: published(levante.id, {images: [existing]}), draft: null}]])
  const {result, sent} = await run(states, [planned('A', levante), planned('B', levante)])
  assert.deepEqual(result.imports.map((item) => [item.action, item.draftExists]), [['append', false], ['append', false]])
  assert.equal(sent.length, 1, 'una transacción por documento')
  const [create, patch] = sent[0]!
  assert.deepEqual(create, {createIfNotExists: {_id: 'drafts.beach-levante', _type: 'beach', name: 'X', images: [existing]}})
  assert.ok(patch && 'patch' in patch)
  assert.equal(patch.patch.id, 'drafts.beach-levante')
  assert.equal(patch.patch.ifRevisionID, undefined)
  assert.deepEqual(patch.patch.setIfMissing, {images: []})
  assert.equal(patch.patch.insert?.after, 'images[-1]')
  assert.deepEqual(patch.patch.insert?.items.map((item) => (item as {asset: {_ref: string}}).asset._ref), ['image-A', 'image-B'])
  for (const mutation of sent.flat()) {
    const id = 'patch' in mutation ? mutation.patch.id : mutation.createIfNotExists._id
    assert.match(id, /^drafts\./)
  }
})

test('array con borrador abierto: añade al final con la revisión del borrador y conserva sus cambios', async () => {
  const draftOnly = {...existing, sourceUrl: 'https://commons.wikimedia.org/wiki/File:SoloBorrador.jpg'}
  const states = new Map([[levante.id, {published: published(levante.id), draft: {...published(`drafts.${levante.id}`, {images: [draftOnly]}), _rev: 'rev-draft'}}]])
  const {result, sent} = await run(states, [planned('A', levante)])
  assert.deepEqual(result.imports.map((item) => [item.action, item.draftExists]), [['append', true]])
  assert.equal(sent[0]!.length, 1, 'no recrea el borrador')
  const patch = sent[0]![0]!
  assert.ok('patch' in patch)
  assert.deepEqual({id: patch.patch.id, ifRevisionID: patch.patch.ifRevisionID, set: patch.patch.set}, {id: 'drafts.beach-levante', ifRevisionID: 'rev-draft', set: undefined})
  assert.ok(patch.patch.insert, 'añade, no sustituye el array')
})

test('campo único: sustituye si el borrador no lo cambió; issue si ya lo cambió', async () => {
  const same = new Map([[rincon.id, {published: published(rincon.id, {image: existing}), draft: {...published(`drafts.${rincon.id}`, {image: existing}), _rev: 'r2'}}]])
  const {result, sent} = await run(same, [planned('A', rincon)])
  assert.deepEqual(result.imports.map((item) => item.action), ['replace'])
  const patch = sent[0]![0]!
  assert.ok('patch' in patch)
  assert.deepEqual(Object.keys(patch.patch.set ?? {}), ['image'])
  assert.equal(patch.patch.ifRevisionID, 'r2')

  const changed = new Map([[rincon.id, {published: published(rincon.id, {image: existing}), draft: published(`drafts.${rincon.id}`, {image: {...existing, alt: 'Cambiado en el Studio'}})}]])
  const blocked = await run(changed, [planned('A', rincon)])
  assert.deepEqual(blocked.result.issues, ['A → area-rincon.image: el borrador ya cambió image; resuélvelo en el Studio.'])
  assert.equal(blocked.result.imports.length, 0)
  assert.equal(blocked.sent.length, 0)

  const twice = planDraftWrites(plan(planned('A', rincon), planned('B', rincon)), new Map([[rincon.id, {published: published(rincon.id), draft: null}]]))
  assert.match(twice.issues.join(), /más de una imagen aprobada para el campo único/)
})

test('una imagen cuyo sourceUrl ya está en el publicado, en el borrador o antes en el plan se omite', () => {
  const inPublished = planned('Otra', levante)
  const states = new Map([[levante.id, {published: published(levante.id, {images: [existing]}), draft: published(`drafts.${levante.id}`, {images: [{...existing, sourceUrl: 'https://commons.wikimedia.org/wiki/File:B.jpg'}]})}]])
  const result = planDraftWrites(plan(inPublished, planned('B', levante), planned('C', levante), planned('C2', levante, {value: {...planned('C', levante).value}})), states)
  assert.deepEqual(result.imports.map((item) => item.key), ['C'])
  assert.equal(result.skipped.length, 3)
  assert.match(result.skipped.join('\n'), /Otra → beach-levante\.images: el documento ya tiene esa imagen/)
})

test('documento sin leer: issue, no se importa', () => {
  assert.match(planDraftWrites(plan(planned('A', levante)), new Map()).issues.join(), /no se ha podido leer/)
})

test('planHash estable entre simulaciones; --expect-plan aborta si el plan cambió', () => {
  const states = new Map([[levante.id, {published: published(levante.id), draft: null}]])
  const first = buildPlanArtifact({file: 'content/images/candidates/beach-playa-levante.json', fileHash: 'h1', plan: planDraftWrites(plan(planned('A', levante)), states), now: NOW})
  const again = buildPlanArtifact({file: first.file, fileHash: 'h1', plan: planDraftWrites(plan(planned('A', levante)), states), now: new Date('2026-10-30T00:00:00Z')})
  assert.equal(again.planHash, first.planHash)
  assert.deepEqual(first.imports, [{key: 'A', document: {type: 'beach', id: 'beach-levante', slug: 'playa-levante'}, field: 'images', action: 'append', draftExists: false, credit: 'Ana / commons · cc-by-sa-4.0'}])
  assert.match(first.planHash, /^[a-f0-9]{64}$/)
  assert.doesNotThrow(() => assertExpectedPlan(again, first.planHash))
  assert.doesNotThrow(() => assertExpectedPlan(again, undefined))

  const withDraft = buildPlanArtifact({file: first.file, fileHash: 'h1', plan: planDraftWrites(plan(planned('A', levante)), new Map([[levante.id, {published: published(levante.id), draft: published(`drafts.${levante.id}`)}]])), now: NOW})
  const editedFile = buildPlanArtifact({file: first.file, fileHash: 'h2', plan: planDraftWrites(plan(planned('A', levante)), states), now: NOW})
  const moreImages = buildPlanArtifact({file: first.file, fileHash: 'h1', plan: planDraftWrites(plan(planned('A', levante), planned('B', levante)), states), now: NOW})
  for (const changed of [withDraft, editedFile, moreImages]) assert.throws(() => assertExpectedPlan(changed, first.planHash), /El plan ha cambiado/)
})
