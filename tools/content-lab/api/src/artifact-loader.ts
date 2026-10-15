import {readdir, readFile} from 'node:fs/promises'
import {basename, resolve} from 'node:path'
import type {ArtifactResponse, ComparisonPhaseState, ComparisonSummary, PipelinePhase} from '../../shared/types'
import {PIPELINE_PHASES, isCurrentPhase} from '../../shared/workflow'
import {validateTopic} from './validation'

type Json = Record<string, any>

const paths = {
  selection: (topic: string) => `content/comparisons/candidates/comparison-${topic}.json`,
  enrichment: (topic: string) => `content/comparisons/enriched/comparison-${topic}.json`,
  generation: (topic: string) => `content/generated/.staging/comparisons/comparison-${topic}.json`,
  published: (topic: string) => `content/generated/comparisons/comparison-${topic}.json`,
  manual: (topic: string) => `content/manual/comparisons/${topic}.json`,
  topicReport: (topic: string, phase: PipelinePhase) => `content/reports/comparisons/${topic}/${phase}.json`,
  globalReport: (phase: PipelinePhase) => `content/reports/comparison-${phase}.json`,
  opportunities: 'content/reports/opportunities/latest.json',
  opportunity: (businessId: string) => `content/opportunities/${businessId}.json`,
}

export class ArtifactLoader {
  constructor(readonly root: string) {}

  async readKnown<T = Json>(relativePath: string): Promise<ArtifactResponse<T>> {
    const absolute = resolve(this.root, relativePath)
    try {
      const text = await readFile(absolute, 'utf8')
      try { return {status: 'available', path: relativePath, data: JSON.parse(text) as T} }
      catch (error) { return {status: 'invalid', path: relativePath, error: `Invalid JSON: ${relativePath}\n${error instanceof Error ? error.message : String(error)}`} }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return {status: 'missing', path: relativePath}
      return {status: 'invalid', path: relativePath, error: error instanceof Error ? error.message : String(error)}
    }
  }

  async selection(topicInput: unknown) {
    const topic = validateTopic(topicInput)
    const artifact = await this.readKnown(paths.selection(topic))
    return artifact.status === 'available'
      ? {...artifact, data: normalizeSelectionArtifact(artifact.data as Json)}
      : artifact
  }
  enrichment(topicInput: unknown) { const topic = validateTopic(topicInput); return this.readKnown(paths.enrichment(topic)) }
  generation(topicInput: unknown) { const topic = validateTopic(topicInput); return this.readKnown(paths.generation(topic)) }
  published(topicInput: unknown) { const topic = validateTopic(topicInput); return this.readKnown(paths.published(topic)) }

  async topicReport(topicInput: unknown, phase: PipelinePhase): Promise<ArtifactResponse> {
    const topic = validateTopic(topicInput)
    const persistentPath = paths.topicReport(topic, phase)
    const persistent = await this.readKnown(persistentPath)
    if (persistent.status !== 'missing') return {...persistent, source: 'topic-report'}

    const globalPath = paths.globalReport(phase)
    const global = await this.readKnown(globalPath)
    if (global.status === 'available' && (global.data as Json).topic === topic) return {...global, source: 'global-report'}
    if (global.status === 'invalid') return {...global, source: 'global-report'}
    return {
      status: 'missing',
      path: persistentPath,
      ...(global.status === 'available' ? {error: `El report global actual pertenece a topic=${(global.data as Json).topic}.`} : {}),
    }
  }

  async evidence(topic: unknown) { return this.enrichment(topic) }
  async opportunities() { return this.readKnown(paths.opportunities) }
  async opportunity(businessId: string) { return this.readKnown(paths.opportunity(businessId)) }

