import {resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {readJsonIfExists, writeJsonAtomic} from '../content/lib/files'
import {auditSite, findingKey, newFindings, type Finding} from './lib/audit'
import {readDistPages, readSitemapOrigin} from './lib/dist'

interface Baseline {
  description: string
  accepted: Finding[]
}

const {values} = parseArgs({
  options: {
    dist: {type: 'string', default: 'dist'},
    site: {type: 'string'},
    report: {type: 'string', default: 'content/reports/seo/crawl.json'},
    baseline: {type: 'string'},
    'update-baseline': {type: 'boolean', default: false},
    // Primera pasada de `npm run build`: solo escribe el grafo para que la segunda lo lea (src/lib/crawl-graph.ts).
    'graph-only': {type: 'boolean', default: false},
  },
})

const dist = resolve(values.dist)
const origin = values.site ?? await readSitemapOrigin(dist)
if (!origin) throw new Error(`No se pudo deducir el origen del sitio desde ${values.dist}/sitemap-index.xml. Usa --site.`)

const pages = await readDistPages(dist)
if (pages.length === 0) throw new Error(`No hay páginas HTML en ${values.dist}. Ejecuta antes npm run build.`)

const result = auditSite(pages, {origin})
const baselinePath = values.baseline ? resolve(values.baseline) : null
const baseline = baselinePath ? await readJsonIfExists<Baseline>(baselinePath, {description: '', accepted: []}) : null
const fresh = baseline ? newFindings(result.errors, baseline.accepted) : result.errors

if (values['graph-only']) {
  await writeJsonAtomic(resolve(values.report), {dist: values.dist, baseline: null, ...result, newErrors: []})
  console.log(`Grafo de enlaces de ${result.summary.pages} páginas: ${values.report}`)
  process.exit(0)
}

await writeJsonAtomic(resolve(values.report), {
  dist: values.dist,
  baseline: values.baseline ?? null,
  ...result,
  newErrors: fresh,
})

if (values['update-baseline']) {
  const target = baselinePath ?? resolve('scripts/seo/baseline.json')
  await writeJsonAtomic(target, {
    description: 'Errores conocidos de seo:audit aceptados temporalmente. El hook Stop solo bloquea los que no están aquí. Cada entrada debe desaparecer cuando se corrija.',
    accepted: result.errors,
  } satisfies Baseline)
  console.log(`Línea base actualizada con ${result.errors.length} errores: ${target}`)
}

const known = new Set(baseline?.accepted.map(findingKey) ?? [])
const format = (finding: Finding) => `${finding.route} [${finding.rule}${finding.zone ? `:${finding.zone}` : ''}] ${finding.detail}`
for (const error of result.errors) console.log(`ERROR ${format(error)}${known.has(findingKey(error)) ? ' (en línea base)' : ''}`)
for (const warning of result.warnings) console.log(`AVISO ${format(warning)}`)
console.log(`\n${result.summary.pages} páginas · ${result.summary.errors} errores${baseline ? ` (${fresh.length} nuevos)` : ''} · ${result.summary.warnings} avisos · origen ${result.origin}`)
console.log(`Informe: ${values.report}`)

if (fresh.length > 0 && !values['update-baseline']) process.exitCode = 1
