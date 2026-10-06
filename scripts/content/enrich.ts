import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {applyFilters, parsePipelineOptions, type PipelineOptions} from './lib/cli'
import {OfficialWebsiteAdapter} from './lib/adapters'
import {enrichEntity, validateFactProvenance} from './lib/enrichment'
import {loadJsonDirectory, removeFileIfExists, writeJsonAtomic} from './lib/files'
import {canRunStage, loadManifest, markEntryError, saveManifest, transitionEntry} from './lib/manifest'
import {createReport, finishReport} from './lib/reporting'
import type {DiscoveredEntity, PhaseReportItem} from './lib/types'

export async function runEnrichment(options: PipelineOptions, root = process.cwd(), now = new Date().toISOString()): Promise<void> {
  const manifest = await loadManifest(root)
  const files = await loadJsonDirectory<DiscoveredEntity>(resolve(root, 'content/discovered'))
  const selected = applyFilters(files.map(({value}) => value), options)
  const items: PhaseReportItem[] = []
  const officialWebsite = new OfficialWebsiteAdapter()

  for (const discovered of selected) {
    const entry = manifest.entries.find((candidate) => candidate.id === discovered.id)
    if (!entry) {
      items.push({id: discovered.id, outcome: 'error', message: 'No existe una entrada correspondiente en el manifest.'})
      continue
    }
    if (!canRunStage(entry, 'enrichment', options.force)) {
      items.push({id: discovered.id, outcome: 'skipped', message: 'Ya estaba enriquecido; usa --force para recalcularlo.'})
      continue
    }
    try {
      const base = enrichEntity(discovered)
      let websiteResult
      let websiteMessage: string | undefined
      if (base.facts.website.value) {
        try {
          websiteResult = await officialWebsite.enrich(base.facts.website.value, now)
        } catch (error) {
          websiteMessage = `Web oficial no enriquecida: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      const enriched = enrichEntity(discovered, websiteResult)
      const provenanceErrors = validateFactProvenance(enriched)
      if (provenanceErrors.length) throw new Error(provenanceErrors.join(' '))
      if (!options.dryRun) {
        if (options.force) {
          await Promise.all([
            removeFileIfExists(resolve(root, `content/generated/.staging/businesses/${enriched.id}.json`)),
            removeFileIfExists(resolve(root, `content/generated/businesses/${enriched.id}.json`)),
          ])
        }
        await writeJsonAtomic(resolve(root, `content/enriched/${enriched.id}.json`), enriched)
        transitionEntry(entry, 'enriched', now, options.force)
      }
      items.push({id: enriched.id, outcome: 'processed', ...(websiteMessage ? {message: websiteMessage} : {})})
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!options.dryRun) markEntryError(entry, 'enrichment', message, now)
      items.push({id: discovered.id, outcome: 'error', message})
    }
  }

  if (!options.dryRun) await saveManifest(manifest, root, now)
  await finishReport(createReport('enrichment', options.dryRun, now, items), root)
  if (items.some((item) => item.outcome === 'error')) process.exitCode = 1
}

async function main(): Promise<void> {
  try {
    await runEnrichment(parsePipelineOptions())
  } catch (error) {
    console.error(`Enrichment falló: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
