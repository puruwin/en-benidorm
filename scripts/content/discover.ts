import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {BENIDORM_SCOPE, FileDiscoveryCheckpointStore, LocalOsmExtractAdapter, OpenStreetMapAdapter, type DiscoveryAdapterOutput, type SourceAdapter, type SourceRecord} from './lib/adapters'
import {parsePipelineOptions, type PipelineOptions} from './lib/cli'
import {loadJsonDirectory, writeJsonAtomic} from './lib/files'
import {createManifestEntry, findBySource, loadManifest, markSelectedForResearch, recordDiscoverySighting, saveManifest} from './lib/manifest'
import {deduplicateBy, deterministicBusinessId, entityFingerprint, slugify, uniqueSlug} from './lib/normalize'
import {createReport, finishReport} from './lib/reporting'
import {findProbableDuplicates} from './lib/discovery-identity'
import {classifyBusiness} from './lib/business-taxonomy'
import {classifyGeography} from './lib/discovery-geography'
import {calculateDiscoveryCoverage, writeDiscoveryCoverage} from './lib/discovery-coverage'
import type {ContentManifest, DiscoveredEntity, DiscoveryCategory, DiscoveryRun, PhaseReportItem} from './lib/types'

export async function runDiscovery(
  options: PipelineOptions,
  dependencies: {adapter?: SourceAdapter; root?: string; now?: string} = {},
): Promise<void> {
  const root = dependencies.root ?? process.cwd()
  const now = dependencies.now ?? new Date().toISOString()
  const manifest = await loadManifest(root)
  const adapter = dependencies.adapter ?? (options.osmExtract
    ? new LocalOsmExtractAdapter(resolve(root, options.osmExtract), {
        ...(options.extractSourceUrl ? {sourceUrl: options.extractSourceUrl} : {}),
        ...(options.extractDownloadedAt ? {downloadedAt: options.extractDownloadedAt} : {}),
      })
    : new OpenStreetMapAdapter(undefined, fetch, {
        ...(options.concurrency !== undefined ? {concurrency: options.concurrency} : {}),
        ...(options.tileGrid !== undefined ? {tileGrid: options.tileGrid} : {}),
        ...(options.timeoutMs !== undefined ? {timeoutMs: options.timeoutMs} : {}),
        ...(options.maxAttempts !== undefined ? {maxAttempts: options.maxAttempts} : {}),
        ...(options.backoffMs !== undefined ? {baseBackoffMs: options.backoffMs} : {}),
        ...(!options.dryRun ? {checkpointStore: new FileDiscoveryCheckpointStore(root)} : {}),
        ...(options.resume !== undefined ? {resume: options.resume} : {}),
      }))
  const geography = options.geography ?? BENIDORM_SCOPE
  const request = {
    ...(options.type ? {type: options.type} : {}),
    ...(options.categories ? {categories: options.categories} : {}),
    geography,
    retrievedAt: now,
  }
  const adapterOutput: DiscoveryAdapterOutput = adapter.discoverDetailed
    ? await adapter.discoverDetailed(request)
    : {records: await adapter.discover(request), status: 'success', units: [], checkpointPath: null, resumedUnits: 0}
  const rawRecords = adapterOutput.records
  const runStatus = adapterOutput.status === 'success' && rawRecords.length === 0 && manifest.entries.length > 0
    ? 'anomalous-empty' as const : adapterOutput.status
  const records = deduplicateRecords(rawRecords)
  const existingArtifacts = new Map((await loadJsonDirectory<DiscoveredEntity>(resolve(root, 'content/discovered'))).map(({value}) => [value.id, value]))
  const probableDuplicates = findProbableDuplicates(records, [...existingArtifacts.values()])
  const entities = assignIdentities(records, manifest)
  const researchLimit = options.researchLimit ?? options.limit
  const selectedForResearch = new Set((researchLimit ? entities.slice(0, researchLimit) : []).map((entity) => entity.id))
  const items: PhaseReportItem[] = []
  let created = 0
  let updated = 0

  for (const entity of entities) {
    const existing = manifest.entries.find((entry) => entry.id === entity.id)
    const previousArtifact = existingArtifacts.get(entity.id)
    const mergedEntity = mergeDiscoveredEntity(previousArtifact, entity, now, options.categories ?? categoriesForType(entity.type), geography.name)
    if (!options.dryRun) {
      await writeJsonAtomic(resolve(root, `content/discovered/${entity.id}.json`), mergedEntity)
      if (existing) {
        const previousKeys = new Set(existing.sources.map((source) => source.key))
        existing.type = entity.type
        existing.slug = entity.slug
        existing.priority = Math.max(existing.priority, entity.priority)
        existing.sources = mergeSources(existing.sources, entity.sources)
        recordDiscoverySighting(existing, {
          now, sources: entity.sources, categories: mergedEntity.discovery?.categories ?? [], geographicScope: geography.name,
          isNewSource: entity.sources.some((source) => !previousKeys.has(source.key)),
        })
      } else {
        manifest.entries.push(createManifestEntry({
          ...entity, now, categories: mergedEntity.discovery?.categories ?? [], geographicScope: geography.name,
        }))
      }
      const target = existing ?? manifest.entries.at(-1)!
      if (selectedForResearch.has(entity.id)) markSelectedForResearch(target, 'editorial-business', 'discovery-default', now)
    }
    if (existing) updated += 1
    else created += 1
    items.push({id: entity.id, outcome: 'processed', message: existing ? 'Catálogo actualizado incrementalmente.' : 'Alta nueva en catálogo.'})
  }

  if (!options.dryRun && runStatus !== 'failed' && runStatus !== 'anomalous-empty') await saveManifest(manifest, root, now)
  if (!options.dryRun) {
    const catalog = (await loadJsonDirectory<DiscoveredEntity>(resolve(root, 'content/discovered'))).map(({value}) => value)
    const normalizedCatalog: DiscoveredEntity[] = []
    for (const entity of catalog) {
      const normalized = withDiscoveryMetadata(entity)
      normalizedCatalog.push(normalized)
      if (JSON.stringify(entity.businessClassification) !== JSON.stringify(normalized.businessClassification)
        || JSON.stringify(entity.geography) !== JSON.stringify(normalized.geography)) {
        await writeJsonAtomic(resolve(root, `content/discovered/${entity.id}.json`), normalized)
      }
    }
    const catalogDuplicates = findCatalogDuplicates(normalizedCatalog)
    await writeDiscoveryCoverage(calculateDiscoveryCoverage(
      normalizedCatalog, catalogDuplicates, now, geography.name,
      [...existingArtifacts.values()].filter((entity) => entity.targetDocumentType === 'business').length,
    ), root)
  }
  const report = createReport('discovery', options.dryRun, now, items)
  report.summary = {
    found: rawRecords.length, unique: records.length, new: created, existing: updated,
    duplicates: rawRecords.length - records.length, selectedForResearch: selectedForResearch.size,
    catalogSize: manifest.entries.length, categories: options.categories ?? [], geography: geography.name,
    ...(rawRecords.length === 0 && manifest.entries.length > 0
      ? {coverageWarning: 'La fuente devolvió cero resultados para un catálogo existente; no se interpreta como ausencia de negocios.'}
      : {}),
    runStatus,
    queries: adapterOutput.units.length,
    attempts: adapterOutput.units.reduce((sum, unit) => sum + unit.attempts.length, 0),
    retries: adapterOutput.units.reduce((sum, unit) => sum + Math.max(0, unit.attempts.length - 1), 0),
    resumedUnits: adapterOutput.resumedUnits,
    probableDuplicates: probableDuplicates.length,
    errors: adapterOutput.units.flatMap((unit) => unit.attempts.filter((attempt) => attempt.outcome !== 'success')),
  }
  await finishReport(report, root)
  if (!options.dryRun) await writeDiscoveryRun(root, {
    schemaVersion: 1, id: runId(now), provider: adapter.provider, status: runStatus,
    startedAt: now, finishedAt: new Date().toISOString(), geography,
    categories: options.categories ?? inferredCategories(records), units: adapterOutput.units,
    checkpointPath: adapterOutput.checkpointPath, resumedUnits: adapterOutput.resumedUnits,
    totals: {
      queries: adapterOutput.units.length,
      attempts: adapterOutput.units.reduce((sum, unit) => sum + unit.attempts.length, 0),
      retries: adapterOutput.units.reduce((sum, unit) => sum + Math.max(0, unit.attempts.length - 1), 0),
      found: rawRecords.length, unique: records.length, new: created, existing: updated,
      exactDuplicates: rawRecords.length - records.length, probableDuplicates: probableDuplicates.length,
    },
    probableDuplicates, coverageByCategory: coverageByCategory(
      adapterOutput.units, records, options.categories ?? inferredCategories(records),
    ),
  })
  if (runStatus === 'failed') process.exitCode = 1
}

