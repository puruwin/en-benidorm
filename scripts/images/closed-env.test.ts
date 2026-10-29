import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {loadEnvironment} from '../sanity-client'

test('con CONTENT_LAB_CLOSED_ENV, loadEnvironment no rellena variables desde .env', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closed-env-'))
  const cwd = process.cwd()
  await writeFile(join(dir, '.env'), 'CLOSED_ENV_TEST_TOKEN=from-dotenv\n')
  process.env.CONTENT_LAB_CLOSED_ENV = '1'
  try {
    process.chdir(dir)
    loadEnvironment()
    assert.equal(process.env.CLOSED_ENV_TEST_TOKEN, undefined)
  } finally {
    process.chdir(cwd)
    delete process.env.CONTENT_LAB_CLOSED_ENV
    await rm(dir, {recursive: true, force: true})
  }
})
