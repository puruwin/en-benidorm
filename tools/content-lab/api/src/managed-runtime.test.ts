import assert from 'node:assert/strict'
import {execFile as execFileCallback} from 'node:child_process'
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import {promisify} from 'node:util'
import {prepareManagedRuntime} from '../../ops/managed-runtime.mjs'
const execFile = promisify(execFileCallback)

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'managed-runtime-'))
  const content = resolve(root, 'persistent/content')
  await mkdir(content, {recursive: true})
  await writeFile(resolve(content, 'manifest.json'), '{"version":1,"entries":[]}')
  await writeFile(resolve(content, 'notes.json'), '{"notes":"preserve across releases"}')
  async function release(name: string) {
    const projectRoot = resolve(root, name)
    for (const dir of ['scripts', 'tools', 'node_modules']) await mkdir(resolve(projectRoot, dir), {recursive: true})
    await writeFile(resolve(projectRoot, 'package.json'), JSON.stringify({type: 'module', scripts: {fixture: 'node scripts/fixture.mjs'}}))
    await writeFile(resolve(projectRoot, 'package-lock.json'), '{}')
    await writeFile(resolve(projectRoot, 'scripts/fixture.mjs'), `import {writeFile} from 'node:fs/promises'; await writeFile('content/worker.json', JSON.stringify({release:${JSON.stringify(name)}}));`)
    return projectRoot
  }
  return {root, content, release, cleanup: () => rm(root, {recursive: true, force: true})}
}

test('runtime externo permite npm/scripts, conserva datos entre releases y no mueve el checkout', async () => {
  const f = await fixture()
  try {
    const firstRelease = await f.release('release-1')
    const runtime = await prepareManagedRuntime({projectRoot: firstRelease, contentPath: f.content, runtimeParent: f.root})
    const firstRoot = runtime.root
    await execFile('npm', ['run', 'fixture'], {cwd: runtime.root})
    assert.deepEqual(JSON.parse(await readFile(resolve(f.content, 'worker.json'), 'utf8')), {release: 'release-1'})
    await runtime.cleanup()
    await assert.rejects(readFile(resolve(firstRoot, 'package.json')), {code: 'ENOENT'})
    await rm(firstRelease, {recursive: true, force: true})
    const secondRelease = await f.release('release-2')
    const second = await prepareManagedRuntime({projectRoot: secondRelease, contentPath: f.content, runtimeParent: f.root})
    try {
      await execFile('npm', ['run', 'fixture'], {cwd: second.root})
      assert.deepEqual(JSON.parse(await readFile(resolve(f.content, 'worker.json'), 'utf8')), {release: 'release-2'})
      assert.equal(await readFile(resolve(f.content, 'notes.json'), 'utf8'), '{"notes":"preserve across releases"}')
      assert.ok((await readdir(secondRelease)).includes('scripts'))
      await assert.rejects(readFile(resolve(secondRelease, 'content/worker.json')), {code: 'ENOENT'})
    } finally {await second.cleanup()}
  } finally {await f.cleanup()}
})

test('runtime rechaza rutas relativas, datos dentro del release, snapshot ausente y dependencias ausentes', async () => {
  const f = await fixture()
  try {
    const projectRoot = await f.release('release')
    await assert.rejects(prepareManagedRuntime({projectRoot, contentPath: './content'}), /absoluta/)
    await mkdir(resolve(projectRoot, 'content'))
    await assert.rejects(prepareManagedRuntime({projectRoot, contentPath: resolve(projectRoot, 'content')}), /fuera/)
    await assert.rejects(prepareManagedRuntime({projectRoot, contentPath: resolve(f.root, 'absent')}), /No existe/)
    await rm(resolve(projectRoot, 'node_modules'), {recursive: true})
    await assert.rejects(prepareManagedRuntime({projectRoot, contentPath: f.content}), /dependencias/)
    await writeFile(resolve(f.content, 'manifest.json'), '{}')
    await assert.rejects(prepareManagedRuntime({projectRoot, contentPath: f.content}), /manifest/)
  } finally {await f.cleanup()}
})
