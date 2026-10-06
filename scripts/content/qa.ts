import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import type {ContentDocument} from '../content-validation'
import {applyFilters, parsePipelineOptions, type PipelineOptions} from './lib/cli'
import {loadJsonDirectory, removeFileIfExists, writeJsonAtomic} from './lib/files'
import {canRunStage, loadManifest, markEntryError, saveManifest, transitionEntry} from './lib/manifest'
import {inspectCandidates, type QACandidate} from './lib/qa'
import {createReport, finishReport} from './lib/reporting'
import type {EnrichedEntity, GeneratedBusinessArtifact, PhaseReportItem} from './lib/types'

export async function runQA(options: PipelineOptions, root = process.cwd(), now = new Date().toISOString()): Promise<void> {
  const manifest = await loadManifest(root)
  const stagedFiles = await loadJsonDirectory<GeneratedBusinessArtifact>(resolve(root, 'content/generated/.staging/businesses'))
  const enrichedFiles = await loadJsonDirectory<EnrichedEntity>(resolve(root, 'content/enriched'))
  const enrichedById = new Map(enrichedFiles.map(({value}) => [value.id, value]))
  const allCandidates: QACandidate[] = stagedFiles.map(({value}) => {
    const enriched = enrichedById.get(value.id)
    const document = value.document as ContentDocument | null
    return {id: value.id, document, qualityAssessment: value.qualityAssessment, generationSkipped: value.generationSkipped, ...(enriched ? {enriched} : {})}
  })
  const selectedDocuments = applyFilters(
    allCandidates.map((candidate) => ({...candidate, type: candidate.enriched?.type ?? 'restaurant' as const})),
    options,
  )
  const selectedIds = new Set(selectedDocuments.map(({id}) => id))
  const inspected = inspectCandidates(allCandidates)
  const results = inspected.filter((result) => selectedIds.has(result.id))
  const documents = new Map(stagedFiles.map(({value}) => [value.id, value.document as ContentDocument | null]))
  const items: PhaseReportItem[] = []

  for (const result of results) {
    const entry = manifest.entries.find((candidate) => candidate.id === result.id)
    if (!entry) {
      items.push({id: result.id, outcome: 'FAIL', issues: [...result.issues, {severity: 'FAIL', code: 'manifest', path: '', message: 'No existe en manifest.'}]})
      continue
    }
    if (!canRunStage(entry, 'qa', options.force)) {
      items.push({id: result.id, outcome: 'skipped', message: 'Ya estaba validado; usa --force para repetir QA.'})
      continue
    }
    const document = documents.get(result.id)
    const destination = resolve(root, `content/generated/businesses/${result.id}.json`)
    if (!options.dryRun) {
      if (result.outcome === 'FAIL') {
        await removeFileIfExists(destination)
        markEntryError(entry, 'qa', result.issues.filter((issue) => issue.severity === 'FAIL').map((issue) => issue.message).join(' '), now)
      } else if (result.outcome === 'SKIPPED') {
        await removeFileIfExists(destination)
        transitionEntry(entry, 'validated', now, options.force)
      } else if (document) {
        await writeJsonAtomic(destination, document)
        transitionEntry(entry, 'validated', now, options.force)
      }
    }
    const assessment = allCandidates.find((candidate) => candidate.id === result.id)?.qualityAssessment
    items.push({
      id: result.id, outcome: result.outcome, issues: result.issues, qualityTier: result.qualityTier,
      generationSkipped: result.generationSkipped,
      ...(assessment ? {reasons: assessment.reasons, distinctiveFacts: assessment.distinctiveFacts, missingUsefulFacts: assessment.missingUsefulFacts} : {}),
    })
  }

  if (!options.dryRun) await saveManifest(manifest, root, now)
  const report = createReport('qa', options.dryRun, now, items)
  report.summary = {
    total: items.length,
    qualityTier: Object.fromEntries(['rich', 'basic', 'insufficient'].map((tier) => [tier, items.filter((item) => item.qualityTier === tier).length])),
    qa: Object.fromEntries(['PASS', 'WARNING', 'FAIL', 'SKIPPED'].map((outcome) => [outcome, items.filter((item) => item.outcome === outcome).length])),
    generation: {generated: items.filter((item) => item.generationSkipped === false).length, skippedInsufficient: items.filter((item) => item.generationSkipped).length},
  }
  await finishReport(report, root)
  if (items.some((item) => item.outcome === 'FAIL')) process.exitCode = 1
}

async function main(): Promise<void> {
  try {
    await runQA(parsePipelineOptions())
  } catch (error) {
    console.error(`QA falló: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
