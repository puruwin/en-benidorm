import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {OpenAIResponsesProvider, type AIProvider} from './lib/ai'
import {applyFilters, parsePipelineOptions, type PipelineOptions} from './lib/cli'
import {loadJsonDirectory, removeFileIfExists, writeJsonAtomic} from './lib/files'
import {BUSINESS_DOCUMENT_SCHEMA, BUSINESS_TAXONOMY, buildGenerationArtifact, EDITORIAL_INSTRUCTIONS} from './lib/generation'
import {canRunStage, loadManifest, markEntryError, recordQualityAssessment, saveManifest, transitionEntry} from './lib/manifest'
import {evaluateBusinessQualityTier} from './lib/quality'
import {createReport, finishReport} from './lib/reporting'
import type {EditorialSection, EnrichedEntity, PhaseReportItem} from './lib/types'

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
      const assessment = evaluateBusinessQualityTier(enriched.facts)
      recordQualityAssessment(entry, assessment, now)
      if (assessment.tier === 'insufficient') {
        const artifact = buildGenerationArtifact(enriched, assessment)
        if (!options.dryRun) {
          await writeJsonAtomic(resolve(root, `content/generated/.staging/businesses/${enriched.id}.json`), artifact)
          transitionEntry(entry, 'generated', now, options.force)
        }
        items.push({
          id: enriched.id, outcome: 'skipped', qualityTier: assessment.tier, reasons: assessment.reasons,
          distinctiveFacts: assessment.distinctiveFacts, missingUsefulFacts: assessment.missingUsefulFacts,
          generationSkipped: true, message: 'insufficient-facts',
        })
        continue
      }
      provider ??= new OpenAIResponsesProvider()
      const editorial = await provider.generateEditorial({
        qualityAssessment: {...assessment, tier: assessment.tier},
        allowedSections: allowedSections(enriched),
        facts: enriched.facts,
        factsBySource: enriched.factsBySource,
        sources: enriched.sources,
        taxonomy: BUSINESS_TAXONOMY,
        documentSchema: BUSINESS_DOCUMENT_SCHEMA,
        editorialInstructions: EDITORIAL_INSTRUCTIONS,
      })
      const artifact = buildGenerationArtifact(enriched, assessment, editorial)
      if (!options.dryRun) {
        await writeJsonAtomic(resolve(root, `content/generated/.staging/businesses/${enriched.id}.json`), artifact)
        transitionEntry(entry, 'generated', now, options.force)
      }
      items.push({
        id: enriched.id, outcome: 'processed', qualityTier: assessment.tier, reasons: assessment.reasons,
        distinctiveFacts: assessment.distinctiveFacts, missingUsefulFacts: assessment.missingUsefulFacts,
        generationSkipped: false,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!options.dryRun) markEntryError(entry, 'generation', message, now)
      items.push({id: enriched.id, outcome: 'error', message})
    }
  }

  if (!options.dryRun) await saveManifest(manifest, root, now)
  const report = createReport('generation', options.dryRun, now, items)
  report.summary = {
    qualityTier: qualityTotals(items),
    generation: {generated: items.filter((item) => item.outcome === 'processed').length, skippedInsufficient: items.filter((item) => item.generationSkipped).length},
  }
  await finishReport(report, root)
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

function allowedSections(entity: EnrichedEntity): EditorialSection[] {
  const facts = entity.facts
  const present = (field: keyof typeof facts) => facts[field].value !== null && facts[field].sources.length > 0
  const sections: EditorialSection[] = ['overview']
  if (present('cuisine') || present('specialties') || present('concept')) sections.push('food')
  if (present('terrace') || present('distinctiveFeatures')) sections.push('experience')
  if (present('locationContext')) sections.push('location')
  if (present('services') || present('bookingAvailability') || present('takeaway') || present('delivery') || present('accessibility')) sections.push('services')
  if (present('openingInformation') || present('openingHoursRaw')) sections.push('practical')
  return sections
}

function qualityTotals(items: PhaseReportItem[]): Record<string, number> {
  return Object.fromEntries(['rich', 'basic', 'insufficient'].map((tier) => [tier, items.filter((item) => item.qualityTier === tier).length]))
}
