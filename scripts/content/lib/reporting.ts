import {resolve} from 'node:path'
import {writeJsonAtomic} from './files'
import type {PhaseReport, PhaseReportItem, PipelineStage} from './types'

export function createReport(phase: PipelineStage, dryRun: boolean, startedAt: string, items: PhaseReportItem[]): PhaseReport {
  const totals: Record<string, number> = {total: items.length}
  for (const item of items) totals[item.outcome] = (totals[item.outcome] ?? 0) + 1
  return {phase, dryRun, startedAt, finishedAt: new Date().toISOString(), totals, items}
}

export async function finishReport(report: PhaseReport, root = process.cwd()): Promise<void> {
  if (!report.dryRun) await writeJsonAtomic(resolve(root, `content/reports/${report.phase}.json`), report)
  const label = report.dryRun ? ' (dry-run)' : ''
  console.log(`${report.phase}${label}: ${Object.entries(report.totals).map(([key, value]) => `${key}=${value}`).join(', ')}`)
  for (const item of report.items.filter((candidate) => candidate.outcome === 'error' || candidate.outcome === 'FAIL')) {
    console.error(`- ${item.id ?? 'pipeline'}: ${item.message ?? item.issues?.map((issue) => issue.message).join('; ') ?? item.outcome}`)
  }
}
