import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {PassThrough} from 'node:stream'
import test from 'node:test'
import {createApp} from './app'
import {RunManager} from './run-manager'
import {runtimeConfig} from './runtime-config'

const SLUG = 'beach-playa-levante'
const HASH = 'a'.repeat(64)
const BASE_ENV = {PATH: '/usr/bin', SANITY_PROJECT_ID: 'proj', SANITY_DATASET: 'production', SANITY_API_TOKEN: 'general-token', PIXABAY_API_KEY: 'pix', PEXELS_API_KEY: 'pex', OPENAI_API_KEY: 'openai'}
const plan = (extra: Record<string, unknown> = {}) => ({version: 1, file: `content/images/candidates/${SLUG}.json`, fileHash: 'b'.repeat(64), generatedAt: '2026-10-29T10:00:00.000Z', mode: 'draft',
  imports: [{key: 'commons:1', document: {type: 'beach', id: 'beach-1', slug: 'playa-levante'}, field: 'images', action: 'append', draftExists: false, credit: 'Autor · CC BY 4.0'}], skipped: [], issues: [], planHash: HASH, ...extra})

async function fixture(options: {actor?: string | null; environment?: NodeJS.ProcessEnv; plan?: unknown} = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-image-runs-'))
  await mkdir(resolve(root, 'content/images/candidates'), {recursive: true})
  await writeFile(resolve(root, `content/images/candidates/${SLUG}.json`), '{}')
  if (options.plan !== undefined) {
    await mkdir(resolve(root, 'content/images/plans'), {recursive: true})
    await writeFile(resolve(root, `content/images/plans/${SLUG}.json`), typeof options.plan === 'string' ? options.plan : JSON.stringify(options.plan))
  }
  const spawned: Array<{command: string; args: string[]; env: NodeJS.ProcessEnv}> = []
  const child: any = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 123456; child.kill = () => true
  const runs = new RunManager(root, ((command: string, args: string[], spawnOptions: {env: NodeJS.ProcessEnv}) => {spawned.push({command, args, env: spawnOptions.env}); return child}) as any)
  const actor = options.actor === undefined ? 'david' : options.actor
  const config = runtimeConfig(actor ? {CONTENT_LAB_AUTH_USER: actor} : {}, root)
  const app = createApp(root, {config, runs, environment: options.environment ?? {...BASE_ENV, SANITY_IMAGES_TOKEN: 'images-token'}})
  const post = (url: string, payload?: unknown) => app.inject({method: 'POST', url, ...(payload === undefined ? {} : {payload: payload as any})})
  return {root, runs, child, spawned, post, close: async () => {await app.close(); await rm(root, {recursive: true, force: true})}}
}

test('search lanza images:find con los validadores de buildImagesCommand y sin token de Sanity', async () => {
  const f = await fixture()
  try {
    const response = await f.post('/api/images/search', {doc: 'beach:playa-levante', category: 'Category:Platja de Llevant (Benidorm)', radius: 1000})
    assert.equal(response.statusCode, 202, response.body)
    assert.equal(response.json().kind, 'images')
    assert.deepEqual(response.json().files, [`content/images/candidates/${SLUG}.json`])
    const [spawn] = f.spawned
    assert.deepEqual(spawn!.args.slice(2), ['scripts/images/find-candidates.ts', '--doc=beach:playa-levante', '--category=Category:Platja de Llevant (Benidorm)', '--radius=1000'])
    assert.equal(spawn!.env.PIXABAY_API_KEY, 'pix')
    for (const key of ['SANITY_API_TOKEN', 'SANITY_IMAGES_TOKEN', 'OPENAI_API_KEY']) assert.equal(spawn!.env[key], undefined, key)
  } finally {await f.close()}
})

test('search rechaza con 400 claves desconocidas, action, doc y term a la vez y valores inválidos', async () => {
  const f = await fixture()
  try {
    for (const body of [{term: 'playa', extra: 1}, {action: 'import', slug: SLUG}, {action: 'find', term: 'playa'}, {doc: 'beach:playa-levante', term: 'playa'}, {},
      {doc: 'business:bar-pepe'}, {term: 'playa', radius: 10}, {term: '--write'}, {term: 'playa', category: 'Platja'}, []]) {
      const response = await f.post('/api/images/search', body)
      assert.equal(response.statusCode, 400, `${JSON.stringify(body)} → ${response.body}`)
    }
    assert.equal((await f.post('/api/images/search')).statusCode, 400)
    assert.equal(f.spawned.length, 0)
  } finally {await f.close()}
})

test('import/plan simula con --plan-out y sin --write; slug inexistente → 404 e inválido → 400', async () => {
  const f = await fixture()
  try {
    const response = await f.post(`/api/images/${SLUG}/import/plan`)
    assert.equal(response.statusCode, 202, response.body)
    assert.equal(response.json().label, `images:import ${SLUG} (simulación)`)
    assert.deepEqual(f.spawned[0]!.args.slice(2), ['scripts/images/import-approved.ts', `content/images/candidates/${SLUG}.json`, `--plan-out=content/images/plans/${SLUG}.json`])
    f.child.emit('close', 0, null)
    assert.equal((await f.post('/api/images/no-existe/import/plan')).statusCode, 404)
    assert.equal((await f.post('/api/images/Mayus/import/plan')).statusCode, 400)
    assert.ok([400, 404].includes((await f.post('/api/images/..%2Fsecreto/import/plan')).statusCode))
    assert.equal(f.spawned.length, 1)
  } finally {await f.close()}
})

