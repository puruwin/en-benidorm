import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import {DISCOVERY_CATEGORIES, type ContentManifest, type DiscoveredEntity, type DiscoveryCategory, type EnrichedEntity} from '../content/lib/types'
import {loadManifest} from '../content/lib/manifest'
import {loadJsonDirectory, readJsonIfExists, writeJsonAtomic} from '../content/lib/files'
import {categoryFor} from './lib/analysis'
import {verificationIsFresh, verifyBusiness, type VerificationInput} from './lib/verification'
import type {VerificationArtifact, VerificationReport} from './lib/verification-types'

interface VerifyOptions {root?: string; businessId?: string; area?: string; categories?: DiscoveryCategory[]; limit?: number; force?: boolean; now?: string; concurrency?: number}

export async function runVerification(options: VerifyOptions = {}): Promise<VerificationReport> {
  const root = options.root ?? process.cwd()
  const now = options.now ?? new Date().toISOString()
  const manifest = await loadManifest(root)
  const inputs = await loadInputs(root, manifest)
  const categories = options.categories?.length ? options.categories : [...DISCOVERY_CATEGORIES]
  const selected = selectInputs(inputs, {...options, categories})
  const completed: Array<{artifact: VerificationArtifact; reused: boolean}> = []
  let cursor = 0
  const worker = async () => {
    while (cursor < selected.length) {
      const input = selected[cursor++]!
      const path = resolve(root, `content/verification/${input.entry.id}.json`)
      const previous = await readJsonIfExists<VerificationArtifact | null>(path, null)
      if (!options.force && previous && verificationIsFresh(previous, input, now)) { completed.push({artifact: previous, reused: true}); continue }
      const artifact = await verifyBusiness(input, {now})
      await writeJsonAtomic(path, artifact)
      completed.push({artifact, reused: false})
    }
  }
  await Promise.all(Array.from({length: Math.min(options.concurrency ?? 3, Math.max(1, selected.length))}, worker))
  const byId = new Map(completed.map((item) => [item.artifact.businessId, item]))
  const ordered = selected.map((input) => byId.get(input.entry.id)!)
  const report = buildReport(ordered, {categories, ...(options.area ? {area: options.area} : {}), ...(options.limit ? {limit: options.limit} : {})}, now)
  await writeJsonAtomic(resolve(root, 'content/reports/verification/latest.json'), report)
  return report
}

async function loadInputs(root: string, manifest: ContentManifest): Promise<VerificationInput[]> {
  const [discoveredFiles, enrichedFiles] = await Promise.all([
    loadJsonDirectory<DiscoveredEntity>(resolve(root, 'content/discovered')),
    loadJsonDirectory<EnrichedEntity>(resolve(root, 'content/enriched')),
  ])
  const discovered = new Map(discoveredFiles.map(({value}) => [value.id, value]))
  const enriched = new Map(enrichedFiles.map(({value}) => [value.id, value]))
  return manifest.entries.map((entry) => {
    const foundDiscovered = discovered.get(entry.id), foundEnriched = enriched.get(entry.id)
    return {entry, ...(foundDiscovered ? {discovered: foundDiscovered} : {}), ...(foundEnriched ? {enriched: foundEnriched} : {})}
  })
}

function selectInputs(inputs: VerificationInput[], options: VerifyOptions & {categories: DiscoveryCategory[]}): VerificationInput[] {
  let filtered = inputs.filter((input) => options.categories.includes(categoryFor(input.entry)))
  if (options.businessId) filtered = filtered.filter((input) => input.entry.id === options.businessId)
  if (options.area) {
    const area = normalize(options.area)
    filtered = filtered.filter((input) => [...(input.entry.discovery?.geographicScopes ?? []), input.discovered?.raw.tags['addr:city'] ?? '', input.enriched?.facts.address.value?.locality ?? ''].some((value) => normalize(value).includes(area)))
  }
  const groups = new Map(options.categories.map((category) => [category, [] as VerificationInput[]]))
  for (const input of filtered) groups.get(categoryFor(input.entry))?.push(input)
  for (const group of groups.values()) group.sort((a, b) => a.entry.id.localeCompare(b.entry.id))
  const output: VerificationInput[] = []
  const limit = options.limit ?? Infinity
  while (output.length < limit && [...groups.values()].some((group) => group.length)) for (const category of options.categories) {
    const next = groups.get(category)?.shift(); if (next) output.push(next); if (output.length >= limit) break
  }
  return output
}

