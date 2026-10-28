// Importa a Sanity las imágenes que David ha aprobado. Por defecto solo muestra el plan; con --write
// descarga el original, quita EXIF, lo sube como asset con su procedencia y lo asigna al documento.
//   npm run images:import -- content/images/candidates/beach-playa-levante.json [--write]
//   npm run images:import -- --own content/images/own/2026-10-20-playa-levante.json [--write]
// Escribe en el Sanity real: Claude no lo ejecuta con --write.
import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {resolve, sep} from 'node:path'
import {parseArgs} from 'node:util'
import {readJson, readJsonIfExists, writeJsonAtomic} from '../content/lib/files'
import {parseSiteVisit} from '../content/lib/site-visits'
import {getSanityClient, loadEnvironment} from '../sanity-client'
import type {CandidatesFile} from './lib/candidates'
import {fetchBytes} from './lib/http'
import {executeImports, planOwnImports, planStockImports, type OwnPhotosFile, type PlanResult, type PlannedImport, type TargetDocument} from './lib/importer'
import {stripMetadata} from './lib/strip'

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    own: {type: 'string'},
    write: {type: 'boolean', default: false},
  },
})

loadEnvironment()
const manualRoot = resolve('content/manual')
const {places} = await readJsonIfExists<{places: string[]}>(resolve('scripts/seo/place-names.json'), {places: []})
const client = getSanityClient({requireToken: values.write})

const resolveDocument = async (type: string, slug: string): Promise<TargetDocument | null> => {
  const document = await client.fetch<{_id: string; name?: string} | null>(
    `*[_type == $type && slug.current == $slug && !(_id in path("drafts.**"))][0]{_id, "name": coalesce(name, title)}`, {type, slug})
  return document?._id && document.name ? {type, id: document._id, slug, name: document.name} : null
}

let plan: PlanResult
let record: (done: Awaited<ReturnType<typeof executeImports>>) => Promise<void>

if (values.own) {
  const ownPath = resolve(values.own)
  const own = await readJson<OwnPhotosFile>(ownPath)
  const visitPath = insideManual(own.visit)
  const {visit, issues} = parseSiteVisit(JSON.parse(await readFile(visitPath, 'utf8')), own.visit, (path) => existsSync(insideManual(path)))
  if (!visit) throw new Error(`La visita no valida:\n${issues.map((issue) => `- ${issue.path}: ${issue.message}`).join('\n')}`)
  const slug = visit.place.documentId ? await client.fetch<string | null>('*[_id == $id][0].slug.current', {id: visit.place.documentId}) : null
  plan = planOwnImports(own, visit, {places, slug: slug ?? 'foto'})
  record = async (done) => {
    own.imports.push(...done.map(({plan: item, assetId, importedAt}) => ({photo: item.key, documentId: item.document.id, field: item.field, assetId, importedAt})))
    await writeJsonAtomic(ownPath, own)
  }
} else {
  const candidatesPath = positionals[0]
  if (!candidatesPath) throw new Error('Indica el fichero de candidatas o --own <aprobación de fotos propias>.')
  const file = await readJson<CandidatesFile>(resolve(candidatesPath))
  if (file.target.kind === 'document' && (file.target.type as string) === 'business') throw new Error('Las fichas de negocio no admiten imágenes de stock.')
  plan = await planStockImports(file, {places, resolveDocument})
  record = async (done) => {
    file.imports.push(...done.map(({plan: item, assetId, importedAt}) => ({candidateId: item.key, documentId: item.document.id, field: item.field, assetId, importedAt})))
    await writeJsonAtomic(resolve(candidatesPath), file)
  }
}

// El patch va al documento publicado: si hay un borrador abierto, publicarlo después borraría la imagen.
for (const id of new Set(plan.imports.map((item) => item.document.id))) {
  if (await client.fetch<string | null>('*[_id == $draft][0]._id', {draft: `drafts.${id}`})) plan.issues.push(`${id} tiene un borrador abierto en el Studio: publícalo o descártalo antes de importar.`)
}

for (const issue of plan.issues) console.log(`ERROR ${issue}`)
for (const skipped of plan.skipped) console.log(`OMITIDA ${skipped}`)
for (const item of plan.imports) console.log(`${values.write ? 'IMPORTA' : 'PLAN'} ${item.key} → ${item.document.type}:${item.document.slug}.${item.field} · ${item.credit}`)
if (plan.issues.length) {
  console.log('\nCorrige las aprobaciones antes de importar. No se ha escrito nada.')
  process.exit(1)
}
if (!values.write) {
  console.log(`\nSimulación: ${plan.imports.length} imágenes. Añade --write para subirlas a Sanity.`)
  process.exit(0)
}

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
  patch: async (item, value) => {
    const patch = client.patch(item.document.id)
    await (item.isArray ? patch.setIfMissing({[item.field]: []}).append(item.field, [value]) : patch.set({[item.field]: value})).commit()
  },
  now: () => new Date(),
})
await record(done)
console.log(`\n${done.length} imágenes importadas.`)

function insideManual(path: string): string {
  const absolute = resolve(manualRoot, path)
  if (!absolute.startsWith(manualRoot + sep)) throw new Error(`Ruta fuera de content/manual/: ${path}`)
  return absolute
}
