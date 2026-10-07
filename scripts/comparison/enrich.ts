import {stat} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {loadJsonDirectory, readJson, writeJsonAtomic} from '../content/lib/files'
import type {EnrichedEntity} from '../content/lib/types'
import {parseComparisonOptions} from './lib/cli'
import {enrichComparison} from './lib/enrichment'
import {ManualJsonAdapter} from './lib/manual-adapter'
import {EVIDENCE_CATEGORIES, type ComparisonCandidateArtifact, type ComparisonOptions} from './lib/types'

export async function runComparisonEnrichment(options: ComparisonOptions, root = process.cwd(), now = new Date().toISOString()): Promise<void> {
  const destination = resolve(root, `content/comparisons/enriched/${options.id}.json`)
  if (!options.force && await exists(destination)) { console.log(`comparison-enrichment: skipped=1 (${options.id}; usa --force para recalcular)`); return }
  const candidates = await readJson<ComparisonCandidateArtifact>(resolve(root, `content/comparisons/candidates/${options.id}.json`))
  const entities = new Map((await loadJsonDirectory<EnrichedEntity>(resolve(root, 'content/enriched'))).map(({value}) => [value.id, value]))
  const manual = await new ManualJsonAdapter(resolve(root, `content/manual/comparisons/${candidates.topic}.json`)).load()
  const artifact = enrichComparison(candidates, entities, manual, now)
  const report = {
    phase: 'comparison-enrichment', dryRun: options.dryRun, startedAt: now, finishedAt: new Date().toISOString(), topic: artifact.topic,
    searchIntent: artifact.searchIntent,
    businessesSelected: artifact.businesses.map((business) => ({
      businessId: business.businessId,
      selectionScore: candidates.candidates.find((candidate) => candidate.businessId === business.businessId)?.scores.total ?? business.scores.total,
      enrichedScore: business.scores.total,
      scores: business.scores,
    })),
    evidenceCoverage: {
      perBusiness: artifact.businesses.map((business) => ({businessId: business.businessId, ...Object.fromEntries(Object.entries(business.evidence).map(([key, facts]) => [key, facts.length]))})),
      perDimension: Object.fromEntries(EVIDENCE_CATEGORIES.map((dimension) => [dimension, {
        businessesCovered: artifact.businesses.filter((business) => business.evidence[dimension].length > 0).length,
        factCount: artifact.businesses.reduce((sum, business) => sum + business.evidence[dimension].length, 0),
      }])),
    },
    missingData: artifact.businesses.map((business) => ({businessId: business.businessId, fields: Object.entries(business.evidence).filter(([, facts]) => facts.length === 0).map(([field]) => field)})),
    sourceConflicts: artifact.sourceConflicts,
  }
  if (!options.dryRun) {
    await writeJsonAtomic(destination, artifact)
    await writeJsonAtomic(resolve(root, 'content/reports/comparison-enrichment.json'), report)
  }
  console.log(`comparison-enrichment${options.dryRun ? ' (dry-run)' : ''}: businesses=${artifact.businesses.length}, evidence=${artifact.businesses.flatMap((business) => Object.values(business.evidence).flat()).length}`)
}

async function exists(path: string): Promise<boolean> { try { await stat(path); return true } catch { return false } }
async function main(): Promise<void> { try { await runComparisonEnrichment(parseComparisonOptions()) } catch (error) { console.error(`Comparison enrichment falló: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 } }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