  async topics(): Promise<ComparisonSummary[]> {
    const topics = new Set<string>()
    const directories = [
      ['content/comparisons/candidates', /^comparison-(.+)\.json$/],
      ['content/comparisons/enriched', /^comparison-(.+)\.json$/],
      ['content/generated/.staging/comparisons', /^comparison-(.+)\.json$/],
      ['content/generated/comparisons', /^comparison-(.+)\.json$/],
      ['content/manual/comparisons', /^(.+)\.json$/],
    ] as const
    for (const [directory, pattern] of directories) {
      try {
        for (const file of await readdir(resolve(this.root, directory))) {
          const match = basename(file).match(pattern)
          if (match?.[1] && /^[a-z0-9][a-z0-9-]*$/.test(match[1])) topics.add(match[1])
        }
      } catch { /* optional artifact directory */ }
    }
    try {
      for (const entry of await readdir(resolve(this.root, 'content/reports/comparisons'), {withFileTypes: true})) {
        if (entry.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(entry.name)) topics.add(entry.name)
      }
    } catch { /* optional persistent report directory */ }
    return Promise.all([...topics].sort().map((topic) => this.summary(topic)))
  }

  async summary(topicInput: string): Promise<ComparisonSummary> {
    const topic = validateTopic(topicInput)
    const [selection, enrichment, generation, published, manual, ...reports] = await Promise.all([
      this.selection(topic), this.enrichment(topic), this.generation(topic), this.published(topic), this.readKnown(paths.manual(topic)),
      ...PIPELINE_PHASES.map((phase) => this.topicReport(topic, phase)),
    ])
    const artifacts = {selection, enrichment, generation}
    const phases = Object.fromEntries(PIPELINE_PHASES.map((phase, index) => [
      phase,
      phaseState(phase, reports[index]!, artifacts, published),
    ])) as Record<PipelinePhase, ComparisonPhaseState>
    applyTimestampStaleness(phases)

    const selectionData = selection.data as Json | undefined
    const enrichmentData = enrichment.data as Json | undefined
    const generationData = generation.data as Json | undefined
    const qa = phases.qa
    let status: ComparisonSummary['status'] = 'not-started'
    if (isCurrentPhase(phases.selection)) status = 'selected'
    if (isCurrentPhase(phases.enrichment)) status = 'enriched'
    if (isCurrentPhase(phases.generation)) status = 'generated'
    if (isCurrentPhase(qa) && qa.qaOutcome === 'PASS') status = 'validated'
    if (isCurrentPhase(qa) && qa.qaOutcome === 'WARNING') status = 'warning'
    if (isCurrentPhase(qa) && qa.qaOutcome === 'FAIL') status = 'failed'
    if (PIPELINE_PHASES.some((phase) => phases[phase].status === 'failed' && !phases[phase].stale)) status = 'failed'
    const rawName = topic.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    const updatedAt = latest(PIPELINE_PHASES.map((phase) => phases[phase].finishedAt))
    return {
      topic, displayName: rawName,
      searchIntent: selectionData?.searchIntent ?? enrichmentData?.searchIntent ?? generationData?.searchIntent,
      configured: manual.status === 'available', status, phases,
      ...(isCurrentPhase(qa) && qa.qaOutcome ? {qaOutcome: qa.qaOutcome} : {}),
      ...(qa.inferred ? {qaInferred: true} : {}),
      ...(generationData?.indexability && isCurrentPhase(phases.generation) ? {indexability: generationData.indexability} : {}),
      businesses: enrichmentData?.businesses?.length ?? selectionData?.candidateCount ?? selectionData?.candidates?.length ?? 0,
      ...(updatedAt ? {updatedAt} : {}),
    }
  }

  async detail(topicInput: unknown) {
    const topic = validateTopic(topicInput)
    const [summary, selection, enrichment, generation, published, selectionReport, enrichmentReport, generationReport, qa] = await Promise.all([
      this.summary(topic), this.selection(topic), this.enrichment(topic), this.generation(topic), this.published(topic),
      this.topicReport(topic, 'selection'), this.topicReport(topic, 'enrichment'), this.topicReport(topic, 'generation'), this.topicReport(topic, 'qa'),
    ])
    return {summary, artifacts: {selection, enrichment, generation, published}, reports: {selection: selectionReport, enrichment: enrichmentReport, generation: generationReport, qa}}
  }
}

