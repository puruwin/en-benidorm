import {stat} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {writeJsonAtomic} from '../content/lib/files'
import {loadManifest, markSelectedForResearch, saveManifest} from '../content/lib/manifest'
import {parseComparisonOptions} from './lib/cli'
import {writeComparisonReport} from './lib/reporting'
import {selectComparisonCandidates} from './lib/selection'
import type {ComparisonOptions} from './lib/types'

export async function runComparisonSelection(options: ComparisonOptions, root = process.cwd(), now = new Date().toISOString()): Promise<void> {
  const destination = resolve(root, `content/comparisons/candidates/${options.id}.json`)
  if (!options.force && await exists(destination)) {
    console.log(`comparison-selection: skipped=1 (${options.id}; usa --force para recalcular)`)
    return
  }
  const artifact = await selectComparisonCandidates(options, root, now)
  const direct = artifact.candidates.filter((candidate) => (candidate.matchType ?? 'direct') === 'direct')
  const potential = artifact.candidates.filter((candidate) => candidate.matchType === 'potential')
  const report = {
    phase: 'comparison-selection', dryRun: options.dryRun, startedAt: now, finishedAt: new Date().toISOString(),
    topic: artifact.topic, searchIntent: artifact.searchIntent,
    summary: artifact.summary,
    candidateBusinesses: artifact.candidates,
    directBusinesses: direct,
    potentialBusinesses: potential,
    excludedBusinesses: artifact.excluded,
    totals: {
      considered: artifact.summary?.considered ?? artifact.candidates.length + artifact.excluded.length,
      candidates: artifact.candidates.length,
      direct: direct.length,
      potential: potential.length,
      excluded: artifact.excluded.length,
    },
  }
  if (!options.dryRun) {
    await writeJsonAtomic(destination, artifact)
    const manifest = await loadManifest(root)
    const selected = new Set(artifact.candidates.map((candidate) => candidate.businessId))
    for (const entry of manifest.entries) if (selected.has(entry.id)) {
      markSelectedForResearch(entry, 'editorial-comparison', artifact.id, now)
    }
    await saveManifest(manifest, root, now)
    await writeComparisonReport({topic: artifact.topic, phase: 'comparison-selection', report, root, invalidateDownstream: options.force})
  }
  console.log(`comparison-selection${options.dryRun ? ' (dry-run)' : ''}: considered=${artifact.summary?.considered ?? artifact.candidates.length + artifact.excluded.length}, direct=${direct.length}, potential=${potential.length}, excluded=${artifact.excluded.length}`)
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}

async function main(): Promise<void> {
  try { await runComparisonSelection(parseComparisonOptions()) }
  catch (error) { console.error(`Comparison selection falló: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
