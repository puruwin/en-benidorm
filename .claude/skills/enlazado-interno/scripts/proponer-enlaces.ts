// Propone enlaces contextuales hub ↔ ficha y ficha ↔ ficha cercana a partir del informe de seo:audit.
// Uso: node --import tsx .claude/skills/enlazado-interno/scripts/proponer-enlaces.ts [--report content/reports/seo/crawl.json] [--dist dist] [--route /ruta/]
import {readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {parse} from 'parse5'
import type {AuditResult} from '../../../../scripts/seo/lib/audit'
import {classifyRoute, proposeLinks} from '../../../../scripts/seo/lib/links'

const {values} = parseArgs({
  options: {
    report: {type: 'string', default: 'content/reports/seo/crawl.json'},
    dist: {type: 'string'},
    route: {type: 'string'},
  },
})

let report: AuditResult
try {
  report = JSON.parse(await readFile(resolve(values.report), 'utf8')) as AuditResult
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  console.error(`No existe ${values.report}. Ejecuta antes npm run build y npm run seo:audit.`)
  process.exit(1)
}

const zones = values.dist ? await readZones(resolve(values.dist), Object.keys(report.pages)) : undefined
const route = values.route
const proposals = proposeLinks(report.pages, zones ? {zones} : {}).filter((proposal) => !route || proposal.from === route || proposal.to === route)

const orphans = report.errors.filter((error) => error.rule === 'orphan').map((error) => error.route)
console.log(`Huérfanas según ${values.report}: ${orphans.join(', ') || 'ninguna'}`)
if (zones) console.log(`Zonas leídas de ${values.dist}: ${Object.entries(zones).map(([page, zone]) => `${page} (${zone})`).join(', ') || 'ninguna'}`)
console.log('')
if (proposals.length === 0) {
  console.log('Sin propuestas.')
} else {
  console.log('| Desde | Hacia | Motivo | Detalle | Destino bajo mínimo |')
  console.log('| --- | --- | --- | --- | --- |')
  for (const proposal of proposals) {
    console.log(`| ${proposal.from} | ${proposal.to} | ${proposal.reason} | ${proposal.detail} | ${proposal.targetBelowMinimum ? 'sí' : 'no'} |`)
  }
}

const uncovered = orphans.filter((orphan) => (!route || orphan === route) && !proposals.some((proposal) => proposal.to === orphan))
if (uncovered.length > 0) console.log(`\nHuérfanas sin propuesta (no tienen relación hub ↔ ficha ni ficha cercana; decide a mano): ${uncovered.join(', ')}`)

/** Zona de cada ficha según el `<dt>Zona</dt><dd>…</dd>` que pinta `src/pages/restaurantes/[slug].astro`. */
async function readZones(dist: string, routes: string[]): Promise<Record<string, string>> {
  const zones: Record<string, string> = {}
  for (const page of routes.filter((candidate) => classifyRoute(candidate) === 'ficha')) {
    let html: string
    try {
      html = await readFile(join(dist, page, 'index.html'), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const zone = zoneOf(parse(html) as unknown as HtmlNode)
    if (zone) zones[page] = zone
  }
  return zones
}

interface HtmlNode {
  nodeName?: string
  tagName?: string
  value?: string
  childNodes?: HtmlNode[]
}

function zoneOf(root: HtmlNode): string | null {
  const stack: HtmlNode[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    const children = node.childNodes ?? []
    if (node.tagName === 'div') {
      const dt = children.find((child) => child.tagName === 'dt')
      const dd = children.find((child) => child.tagName === 'dd')
      if (dt && dd && text(dt) === 'Zona') return text(dd) || null
    }
    stack.push(...children)
  }
  return null
}

function text(node: HtmlNode): string {
  if (node.nodeName === '#text') return node.value ?? ''
  return (node.childNodes ?? []).map(text).join('').replace(/\s+/g, ' ').trim()
}
