import assert from 'node:assert/strict'
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {syncArtifacts, digest} from '../../ops/sync-artifacts.mjs'

test('sync: primera copia, actualización, reinicio, conflictos y datos humanos', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-artifacts-'))
  const projectRoot = join(root, 'release'), contentPath = join(root, 'persistent')
  const path = 'enriched/business-asisa.json'
  const options = {projectRoot, contentPath}
  async function put(base: string, path: string, data: string) {await mkdir(join(base, path, '..'), {recursive: true}); await writeFile(join(base, path), data)}
  async function release(data: string) {
    await put(projectRoot, `content/${path}`, data)
    await put(projectRoot, 'tools/content-lab/ops/artifacts.json', JSON.stringify({version: 1, files: {[path]: digest(data)}}))
  }
  try {
    await put(contentPath, 'manifest.json', '{"entries":[]}')
    for (const file of ['manual/comparison-observations/asisa.json', 'manual/comparisons/test.json', 'manual/businesses-italiano.json']) await put(contentPath, file, '{"human":true}')
    await put(projectRoot, 'content/manual/comparison-observations/asisa.json', '{"human":false}')
    await release('{"v":1}')
    assert.deepEqual(await syncArtifacts(options), {verified: 1, updated: 1})
    assert.deepEqual(await syncArtifacts(options), {verified: 1, updated: 0})
    await release('{"v":2}')
    assert.equal((await syncArtifacts(options)).updated, 1)
    assert.equal(await readFile(join(contentPath, path), 'utf8'), '{"v":2}')
    for (const file of ['manual/comparison-observations/asisa.json', 'manual/comparisons/test.json', 'manual/businesses-italiano.json']) assert.equal(await readFile(join(contentPath, file), 'utf8'), '{"human":true}')
    await put(contentPath, path, '{"local":true}')
    await release('{"v":3}')
    await assert.rejects(syncArtifacts(options), /Conflicto/)
    assert.equal(await readFile(join(contentPath, path), 'utf8'), '{"local":true}')
    // Removal from release is never a persistent deletion.
    await put(projectRoot, 'tools/content-lab/ops/artifacts.json', '{"version":1,"files":{}}')
    await syncArtifacts(options)
    assert.equal(await readFile(join(contentPath, path), 'utf8'), '{"local":true}')
    // Unknown pre-existing differing artifacts cannot be adopted silently.
    await rm(join(contentPath, '.release-artifacts/state.json'))
    await release('{"v":4}')
    await assert.rejects(syncArtifacts(options), /Conflicto/)
    await put(contentPath, path, '{"v":4}')
    assert.equal((await syncArtifacts(options)).updated, 0)
    // Interrupted publication recorded a pending checksum; next start finishes safely.
    await put(contentPath, '.release-artifacts/state.json', JSON.stringify({version: 1, files: {[path]: {hash: digest('{"v":3}'), pending: digest('{"v":4}')}}}))
    assert.equal((await syncArtifacts(options)).updated, 0)
    await put(contentPath, '.release-artifacts/sync.lock', '')
    await assert.rejects(syncArtifacts(options), /bloqueada/)
    await rm(join(contentPath, '.release-artifacts/sync.lock'))
    await put(projectRoot, `content/${path}`, '{}')
    await assert.rejects(syncArtifacts(options), /Integridad/)
    await release('{"v":5}')
    await rm(join(contentPath, 'enriched'), {recursive: true})
    await symlink(join(projectRoot, 'content/enriched'), join(contentPath, 'enriched'))
    await assert.rejects(syncArtifacts(options), /insegura/)
    await put(projectRoot, 'tools/content-lab/ops/artifacts.json', JSON.stringify({version: 1, files: {'manual/comparisons/test.json': digest('{}')}}))
    await assert.rejects(syncArtifacts(options), /no permitido/)
  } finally {await rm(root, {recursive: true, force: true})}
})

test('release versionado: el runtime sirve las comparativas publicadas y reinicia sin recopiarlas', async () => {
  const {fileURLToPath} = await import('node:url')
  const {prepareManagedRuntime} = await import('../../ops/managed-runtime.mjs')
  const {ArtifactLoader} = await import('./artifact-loader')
  const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url))
  const root = await mkdtemp(join(tmpdir(), 'release-runtime-'))
  const contentPath = join(root, 'content')
  await mkdir(contentPath)
  await writeFile(join(contentPath, 'manifest.json'), '{"entries":[]}')
  try {
    const runtime = await prepareManagedRuntime({projectRoot, contentPath, runtimeParent: root})
    try {
      const loader = new ArtifactLoader(runtime.root)
      assert.equal((await loader.published('arroces')).status, 'available')
      assert.equal((await loader.published('italiano')).status, 'available')
      for (const path of ['generated/comparisons/comparison-arroces.json', 'generated/comparisons/comparison-italiano.json']) assert.deepEqual(await readFile(join(contentPath, path)), await readFile(join(projectRoot, 'content', path)))
    } finally {await runtime.cleanup()}
    assert.equal((await syncArtifacts({projectRoot, contentPath})).updated, 0)
    const second = await prepareManagedRuntime({projectRoot, contentPath, runtimeParent: root})
    await second.cleanup()
  } finally {await rm(root, {recursive: true, force: true})}
})
