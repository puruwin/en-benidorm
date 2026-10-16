import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {validatePersistentContent} from './project-root'

const script = fileURLToPath(new URL('../../ops/init-storage.mjs', import.meta.url))
test('storage init conserva snapshot y rechaza sobreescritura; preflight exige manifest persistente', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-storage-'))
  try {
    const source = resolve(root, 'source'), content = resolve(root, 'content')
    await mkdir(resolve(source, 'manual'), {recursive: true})
    await writeFile(resolve(source, 'manifest.json'), JSON.stringify({version: 1, entries: []}))
    await writeFile(resolve(source, 'manual/notes.json'), '{"notes":"preserve"}')
    await assert.rejects(validatePersistentContent(root), /persistente/)
    assert.equal(spawnSync(process.execPath, [script, `--source=${source}`, `--target=${content}`]).status, 0)
    await validatePersistentContent(root)
    const bytes = await readFile(resolve(content, 'manual/notes.json'), 'utf8')
    assert.equal(bytes, '{"notes":"preserve"}')
    assert.notEqual(spawnSync(process.execPath, [script, `--source=${source}`, `--target=${content}`]).status, 0)
    assert.equal(await readFile(resolve(content, 'manual/notes.json'), 'utf8'), bytes)
    assert.notEqual(spawnSync(process.execPath, [script, `--source=${source}`, `--target=${source}/nested`]).status, 0)
  } finally {await rm(root, {recursive: true, force: true})}
})
