import {stat} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {loadJsonDirectory, readJson, writeJsonAtomic} from '../content/lib/files'
import {enrichEntity} from '../content/lib/enrichment'
import {loadManifest, markResearched, recordEditorialEligibility, saveManifest} from '../content/lib/manifest'
import type {DiscoveredEntity, EnrichedEntity} from '../content/lib/types'
import {parseComparisonOptions} from './lib/cli'
import {enrichComparison} from './lib/enrichment'
import {evaluateComparisonDataGate} from './lib/gate'
import {ManualJsonAdapter, type ManualComparisonBusiness} from './lib/manual-adapter'
import {loadManualComparisonObservations, type ManualObservationBusiness} from './lib/manual-observations'
import {attachCreatorObservations, creatorObservationSummary, loadCreatorObservations} from './lib/creator-observations'
import {researchPotentialCandidates, type PotentialResearchOptions} from './lib/research'
import {FileResearchResultCache} from './lib/research-cache'
import {writeComparisonReport} from './lib/reporting'
import {EVIDENCE_CATEGORIES, type ComparisonCandidateArtifact, type ComparisonOptions} from './lib/types'

export async function runComparisonEnrichment(
  options: ComparisonOptions,
  root = process.cwd(),
  now = new Date().toISOString(),
  researchOptions: PotentialResearchOptions = {},
): Promise<void> {
  const destination = resolve(root, `content/comparisons/enriched/${options.id}.json`)
  if (!options.force && await exists(destination)) { console.log(`comparison-enrichment: skipped=1 (${options.id}; usa --force para recalcular)`); return }
  const candidates = await readJson<ComparisonCandidateArtifact>(resolve(root, `content/comparisons/candidates/${options.id}.json`))
  const enrichedEntities = new Map((await loadJsonDirectory<EnrichedEntity>(resolve(root, 'content/enriched'))).map(({value}) => [value.id, value]))
  const entities = new Map(enrichedEntities)
  for (const {value} of await loadJsonDirectory<DiscoveredEntity>(resolve(root, 'content/discovered'))) {
    if (value.targetDocumentType === 'business' && !entities.has(value.id)) entities.set(value.id, enrichEntity(value))
  }
  const manualPath = resolve(root, `content/manual/comparisons/${candidates.topic}.json`)
  // A topic without a curated manual file simply has no manual facts; it never invents an empty one.
  const manual = await exists(manualPath)
    ? await new ManualJsonAdapter(manualPath).load()
    : (console.log(`comparison-enrichment: sin fuente manual para ${candidates.topic}`), {topic: candidates.topic, sources: [], businesses: []})
  const manualObservations = await loadManualComparisonObservations(resolve(root, 'content/manual/comparison-observations'), enrichedEntities)
  const creatorObservations = await loadCreatorObservations(resolve(root, 'content/manual/creator-observations'), new Set(enrichedEntities.keys()))
  const existingEvidenceByBusiness = mergePlanningEvidence(manual.businesses, manualObservations.businesses)
  const research = await researchPotentialCandidates(candidates, entities, now, {
    ...researchOptions,
    force: options.force,
    existingEvidenceByBusiness,
    ...(!options.dryRun && !researchOptions.resultCache ? {resultCache: new FileResearchResultCache(resolve(root, 'content/reports/.comparison-research-cache'))} : {}),
    logger: researchOptions.logger ?? ((message) => console.log(`comparison-research: ${message}`)),
  })
  const evidenceArtifact = enrichComparison(candidates, entities, manual, now, research, manualObservations)
  const dataGate = evaluateComparisonDataGate(evidenceArtifact)
  // Evidencia de tercero: se adjunta después del gate y fuera de `evidence`, así no puede moverlo.
  const artifact = attachCreatorObservations(evidenceArtifact, creatorObservations)
  const investigations = artifact.investigations ?? []
  const directCount = candidates.candidates.filter((candidate) => (candidate.matchType ?? 'direct') === 'direct').length
  const potentialCount = candidates.candidates.filter((candidate) => candidate.matchType === 'potential').length
  const potentialConfirmed = artifact.businesses.filter((business) => business.origin === 'potential').length
  const researchSummary = {
    planned: research.size,
    attempted: [...research.values()].filter((item) => !['not-required', 'no-official-website', 'no-verifiable-source'].includes(item.research.status)).length,
    websitesFound: [...research.values()].filter((item) => item.research.website !== null).length,
    websitesReached: [...research.values()].filter((item) => item.research.pagesVisited.length > 0).length,
    pagesVisited: [...research.values()].reduce((sum, item) => sum + item.research.pagesVisited.length, 0),
    requests: [...research.values()].reduce((sum, item) => sum + (item.research.metrics?.requests ?? 0), 0),
    durationMs: [...research.values()].reduce((sum, item) => sum + (item.research.metrics?.durationMs ?? 0), 0),
    cacheHits: [...research.values()].filter((item) => item.research.metrics?.cacheHit).length,
    documentsProcessed: [...research.values()].reduce((sum, item) => sum + (item.research.metrics?.documents ?? 0), 0),
    documentPages: [...research.values()].reduce((sum, item) => sum + (item.research.metrics?.documentPages ?? 0), 0),
    documentBytes: [...research.values()].reduce((sum, item) => sum + (item.research.metrics?.documentBytes ?? 0), 0),
    extractedByFormat: extractionTotals(research, 'byFormat'),
    extractedByDimension: extractionTotals(research, 'byDimension'),
    byBusiness: [...research.entries()].map(([businessId, item]) => ({businessId, ...item.research})),
    potentialConfirmed,
    rejectionReasons: rejectionReasonTotals(investigations.filter((item) => item.outcome === 'rejected').flatMap((item) => item.reasons)),
  }
  const manualObservationBusinessIds = new Set(manualObservations.businesses.map((business) => business.businessId))
  const manualConfirmedCandidates = artifact.businesses.filter((business) => business.origin === 'potential'
    && business.confirmationEvidence?.some((evidence) => evidence.sourceStage === 'manual-observation')).length
  const manualSummary = {
    manualObservationsLoaded: manualObservations.records.reduce((sum, record) => sum + record.observations.length, 0),
    manualEvidenceAdded: artifact.businesses.reduce((sum, business) => sum + Object.values(business.evidence).flat().filter((fact) =>
      fact.provenance?.some((item) => item.sourceStage === 'manual-observation')).length, 0),
    manualConfirmedCandidates,
    businessesObserved: manualObservationBusinessIds.size,
  }
  const report = {
    phase: 'comparison-enrichment', dryRun: options.dryRun, startedAt: now, finishedAt: new Date().toISOString(), topic: artifact.topic,
    searchIntent: artifact.searchIntent,
    businessesSelected: artifact.businesses.map((business) => ({
      businessId: business.businessId,
      origin: business.origin ?? 'direct',
      outcome: business.enrichmentOutcome ?? 'confirmed',
      selectionScore: candidates.candidates.find((candidate) => candidate.businessId === business.businessId)?.scores.total ?? business.scores.total,
      enrichedScore: business.scores.total,
      scores: business.scores,
    })),
    investigations: artifact.investigations ?? artifact.businesses.map((business) => ({
      businessId: business.businessId, origin: 'direct', outcome: 'confirmed', reasons: ['Legacy artifact'],
    })),
    totals: {
      investigated: artifact.investigations?.length ?? artifact.businesses.length,
      direct: directCount,
      potential: potentialCount,
      confirmed: artifact.businesses.length,
      rejected: artifact.investigations?.filter((item) => item.outcome === 'rejected').length ?? 0,
    },
    research: researchSummary,
    manualObservations: manualSummary,
    creatorObservations: creatorObservationSummary(creatorObservations, artifact),
    evidenceCoverage: {
      perBusiness: artifact.businesses.map((business) => ({businessId: business.businessId, ...Object.fromEntries(Object.entries(business.evidence).map(([key, facts]) => [key, facts.length]))})),
      perDimension: Object.fromEntries(EVIDENCE_CATEGORIES.map((dimension) => [dimension, {
        businessesCovered: artifact.businesses.filter((business) => (business.evidence[dimension]?.length ?? 0) > 0).length,
        factCount: artifact.businesses.reduce((sum, business) => sum + (business.evidence[dimension]?.length ?? 0), 0),
      }])),
    },
    missingData: artifact.businesses.map((business) => ({businessId: business.businessId, fields: Object.entries(business.evidence).filter(([, facts]) => facts.length === 0).map(([field]) => field)})),
    sourceConflicts: artifact.sourceConflicts,
    integrityIssues: artifact.integrityIssues ?? [],
    operationalStatus: artifact.businesses.map((business) => ({businessId: business.businessId, ...business.operationalStatus})),
    sourceIntegrity: Object.fromEntries([...new Set(artifact.sources.map((source) => source.sourceClass ?? 'legacy-unclassified'))].map((sourceClass) => [sourceClass, artifact.sources.filter((source) => (source.sourceClass ?? 'legacy-unclassified') === sourceClass).length])),
    dataGate,
  }
  if (!options.dryRun) {
    await writeJsonAtomic(destination, artifact)
    const manifest = await loadManifest(root)
    const investigationsById = new Map((artifact.investigations ?? []).map((item) => [item.businessId, item]))
    for (const candidate of candidates.candidates) {
      const entry = manifest.entries.find((item) => item.id === candidate.businessId)
      if (!entry) continue
      markResearched(entry, 'editorial-comparison', artifact.id, now)
      const investigation = investigationsById.get(candidate.businessId)
      const eligible = artifact.businesses.some((business) => business.businessId === candidate.businessId)
      recordEditorialEligibility(entry, artifact.id, eligible ? 'eligible' : 'ineligible', now, investigation?.reasons.join('; '))
    }
    await saveManifest(manifest, root, now)
    await writeComparisonReport({topic: artifact.topic, phase: 'comparison-enrichment', report, root, invalidateDownstream: options.force})
  }
  console.log(`comparison-enrichment${options.dryRun ? ' (dry-run)' : ''}: investigated=${artifact.investigations?.length ?? artifact.businesses.length}, direct=${directCount}, potential=${potentialCount}, confirmed=${artifact.businesses.length}, potential-confirmed=${potentialConfirmed}, manual-loaded=${manualSummary.manualObservationsLoaded}, manual-evidence=${manualSummary.manualEvidenceAdded}, manual-confirmed=${manualSummary.manualConfirmedCandidates}, rejected=${artifact.investigations?.filter((item) => item.outcome === 'rejected').length ?? 0}, websites=${researchSummary.websitesFound}, reached=${researchSummary.websitesReached}, pages=${researchSummary.pagesVisited}, evidence=${artifact.businesses.flatMap((business) => Object.values(business.evidence).flat()).length}`)
}

