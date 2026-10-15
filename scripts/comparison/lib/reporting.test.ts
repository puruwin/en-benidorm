import assert from 'node:assert/strict'
import {access, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import {readJson, writeJsonAtomic} from '../../content/lib/files'
import {
  comparisonGlobalReportPath,
  comparisonTopicReportPath,
  type ComparisonReportPhase,
  writeComparisonReport,
} from './reporting'

const startedAt = '2026-10-08T07:52:00.000Z'
const finishedAt = '2026-10-08T07:52:01.000Z'

function report(marker: string) {
  return {startedAt, finishedAt, marker}
}

async function tempRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'comparison-reports-'))
  try { await run(root) } finally { await rm(root, {recursive: true, force: true}) }
}

async function seed(root: string, topic: string, phases: ComparisonReportPhase[]): Promise<void> {
  for (const phase of phases) await writeJsonAtomic(resolve(root, comparisonTopicReportPath(topic, phase)), {
    topic, phase, startedAt, finishedAt, status: 'completed', stale: false,
  })
}

test('writeComparisonReport crea el directorio por topic y escribe report persistente y global', async () => tempRoot(async (root) => {
  await writeComparisonReport({root, topic: 'italiano', phase: 'comparison-selection', report: report('selection')})
  const persistent = await readJson<any>(resolve(root, comparisonTopicReportPath('italiano', 'comparison-selection')))
  const global = await readJson<any>(resolve(root, comparisonGlobalReportPath('comparison-selection')))
  assert.equal(persistent.marker, 'selection')
  assert.equal(persistent.status, 'completed')
  assert.equal(persistent.stale, false)
  assert.deepEqual(global, persistent)
}))

test('writeComparisonReport rechaza topics que permitirían path traversal', async () => tempRoot(async (root) => {
  await assert.rejects(
    writeComparisonReport({root, topic: '../italiano', phase: 'comparison-selection', report: report('invalid')}),
    /Topic inválido/,
  )
}))

test('dry-run no escribe reports', async () => tempRoot(async (root) => {
  await writeComparisonReport({root, topic: 'italiano', phase: 'comparison-selection', report: report('dry'), dryRun: true})
  await assert.rejects(access(resolve(root, comparisonTopicReportPath('italiano', 'comparison-selection'))))
  await assert.rejects(access(resolve(root, comparisonGlobalReportPath('comparison-selection'))))
}))

test('selection forzada invalida enrichment, generation y qa', async () => tempRoot(async (root) => {
  await seed(root, 'italiano', ['comparison-enrichment', 'comparison-generation', 'comparison-qa'])
  await writeJsonAtomic(resolve(root, comparisonGlobalReportPath('comparison-qa')), {
    topic: 'italiano', phase: 'comparison-qa', startedAt, finishedAt, status: 'completed', stale: false,
  })
  await writeComparisonReport({root, topic: 'italiano', phase: 'comparison-selection', report: report('new'), invalidateDownstream: true})
  for (const phase of ['comparison-enrichment', 'comparison-generation', 'comparison-qa'] as const) {
    assert.equal((await readJson<any>(resolve(root, comparisonTopicReportPath('italiano', phase)))).stale, true)
  }
  assert.equal((await readJson<any>(resolve(root, comparisonGlobalReportPath('comparison-qa')))).stale, true)
}))

test('enrichment forzado invalida generation y qa, pero no selection', async () => tempRoot(async (root) => {
  await seed(root, 'italiano', ['comparison-selection', 'comparison-enrichment', 'comparison-generation', 'comparison-qa'])
  await writeComparisonReport({root, topic: 'italiano', phase: 'comparison-enrichment', report: report('new'), invalidateDownstream: true})
  assert.equal((await readJson<any>(resolve(root, comparisonTopicReportPath('italiano', 'comparison-selection')))).stale, false)
  assert.equal((await readJson<any>(resolve(root, comparisonTopicReportPath('italiano', 'comparison-generation')))).stale, true)
  assert.equal((await readJson<any>(resolve(root, comparisonTopicReportPath('italiano', 'comparison-qa')))).stale, true)
}))

test('generation forzada sólo invalida qa', async () => tempRoot(async (root) => {
  await seed(root, 'italiano', ['comparison-selection', 'comparison-enrichment', 'comparison-generation', 'comparison-qa'])
  await writeComparisonReport({root, topic: 'italiano', phase: 'comparison-generation', report: report('new'), invalidateDownstream: true})
  assert.equal((await readJson<any>(resolve(root, comparisonTopicReportPath('italiano', 'comparison-enrichment')))).stale, false)
  assert.equal((await readJson<any>(resolve(root, comparisonTopicReportPath('italiano', 'comparison-qa')))).stale, true)
}))

test('qa no invalida upstream y cada rerun deja su propio report current', async () => tempRoot(async (root) => {
  await seed(root, 'italiano', ['comparison-selection', 'comparison-enrichment', 'comparison-generation', 'comparison-qa'])
  await writeJsonAtomic(resolve(root, comparisonTopicReportPath('italiano', 'comparison-qa')), {
    topic: 'italiano', phase: 'comparison-qa', startedAt, finishedAt, status: 'completed', stale: true,
  })
  await writeComparisonReport({root, topic: 'italiano', phase: 'comparison-qa', report: report('new'), invalidateDownstream: true})
  for (const phase of ['comparison-selection', 'comparison-enrichment', 'comparison-generation', 'comparison-qa'] as const) {
    assert.equal((await readJson<any>(resolve(root, comparisonTopicReportPath('italiano', phase)))).stale, false)
  }
}))

test('reports de topics distintos no se pisan', async () => tempRoot(async (root) => {
  await writeComparisonReport({root, topic: 'italiano', phase: 'comparison-selection', report: report('italiano')})
  await writeComparisonReport({root, topic: 'arroces', phase: 'comparison-selection', report: report('arroces')})
  assert.equal((await readJson<any>(resolve(root, comparisonTopicReportPath('italiano', 'comparison-selection')))).marker, 'italiano')
  assert.equal((await readJson<any>(resolve(root, comparisonTopicReportPath('arroces', 'comparison-selection')))).marker, 'arroces')
}))
