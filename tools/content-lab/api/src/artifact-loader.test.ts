import assert from 'node:assert/strict'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import {ArtifactLoader} from './artifact-loader'

test('artifact loader descubre topic y carga artefactos conocidos', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-loader-'))
  try {
    await mkdir(resolve(root, 'content/comparisons/candidates'), {recursive: true})
    await mkdir(resolve(root, 'content/manual/comparisons'), {recursive: true})
    await writeFile(resolve(root, 'content/comparisons/candidates/comparison-arroces.json'), JSON.stringify({topic: 'arroces', candidateCount: 7, searchIntent: 'elegir arroz'}))
    await writeFile(resolve(root, 'content/manual/comparisons/arroces.json'), '{}')
    const loader = new ArtifactLoader(root)
    const selection = await loader.selection('arroces')
    assert.equal(selection.status, 'available')
    assert.equal((selection.data as any).candidateCount, 7)
    const topics = await loader.topics()
    assert.equal(topics[0]?.topic, 'arroces')
    assert.equal(topics[0]?.configured, true)
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('Content Lab normaliza un selection report antiguo como direct/excluded', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-selection-v1-'))
  try {
    await mkdir(resolve(root, 'content/comparisons/candidates'), {recursive: true})
    await writeFile(resolve(root, 'content/comparisons/candidates/comparison-legacy.json'), JSON.stringify({
      schemaVersion: 1,
      topic: 'legacy',
      candidates: [{businessId: 'business-direct', qualityTier: 'basic', topicEvidence: ['cuisine=italiana']}],
      excluded: [{businessId: 'business-out', reason: 'not-relevant', details: []}],
    }))

    const selection = await new ArtifactLoader(root).selection('legacy')
    const data = selection.data as any
    assert.equal(data.candidates[0].matchType, 'direct')
    assert.equal(data.candidates[0].evidence[0].field, 'cuisine')
    assert.deepEqual(data.summary, {considered: 2, direct: 1, potential: 0, excluded: 1, insufficient: 0})
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('Content Lab conserva un selection report nuevo con direct y potential', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-selection-v2-'))
  try {
    await mkdir(resolve(root, 'content/comparisons/candidates'), {recursive: true})
    const summary = {considered: 4, direct: 1, potential: 1, excluded: 2, insufficient: 1}
    await writeFile(resolve(root, 'content/comparisons/candidates/comparison-breakfast.json'), JSON.stringify({
      schemaVersion: 2,
      topic: 'breakfast',
      summary,
      candidates: [
        {businessId: 'business-direct', matchType: 'direct', evidence: []},
        {businessId: 'business-potential', matchType: 'potential', evidence: [{field: 'businessKind', value: 'cafe', strength: 'supporting', sourceKeys: ['osm:1']}]},
      ],
      excluded: [{businessId: 'business-out', reason: 'not-relevant'}, {businessId: 'business-low', reason: 'outside-potential-limit'}],
    }))

    const selection = await new ArtifactLoader(root).selection('breakfast')
    const data = selection.data as any
    assert.deepEqual(data.summary, summary)
    assert.deepEqual(data.candidates.map((item: any) => item.matchType), ['direct', 'potential'])
    assert.equal(data.candidates[1].evidence[0].strength, 'supporting')
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('artifact loader distingue missing e invalid JSON sin tumbar la app', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-invalid-'))
  try {
    await mkdir(resolve(root, 'content/comparisons/candidates'), {recursive: true})
    await writeFile(resolve(root, 'content/comparisons/candidates/comparison-roto.json'), '{no-json')
    const loader = new ArtifactLoader(root)
    assert.equal((await loader.selection('ausente')).status, 'missing')
    const invalid = await loader.selection('roto')
    assert.equal(invalid.status, 'invalid')
    assert.match(invalid.error ?? '', /Invalid JSON/)
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('Content Lab carga Opportunity Analysis desde artefactos independientes', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-opportunities-'))
  try {
    await mkdir(resolve(root, 'content/reports/opportunities'), {recursive: true})
    await mkdir(resolve(root, 'content/opportunities'), {recursive: true})
    await writeFile(resolve(root, 'content/reports/opportunities/latest.json'), JSON.stringify({businessesAnalyzed: 1, analyses: [{businessId: 'business-uno'}]}))
    await writeFile(resolve(root, 'content/opportunities/business-uno.json'), JSON.stringify({businessId: 'business-uno', status: 'analyzed'}))
    const loader = new ArtifactLoader(root)
    assert.equal((await loader.opportunities()).status, 'available')
    assert.equal(((await loader.opportunity('business-uno')).data as any).status, 'analyzed')
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('report agregado sólo se asocia al topic al que pertenece', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-report-'))
  try {
    await mkdir(resolve(root, 'content/reports'), {recursive: true})
    await writeFile(resolve(root, 'content/reports/comparison-qa.json'), JSON.stringify({topic: 'arroces', qaOutcome: 'WARNING'}))
    const loader = new ArtifactLoader(root)
    const fallback = await loader.topicReport('arroces', 'qa')
    assert.equal(fallback.status, 'available')
    assert.equal(fallback.source, 'global-report')
    assert.equal((await loader.topicReport('italiano', 'qa')).status, 'missing')
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('report persistente por topic tiene prioridad sobre el global', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-priority-'))
  try {
    await mkdir(resolve(root, 'content/reports/comparisons/italiano'), {recursive: true})
    await writeFile(resolve(root, 'content/reports/comparisons/italiano/qa.json'), JSON.stringify({topic: 'italiano', phase: 'comparison-qa', status: 'completed', stale: false, qaOutcome: 'PASS'}))
    await writeFile(resolve(root, 'content/reports/comparison-qa.json'), JSON.stringify({topic: 'italiano', qaOutcome: 'WARNING'}))
    const report = await new ArtifactLoader(root).topicReport('italiano', 'qa')
    assert.equal(report.source, 'topic-report')
    assert.equal((report.data as any).qaOutcome, 'PASS')
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('summary usa artefactos como fallback explícitamente inferido', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-inference-'))
  try {
    await mkdir(resolve(root, 'content/generated/comparisons'), {recursive: true})
    await writeFile(resolve(root, 'content/generated/comparisons/comparison-italiano.json'), JSON.stringify({topic: 'italiano', lastVerified: '2026-10-07'}))
    const summary = await new ArtifactLoader(root).summary('italiano')
    assert.equal(summary.phases.generation.source, 'inference')
    assert.equal(summary.phases.qa.inferred, true)
    assert.equal(summary.phases.qa.qaOutcome, undefined)
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('fallback detecta QA inferida stale si generation es posterior al documento publicado', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-inferred-stale-'))
  try {
    await mkdir(resolve(root, 'content/generated/.staging/comparisons'), {recursive: true})
    await mkdir(resolve(root, 'content/generated/comparisons'), {recursive: true})
    await writeFile(resolve(root, 'content/generated/.staging/comparisons/comparison-italiano.json'), JSON.stringify({topic: 'italiano', generatedAt: '2026-10-08T07:52:00.000Z'}))
    await writeFile(resolve(root, 'content/generated/comparisons/comparison-italiano.json'), JSON.stringify({topic: 'italiano', lastVerified: '2026-10-07'}))
    const summary = await new ArtifactLoader(root).summary('italiano')
    assert.equal(summary.phases.generation.stale, false)
    assert.equal(summary.phases.qa.stale, true)
    assert.equal(summary.qaOutcome, undefined)
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('summary respeta stale y no presenta QA desactualizada como validación actual', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-stale-'))
  try {
    await mkdir(resolve(root, 'content/reports/comparisons/italiano'), {recursive: true})
    for (const [phase, stale, outcome] of [
      ['selection', false, undefined], ['enrichment', false, undefined], ['generation', true, undefined], ['qa', true, 'PASS'],
    ] as const) {
      await writeFile(resolve(root, `content/reports/comparisons/italiano/${phase}.json`), JSON.stringify({
        topic: 'italiano', phase: `comparison-${phase}`, status: 'completed', stale,
        startedAt: '2026-10-07T10:00:00.000Z', finishedAt: '2026-10-07T10:01:00.000Z',
        ...(outcome ? {qaOutcome: outcome} : {}),
      }))
    }
    const summary = await new ArtifactLoader(root).summary('italiano')
    assert.equal(summary.phases.generation.stale, true)
    assert.equal(summary.phases.qa.stale, true)
    assert.equal(summary.qaOutcome, undefined)
    assert.equal(summary.status, 'enriched')
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('dashboard puede resumir dos topics desde reports persistentes simultáneos', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-two-topics-'))
  try {
    for (const [topic, outcome] of [['italiano', 'PASS'], ['arroces', 'WARNING']] as const) {
      await mkdir(resolve(root, `content/reports/comparisons/${topic}`), {recursive: true})
      for (const phase of ['selection', 'enrichment', 'generation', 'qa']) {
        await writeFile(resolve(root, `content/reports/comparisons/${topic}/${phase}.json`), JSON.stringify({
          topic, phase: `comparison-${phase}`, status: 'completed', stale: false,
          startedAt: '2026-10-08T07:52:00.000Z', finishedAt: '2026-10-08T07:53:00.000Z',
          ...(phase === 'qa' ? {qaOutcome: outcome} : {}),
        }))
      }
    }
    const summaries = await new ArtifactLoader(root).topics()
    assert.deepEqual(summaries.map((item) => [item.topic, item.qaOutcome]), [['arroces', 'WARNING'], ['italiano', 'PASS']])
    assert.ok(summaries.every((item) => item.phases.qa.source === 'topic-report'))
  } finally { await rm(root, {recursive: true, force: true}) }
})
