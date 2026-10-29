import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {PassThrough} from 'node:stream'
import test from 'node:test'
import {createApp} from './app'
import {ImageDecisions} from './image-decisions'
import {RunManager} from './run-manager'
import {runtimeConfig} from './runtime-config'

const SLUG = 'beach-playa-levante'
const PATH = `content/images/candidates/${SLUG}.json`
const candidate = (id: string, use: 'lugar' | 'ambiental', extra: Record<string, unknown> = {}) => ({
  id, provider: id.split(':')[0], title: id, thumbnailUrl: `https://upload.wikimedia.org/${id}.jpg`, sourceUrl: `https://commons.wikimedia.org/wiki/${id}`,
  originalUrl: `https://upload.wikimedia.org/${id}.jpg`, author: 'Autora', license: {id: 'cc0'}, retrievedAt: '2026-10-01T00:00:00.000Z',
  use, placeBasis: use === 'lugar' ? 'commons-category' : null, warnings: [], ...extra,
})
const baseFile = (extra: Record<string, unknown> = {}) => ({
  version: 1, target: {kind: 'document', type: 'beach', id: 'beach-1', slug: 'playa-levante', name: 'Playa de Levante'},
  generatedAt: '2026-10-01T00:00:00.000Z', query: {category: 'Category:Platja de Llevant (Benidorm)'}, warnings: [],
  candidates: [
    candidate('commons:1', 'lugar', {sourceDescription: 'Vista de la playa desde el mirador'}),
    candidate('pixabay:2', 'ambiental'),
    candidate('commons:3', 'lugar'),
  ],
  rejected: [{id: 'commons:9', reason: 'NC'}], approvals: [], imports: [], ...extra,
})
const valid = {candidateId: 'commons:1', alt: 'Arena y sombrillas junto al paseo', placeVerified: true}

async function fixture(options: {actor?: string | null; file?: unknown} = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-decisions-'))
  await mkdir(resolve(root, 'content/images/candidates'), {recursive: true})
  await writeFile(resolve(root, PATH), JSON.stringify(options.file ?? baseFile()))
  const child: any = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 123456; child.kill = () => true
  const runs = new RunManager(root, (() => child) as any)
  const actor = options.actor === undefined ? 'david' : options.actor
  const config = runtimeConfig(actor ? {CONTENT_LAB_AUTH_USER: actor} : {}, root)
  const decisions = new ImageDecisions(root, {runs, places: ['Benidorm'], now: () => new Date('2026-10-29T10:00:00.000Z')})
  const app = createApp(root, {config, runs, decisions})
  const post = (action: string, payload: unknown, slug = SLUG) => app.inject({method: 'POST', url: `/api/images/${slug}/${action}`, payload: payload as any})
  const read = async () => JSON.parse(await readFile(resolve(root, PATH), 'utf8'))
  return {root, runs, child, post, read, close: async () => {await app.close(); await rm(root, {recursive: true, force: true})}}
}

test('approve guarda la aprobación con el actor de la sesión, la fecha de hoy y via content-lab', async () => {
  const f = await fixture()
  try {
    const response = await f.post('approve', {...valid, caption: '  ', alt: '  Arena y sombrillas junto al paseo '})
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual((await f.read()).approvals, [{candidateId: 'commons:1', alt: 'Arena y sombrillas junto al paseo', placeVerified: true, approvedBy: 'david', approvedAt: '2026-10-29', via: 'content-lab'}])
    assert.equal(response.json().file.approvals.length, 1)
  } finally {await f.close()}
})

