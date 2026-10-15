import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import {DISCOVERY_CATEGORIES, type ContentManifest, type DiscoveredEntity, type DiscoveryCategory, type DiscoveryRun, type EnrichedEntity} from '../content/lib/types'
import {loadManifest} from '../content/lib/manifest'
import {loadJsonDirectory, readJsonIfExists, writeJsonAtomic} from '../content/lib/files'
import {analyzeOpportunity, categoryFor, opportunityFingerprint, type OpportunityEvidence} from './lib/analysis'
import {effectiveReviewState, validateOpportunityReview} from './lib/reviews'
import type {OpportunityAnalysis, OpportunityArea, OpportunityReport, OpportunityReview, OpportunityReviewWorkflowStatus, OpportunitySignalType} from './lib/types'
import type {VerificationArtifact} from './lib/verification-types'

export interface OpportunityOptions {
  root?: string
  businessId?: string
  area?: string
  categories?: DiscoveryCategory[]
  limit?: number
  force?: boolean
  now?: string
}

export async function runOpportunityAnalysis(options: OpportunityOptions = {}): Promise<OpportunityReport> {
  const root = options.root ?? process.cwd()
  const now = options.now ?? new Date().toISOString()
  const manifest = await loadManifest(root)
  const evidence = await loadEvidence(root, manifest)
  const categories = options.categories?.length ? options.categories : [...DISCOVERY_CATEGORIES]
  const selected = selectEntries(evidence, {...options, categories})
  const analyses: OpportunityAnalysis[] = []
  let reusedUnchanged = 0
  for (const item of selected) {
    const path = resolve(root, `content/opportunities/${item.entry.id}.json`)
    const previous = await readJsonIfExists<OpportunityAnalysis | null>(path, null)
    const fingerprint = opportunityFingerprint(item)
    if (!options.force && previous?.schemaVersion === 1 && previous.inputFingerprint === fingerprint) {
      analyses.push(previous)
      reusedUnchanged += 1
      continue
    }
    const analysis = analyzeOpportunity(item, now)
    await writeJsonAtomic(path, analysis)
    analyses.push(analysis)
  }
  const filters: OpportunityReport['selection']['filters'] = {
    categories,
    ...(options.businessId ? {businessId: options.businessId} : {}),
    ...(options.area ? {area: options.area} : {}),
    ...(options.limit ? {limit: options.limit} : {}),
  }
  const reviewStates = new Map(selected.map((item) => [item.entry.id, effectiveReviewState(item.review, now)]))
  const report = buildReport(analyses, reusedUnchanged, filters, reviewStates, now)
  await writeJsonAtomic(resolve(root, 'content/reports/opportunities/latest.json'), report)
  return report
}