function phaseState(
  phase: PipelinePhase,
  report: ArtifactResponse,
  artifacts: Record<'selection' | 'enrichment' | 'generation', ArtifactResponse>,
  published: ArtifactResponse,
): ComparisonPhaseState {
  if (report.status === 'available' && report.source === 'topic-report') return stateFromReport(phase, report)
  if (phase !== 'qa' && artifacts[phase].status === 'available') {
    const data = artifacts[phase].data as Json
    const timestamp = phase === 'selection' ? data.generatedAt : phase === 'enrichment' ? data.enrichedAt : data.generatedAt
    return {phase, status: 'completed', stale: false, inferred: true, source: 'artifact', ...(typeof timestamp === 'string' ? {finishedAt: timestamp} : {})}
  }
  if (report.status === 'available') return stateFromReport(phase, report)
  if ((phase === 'generation' || phase === 'qa') && published.status === 'available') {
    const data = published.data as Json
    const timestamp = data.lastVerified ?? data.generatedAt
    return {phase, status: 'completed', stale: false, inferred: true, source: 'inference', ...(typeof timestamp === 'string' ? {finishedAt: timestamp} : {})}
  }
  return {phase, status: 'not-run', stale: false, inferred: false, source: 'none'}
}

function stateFromReport(phase: PipelinePhase, report: ArtifactResponse): ComparisonPhaseState {
  const data = report.data as Json
  return {
    phase,
    status: reportStatus(data.status),
    stale: data.stale === true,
    inferred: false,
    source: report.source ?? 'global-report',
    ...(typeof data.startedAt === 'string' ? {startedAt: data.startedAt} : {}),
    ...(typeof data.finishedAt === 'string' ? {finishedAt: data.finishedAt} : {}),
    ...(phase === 'qa' && ['PASS', 'WARNING', 'FAIL'].includes(data.qaOutcome) ? {qaOutcome: data.qaOutcome} : {}),
  }
}

function reportStatus(value: unknown): ComparisonPhaseState['status'] {
  return value === 'failed' || value === 'cancelled' || value === 'completed' ? value : 'completed'
}

function applyTimestampStaleness(phases: Record<PipelinePhase, ComparisonPhaseState>): void {
  for (let downstreamIndex = 1; downstreamIndex < PIPELINE_PHASES.length; downstreamIndex += 1) {
    const downstream = phases[PIPELINE_PHASES[downstreamIndex]!]!
    if (downstream.status === 'not-run' || downstream.stale || !downstream.finishedAt) continue
    const downstreamTime = Date.parse(downstream.finishedAt)
    if (!Number.isFinite(downstreamTime)) continue
    for (const upstreamPhase of PIPELINE_PHASES.slice(0, downstreamIndex)) {
      const upstream = phases[upstreamPhase]
      if (upstream.status !== 'completed' || upstream.stale || !upstream.finishedAt) continue
      if (Date.parse(upstream.finishedAt) > downstreamTime) {
        downstream.stale = true
        break
      }
    }
  }
}

function latest(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort((a, b) => Date.parse(b) - Date.parse(a))[0]
}

export function normalizeSelectionArtifact(data: Json): Json {
  const candidates = Array.isArray(data.candidates) ? data.candidates.map((candidate: Json) => ({
    ...candidate,
    matchType: candidate.matchType === 'potential' ? 'potential' : 'direct',
    evidence: Array.isArray(candidate.evidence) ? candidate.evidence : legacyEvidence(candidate.topicEvidence, 'direct'),
  })) : []
  const excluded = Array.isArray(data.excluded) ? data.excluded : []
  const direct = candidates.filter((candidate: Json) => candidate.matchType === 'direct').length
  const potential = candidates.filter((candidate: Json) => candidate.matchType === 'potential').length
  return {
    ...data,
    candidates,
    excluded,
    summary: data.summary ?? {
      considered: candidates.length + excluded.length,
      direct,
      potential,
      excluded: excluded.length,
      insufficient: excluded.filter((candidate: Json) => candidate.reason === 'insufficient').length,
    },
  }
}

function legacyEvidence(values: unknown, strength: 'direct' | 'supporting'): Json[] {
  if (!Array.isArray(values)) return []
  return values.filter((value): value is string => typeof value === 'string').map((value) => {
    const separator = value.indexOf('=')
    return {
      field: separator >= 0 ? value.slice(0, separator) : 'legacy',
      value: separator >= 0 ? value.slice(separator + 1) : value,
      strength,
      sourceKeys: [],
    }
  })
}