export function deduplicateRecords(records: readonly SourceRecord[]): SourceRecord[] {
  const bySource = deduplicateBy(records, (record) => record.sources[0]?.key ?? '')
  const ordered = [...bySource].sort((a, b) => b.priority - a.priority || a.raw.name.localeCompare(b.raw.name, 'es'))
  const merged = new Map<string, SourceRecord>()
  for (const record of ordered) {
    if (record.raw.latitude === null || record.raw.longitude === null) {
      merged.set(record.sources[0]?.key ?? `${record.type}:${record.raw.name}:${merged.size}`, structuredClone(record))
      continue
    }
    const fingerprint = entityFingerprint({...record.raw, type: record.type})
    const existing = merged.get(fingerprint)
    if (!existing) {
      merged.set(fingerprint, structuredClone(record))
      continue
    }
    const providers = new Set(existing.sources.map((source) => source.provider))
    if (record.sources.some((source) => providers.has(source.provider))) {
      const keys = new Set(existing.sources.map((source) => source.key))
      existing.sources.push(...record.sources.filter((source) => !keys.has(source.key)))
    } else {
      merged.set(`${fingerprint}:${record.sources[0]?.key ?? merged.size}`, structuredClone(record))
    }
  }
  return [...merged.values()]
}

export function assignIdentities(records: readonly SourceRecord[], manifest: ContentManifest): DiscoveredEntity[] {
  const used = new Set(manifest.entries.map((entry) => entry.slug))
  return records.map((record) => {
    const existing = record.sources.map((source) => findBySource(manifest, source)).find(Boolean)
    const primarySource = record.sources[0]
    if (!primarySource) throw new Error('El adapter devolvió un registro sin fuentes.')
    const targetDocumentType = record.type === 'attraction' ? 'place' as const : 'business' as const
    const slug = existing?.slug ?? uniqueSlug(slugify(record.raw.name), used, primarySource.key)
    used.add(slug)
    return {
      schemaVersion: 1,
      id: existing?.id ?? (targetDocumentType === 'business' ? deterministicBusinessId(slug) : `place-${slug}`),
      type: record.type,
      targetDocumentType,
      slug,
      priority: record.priority,
      sources: record.sources,
      raw: record.raw,
    }
  })
}