async function loadEvidence(root: string, manifest: ContentManifest): Promise<OpportunityEvidence[]> {
  const [discoveredFiles, enrichedFiles, comparisonFiles, discoveryReports, reviewFiles, verificationFiles] = await Promise.all([
    loadJsonDirectory<DiscoveredEntity>(resolve(root, 'content/discovered')),
    loadJsonDirectory<EnrichedEntity>(resolve(root, 'content/enriched')),
    loadJsonDirectory<any>(resolve(root, 'content/comparisons/enriched')),
    loadJsonDirectory<DiscoveryRun>(resolve(root, 'content/reports/discovery-runs')),
    loadJsonDirectory<OpportunityReview>(resolve(root, 'content/manual/opportunity-reviews')),
    loadJsonDirectory<VerificationArtifact>(resolve(root, 'content/verification')),
  ])
  const discovered = new Map(discoveredFiles.map(({value}) => [value.id, value]))
  const enriched = new Map(enrichedFiles.map(({value}) => [value.id, value]))
  const comparisons = new Map<string, NonNullable<OpportunityEvidence['comparison']>>()
  const reviews = new Map(reviewFiles.map(({value}) => [value.businessId, value]))
  const verifications = new Map(verificationFiles.map(({value}) => [value.businessId, value]))
  for (const {value} of comparisonFiles) {
    for (const business of value.businesses ?? []) {
      const current = comparisons.get(business.businessId) ?? {integrityIssues: []}
      if (business.operationalStatus && (!current.operationalStatus || Date.parse(business.operationalStatus.assessedAt ?? '') > Date.parse(current.operationalStatus.assessedAt ?? ''))) current.operationalStatus = business.operationalStatus
      comparisons.set(business.businessId, current)
    }
    for (const issue of value.integrityIssues ?? []) {
      const current = comparisons.get(issue.businessId) ?? {integrityIssues: []}
      if (!current.integrityIssues.some((item) => item.code === issue.code && item.message === issue.message)) current.integrityIssues.push(issue)
      comparisons.set(issue.businessId, current)
    }
  }
  const duplicateSources = new Map<string, string[]>()
  for (const {value} of discoveryReports) for (const duplicate of value.probableDuplicates ?? []) {
    duplicateSources.set(duplicate.existingBusinessId, [...new Set([...(duplicateSources.get(duplicate.existingBusinessId) ?? []), ...duplicate.incomingSourceKeys])])
  }
  return manifest.entries.map((entry) => {
    const discoveredEntity = discovered.get(entry.id)
    const enrichedEntity = enriched.get(entry.id)
    const comparison = comparisons.get(entry.id)
    const probableDuplicateSourceKeys = duplicateSources.get(entry.id)
    const rawReview = reviews.get(entry.id)
    const verification = verifications.get(entry.id)
    const availableSourceKeys = new Set([
      ...entry.sources.map((source) => source.key),
      ...(discoveredEntity?.sources.map((source) => source.key) ?? []),
      ...(enrichedEntity?.sources.map((source) => source.key) ?? []),
      ...(verification?.sources.map((source) => source.key) ?? []),
    ])
    const review = rawReview ? validateOpportunityReview(rawReview, entry.id, availableSourceKeys) : undefined
    return {entry, ...(discoveredEntity ? {discovered: discoveredEntity} : {}), ...(enrichedEntity ? {enriched: enrichedEntity} : {}), ...(comparison ? {comparison} : {}), ...(probableDuplicateSourceKeys ? {probableDuplicateSourceKeys} : {}), ...(review ? {review} : {}), ...(verification ? {verification} : {})}
  })
}

function selectEntries(items: OpportunityEvidence[], options: OpportunityOptions & {categories: DiscoveryCategory[]}): OpportunityEvidence[] {
  let filtered = items.filter((item) => options.categories.includes(categoryFor(item.entry)))
  if (options.businessId) filtered = filtered.filter((item) => item.entry.id === options.businessId)
  if (options.area) {
    const area = normalize(options.area)
    filtered = filtered.filter((item) => {
      const scopes = item.entry.discovery?.geographicScopes ?? []
      const locality = item.discovered?.raw.tags['addr:city'] ?? item.enriched?.facts.address.value?.locality ?? ''
      return [...scopes, locality].some((value) => normalize(value).includes(area))
    })
  }
  const groups = new Map<DiscoveryCategory, OpportunityEvidence[]>()
  for (const category of options.categories) groups.set(category, [])
  for (const item of filtered) groups.get(categoryFor(item.entry))?.push(item)
  for (const group of groups.values()) group.sort((a, b) => a.entry.id.localeCompare(b.entry.id))
  const result: OpportunityEvidence[] = []
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  while (result.length < limit && [...groups.values()].some((group) => group.length)) {
    for (const category of options.categories) {
      const next = groups.get(category)?.shift()
      if (next) result.push(next)
      if (result.length >= limit) break
    }
  }
  return result
}