test('import con el planHash guardado lanza --write con el actor, --expect-plan, --run-id y solo el token de imágenes', async () => {
  const f = await fixture({plan: plan()})
  try {
    const response = await f.post(`/api/images/${SLUG}/import`, {planHash: HASH})
    assert.equal(response.statusCode, 202, response.body)
    const run = response.json()
    assert.deepEqual(f.spawned[0]!.args.slice(3), [`content/images/candidates/${SLUG}.json`, '--write', '--by=david', `--expect-plan=${HASH}`, `--run-id=${run.id}`])
    assert.equal(f.spawned[0]!.env.SANITY_API_TOKEN, 'images-token')
    assert.equal(f.spawned[0]!.env.SANITY_IMAGES_TOKEN, undefined)
    assert.equal(f.spawned[0]!.env.PIXABAY_API_KEY, undefined)
    assert.deepEqual(run.files, [`content/images/candidates/${SLUG}.json`])
  } finally {await f.close()}
})

test('import sin SANITY_IMAGES_TOKEN → 409 aunque exista SANITY_API_TOKEN', async () => {
  for (const token of [undefined, '', '   ']) {
    const f = await fixture({plan: plan(), environment: {...BASE_ENV, ...(token === undefined ? {} : {SANITY_IMAGES_TOKEN: token})}})
    try {
      const response = await f.post(`/api/images/${SLUG}/import`, {planHash: HASH})
      assert.equal(response.statusCode, 409, response.body)
      assert.match(response.json().error, /SANITY_IMAGES_TOKEN/)
      assert.equal(f.spawned.length, 0)
    } finally {await f.close()}
  }
})

test('import rechaza planHash distinto, plan ausente, inválido, con errores o vacío con 409', async () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['hash distinto', plan({planHash: 'c'.repeat(64)}), /no coincide/],
    ['sin plan', undefined, /simula/],
    ['plan roto', '{', /no es válido/],
    ['plan con errores', plan({issues: ['aprobación commons:1: alt vacío']}), /errores/],
    ['plan vacío', plan({imports: []}), /nada que importar/],
  ]
  for (const [name, saved, message] of cases) {
    const f = await fixture({plan: saved})
    try {
      const response = await f.post(`/api/images/${SLUG}/import`, {planHash: HASH})
      assert.equal(response.statusCode, 409, `${name}: ${response.body}`)
      assert.match(response.json().error, message, name)
      assert.equal(f.spawned.length, 0, name)
    } finally {await f.close()}
  }
})

test('import valida el body: solo {planHash} con un sha256', async () => {
  const f = await fixture({plan: plan()})
  try {
    for (const body of [{}, {planHash: 'xyz'}, {planHash: HASH.toUpperCase()}, {planHash: HASH, by: 'otro'}, {planHash: HASH, write: false}, {planHash: HASH, approvedBy: 'otro'}, [HASH]]) {
      const response = await f.post(`/api/images/${SLUG}/import`, body)
      assert.equal(response.statusCode, 400, `${JSON.stringify(body)} → ${response.body}`)
    }
    assert.equal((await f.post(`/api/images/${SLUG}/import`)).statusCode, 400)
    assert.equal((await f.post('/api/images/no-existe/import', {planHash: HASH})).statusCode, 404)
    assert.equal(f.spawned.length, 0)
  } finally {await f.close()}
})

test('sin actor, search, import/plan e import responden 409 y no lanzan nada', async () => {
  const f = await fixture({actor: null, plan: plan()})
  try {
    for (const [url, body] of [['/api/images/search', {term: 'playa'}], [`/api/images/${SLUG}/import/plan`, undefined], [`/api/images/${SLUG}/import`, {planHash: HASH}]] as const) {
      const response = await f.post(url, body)
      assert.equal(response.statusCode, 409, `${url} → ${response.body}`)
      assert.match(response.json().error, /CONTENT_LAB_AUTH_USER/)
    }
    assert.equal(f.spawned.length, 0)
  } finally {await f.close()}
})

test('con un run activo, los tres endpoints responden 409', async () => {
  const f = await fixture({plan: plan()})
  try {
    assert.equal((await f.post('/api/images/search', {term: 'playa'})).statusCode, 202)
    for (const [url, body] of [['/api/images/search', {term: 'playa'}], [`/api/images/${SLUG}/import/plan`, undefined], [`/api/images/${SLUG}/import`, {planHash: HASH}]] as const) {
      assert.equal((await f.post(url, body)).statusCode, 409, url)
    }
    assert.equal(f.spawned.length, 1)
  } finally {await f.close()}
})
