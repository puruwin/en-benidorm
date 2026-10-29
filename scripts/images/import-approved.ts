// Importa a Sanity, como borrador, las imágenes que David ha aprobado. Por defecto solo muestra el plan;
// con --write descarga el original, quita EXIF, lo sube como asset con su procedencia y lo asigna en
// `drafts.<id>`. Nunca publica: David revisa y publica en el Studio.
//   npm run images:import -- content/images/candidates/beach-playa-levante.json [--write]
//   npm run images:import -- --own content/images/own/2026-10-20-playa-levante.json [--write]
// Opciones: --plan-out content/images/plans/<slug>.json (guarda el plan con su planHash),
// --expect-plan <hash> (aborta si el plan recalculado difiere), --by <usuario>, --run-id <id>.
// Escribe en el Sanity real: Claude no lo ejecuta con --write.
import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {relative, resolve, sep} from 'node:path'
import {parseArgs} from 'node:util'
import type {Mutation} from '@sanity/client'
import {readJsonIfExists, writeJsonAtomic} from '../content/lib/files'
import {parseSiteVisit} from '../content/lib/site-visits'
import {getSanityClient, loadEnvironment} from '../sanity-client'
import type {CandidatesFile} from './lib/candidates'
import {assertExpectedPlan, buildPlanArtifact, draftId, draftMutations, draftWriter, planDraftWrites, sha256, type DocumentState, type SanityDoc} from './lib/draft-import'
import {fetchBytes} from './lib/http'
import {executeImports, planOwnImports, planStockImports, type OwnPhotosFile, type PlanResult, type PlannedImport, type TargetDocument} from './lib/importer'
import {stripMetadata} from './lib/strip'

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    own: {type: 'string'},
    write: {type: 'boolean', default: false},
    'plan-out': {type: 'string'},
    'expect-plan': {type: 'string'},
    by: {type: 'string'},
    'run-id': {type: 'string'},
  },
})

// Mismas reglas que validateActor/validatePlanHash de Content Lab (tools/content-lab/api/src/validation.ts).
const IDENTIFIER = /^\w[\w.@-]{0,99}$/
for (const option of ['by', 'run-id'] as const) {
  if (values[option] !== undefined && !IDENTIFIER.test(values[option])) throw new Error(`--${option} inválido.`)
}
if (values['expect-plan'] !== undefined && !/^[a-f0-9]{64}$/.test(values['expect-plan'])) throw new Error('--expect-plan debe ser un sha256.')
const plansRoot = resolve('content/images/plans')
const planOut = values['plan-out'] === undefined ? undefined : resolve(values['plan-out'])
if (planOut && !(planOut.startsWith(plansRoot + sep) && planOut.endsWith('.json'))) throw new Error('--plan-out debe ser un .json dentro de content/images/plans/.')

loadEnvironment()
const manualRoot = resolve('content/manual')
const {places} = await readJsonIfExists<{places: string[]}>(resolve('scripts/seo/place-names.json'), {places: []})
// raw: con la perspectiva por defecto (published) los borradores no se ven.
const client = getSanityClient({requireToken: values.write, perspective: 'raw'})

const resolveDocument = async (type: string, slug: string): Promise<TargetDocument | null> => {
  const document = await client.fetch<{_id: string; name?: string} | null>(
    `*[_type == $type && slug.current == $slug && !(_id in path("drafts.**"))][0]{_id, "name": coalesce(name, title)}`, {type, slug})
  return document?._id && document.name ? {type, id: document._id, slug, name: document.name} : null
}

const importedRecord = (item: PlannedImport, assetId: string, importedAt: string) => ({
  documentId: item.document.id, field: item.field, assetId, importedAt, mode: 'draft' as const, draftId: draftId(item.document.id),
  ...(values.by ? {importedBy: values.by} : {}), ...(values['run-id'] ? {runId: values['run-id']} : {}),
})

let filePath: string
let fileBytes: Buffer
let plan: PlanResult
let record: (done: Awaited<ReturnType<typeof executeImports>>) => Promise<void>