function buildReport(analyses: OpportunityAnalysis[], reusedUnchanged: number, filters: OpportunityReport['selection']['filters'], reviewStates: ReadonlyMap<string, OpportunityReviewWorkflowStatus>, now: string): OpportunityReport {
  const signalCounts: Partial<Record<OpportunitySignalType, number>> = {}
  const opportunityAreaCounts: Partial<Record<OpportunityArea, number>> = {}
  for (const analysis of analyses) {
    for (const signal of analysis.signals) signalCounts[signal.type] = (signalCounts[signal.type] ?? 0) + 1
    for (const area of analysis.summary.opportunityAreas) opportunityAreaCounts[area] = (opportunityAreaCounts[area] ?? 0) + 1
  }
  const signals = analyses.reduce((sum, item) => sum + item.provenance.totalSignals, 0)
  const coveredSignals = analyses.reduce((sum, item) => sum + item.provenance.coveredSignals, 0)
  const reviewStateCounts: OpportunityReport['reviewStateCounts'] = {}
  for (const analysis of analyses) {
    const state = reviewStates.get(analysis.businessId) ?? 'unreviewed'
    reviewStateCounts[state] = (reviewStateCounts[state] ?? 0) + 1
  }
  return {
    schemaVersion: 1, generatedAt: now,
    selection: {
      method: 'deterministic-category-round-robin', filters,
      description: 'Muestra determinista por orden de businessId, alternando categorías solicitadas y sin usar señales u oportunidad aparente para seleccionar.',
      businessIds: analyses.map((item) => item.businessId),
    },
    businessesAnalyzed: analyses.length, reusedUnchanged,
    actionableHypotheses: analyses.reduce((sum, item) => sum + item.hypotheses.length, 0),
    needsReview: analyses.filter((item) => item.status === 'needs-review').length,
    notActionable: analyses.filter((item) => item.status === 'not-actionable').length,
    reviewStateCounts,
    signalCounts, opportunityAreaCounts,
    businessesWithoutOfficialWebsite: analyses.filter((item) => item.signals.some((signal) => signal.type === 'no_official_website_found')).map((item) => item.businessId),
    businessesWithIdentityOrStatusConflicts: analyses.filter((item) => item.signals.some((signal) => ['identity_conflict', 'probable_duplicate', 'operational_status_unknown', 'operational_status_conflict'].includes(signal.type))).map((item) => item.businessId),
    provenanceCoverage: {signals, coveredSignals, ratio: signals ? coveredSignals / signals : 0},
    analyses: analyses.map(({businessId, businessName, category, status, signals: itemSignals, hypotheses, suggestedActions, summary}) => ({businessId, businessName, category, status, signals: itemSignals, hypotheses, suggestedActions, summary, reviewState: reviewStates.get(businessId) ?? 'unreviewed'})),
  }
}

function parseArgs(argv: string[]): OpportunityOptions {
  const options: OpportunityOptions = {}
  for (const arg of argv) {
    if (arg === '--force') options.force = true
    else if (arg.startsWith('--business=')) options.businessId = arg.slice('--business='.length)
    else if (arg.startsWith('--area=')) options.area = arg.slice('--area='.length)
    else if (arg.startsWith('--category=')) {
      const values = arg.slice('--category='.length).split(',')
      for (const value of values) if (!DISCOVERY_CATEGORIES.includes(value as DiscoveryCategory)) throw new Error(`Categoría no soportada: ${value}`)
      options.categories = values as DiscoveryCategory[]
    } else if (arg.startsWith('--limit=')) {
      options.limit = Number(arg.slice('--limit='.length))
      if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error('--limit debe ser un entero positivo.')
    } else throw new Error(`Opción no soportada: ${arg}`)
  }
  return options
}

function normalize(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() }

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const report = await runOpportunityAnalysis(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify({
    businessesAnalyzed: report.businessesAnalyzed, reusedUnchanged: report.reusedUnchanged,
    actionableHypotheses: report.actionableHypotheses, needsReview: report.needsReview,
    notActionable: report.notActionable, provenanceCoverage: report.provenanceCoverage,
  }, null, 2))
}
