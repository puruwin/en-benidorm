import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {OpenAIResponsesProvider, type AIProvider} from './lib/ai'
import {applyFilters, parsePipelineOptions, type PipelineOptions} from './lib/cli'
import {loadJsonDirectory, removeFileIfExists, writeJsonAtomic} from './lib/files'
import {BUSINESS_DOCUMENT_SCHEMA, BUSINESS_TAXONOMY, buildBusinessDocument, EDITORIAL_INSTRUCTIONS} from './lib/generation'
import {canRunStage, loadManifest, markEntryError, saveManifest, transitionEntry} from './lib/manifest'
import {createReport, finishReport} from './lib/reporting'
import type {EnrichedEntity, PhaseReportItem} from './lib/types'

export async function runGeneration(
  options: PipelineOptions,
  dependencies: {provider?: AIProvider; root?: string; now?: string} = {},
): Promise<void> {
  const root = dependencies.root ?? process.cwd()
  const now = dependencies.now ?? new Date().toISOString()
  const manifest = await loadManifest(root)
  const files = await loadJsonDirectory<EnrichedEntity>(resolve(root, 'content/enriched'))
  const selected = applyFilters(files.map(({value}) => value), options)
  const items: PhaseReportItem[] = []
  let provider = dependencies.provider

  for (const enriched of selected) {
    const entry = manifest.entries.find((candidate) => candidate.id === enriched.id)
    if (!entry) {
      items.push({id: enriched.id, outcome: 'error', message: 'No existe una entrada correspondiente en el manifest.'})
      continue
    }
    if (enriched.targetDocumentType !== 'business') {
      items.push({id: enriched.id, outcome: 'skipped', message: 'Las atracciones se conservan para una futura pipeline de Place.'})
      continue
    }
    if (!canRunStage(entry, 'generation', options.force)) {
      items.push({id: enriched.id, outcome: 'skipped', message: 'Ya estaba generado; usa --force para regenerarlo.'})
      continue
    }
    try {
      if (!options.dryRun && options.force) {
        await Promise.all([
          removeFileIfExists(resolve(root, `content/generated/.staging/businesses/${enriched.id}.json`)),
          removeFileIfExists(resolve(root, `content/generated/businesses/${enriched.id}.json`)),
        ])
      }
      provider ??= new OpenAIResponsesProvider()
      const editorial = await provider.generateEditorial({
        facts: enriched.facts,
        factsBySource: enriched.factsBySource,
        sources: enriched.sources,
        taxonomy: BUSINESS_TAXONOMY,
        documentSchema: BUSINESS_DOCUMENT_SCHEMA,
        editorialInstructions: EDITORIAL_INSTRUCTIONS,
      })
      const document = buildBusinessDocument(enriched, editorial)
      if (!options.dryRun) {
        await writeJsonAtomic(resolve(root, `content/generated/.staging/businesses/${enriched.id}.json`), document)
        transitionEntry(entry, 'generated', now, options.force)
      }
      items.push({id: enriched.id, outcome: 'processed'})
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!options.dryRun) markEntryError(entry, 'generation', message, now)
      items.push({id: enriched.id, outcome: 'error', message})
    }
  }

  if (!options.dryRun) await saveManifest(manifest, root, now)
  await finishReport(createReport('generation', options.dryRun, now, items), root)
  if (items.some((item) => item.outcome === 'error')) process.exitCode = 1
}

async function main(): Promise<void> {
  try {
    await runGeneration(parsePipelineOptions())
  } catch (error) {
    console.error(`Generation falló: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
