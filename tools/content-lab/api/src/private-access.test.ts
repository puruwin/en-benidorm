import assert from 'node:assert/strict'
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import {createApp} from './app'
import {passwordHash} from './private-access'
import {requireActor, runtimeConfig} from './runtime-config'
import {installProductionWeb} from './production-web'
import {RunManager} from './run-manager'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'

const origin = 'https://lab.example.test'
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-private-'))
  const config = runtimeConfig({CONTENT_LAB_MODE: 'private', CONTENT_LAB_ORIGIN: origin, CONTENT_LAB_AUTH_USER: 'editor', CONTENT_LAB_PASSWORD_HASH: await passwordHash('fixture-password-only')}, root)
  let spawnCount = 0
  const child: any = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 123456; child.kill = () => true
  const runs = new RunManager(root, (() => {spawnCount++; return child}) as any)
  const app = createApp(root, {config, runs})
  const request = (method: 'GET' | 'POST' | 'PUT' | 'HEAD', url: string, payload?: any, cookie?: string, extra: Record<string, string> = {}) => app.inject({method, url, headers: {host: 'lab.example.test', ...(method === 'GET' || method === 'HEAD' ? {} : {origin, 'content-type': 'application/json'}), ...(cookie ? {cookie} : {}), ...extra}, ...(payload === undefined ? {} : {payload})})
  const login = async () => {
    const response = await request('POST', '/api/session/login', {username: 'editor', password: 'fixture-password-only'})
    assert.equal(response.statusCode, 200)
    return String(response.headers['set-cookie']).split(';')[0]!
  }
  return {root, app, config, request, login, child, spawnCount: () => spawnCount, close: async () => {await app.close(); await rm(root, {recursive: true, force: true})}}
}

test('producción falla sin credenciales/origen HTTPS; local sigue limitado a loopback', () => {
  assert.throws(() => runtimeConfig({NODE_ENV: 'production'}, '/project'), /HTTPS/)
  assert.throws(() => runtimeConfig({NODE_ENV: 'production', CONTENT_LAB_MODE: 'local'}, '/project'), /producción/)
  assert.throws(() => runtimeConfig({CONTENT_LAB_HOST: '0.0.0.0'}, '/project'), /loopback/)
  for (const value of ['http://lab.example.test', 'https://lab.example.test/path', 'https://user:pass@lab.example.test', 'https://lab.example.test/?x=1']) assert.throws(() => runtimeConfig({CONTENT_LAB_MODE: 'private', CONTENT_LAB_ORIGIN: value}, '/project'), /HTTPS/)
  assert.equal(runtimeConfig({}, '/project').port, 4174)
})

test('todas las APIs y métodos quedan protegidos antes de acceder a datos o ejecutar pipelines', async () => {
  const f = await fixture()
  try {
    for (const [method, url] of [['GET', '/api/health'], ['GET', '/api/businesses'], ['GET', '/api/runs/run/events'], ['GET', '/api/businesses/business-test'], ['POST', '/api/comparisons/desayunos/run/generation'], ['POST', '/api/runs/run/cancel'], ['POST', '/api/comparisons/desayunos/codex-prompt']] as const) assert.equal((await f.request(method, url, method === 'GET' ? undefined : {})).statusCode, 401, url)
    assert.equal(f.spawnCount(), 0)
    assert.deepEqual((await f.request('GET', '/api/session')).json(), {authenticationRequired: true, authenticated: false, actor: null})
    assert.equal((await f.request('GET', '/api/businesses', undefined, undefined, {host: 'evil.test'})).statusCode, 403)
    assert.equal((await f.request('GET', '/%61pi/businesses')).statusCode, 401)
  } finally {await f.close()}
})

test('login, cookie segura, acceso autorizado, CSRF y revocación al salir', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.request('POST', '/api/session/login', {username: 'editor', password: 'wrong'})).statusCode, 401)
    assert.equal((await f.request('POST', '/api/session/login', {username: 'editor', password: 'fixture-password-only'}, undefined, {origin: 'https://evil.test'})).statusCode, 403)
    assert.equal((await f.request('POST', '/api/session/login', '{}', undefined, {'content-type': 'text/plain'})).statusCode, 415)
    const response = await f.request('POST', '/api/session/login', {username: 'editor', password: 'fixture-password-only'})
    assert.equal(response.statusCode, 200)
    const setCookie = String(response.headers['set-cookie'])
    for (const flag of ['__Host-content_lab=', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(setCookie.includes(flag))
    assert.ok(!JSON.stringify(response.json()).includes('fixture-password-only'))
    const cookie = setCookie.split(';')[0]!
    assert.equal((await f.request('GET', '/api/health', undefined, cookie)).statusCode, 200)
    assert.equal('projectRoot' in (await f.request('GET', '/api/health', undefined, cookie)).json(), false)
    assert.equal((await f.request('POST', '/api/comparisons/desayunos/codex-prompt', {}, cookie, {origin: 'https://evil.test'})).statusCode, 403)
    assert.equal((await f.request('POST', '/api/session/logout', {}, cookie)).statusCode, 200)
    assert.equal((await f.request('GET', '/api/health', undefined, cookie)).statusCode, 401)
    assert.equal((await f.request('GET', '/api/health', undefined, '__Host-content_lab=forged')).statusCode, 401)
  } finally {await f.close()}
})