test('approve rechaza cada regla de #23 con 400 y no escribe', async () => {
  const cases: Array<[string, Record<string, unknown>, RegExp, Record<string, unknown>?]> = [
    ['candidata inexistente', {...valid, candidateId: 'commons:404'}, /no hay ninguna candidata/],
    ['candidata rechazada', {...valid, candidateId: 'commons:9'}, /rechazada por licencia/],
    ['destino business', {...valid, document: {type: 'business', slug: 'bar-pepe'}}, /fichas de negocio no admiten/],
    ['destino no de stock', {...valid, document: {type: 'event', slug: 'fiesta'}}, /tipo de documento no admitido/],
    ['campo inválido', {...valid, field: 'heroImage'}, /no es de imagen en beach/],
    ['ambiental con placeVerified', {...valid, candidateId: 'pixabay:2'}, /ambiental.*no puede tener el lugar verificado/],
    ['alt vacío', {...valid, alt: '   '}, /falta el alt/],
    ['alt copiado de la fuente', {...valid, alt: 'Vista de la playa, desde el mirador.'}, /copia la descripción de la fuente/],
    ['lugar sin verificar', {candidateId: 'pixabay:2', alt: 'Atardecer en Benidorm', placeVerified: false}, /nombran «Benidorm» con placeVerified = false/],
    ['nombre del documento sin verificar', {candidateId: 'pixabay:2', alt: 'Arena', caption: 'Playa de Levante en verano', placeVerified: false}, /«Playa de Levante»/],
    ['aprobación duplicada', valid, /ya está aprobada para beach:playa-levante/, {approvals: [{...valid, approvedBy: 'david', approvedAt: '2026-10-28'}]}],
    ['candidata descartada', valid, /deshaz el descarte/, {dismissals: [{candidateId: 'commons:1', dismissedBy: 'david', dismissedAt: '2026-10-28T00:00:00.000Z', reason: 'otra playa'}]}],
  ]
  for (const [name, body, message, extra] of cases) {
    const f = await fixture({file: baseFile(extra)})
    try {
      const before = await f.read()
      const response = await f.post('approve', body)
      assert.equal(response.statusCode, 400, `${name}: ${response.body}`)
      assert.match(response.json().error, message, name)
      assert.ok(Array.isArray(response.json().issues), name)
      assert.deepEqual(await f.read(), before, name)
    } finally {await f.close()}
  }
})

test('approvedBy, approvedAt o claves desconocidas en el body dan 400', async () => {
  const f = await fixture()
  try {
    for (const body of [{...valid, approvedBy: 'otro'}, {...valid, approvedAt: '2026-01-01'}]) {
      for (const action of ['approve', 'validate']) {
        const response = await f.post(action, body)
        assert.equal(response.statusCode, 400)
        assert.match(response.json().error, /los pone el servidor/)
      }
    }
    for (const body of [{...valid, via: 'manual'}, {...valid, extra: 1}, {...valid, document: {type: 'beach', slug: '../x'}}, {...valid, placeVerified: 'true'}, [valid]]) {
      assert.equal((await f.post('approve', body)).statusCode, 400, JSON.stringify(body))
    }
    assert.deepEqual((await f.read()).approvals, [])
  } finally {await f.close()}
})

test('validate devuelve issues[] sin escribir', async () => {
  const f = await fixture()
  try {
    const ok = await f.post('validate', valid)
    assert.equal(ok.statusCode, 200)
    assert.deepEqual(ok.json(), {issues: []})
    const bad = await f.post('validate', {...valid, candidateId: 'pixabay:2', alt: ''})
    assert.equal(bad.statusCode, 200)
    assert.equal(bad.json().issues.length, 2)
    assert.deepEqual((await f.read()).approvals, [])
  } finally {await f.close()}
})

test('dismiss exige motivo de 3 a 200 caracteres y no descarta una aprobada; undismiss deja registro', async () => {
  const f = await fixture({file: baseFile({approvals: [{...valid, approvedBy: 'david', approvedAt: '2026-10-28'}]})})
  try {
    assert.equal((await f.post('dismiss', {candidateId: 'pixabay:2', reason: ' x '})).statusCode, 400)
    assert.equal((await f.post('dismiss', {candidateId: 'pixabay:2', reason: 'x'.repeat(201)})).statusCode, 400)
    assert.equal((await f.post('dismiss', {candidateId: 'commons:404', reason: 'otra playa'})).statusCode, 400)
    const approved = await f.post('dismiss', {candidateId: 'commons:1', reason: 'otra playa'})
    assert.equal(approved.statusCode, 400)
    assert.match(approved.json().error, /retira la aprobación/)

    assert.equal((await f.post('undismiss', {candidateId: 'pixabay:2'})).statusCode, 400)
    assert.equal((await f.post('dismiss', {candidateId: 'pixabay:2', reason: 'otra playa'})).statusCode, 200)
    assert.equal((await f.post('dismiss', {candidateId: 'pixabay:2', reason: 'otra playa'})).statusCode, 400)
    assert.equal((await f.post('undismiss', {candidateId: 'pixabay:2'})).statusCode, 200)
    assert.equal((await f.post('dismiss', {candidateId: 'pixabay:2', reason: 'calidad'})).statusCode, 200)
    assert.deepEqual((await f.read()).dismissals, [
      {candidateId: 'pixabay:2', dismissedBy: 'david', dismissedAt: '2026-10-29T10:00:00.000Z', reason: 'otra playa', undoneAt: '2026-10-29T10:00:00.000Z', undoneBy: 'david'},
      {candidateId: 'pixabay:2', dismissedBy: 'david', dismissedAt: '2026-10-29T10:00:00.000Z', reason: 'calidad'},
    ])
  } finally {await f.close()}
})

