import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {OpenStreetMapAdapter, type SourceAdapter, type SourceRecord} from './lib/adapters'
import {applyFilters, parsePipelineOptions, type PipelineOptions} from './lib/cli'
import {removeFileIfExists, writeJsonAtomic} from './lib/files'
import {createManifestEntry, findBySource, loadManifest, saveManifest, transitionEntry} from './lib/manifest'
import {deduplicateBy, deterministicBusinessId, entityFingerprint, slugify, uniqueSlug} from './lib/normalize'
import {createReport, finishReport} from './lib/reporting'
import type {ContentManifest, DiscoveredEntity, PhaseReportItem} from './lib/types'

export async function runDiscovery(
  options: PipelineOptions,
  dependencies: {adapter?: SourceAdapter; root?: string; now?: string} = {},
): Promise<void> {
  const root = dependencies.root ?? process.cwd()
  const now = dependencies.now ?? new Date().toISOString()
  const manifest = await loadManifest(root)
  const adapter = dependencies.adapter ?? new OpenStreetMapAdapter()
  const records = deduplicateRecords(await adapter.discover({
    ...(options.type ? {type: options.type} : {}),
    ...(options.limit ? {limit: options.limit} : {}),
    retrievedAt: now,
  }))
  const entities = assignIdentities(records, manifest)
  const selected = applyFilters(entities, options)
  const items: PhaseReportItem[] = []

  for (const entity of selected) {
    const existing = manifest.entries.find((entry) => entry.id === entity.id)
    if (existing && !options.force) {
      items.push({id: entity.id, outcome: 'skipped', message: 'Ya estaba descubierto; usa --force para refrescarlo.'})
      continue
    }
    if (!options.dryRun) {
      if (existing && options.force) {
        await Promise.all([
          removeFileIfExists(resolve(root, `content/enriched/${entity.id}.json`)),
          removeFileIfExists(resolve(root, `content/generated/.staging/businesses/${entity.id}.json`)),
          removeFileIfExists(resolve(root, `content/generated/businesses/${entity.id}.json`)),
        ])
      }
      await writeJsonAtomic(resolve(root, `content/discovered/${entity.id}.json`), entity)
      if (existing) {
        existing.type = entity.type
        existing.slug = entity.slug
        existing.priority = entity.priority
        existing.sources = entity.sources
        transitionEntry(existing, 'discovered', now, true)
      } else {
        manifest.entries.push(createManifestEntry({...entity, now}))
      }
    }
    items.push({id: entity.id, outcome: 'processed'})
  }

  if (!options.dryRun) await saveManifest(manifest, root, now)
  await finishReport(createReport('discovery', options.dryRun, now, items), root)
}

export function deduplicateRecords(records: readonly SourceRecord[]): SourceRecord[] {
  const bySource = deduplicateBy(records, (record) => record.sources[0]?.key ?? '')
  const ordered = [...bySource].sort((a, b) => b.priority - a.priority || a.raw.name.localeCompare(b.raw.name, 'es'))
  const merged = new Map<string, SourceRecord>()
  for (const record of ordered) {
    const fingerprint = entityFingerprint({...record.raw, type: record.type})
    const existing = merged.get(fingerprint)
    if (!existing) {
      merged.set(fingerprint, structuredClone(record))
      continue
    }
    const keys = new Set(existing.sources.map((source) => source.key))
    existing.sources.push(...record.sources.filter((source) => !keys.has(source.key)))
  }
  return [...merged.values()]
}

function assignIdentities(records: readonly SourceRecord[], manifest: ContentManifest): DiscoveredEntity[] {
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

async function main(): Promise<void> {
  try {
    await runDiscovery(parsePipelineOptions())
  } catch (error) {
    console.error(`Discovery falló: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
