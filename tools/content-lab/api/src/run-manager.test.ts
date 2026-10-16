import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import test from 'node:test'
import {RunManager} from './run-manager'

function fakeProcess() {
  const child: any = new EventEmitter()
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 123456; child.killed = false
  child.kill = () => { child.killed = true; return true }
  return child
}

test('run manager transiciona running -> completed y captura streams', async () => {
  const child = fakeProcess()
  const manager = new RunManager('/project', (() => child) as any)
  const run = manager.start('arroces', 'selection')
  assert.equal(run.status, 'running')
  assert.throws(() => manager.start('italiano', 'selection'), /ejecución activa/)
  child.stdout.write('Loading candidates...\n'); child.stderr.write('warning\n')
  child.emit('close', 0, null)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(run.status, 'completed'); assert.equal(run.exitCode, 0)
  assert.ok(run.logs.some((log) => log.stream === 'stdout' && log.message === 'Loading candidates...'))
  assert.ok(run.logs.some((log) => log.stream === 'stderr' && log.message === 'warning'))
})

test('run manager marca cancelled aunque el proceso termine después', () => {
  const child = fakeProcess()
  const manager = new RunManager('/project', (() => child) as any)
  const run = manager.start('arroces', 'qa')
  const originalKill = process.kill
  process.kill = (() => true) as typeof process.kill
  try { manager.cancel(run.id) } finally { process.kill = originalKill }
  assert.equal(run.status, 'cancelled')
  child.emit('close', null, 'SIGTERM')
  assert.equal(run.status, 'cancelled')
  assert.ok(run.finishedAt)
})

test('run manager emite una sola notificación terminal', () => {
  const child = fakeProcess()
  const manager = new RunManager('/project', (() => child) as any)
  const run = manager.start('desayunos', 'generation')
  const notifications: Array<{finished: boolean; message: string | undefined}> = []
  manager.subscribe(run.id, (updated, log) => {
    notifications.push({finished: Boolean(updated.finishedAt), message: log?.message})
  })

  child.emit('close', 0, null)

  const terminal = notifications.filter((notification) => notification.finished)
  assert.equal(terminal.length, 1)
  assert.match(terminal[0]?.message ?? '', /^COMPLETED/)
})

test('run manager oculta valores sensibles y acota los logs retenidos', () => {
  const child = fakeProcess()
  const manager = new RunManager('/project', (() => child) as any)
  const previous = process.env.CONTENT_LAB_TEST_API_KEY
  process.env.CONTENT_LAB_TEST_API_KEY = 'fixture-secret-for-log-test'
  try {
    const run = manager.start('desayunos', 'generation')
    child.stderr.write('failure fixture-secret-for-log-test\n')
    assert.ok(run.logs.some(log => log.message.includes('[REDACTED]')))
    assert.ok(!run.logs.some(log => log.message.includes('fixture-secret-for-log-test')))
    for (let i = 0; i < 5100; i++) child.stdout.write(`line ${i}\n`)
    assert.equal(run.logs.length, 5000)
    child.emit('close', 0, null)
  } finally {
    if (previous === undefined) delete process.env.CONTENT_LAB_TEST_API_KEY
    else process.env.CONTENT_LAB_TEST_API_KEY = previous
  }
})

test('shutdown cancela su proceso activo y rechaza nuevos trabajos', async () => {
  const child = fakeProcess()
  const manager = new RunManager('/project', (() => child) as any)
  const run = manager.start('desayunos', 'selection')
  const originalKill = process.kill
  process.kill = (() => true) as typeof process.kill
  try {
    const closing = manager.shutdown()
    assert.throws(() => manager.start('arroces', 'selection'), /cerrándose/)
    child.emit('close', null, 'SIGTERM')
    await closing
    assert.equal(run.status, 'cancelled')
    assert.ok(run.finishedAt)
  } finally {process.kill = originalKill}
})