export function mergeDiscoveredEntity(
  existing: DiscoveredEntity | undefined,
  incoming: DiscoveredEntity,
  now: string,
  categories: import('./lib/types').DiscoveryCategory[],
  geographicScope: string,
): DiscoveredEntity {
  const firstSeenAt = existing?.discovery?.firstSeenAt ?? now
  return withDiscoveryMetadata({
    ...(existing ?? {}), ...incoming, schemaVersion: 2,
    priority: Math.max(existing?.priority ?? 0, incoming.priority),
    sources: mergeSources(existing?.sources ?? [], incoming.sources),
    raw: {
      name: incoming.raw.name || existing?.raw.name || '',
      tags: {...(existing?.raw.tags ?? {}), ...incoming.raw.tags},
      latitude: incoming.raw.latitude ?? existing?.raw.latitude ?? null,
      longitude: incoming.raw.longitude ?? existing?.raw.longitude ?? null,
    },
    discovery: {
      firstSeenAt, lastSeenAt: now,
      categories: [...new Set([...(existing?.discovery?.categories ?? []), ...categories])],
      geographicScopes: [...new Set([...(existing?.discovery?.geographicScopes ?? []), geographicScope])],
    },
  })
}

export function withDiscoveryMetadata(entity: DiscoveredEntity): DiscoveredEntity {
  return {
    ...entity,
    businessClassification: classifyBusiness(entity.raw.tags),
    geography: classifyGeography(entity.raw.tags, entity.raw.latitude, entity.raw.longitude),
  }
}

export function findCatalogDuplicates(entities: readonly DiscoveredEntity[]) {
  const result: ReturnType<typeof findProbableDuplicates> = []
  for (let index = 0; index < entities.length; index += 1) {
    const incoming = entities[index]!
    const record: SourceRecord = {type: incoming.type, priority: incoming.priority, sources: incoming.sources, raw: incoming.raw}
    result.push(...findProbableDuplicates([record], entities.slice(index + 1)))
  }
  return result
}

function mergeSources(existing: import('./lib/types').SourceProvenance[], incoming: import('./lib/types').SourceProvenance[]): import('./lib/types').SourceProvenance[] {
  const merged = new Map(existing.map((source) => [source.key, source]))
  for (const source of incoming) merged.set(source.key, source)
  return [...merged.values()]
}

function categoriesForType(type: DiscoveredEntity['type']): import('./lib/types').DiscoveryCategory[] {
  if (['restaurant', 'bar', 'cafe', 'hotel'].includes(type)) return ['hospitality']
  if (type === 'service') return ['professional-services']
  if (type === 'shop') return ['retail']
  return ['attractions']
}

async function writeDiscoveryRun(root: string, run: DiscoveryRun): Promise<void> {
  await writeJsonAtomic(resolve(root, `content/reports/discovery-runs/${run.id}.json`), run)
}

function runId(now: string): string {
  return now.replace(/[:.]/g, '-').replace(/Z$/, 'Z')
}

function inferredCategories(records: readonly SourceRecord[]): DiscoveryCategory[] {
  return [...new Set(records.flatMap((record) => categoriesForType(record.type)))]
}

function coverageByCategory(
  units: DiscoveryAdapterOutput['units'],
  records: readonly SourceRecord[],
  requested: readonly DiscoveryCategory[],
): DiscoveryRun['coverageByCategory'] {
  const result: DiscoveryRun['coverageByCategory'] = {}
  for (const category of requested) {
    const types = category === 'hospitality' ? ['restaurant', 'bar', 'cafe', 'hotel']
      : category === 'professional-services' ? ['service'] : category === 'retail' ? ['shop'] : ['attraction']
    const categoryUnits = units.filter((unit) => unit.type === 'mixed' || types.includes(unit.type))
    const count = records.filter((record) => types.includes(record.type)).length
    if (categoryUnits.length || count) result[category] = {
      units: categoryUnits.length,
      completed: categoryUnits.filter((unit) => unit.status !== 'failed').length,
      records: count,
    }
  }
  return result
}

async function main(): Promise<void> {
  try {
    await runDiscovery(parsePipelineOptions())
  } catch (error) {
    console.error(`Discovery falló: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
