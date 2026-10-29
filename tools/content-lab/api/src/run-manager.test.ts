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

test('los runs de comparison no reciben SANITY_IMAGES_TOKEN y el log redacta su valor', () => {
  const child = fakeProcess()
  let env: NodeJS.ProcessEnv | undefined
  const manager = new RunManager('/project', ((_command: string, _args: string[], options: {env: NodeJS.ProcessEnv}) => {env = options.env; return child}) as any)
  const previous = process.env.SANITY_IMAGES_TOKEN
  process.env.SANITY_IMAGES_TOKEN = 'fixture-images-token-value'
  try {
    const run = manager.start('desayunos', 'selection')
    assert.equal(env?.SANITY_IMAGES_TOKEN, undefined)
    assert.equal(env?.PATH, process.env.PATH)
    child.stdout.write('token fixture-images-token-value\n')
    assert.ok(!run.logs.some(log => log.message.includes('fixture-images-token-value')))
    child.emit('close', 0, null)
  } finally {
    if (previous === undefined) delete process.env.SANITY_IMAGES_TOKEN
    else process.env.SANITY_IMAGES_TOKEN = previous
  }
})

test('startCommand usa el id dado y rechaza uno repetido', () => {
  const child = fakeProcess()
  const manager = new RunManager('/project', (() => child) as any)
  const spec = {kind: 'images' as const, label: 'images:import x', command: 'node', args: [], env: {}, id: 'run-fijo'}
  assert.equal(manager.startCommand(spec).id, 'run-fijo')
  child.emit('close', 0, null)
  assert.throws(() => manager.startCommand(spec), /repetido/)
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

test('startCommand pasa el entorno exacto al hijo y guarda kind y label', () => {
  const child = fakeProcess()
  const calls: any[] = []
  const manager = new RunManager('/project', ((command: string, args: string[], options: any) => { calls.push({command, args, options}); return child }) as any)
  const env = {PATH: '/usr/bin', CONTENT_LAB_CLOSED_ENV: '1'}
  const run = manager.startCommand({kind: 'images', label: 'images:find beach:playa-levante', command: '/usr/bin/node', args: ['--import', 'tsx', 'scripts/images/find-candidates.ts'], env})
  assert.equal(calls[0].options.env, env)
  assert.equal(calls[0].options.cwd, '/project')
  assert.equal(run.kind, 'images'); assert.equal(run.label, 'images:find beach:playa-levante')
  assert.equal(run.topic, undefined); assert.equal(run.phase, undefined)
  assert.match(run.logs[0]?.message ?? '', /^Running images:find beach:playa-levante/)
  assert.throws(() => manager.start('arroces', 'selection'), /ejecución activa/)
  child.emit('close', 0, null)
  assert.equal(run.status, 'completed')
})

test('start de comparativas sigue heredando process.env (salvo SANITY_IMAGES_TOKEN) y marca kind comparison', () => {
  const calls: any[] = []
  const manager = new RunManager('/project', ((command: string, args: string[], options: any) => { calls.push({command, args, options}); return fakeProcess() }) as any)
  const run = manager.start('arroces', 'selection')
  const {SANITY_IMAGES_TOKEN: _imagesToken, ...inherited} = process.env
  assert.deepEqual(calls[0].options.env, inherited)
  assert.equal(calls[0].command, 'npm')
  assert.deepEqual({kind: run.kind, topic: run.topic, phase: run.phase}, {kind: 'comparison', topic: 'arroces', phase: 'selection'})
  assert.match(run.logs[0]?.message ?? '', /^Running comparison:selection/)
  assert.throws(() => manager.startCommand({kind: 'images', label: 'x', command: 'node', args: [], env: {}}), /ejecución activa/)
})
