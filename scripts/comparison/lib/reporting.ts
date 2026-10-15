import {resolve} from 'node:path'
import {readJsonIfExists, writeJsonAtomic} from '../../content/lib/files'

export const COMPARISON_REPORT_PHASES = [
  'comparison-selection',
  'comparison-enrichment',
  'comparison-generation',
  'comparison-qa',
] as const

export type ComparisonReportPhase = (typeof COMPARISON_REPORT_PHASES)[number]
export type ComparisonReportStatus = 'completed' | 'failed' | 'cancelled'

export interface ComparisonReportMeta {
  topic: string
  phase: ComparisonReportPhase
  startedAt: string
  finishedAt: string
  status: ComparisonReportStatus
  stale: boolean
}

type ReportBody = Record<string, unknown> & {
  startedAt: string
  finishedAt: string
  status?: ComparisonReportStatus
}

const TOPIC_PATTERN = /^[a-z0-9][a-z0-9-]*$/

const PHASE_FILE: Record<ComparisonReportPhase, string> = {
  'comparison-selection': 'selection.json',
  'comparison-enrichment': 'enrichment.json',
  'comparison-generation': 'generation.json',
  'comparison-qa': 'qa.json',
}

export function validateComparisonReportTopic(topic: string): string {
  if (!TOPIC_PATTERN.test(topic)) throw new Error('Topic inválido para report. Usa minúsculas, números y guiones.')
  return topic
}

export function comparisonTopicReportPath(topicInput: string, phase: ComparisonReportPhase): string {
  const topic = validateComparisonReportTopic(topicInput)
  return `content/reports/comparisons/${topic}/${PHASE_FILE[phase]}`
}

export function comparisonGlobalReportPath(phase: ComparisonReportPhase): string {
  return `content/reports/${phase}.json`
}

export async function writeComparisonReport<T extends ReportBody>({
  topic: topicInput,
  phase,
  report,
  root = process.cwd(),
  invalidateDownstream = false,
  dryRun = false,
}: {
  topic: string
  phase: ComparisonReportPhase
  report: T
  root?: string
  invalidateDownstream?: boolean
  dryRun?: boolean
}): Promise<T & ComparisonReportMeta> {
  const topic = validateComparisonReportTopic(topicInput)
  const value = {
    ...report,
    topic,
    phase,
    status: report.status ?? 'completed',
    stale: false,
  } as T & ComparisonReportMeta
  if (dryRun) return value
  if (invalidateDownstream) await markDownstreamReportsStale(root, topic, phase)
  await writeJsonAtomic(resolve(root, comparisonGlobalReportPath(phase)), value)
  await writeJsonAtomic(resolve(root, comparisonTopicReportPath(topic, phase)), value)
  return value
}

async function markDownstreamReportsStale(root: string, topic: string, phase: ComparisonReportPhase): Promise<void> {
  const phaseIndex = COMPARISON_REPORT_PHASES.indexOf(phase)
  for (const downstream of COMPARISON_REPORT_PHASES.slice(phaseIndex + 1)) {
    const path = resolve(root, comparisonTopicReportPath(topic, downstream))
    const report = await readJsonIfExists<Record<string, unknown> | null>(path, null)
    if (report && report.stale !== true) await writeJsonAtomic(path, {...report, stale: true})

    const globalPath = resolve(root, comparisonGlobalReportPath(downstream))
    const globalReport = await readJsonIfExists<Record<string, unknown> | null>(globalPath, null)
    if (globalReport?.topic === topic && globalReport.stale !== true) await writeJsonAtomic(globalPath, {...globalReport, stale: true})
  }
}
