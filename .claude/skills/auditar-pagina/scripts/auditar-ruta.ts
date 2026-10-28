// Audita el build completo con las reglas de seo:audit y muestra solo lo que afecta a una ruta.
// Uso: node --import tsx .claude/skills/auditar-pagina/scripts/auditar-ruta.ts <ruta> [--dist dist] [--baseline scripts/seo/baseline.json] [--site https://...]
import {resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {readJsonIfExists} from '../../../../scripts/content/lib/files'
import {auditSite, findingKey, type Finding} from '../../../../scripts/seo/lib/audit'
import {readDistPages, readSitemapOrigin} from '../../../../scripts/seo/lib/dist'

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    dist: {type: 'string', default: 'dist'},
    site: {type: 'string'},
    baseline: {type: 'string', default: 'scripts/seo/baseline.json'},
  },
})

const input = positionals[0]
if (!input) throw new Error('Indica la ruta a auditar, por ejemplo /restaurantes/mi-ficha/')
const route = normalizeRoute(input)

const dist = resolve(values.dist)
const origin = values.site ?? await readSitemapOrigin(dist)
if (!origin) throw new Error(`No se pudo deducir el origen del sitio desde ${values.dist}/sitemap-index.xml. Usa --site.`)
const pages = await readDistPages(dist)
if (pages.length === 0) throw new Error(`No hay páginas HTML en ${values.dist}. Ejecuta antes npm run build.`)

// La auditoría es de sitio completo: las huérfanas y los enlaces rotos dependen de las demás páginas.
const {places} = await readJsonIfExists<{places: string[]}>(resolve('scripts/seo/place-names.json'), {places: []})
const result = auditSite(pages, {origin, placeNames: places})
const entry = result.pages[route]
if (!entry) {
  console.error(`La ruta ${route} no existe en ${values.dist}. ¿Has ejecutado npm run build?`)
  process.exit(1)
}

const baseline = await readJsonIfExists<{accepted: Finding[]}>(resolve(values.baseline), {accepted: []})
const known = new Set(baseline.accepted.map(findingKey))
const errors = result.errors.filter((finding) => finding.route === route)
const warnings = result.warnings.filter((finding) => finding.route === route)
const fresh = errors.filter((finding) => !known.has(findingKey(finding)))

const format = (finding: Finding) => `[${finding.rule}${finding.zone ? `:${finding.zone}` : ''}] ${finding.detail}`
console.log(`${route} · ${entry.type}`)
console.log(`Entrantes (${entry.incoming.length}): ${entry.incoming.join(', ') || '—'}`)
console.log(`Salientes (${entry.outgoing.length}): ${entry.outgoing.join(', ') || '—'}\n`)
for (const error of errors) console.log(`ERROR ${format(error)} (${known.has(findingKey(error)) ? 'en línea base' : 'nuevo'})`)
for (const warning of warnings) console.log(`AVISO ${format(warning)}`)
console.log(`\n${errors.length} errores (${fresh.length} nuevos) · ${warnings.length} avisos · línea base ${values.baseline}`)

if (fresh.length > 0) process.exitCode = 1

function normalizeRoute(value: string): string {
  const path = new URL(value, 'https://ruta.invalid').pathname
  const last = path.split('/').pop() ?? ''
  return last === '' || last.endsWith('.html') ? path : `${path}/`
}