test('sesión expirada y reinicio invalidan cookies; login tiene límite de intentos', async () => {
  const f = await fixture()
  try {
    f.config.sessionSeconds = -1
    const cookie = await f.login()
    assert.equal((await f.request('GET', '/api/health', undefined, cookie)).statusCode, 401)
    for (let i = 0; i < 10; i++) assert.equal((await f.request('POST', '/api/session/login', {username: 'editor', password: 'bad'})).statusCode, 401)
    assert.equal((await f.request('POST', '/api/session/login', {username: 'editor', password: 'bad'})).statusCode, 429)
  } finally {await f.close()}
})

test('frontend compilado con rutas SPA; no se sirven datos, código, envs, mapas o traversal', async () => {
  const f = await fixture()
  try {
    await mkdir(resolve(f.root, 'web/assets'), {recursive: true})
    await writeFile(resolve(f.root, 'web/index.html'), '<html><body>Compiled shell</body></html>')
    await writeFile(resolve(f.root, 'web/assets/app.js'), 'console.log("compiled")')
    await writeFile(resolve(f.root, 'web/.env'), 'MUST_NOT_BE_SERVED')
    await installProductionWeb(f.app, resolve(f.root, 'web'))
    for (const path of ['/', '/businesses', '/businesses/business-test', '/comparisons/desayunos', '/assets/app.js']) {
      const response = await f.request('GET', path)
      assert.equal(response.statusCode, 200, path)
      assert.equal(response.headers['x-frame-options'], 'DENY')
      assert.ok(String(response.headers['content-security-policy']).includes("frame-ancestors 'none'"))
    }
    const cookie = await f.login()
    for (const path of ['/.env', '/content/manifest.json', '/scripts/seed-sanity.ts', '/assets/app.js.map', '/assets/%2e%2e/.env', '/api/nonexistent']) {
      const response = await f.request('GET', path, undefined, cookie)
      assert.equal(response.statusCode, 404, path)
      assert.ok(!response.body.includes('MUST_NOT_BE_SERVED'))
    }
  } finally {await f.close()}
})

test('actor: usuario de sesión en privado; CONTENT_LAB_AUTH_USER opcional en local', async () => {
  const hash = await passwordHash('fixture-password-only')
  assert.equal(runtimeConfig({CONTENT_LAB_MODE: 'private', CONTENT_LAB_ORIGIN: origin, CONTENT_LAB_AUTH_USER: 'editor', CONTENT_LAB_PASSWORD_HASH: hash}, '/project').actor, 'editor')
  assert.throws(() => runtimeConfig({CONTENT_LAB_MODE: 'private', CONTENT_LAB_ORIGIN: origin, CONTENT_LAB_PASSWORD_HASH: hash}, '/project'), /CONTENT_LAB_AUTH_USER/)
  assert.equal(runtimeConfig({}, '/project').actor, null)
  assert.equal(runtimeConfig({CONTENT_LAB_AUTH_USER: '  '}, '/project').actor, null)
  assert.equal(runtimeConfig({CONTENT_LAB_AUTH_USER: 'david'}, '/project').actor, 'david')
  assert.equal(runtimeConfig({CONTENT_LAB_AUTH_USER: 'david'}, '/project').username, null)
  assert.throws(() => runtimeConfig({CONTENT_LAB_AUTH_USER: 'x'.repeat(101)}, '/project'), /100 caracteres/)
  assert.equal(requireActor({actor: 'david'}), 'david')
  assert.throws(() => requireActor({actor: null}), (error: any) => error.statusCode === 409 && error.message === 'Define CONTENT_LAB_AUTH_USER para registrar quién decide.')
})

test('/api/session devuelve el actor solo con sesión', async () => {
  const f = await fixture()
  try {
    const login = await f.request('POST', '/api/session/login', {username: 'editor', password: 'fixture-password-only'})
    assert.equal(login.json().actor, 'editor')
    const cookie = String(login.headers['set-cookie']).split(';')[0]!
    assert.deepEqual((await f.request('GET', '/api/session', undefined, cookie)).json(), {authenticationRequired: true, authenticated: true, actor: 'editor'})
    assert.equal((await f.request('GET', '/api/session', undefined, '__Host-content_lab=forged')).json().actor, null)
  } finally {await f.close()}
  for (const [environment, actor] of [[{}, null], [{CONTENT_LAB_AUTH_USER: 'david'}, 'david']] as const) {
    const app = createApp('/project', {config: runtimeConfig(environment, '/project'), runs: new RunManager('/project')})
    try {
      assert.deepEqual((await app.inject({method: 'GET', url: '/api/session'})).json(), {authenticationRequired: false, authenticated: true, actor})
    } finally {await app.close()}
  }
})
