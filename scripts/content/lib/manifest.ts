import {resolve} from 'node:path'
import {readJsonIfExists, writeJsonAtomic} from './files'
import {sourceKey} from './normalize'
import type {BusinessQualityAssessment, ContentManifest, DiscoveryCategory, DiscoveryPurpose, EntityType, ManifestEntry, PipelineStage, PipelineStatus, SourceProvenance} from './types'

export const MANIFEST_PATH = 'content/manifest.json'

const ORDER: Exclude<PipelineStatus, 'error'>[] = [
  'discovered', 'enriched', 'generated', 'validated', 'imported', 'reviewed', 'published',
]

export function emptyManifest(): ContentManifest {
  return {version: 1, updatedAt: null, entries: []}
}

export async function loadManifest(root = process.cwd()): Promise<ContentManifest> {
  const manifest = await readJsonIfExists(resolve(root, MANIFEST_PATH), emptyManifest())
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new Error('content/manifest.json no tiene un formato compatible.')
  for (const entry of manifest.entries) {
    entry.qualityTier ??= null
    entry.qualityAssessedAt ??= null
    entry.qualityReasons ??= []
    entry.missingUsefulFacts ??= []
    entry.discovery ??= lifecycleFromLegacy(entry)
  }
  return manifest
}

export async function saveManifest(manifest: ContentManifest, root = process.cwd(), now = new Date().toISOString()): Promise<void> {
  manifest.entries.sort((a, b) => a.id.localeCompare(b.id))
  manifest.updatedAt = now
  await writeJsonAtomic(resolve(root, MANIFEST_PATH), manifest)
}

export function createManifestEntry(input: {
  id: string
  type: EntityType
  slug: string
  priority: number
  sources: SourceProvenance[]
  now: string
  categories?: DiscoveryCategory[]
  geographicScope?: string
}): ManifestEntry {
  return {
    id: input.id,
    type: input.type,
    slug: input.slug,
    status: 'discovered',
    priority: input.priority,
    sources: input.sources,
    discoveredAt: input.now,
    enrichedAt: null,
    generatedAt: null,
    validatedAt: null,
    importedAt: null,
    reviewedAt: null,
    publishedAt: null,
    qualityTier: null,
    qualityAssessedAt: null,
    qualityReasons: [],
    missingUsefulFacts: [],
    lastError: null,
    discovery: {
      state: 'discovered', firstSeenAt: input.now, lastSeenAt: input.now,
      categories: [...new Set(input.categories ?? [])],
      geographicScopes: input.geographicScope ? [input.geographicScope] : [],
      sourceIdentifiers: input.sources.map(({provider, identifier}) => ({provider, identifier})),
      researchSelections: [], editorialEligibility: [],
      history: [{at: input.now, kind: 'discovered', sourceKeys: input.sources.map((source) => source.key)}],
    },
  }
}

export function recordDiscoverySighting(
  entry: ManifestEntry,
  input: {now: string; sources: SourceProvenance[]; categories: DiscoveryCategory[]; geographicScope: string; isNewSource: boolean},
): void {
  const lifecycle = entry.discovery ??= lifecycleFromLegacy(entry)
  lifecycle.lastSeenAt = input.now
  lifecycle.categories = [...new Set([...lifecycle.categories, ...input.categories])]
  lifecycle.geographicScopes = [...new Set([...lifecycle.geographicScopes, input.geographicScope])]
  lifecycle.sourceIdentifiers = uniqueSourceIdentifiers([...lifecycle.sourceIdentifiers, ...input.sources.map(({provider, identifier}) => ({provider, identifier}))])
  lifecycle.history.push({at: input.now, kind: input.isNewSource ? 'source-added' : 'seen', sourceKeys: input.sources.map((source) => source.key)})
}

export function markSelectedForResearch(entry: ManifestEntry, purpose: DiscoveryPurpose, contextId: string, now: string): void {
  const lifecycle = entry.discovery ??= lifecycleFromLegacy(entry)
  const existing = lifecycle.researchSelections.find((item) => item.purpose === purpose && item.contextId === contextId)
  if (existing) return
  lifecycle.researchSelections.push({purpose, contextId, selectedAt: now, researchedAt: null})
  lifecycle.history.push({at: now, kind: 'selected-for-research', sourceKeys: [], contextId})
}

export function markResearched(entry: ManifestEntry, purpose: DiscoveryPurpose, contextId: string, now: string): void {
  markSelectedForResearch(entry, purpose, contextId, now)
  const lifecycle = entry.discovery!
  const selection = lifecycle.researchSelections.find((item) => item.purpose === purpose && item.contextId === contextId)!
  if (selection.researchedAt) return
  selection.researchedAt = now
  lifecycle.history.push({at: now, kind: 'researched', sourceKeys: [], contextId})
}

