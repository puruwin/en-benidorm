import {stat} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {writeJsonAtomic} from '../content/lib/files'
import {parseComparisonOptions} from './lib/cli'
import {selectComparisonCandidates} from './lib/selection'
import type {ComparisonOptions} from './lib/types'

export async function runComparisonSelection(options: ComparisonOptions, root = process.cwd(), now = new Date().toISOString()): Promise<void> {
  const destination = resolve(root, `content/comparisons/candidates/${options.id}.json`)
  if (!options.force && await exists(destination)) {
    console.log(`comparison-selection: skipped=1 (${options.id}; usa --force para recalcular)`)
    return
  }
  const artifact = await selectComparisonCandidates(options, root, now)
  const report = {
    phase: 'comparison-selection', dryRun: options.dryRun, startedAt: now, finishedAt: new Date().toISOString(),
    topic: artifact.topic, candidateBusinesses: artifact.candidates, excludedBusinesses: artifact.excluded,
    totals: {candidates: artifact.candidates.length, excluded: artifact.excluded.length},
  }
  if (!options.dryRun) {
    await writeJsonAtomic(destination, artifact)
    await writeJsonAtomic(resolve(root, 'content/reports/comparison-selection.json'), report)
  }
  console.log(`comparison-selection${options.dryRun ? ' (dry-run)' : ''}: candidates=${artifact.candidates.length}, excluded=${artifact.excluded.length}`)
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}

async function main(): Promise<void> {
  try { await runComparisonSelection(parseComparisonOptions()) }
  catch (error) { console.error(`Comparison selection falló: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
