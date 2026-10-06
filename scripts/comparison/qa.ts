import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import type {ContentDocument} from '../content-validation'
import {loadJsonDirectory, readJson, removeFileIfExists, writeJsonAtomic} from '../content/lib/files'
import {parseComparisonOptions} from './lib/cli'
import {inspectComparison} from './lib/qa'
import type {ComparisonOptions, EnrichedComparisonArtifact, GeneratedComparisonArtifact} from './lib/types'

export async function runComparisonQA(options: ComparisonOptions, root = process.cwd(), now = new Date().toISOString()): Promise<void> {
  const stagingPath = resolve(root, `content/generated/.staging/comparisons/${options.id}.json`)
  const generated = await readJson<GeneratedComparisonArtifact>(stagingPath)
  const enriched = await readJson<EnrichedComparisonArtifact>(resolve(root, `content/comparisons/enriched/${options.id}.json`))
  const businessDocuments = new Map((await loadJsonDirectory<ContentDocument>(resolve(root, 'content/generated/businesses'))).map(({value}) => [value._id, value]))
  const allGenerated = (await loadJsonDirectory<GeneratedComparisonArtifact>(resolve(root, 'content/generated/.staging/comparisons'))).map(({value}) => value)
  const result = inspectComparison(generated, enriched, businessDocuments, allGenerated)
  const destination = resolve(root, `content/generated/comparisons/${options.id}.json`)
  if (!options.dryRun) {
    if (result.outcome === 'FAIL') await removeFileIfExists(destination)
    else await writeJsonAtomic(destination, generated.document)
    await writeJsonAtomic(resolve(root, 'content/reports/comparison-qa.json'), {
      phase: 'comparison-qa', dryRun: false, startedAt: now, finishedAt: new Date().toISOString(),
      topic: result.topic, qaOutcome: result.outcome, claimsGenerated: result.claimsGenerated, claimsRejected: result.claimsRejected,
      issues: result.issues,
    })
  }
  console.log(`comparison-qa${options.dryRun ? ' (dry-run)' : ''}: outcome=${result.outcome}, claims=${result.claimsGenerated}, rejected=${result.claimsRejected}, issues=${result.issues.length}`)
  for (const issue of result.issues) console.error(`- ${issue.severity} ${issue.code} ${issue.path}: ${issue.message}`)
  if (result.outcome === 'FAIL') process.exitCode = 1
}

async function main(): Promise<void> { try { await runComparisonQA(parseComparisonOptions()) } catch (error) { console.error(`Comparison QA falló: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 } }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
