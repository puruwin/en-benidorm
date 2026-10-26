// Lista, por página, los datos con fecha de consulta de más de N días (90 por defecto).
// Uso: node --import tsx scripts/seo/stale-data.ts [--dist dist] [--max-age 90] [--today AAAA-MM-DD]
import {readdir, readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {readDistPages} from './lib/dist'
import {artifactDates, extractPageDates, MAX_AGE_DAYS, staleItems, type DatedItem} from './lib/freshness'

const ARTIFACT_DIRS = ['content/generated/businesses', 'content/generated/comparisons']

const {values} = parseArgs({
  options: {
    dist: {type: 'string', default: 'dist'},
    'max-age': {type: 'string', default: String(MAX_AGE_DAYS)},
    today: {type: 'string', default: new Date().toISOString().slice(0, 10)},
  },
})

const maxAge = Number(values['max-age'])
if (!Number.isInteger(maxAge) || maxAge < 0) throw new Error('--max-age debe ser un entero no negativo.')

const pages = await readDistPages(resolve(values.dist))
if (pages.length === 0) throw new Error(`No hay páginas HTML en ${values.dist}. Ejecuta antes npm run build.`)
const published = new Set(pages.map((page) => page.route))

const items: DatedItem[] = pages.flatMap((page) => extractPageDates(page.route, page.html))
for (const dir of ARTIFACT_DIRS) {
  for (const file of (await readdir(resolve(dir))).filter((name) => name.endsWith('.json')).sort()) {
    items.push(...artifactDates(JSON.parse(await readFile(join(resolve(dir), file), 'utf8')) as Record<string, unknown>))
  }
}

const stale = staleItems(items, values.today, maxAge)
console.log(`Datos con fecha de más de ${maxAge} días a ${values.today} (${items.length} fechas revisadas en ${pages.length} páginas y ${ARTIFACT_DIRS.join(', ')}).\n`)
if (stale.length === 0) {
  console.log('Ninguno.')
} else {
  let current = ''
  for (const item of stale) {
    if (item.route !== current) {
      current = item.route
      console.log(`${current === stale[0]!.route ? '' : '\n'}### ${current}${published.has(current) ? '' : ' (no está en el build)'}\n`)
      console.log('| Dato | Fuente | Fecha | Días | Origen |')
      console.log('| --- | --- | --- | --- | --- |')
    }
    const origin = item.origin === 'artefacto' ? 'artefacto (no visible)' : 'página'
    console.log(`| ${cell(item.label)} | ${cell(item.source)} | ${item.date} | ${item.ageDays ?? 'sin fecha válida'} | ${origin} |`)
  }
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}