if (values.own) {
  filePath = resolve(values.own)
  fileBytes = await readFile(filePath)
  const own = JSON.parse(fileBytes.toString('utf8')) as OwnPhotosFile
  const visitPath = insideManual(own.visit)
  const {visit, issues} = parseSiteVisit(JSON.parse(await readFile(visitPath, 'utf8')), own.visit, (path) => existsSync(insideManual(path)))
  if (!visit) throw new Error(`La visita no valida:\n${issues.map((issue) => `- ${issue.path}: ${issue.message}`).join('\n')}`)
  const slug = visit.place.documentId ? await client.fetch<string | null>('*[_id == $id][0].slug.current', {id: visit.place.documentId}) : null
  plan = planOwnImports(own, visit, {places, slug: slug ?? 'foto'})
  record = async (done) => {
    own.imports.push(...done.map(({plan: item, assetId, importedAt}) => ({photo: item.key, ...importedRecord(item, assetId, importedAt)})))
    await writeJsonAtomic(filePath, own)
  }
} else {
  if (!positionals[0]) throw new Error('Indica el fichero de candidatas o --own <aprobación de fotos propias>.')
  filePath = resolve(positionals[0])
  fileBytes = await readFile(filePath)
  const file = JSON.parse(fileBytes.toString('utf8')) as CandidatesFile
  if (file.target.kind === 'document' && (file.target.type as string) === 'business') throw new Error('Las fichas de negocio no admiten imágenes de stock.')
  plan = await planStockImports(file, {places, resolveDocument})
  record = async (done) => {
    file.imports.push(...done.map(({plan: item, assetId, importedAt}) => ({candidateId: item.key, ...importedRecord(item, assetId, importedAt)})))
    await writeJsonAtomic(filePath, file)
  }
}

// Publicado y borrador de cada documento: decide añadir/sustituir, omite repetidas y detecta conflictos.
const states = new Map<string, DocumentState>()
for (const id of new Set(plan.imports.map((item) => item.document.id))) {
  const documents = await client.fetch<SanityDoc[]>('*[_id in [$id, $draft]]', {id, draft: draftId(id)})
  const published = documents.find((document) => document._id === id)
  if (published) states.set(id, {published, draft: documents.find((document) => document._id === draftId(id)) ?? null})
}
plan = planDraftWrites(plan, states)
const artifact = buildPlanArtifact({file: relative(process.cwd(), filePath), fileHash: sha256(fileBytes), plan, now: new Date()})
if (planOut) await writeJsonAtomic(planOut, artifact)

for (const issue of plan.issues) console.log(`ERROR ${issue}`)
for (const skipped of plan.skipped) console.log(`OMITIDA ${skipped}`)
for (const item of plan.imports) {
  console.log(`${values.write ? 'IMPORTA' : 'PLAN'} ${item.key} → ${item.document.type}:${item.document.slug}.${item.field} (${item.action === 'append' ? 'añade' : 'sustituye'}) · borrador ${item.draftExists ? 'abierto' : 'nuevo'} · ${item.credit}`)
}
console.log(`planHash ${artifact.planHash}`)
if (plan.imports.length === 0 && plan.issues.length === 0) {
  console.log(plan.skipped.length ? '\nNo hay nada nuevo que importar.' : '\nNo hay aprobaciones: añade entradas a «approvals» (o al fichero de --own) antes de importar.')
  process.exit(0)
}
if (plan.issues.length) {
  console.log('\nCorrige las aprobaciones antes de importar. No se ha escrito nada.')
  process.exit(1)
}
try {
  assertExpectedPlan(artifact, values['expect-plan'])
} catch (error) {
  console.log(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
if (!values.write) {
  console.log(`\nSimulación: ${plan.imports.length} imágenes. Añade --write para subirlas a Sanity como borrador.`)
  process.exit(0)
}

const writer = draftWriter({mutate: (mutations, options) => client.mutate(mutations as Mutation[], options)})
const done = await executeImports(plan.imports, {
  read: async (source) => source.kind === 'url' ? (await fetchBytes(source.url)).bytes : readFile(insideManual(source.path)),
  strip: stripMetadata,
  upload: async (bytes, item: PlannedImport) => {
    const asset = await client.assets.upload('image', bytes, {
      filename: item.filename,
      creditLine: item.credit,
      ...(item.value.origin === 'stock' && item.value.sourceUrl ? {source: {name: item.value.provider ?? 'stock', id: item.key, url: item.value.sourceUrl}} : {}),
    })
    return asset._id
  },
  commit: async (document, entries) => {
    await writer.mutate(draftMutations(states.get(document.id)!, entries), {visibility: 'sync'})
  },
  now: () => new Date(),
})
await record(done)
console.log(`\n${done.length} imágenes importadas como borrador. Revísalas y publícalas en el Studio.`)

function insideManual(path: string): string {
  const absolute = resolve(manualRoot, path)
  if (!absolute.startsWith(manualRoot + sep)) throw new Error(`Ruta fuera de content/manual/: ${path}`)
  return absolute
}
