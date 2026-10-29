import assert from 'node:assert/strict'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {imageScriptsStatus} from './image-scripts-status'

test('los módulos de los scripts de imágenes del repo cargan', async () => {
  const status = await imageScriptsStatus(fileURLToPath(new URL('../../../../', import.meta.url)))
  assert.deepEqual(status, {ok: true, failures: []})
})

test('informa del módulo que no carga y de la ausencia de scripts/images/lib', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'image-scripts-'))
  try {
    const missing = await imageScriptsStatus(root)
    assert.equal(missing.ok, false)
    assert.ok(missing.failures.some(failure => failure.module === 'scripts/images/lib'))
    await mkdir(resolve(root, 'scripts/images/lib'), {recursive: true})
    await writeFile(resolve(root, 'scripts/images/lib/broken.ts'), `import {value} from '../../../src/missing'\nexport default value`)
    const broken = await imageScriptsStatus(root)
    assert.equal(broken.ok, false)
    assert.ok(broken.failures.some(failure => failure.module === 'scripts/images/lib/broken.ts'))
    assert.ok(!broken.failures.some(failure => failure.module === 'scripts/images/lib'))
  } finally {await rm(root, {recursive: true, force: true})}
})
