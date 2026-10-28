// Busca imágenes candidatas para un documento de Sanity o un término y las deja en
// content/images/candidates/<slug>.json para que David las revise. No aprueba ni publica nada.
//   npm run images:find -- --doc beach:playa-levante [--category "Category:Playa de Levante (Benidorm)"] [--radius 500]
//   npm run images:find -- --term "atardecer mar Mediterráneo"
import {resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {readJsonIfExists, writeJsonAtomic} from '../content/lib/files'
import {getSanityClient, loadEnvironment} from '../sanity-client'
import {createJsonCache} from './lib/cache'
import {candidatesSlug, isStockDocumentType, mergeCandidates, type CandidatesFile, type CandidateTarget} from './lib/candidates'
import {fetchJson} from './lib/http'
import {searchCandidates} from './lib/search'

const {values} = parseArgs({
  options: {
    doc: {type: 'string'},
    term: {type: 'string'},
    category: {type: 'string'},
    radius: {type: 'string'},
    out: {type: 'string', default: 'content/images/candidates'},
  },
})

if (Boolean(values.doc) === Boolean(values.term)) throw new Error('Usa --doc <tipo>:<slug> o --term "<término>", no los dos.')
if (values.category && !values.category.startsWith('Category:')) throw new Error('--category debe empezar por «Category:».')

loadEnvironment()
const target: CandidateTarget = values.doc ? await documentTarget(values.doc) : {kind: 'term', term: values.term!.trim()}
const cache = createJsonCache(resolve('content/images/.cache'))
const file = await searchCandidates(target, {
  ...(values.category ? {category: values.category} : {}),
  ...(values.radius ? {radiusMeters: Number(values.radius)} : {}),
}, {
  keys: {pixabay: process.env.PIXABAY_API_KEY, pexels: process.env.PEXELS_API_KEY},
  now: () => new Date(),
  async getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const cached = await cache.get<T>(url)
    if (cached !== undefined) return cached
    const value = await fetchJson<T>(url, headers ? {headers} : {})
    await cache.set(url, value)
    return value
  },
})

const path = resolve(values.out, `${candidatesSlug(target)}.json`)
const merged = mergeCandidates(await readJsonIfExists<CandidatesFile | null>(path, null), file)
await writeJsonAtomic(path, merged)
for (const warning of merged.warnings) console.log(`AVISO ${warning}`)
console.log(`${merged.candidates.length} candidatas (${merged.candidates.filter((item) => item.use === 'lugar').length} con base de lugar) · ${merged.rejected.length} descartadas · ${path}`)
console.log('Aprueba añadiendo entradas a «approvals» y luego: npm run images:import -- ' + path)

async function documentTarget(value: string): Promise<CandidateTarget> {
  const [type, slug] = value.split(':')
  if (type === 'business') throw new Error('Las fichas de negocio no admiten imágenes de stock: solo fotos propias.')
  if (!isStockDocumentType(type) || !slug) throw new Error('--doc debe ser place|area|beach|article:<slug>.')
  const client = getSanityClient({requireToken: false})
  const document = await client.fetch<{_id: string; name?: string; location?: {lat?: number; lng?: number}} | null>(
    `*[_type == $type && slug.current == $slug && !(_id in path("drafts.**"))][0]{_id, "name": coalesce(name, title), "location": coalesce(location, center)}`,
    {type, slug},
  )
  if (!document?._id || !document.name) throw new Error(`No existe ${type}:${slug} publicado en Sanity.`)
  const {lat, lng} = document.location ?? {}
  return {kind: 'document', type, id: document._id, slug, name: document.name, ...(typeof lat === 'number' && typeof lng === 'number' ? {coordinates: {lat, lng}} : {})}
}
