import {stat} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {OpenAIResponsesProvider, type AIProvider} from '../content/lib/ai'
import {readJson, writeJsonAtomic} from '../content/lib/files'
import {parseComparisonOptions} from './lib/cli'
import {buildComparisonArtifact, COMPARISON_EDITORIAL_INSTRUCTIONS} from './lib/generation'
import type {ComparisonOptions, EnrichedComparisonArtifact} from './lib/types'

export async function runComparisonGeneration(
  options: ComparisonOptions,
  dependencies: {provider?: Pick<AIProvider, 'generateComparison'>; root?: string; now?: string} = {},
): Promise<void> {
  const root = dependencies.root ?? process.cwd()
  const now = dependencies.now ?? new Date().toISOString()
  const destination = resolve(root, `content/generated/.staging/comparisons/${options.id}.json`)
  if (!options.force && await exists(destination)) { console.log(`comparison-generation: skipped=1 (${options.id}; usa --force para regenerar)`); return }
  const enriched = await readJson<EnrichedComparisonArtifact>(resolve(root, `content/comparisons/enriched/${options.id}.json`))
  const provider = dependencies.provider ?? new OpenAIResponsesProvider()
  const editorial = await provider.generateComparison({
    comparison: enriched,
    ranking: enriched.businesses.map((business, index) => ({businessId: business.businessId, rank: index + 1, scores: business.scores})),
    author: {id: 'author-david', name: 'David'},
    editorialInstructions: COMPARISON_EDITORIAL_INSTRUCTIONS,
  })
  const artifact = buildComparisonArtifact(enriched, editorial, now)
  const report = {
    phase: 'comparison-generation', dryRun: options.dryRun, startedAt: now, finishedAt: new Date().toISOString(), topic: enriched.topic,
    businessesSelected: enriched.businesses.map((business, index) => ({businessId: business.businessId, rank: index + 1, scores: business.scores})),
    claimsGenerated: artifact.editorial.claims.length, claimsRejected: 0,
  }
  if (!options.dryRun) {
    await writeJsonAtomic(destination, artifact)
    await writeJsonAtomic(resolve(root, 'content/reports/comparison-generation.json'), report)
  }
  console.log(`comparison-generation${options.dryRun ? ' (dry-run)' : ''}: entries=${editorial.entries.length}, claims=${editorial.claims.length}`)
}

async function exists(path: string): Promise<boolean> { try { await stat(path); return true } catch { return false } }
async function main(): Promise<void> { try { await runComparisonGeneration(parseComparisonOptions()) } catch (error) { console.error(`Comparison generation falló: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 } }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
