import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {deploymentStatus} from './deployment-status'
import {runtimeConfig} from './runtime-config'
import {createApp} from './app'

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'deployment-status-'))
  await mkdir(resolve(root, 'content/discovered'), {recursive: true})
  await mkdir(resolve(root, 'tools/content-lab/web/dist'), {recursive: true})
  await writeFile(resolve(root, 'tools/content-lab/web/dist/index.html'), '<html>built</html>')
  await writeFile(resolve(root, 'content/manifest.json'), '{"entries":[{"id":"business-one"}]}')
  await writeFile(resolve(root, 'content/discovered/business-one.json'), JSON.stringify({id: 'business-one', targetDocumentType: 'business', raw: {name: 'One', tags: {}, latitude: 38.5, longitude: -0.1}, sources: []}))
  const environment = {CONTENT_LAB_MODE: 'private', CONTENT_LAB_ORIGIN: 'https://lab.example.test', CONTENT_LAB_AUTH_USER: 'fixture-user-not-for-output', CONTENT_LAB_PASSWORD_HASH: `scrypt$${'a'.repeat(22)}$${'b'.repeat(43)}`}
  return {root, environment, config: runtimeConfig(environment, root), close: () => rm(root, {recursive: true, force: true})}
}

test('diagnóstico separa instalación lista de APIs sin configurar; no muestra valores ni escribe contenido', async () => {
  const f = await fixture()
  try {
    const before = await readFile(resolve(f.root, 'content/manifest.json'), 'utf8')
    const status = await deploymentStatus(f.root, f.config, {environment: f.environment})
    assert.equal(status.ready, true); assert.equal(status.content.businesses, 1)
    assert.equal(status.content.matchesManifest, true)
    assert.deepEqual(status.integrations.map(i => [i.name, i.configured, i.connection]), [['OpenAI', false, 'not-tested'], ['Sanity', false, 'not-tested']])
    const values = {...f.environment, OPENAI_API_KEY: 'fixture-openai-never-output', SANITY_PROJECT_ID: 'fixture-project-never-output', SANITY_DATASET: 'fixture-dataset-never-output', SANITY_API_TOKEN: 'fixture-sanity-never-output'}
    const configured = await deploymentStatus(f.root, f.config, {environment: values})
    assert.ok(configured.integrations.every(i => i.configured && i.connection === 'not-tested'))
    for (const value of Object.values(values)) if (value.startsWith('fixture-') || value.startsWith('scrypt$')) assert.ok(!JSON.stringify(configured).includes(value))
    assert.equal(await readFile(resolve(f.root, 'content/manifest.json'), 'utf8'), before)
  } finally {await f.close()}
})

test('diagnóstico detecta snapshot incompleto, IDs diferentes, artefactos inválidos y build ausente', async () => {
  const f = await fixture()
  try {
    await writeFile(resolve(f.root, 'content/manifest.json'), '{"entries":[{"id":"business-another"}]}')
    let status = await deploymentStatus(f.root, f.config, {environment: {}})
    assert.equal(status.ready, false); assert.equal(status.content.matchesManifest, false)
    await writeFile(resolve(f.root, 'content/manifest.json'), '{"entries":[{"id":"business-one"}]}')
    await writeFile(resolve(f.root, 'content/discovered/business-one.json'), '{}')
    status = await deploymentStatus(f.root, f.config, {environment: {}})
    assert.equal(status.ready, false); assert.equal(status.content.catalogWarnings, 1)
    await rm(resolve(f.root, 'tools/content-lab/web/dist/index.html'))
    status = await deploymentStatus(f.root, null, {environment: {}, configurationError: 'Configuración incompleta.'})
    assert.equal(status.configuration.status, 'invalid'); assert.equal(status.frontend.status, 'missing')
    assert.equal(status.ready, false)
  } finally {await f.close()}
})

test('endpoint de estado protegido en privado y sin conexiones externas en modo local', async () => {
  const f = await fixture()
  const privateApp = createApp(f.root, {config: f.config})
  const local = createApp(f.root)
  try {
    assert.equal((await privateApp.inject({method: 'GET', url: '/api/system', headers: {host: 'lab.example.test'}})).statusCode, 401)
    const response = await local.inject({method: 'GET', url: '/api/system'})
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().content.businesses, 1)
    assert.equal(response.json().mode, 'local')
  } finally {await privateApp.close(); await local.close(); await f.close()}
})

test('doctor termina con código 1 ante configuración privada ausente sin imprimir credenciales', async () => {
  const script = fileURLToPath(new URL('../../ops/doctor.ts', import.meta.url))
  const env = {...process.env}
  for (const key of Object.keys(env)) if (key.startsWith('CONTENT_LAB_') || key === 'NODE_ENV') delete env[key]
  env.OPENAI_API_KEY = 'fixture-doctor-secret-never-output'
  const result = spawnSync(process.execPath, ['--import', 'tsx', script], {cwd: fileURLToPath(new URL('../../../../', import.meta.url)), env, encoding: 'utf8'})
  assert.equal(result.status, 1)
  const status = JSON.parse(result.stdout)
  assert.equal(status.configuration.status, 'invalid')
  assert.ok(!result.stdout.includes(env.OPENAI_API_KEY))
})