test('withdraw mueve una aprobación no importada a withdrawn y rechaza una importada', async () => {
  const approval = (candidateId: string) => ({candidateId, alt: 'Arena', placeVerified: true, approvedBy: 'david', approvedAt: '2026-10-28'})
  const f = await fixture({file: baseFile({
    approvals: [approval('commons:1'), approval('commons:3')],
    imports: [{candidateId: 'commons:3', documentId: 'beach-1', field: 'images', assetId: 'image-x', importedAt: '2026-10-28T00:00:00.000Z'}],
  })})
  try {
    assert.equal((await f.post('withdraw', {candidateId: 'pixabay:2'})).statusCode, 400)
    const imported = await f.post('withdraw', {candidateId: 'commons:3'})
    assert.equal(imported.statusCode, 409)
    assert.match(imported.json().error, /ya está importada/)
    assert.equal((await f.post('withdraw', {candidateId: 'commons:1'})).statusCode, 200)
    const file = await f.read()
    assert.deepEqual(file.approvals, [approval('commons:3')])
    assert.deepEqual(file.withdrawn, [{...approval('commons:1'), withdrawnBy: 'david', withdrawnAt: '2026-10-29T10:00:00.000Z'}])
  } finally {await f.close()}
})

test('sin actor, los cinco endpoints responden 409 y no escriben', async () => {
  const f = await fixture({actor: null})
  try {
    for (const [action, body] of [['validate', valid], ['approve', valid], ['dismiss', {candidateId: 'pixabay:2', reason: 'otra playa'}], ['undismiss', {candidateId: 'pixabay:2'}], ['withdraw', {candidateId: 'commons:1'}]] as const) {
      const response = await f.post(action, body)
      assert.equal(response.statusCode, 409, action)
      assert.match(response.json().error, /CONTENT_LAB_AUTH_USER/)
    }
    assert.deepEqual(await f.read(), baseFile())
  } finally {await f.close()}
})

test('un run de imágenes activo sobre el fichero bloquea las escrituras con 409; sobre otro fichero, no', async () => {
  const f = await fixture()
  try {
    f.runs.startCommand({kind: 'images', label: 'images:find', command: 'node', args: [], env: {}, files: [PATH]})
    const blocked = await f.post('approve', valid)
    assert.equal(blocked.statusCode, 409)
    assert.match(blocked.json().error, /ejecución de imágenes activa/)
    assert.equal((await f.post('dismiss', {candidateId: 'pixabay:2', reason: 'otra playa'})).statusCode, 409)
    assert.deepEqual((await f.read()).approvals, [])
    f.child.emit('close', 0, null)

    f.runs.startCommand({kind: 'images', label: 'images:find', command: 'node', args: [], env: {}, files: ['content/images/candidates/termino-playa.json']})
    assert.equal((await f.post('approve', valid)).statusCode, 200)
    f.child.emit('close', 0, null)

    f.runs.startCommand({kind: 'images', label: 'sin files', command: 'node', args: [], env: {}})
    assert.equal((await f.post('dismiss', {candidateId: 'pixabay:2', reason: 'otra playa'})).statusCode, 409)
    f.child.emit('close', 0, null)
  } finally {await f.close()}
})

test('escrituras concurrentes sobre el mismo fichero no se pisan', async () => {
  const f = await fixture()
  try {
    const responses = await Promise.all([
      f.post('approve', valid),
      f.post('approve', {candidateId: 'commons:3', alt: 'Paseo marítimo', placeVerified: true}),
      f.post('dismiss', {candidateId: 'pixabay:2', reason: 'calidad'}),
    ])
    assert.deepEqual(responses.map(response => response.statusCode), [200, 200, 200])
    const file = await f.read()
    assert.deepEqual(file.approvals.map((item: any) => item.candidateId).sort(), ['commons:1', 'commons:3'])
    assert.equal(file.dismissals.length, 1)
  } finally {await f.close()}
})

test('fichero inexistente → 404; JSON roto → 422; slug inválido → 400', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.post('approve', valid, 'no-existe')).statusCode, 404)
    await writeFile(resolve(f.root, 'content/images/candidates/roto.json'), '{no es json')
    assert.equal((await f.post('approve', valid, 'roto')).statusCode, 422)
    assert.equal((await f.post('approve', valid, 'NO_VALIDO')).statusCode, 400)
  } finally {await f.close()}
})