function buildReport(items: Array<{artifact: VerificationArtifact; reused: boolean}>, filters: {area?: string; categories: DiscoveryCategory[]; limit?: number}, now: string): VerificationReport {
  const identityStatusCounts: Record<string, number> = {}, operationalStatusCounts: Record<string, number> = {}
  for (const {artifact} of items) {
    identityStatusCounts[artifact.identityEvidence.status] = (identityStatusCounts[artifact.identityEvidence.status] ?? 0) + 1
    operationalStatusCounts[artifact.operationalEvidence.status] = (operationalStatusCounts[artifact.operationalEvidence.status] ?? 0) + 1
  }
  return {
    schemaVersion: 1, generatedAt: now,
    selection: {method: 'deterministic-category-round-robin', ...(filters.area ? {area: filters.area} : {}), categories: filters.categories, ...(filters.limit ? {limit: filters.limit} : {}), businessIds: items.map(({artifact}) => artifact.businessId), description: 'La misma muestra determinista de Opportunity Analysis: orden por businessId y round-robin de categorías, sin seleccionar por oportunidad aparente.'},
    businessesProcessed: items.length, reusedFresh: items.filter((item) => item.reused).length,
    crawlErrors: items.reduce((sum, {artifact}) => sum + artifact.errors.length, 0),
    newOperationalEvidence: items.filter(({artifact}) => artifact.operationalEvidence.status !== 'insufficient').length,
    newIdentityEvidence: items.filter(({artifact}) => artifact.identityEvidence.status !== 'insufficient').length,
    officialWebsites: items.filter(({artifact}) => artifact.digitalPresence.website?.scope === 'location').length,
    phones: items.filter(({artifact}) => artifact.digitalPresence.phones.length).length,
    forms: items.filter(({artifact}) => artifact.digitalPresence.forms.length).length,
    booking: items.filter(({artifact}) => artifact.digitalPresence.bookingUrls.length).length,
    insufficient: items.filter(({artifact}) => artifact.identityEvidence.status === 'insufficient' || artifact.operationalEvidence.status === 'insufficient').length,
    identityStatusCounts, operationalStatusCounts,
    results: items.map(({artifact, reused}) => ({businessId: artifact.businessId, identity: artifact.identityEvidence.status, operational: artifact.operationalEvidence.status, website: artifact.digitalPresence.website?.value ?? null, phoneCount: artifact.digitalPresence.phones.length, formCount: artifact.digitalPresence.forms.length, bookingCount: artifact.digitalPresence.bookingUrls.length, errors: artifact.errors.length, reused})),
  }
}

function parseArgs(argv: string[]): VerifyOptions {
  const result: VerifyOptions = {}
  for (const arg of argv) {
    if (arg === '--force') result.force = true
    else if (arg.startsWith('--business=')) result.businessId = arg.slice(11)
    else if (arg.startsWith('--area=')) result.area = arg.slice(7)
    else if (arg.startsWith('--category=')) { const values = arg.slice(11).split(','); if (values.some((value) => !DISCOVERY_CATEGORIES.includes(value as DiscoveryCategory))) throw new Error('Categoría no soportada.'); result.categories = values as DiscoveryCategory[] }
    else if (arg.startsWith('--limit=')) { result.limit = Number(arg.slice(8)); if (!Number.isInteger(result.limit) || result.limit < 1) throw new Error('--limit debe ser un entero positivo.') }
    else throw new Error(`Opción no soportada: ${arg}`)
  }
  return result
}
function normalize(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() }

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const report = await runVerification(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify({businessesProcessed: report.businessesProcessed, reusedFresh: report.reusedFresh, crawlErrors: report.crawlErrors, newOperationalEvidence: report.newOperationalEvidence, newIdentityEvidence: report.newIdentityEvidence, officialWebsites: report.officialWebsites, phones: report.phones, forms: report.forms, booking: report.booking, insufficient: report.insufficient}, null, 2))
}