export function recordEditorialEligibility(entry: ManifestEntry, contextId: string, status: 'eligible' | 'ineligible' | 'unassessed', now: string, reason?: string): void {
  const lifecycle = entry.discovery ??= lifecycleFromLegacy(entry)
  const assessment = {contextId, status, assessedAt: now, ...(reason ? {reason} : {})}
  const index = lifecycle.editorialEligibility.findIndex((item) => item.contextId === contextId)
  if (index >= 0) lifecycle.editorialEligibility[index] = assessment
  else lifecycle.editorialEligibility.push(assessment)
  lifecycle.history.push({at: now, kind: 'editorial-assessed', sourceKeys: [], contextId})
}

export function recordQualityAssessment(entry: ManifestEntry, assessment: BusinessQualityAssessment, now: string): void {
  entry.qualityTier = assessment.tier
  entry.qualityAssessedAt = now
  entry.qualityReasons = [...assessment.reasons]
  entry.missingUsefulFacts = [...assessment.missingUsefulFacts]
}

export function findBySource(manifest: ContentManifest, source: SourceProvenance): ManifestEntry | undefined {
  return manifest.entries.find((entry) => entry.sources.some((candidate) => candidate.key === sourceKey(source.provider, source.identifier)))
}

export function transitionEntry(entry: ManifestEntry, status: Exclude<PipelineStatus, 'error'>, now: string, force = false): void {
  const currentIndex = entry.status === 'error' ? -1 : ORDER.indexOf(entry.status)
  const nextIndex = ORDER.indexOf(status)
  if (force || currentIndex < nextIndex) entry.status = status
  const timestamp = timestampField(status)
  if (timestamp && (force || entry[timestamp] === null)) entry[timestamp] = now
  if (force) {
    for (const later of ORDER.slice(nextIndex + 1)) {
      const field = timestampField(later)
      if (field) entry[field] = null
    }
  }
  entry.lastError = null
}

export function markEntryError(entry: ManifestEntry, stage: PipelineStage, message: string, now: string): void {
  entry.status = 'error'
  entry.lastError = {stage, message, at: now}
}

export function canRunStage(entry: ManifestEntry, stage: PipelineStage, force: boolean): boolean {
  if (force) return true
  if (entry.status === 'error') return entry.lastError?.stage === stage || (stage === 'qa' && entry.lastError?.stage === 'qa')
  if (stage === 'enrichment') return entry.discoveredAt !== null && entry.enrichedAt === null
  if (stage === 'generation') return entry.enrichedAt !== null && entry.generatedAt === null
  if (stage === 'qa') return entry.generatedAt !== null && entry.validatedAt === null
  return true
}

export async function markManifestImported(ids: readonly string[], root = process.cwd(), now = new Date().toISOString()): Promise<void> {
  const manifest = await loadManifest(root)
  const wanted = new Set(ids)
  let changed = false
  for (const entry of manifest.entries) {
    if (!wanted.has(entry.id)) continue
    transitionEntry(entry, 'imported', now)
    changed = true
  }
  if (changed) await saveManifest(manifest, root, now)
}

type TimestampField = 'discoveredAt' | 'enrichedAt' | 'generatedAt' | 'validatedAt' | 'importedAt' | 'reviewedAt' | 'publishedAt'

function timestampField(status: Exclude<PipelineStatus, 'error'>): TimestampField | undefined {
  return `${status}At` as TimestampField
}

function lifecycleFromLegacy(entry: ManifestEntry): NonNullable<ManifestEntry['discovery']> {
  const firstSeenAt = entry.discoveredAt ?? entry.sources[0]?.retrievedAt ?? '1970-01-01T00:00:00.000Z'
  return {
    state: 'discovered', firstSeenAt, lastSeenAt: firstSeenAt, categories: [], geographicScopes: [],
    sourceIdentifiers: uniqueSourceIdentifiers(entry.sources.map(({provider, identifier}) => ({provider, identifier}))),
    researchSelections: [], editorialEligibility: [],
    history: [{at: firstSeenAt, kind: 'discovered', sourceKeys: entry.sources.map((source) => source.key)}],
  }
}

function uniqueSourceIdentifiers(values: Array<{provider: string; identifier: string}>): Array<{provider: string; identifier: string}> {
  return [...new Map(values.map((value) => [`${value.provider}:${value.identifier}`, value])).values()]
}