async function exists(path: string): Promise<boolean> { try { await stat(path); return true } catch { return false } }
async function main(): Promise<void> { try { await runComparisonEnrichment(parseComparisonOptions()) } catch (error) { console.error(`Comparison enrichment falló: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 } }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()

function rejectionReasonTotals(reasons: string[]): Record<string, number> {
  return Object.fromEntries([...new Set(reasons)].sort().map((reason) => [reason, reasons.filter((value) => value === reason).length]))
}

function extractionTotals(
  research: ReadonlyMap<string, import('./lib/research').ComparisonResearchBundle>,
  field: 'byFormat' | 'byDimension',
): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const bundle of research.values()) for (const [key, value] of Object.entries(bundle.research.extraction?.[field] ?? {})) {
    totals[key] = (totals[key] ?? 0) + value
  }
  return totals
}

function mergePlanningEvidence(
  manual: ManualComparisonBusiness[],
  observations: ManualObservationBusiness[],
): Map<string, Partial<Record<(typeof EVIDENCE_CATEGORIES)[number], import('./lib/types').ComparisonEvidenceFact[]>>> {
  const result = new Map<string, Partial<Record<(typeof EVIDENCE_CATEGORIES)[number], import('./lib/types').ComparisonEvidenceFact[]>>>()
  for (const item of [...manual, ...observations]) {
    const target = result.get(item.businessId) ?? {}
    for (const dimension of EVIDENCE_CATEGORIES) {
      const facts = item.evidence[dimension] ?? []
      if (facts.length) target[dimension] = [...(target[dimension] ?? []), ...facts]
    }
    result.set(item.businessId, target)
  }
  return result
}
