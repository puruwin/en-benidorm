import {parse} from 'parse5'

export type LinkZone = 'menu' | 'footer' | 'body'
export type PageType = 'indexable' | 'noindex' | 'redirect' | 'not-found'

export type ErrorRule =
  | 'broken-link'
  | 'link-to-redirect'
  | 'orphan'
  | 'h1-missing'
  | 'h1-multiple'
  | 'title-missing'
  | 'title-duplicate'
  | 'description-missing'
  | 'description-duplicate'
  | 'canonical-mismatch'
  | 'jsonld-invalid'
  | 'unreviewed-verified'
  | 'facts-without-sources'

export type WarningRule = 'img-missing-alt' | 'title-too-long'

export interface Finding<Rule extends string = ErrorRule | WarningRule> {
  rule: Rule
  route: string
  detail: string
  zone?: LinkZone
}

export interface SourcePage {
  route: string
  html: string
}

export interface ParsedLink {
  target: string
  zone: LinkZone
}

export interface ParsedPage {
  route: string
  type: PageType
  redirectTo: string | null
  title: string | null
  description: string | null
  canonical: string | null
  h1Count: number
  links: ParsedLink[]
  jsonLdErrors: string[]
  verifiedClaims: string[]
  hasHumanReview: boolean
  hasPrice: boolean
  hasHours: boolean
  hasSources: boolean
  imagesWithoutAlt: string[]
}

export interface PageGraphEntry {
  type: PageType
  outgoing: string[]
  incoming: string[]
}

export interface AuditResult {
  origin: string
  summary: {pages: number; errors: number; warnings: number}
  pages: Record<string, PageGraphEntry>
  errors: Array<Finding<ErrorRule>>
  warnings: Array<Finding<WarningRule>>
}

export const MIN_INCOMING_LINKS = 2
export const MAX_TITLE_LENGTH = 60

const VERIFIED = /\bverificadas?\b/i
const PRICE = /\d+(?:[.,]\d{1,2})?\s?€|€\s?\d/
const TIME_RANGE = /\b\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}\b/
const HOURS_HEADING = /^horarios?$/i
const HIDDEN_TEXT = new Set(['script', 'style', 'template', 'noscript'])
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

interface HtmlNode {
  nodeName?: string
  tagName?: string
  value?: string
  attrs?: Array<{name: string; value: string}>
  childNodes?: HtmlNode[]
  parentNode?: HtmlNode
}

/** `dist/a/index.html` → `/a/`; `dist/404.html` → `/404.html`. */
export function routeFromFile(relativePath: string): string {
  const path = relativePath.split('\\').join('/').replace(/^\/+/, '')
  if (path === 'index.html') return '/'
  if (path.endsWith('/index.html')) return `/${path.slice(0, -'index.html'.length)}`
  return `/${path}`
}

export function findingKey(finding: Finding<string>): string {
  return [finding.rule, finding.route, finding.zone ?? '', finding.detail].join('|')
}

export function parsePage(source: SourcePage, origin: string): ParsedPage {
  const document = parse(source.html) as unknown as HtmlNode
  const elements = descendants(document)
  const byTag = (tag: string) => elements.filter((node) => node.tagName === tag)
  const body = byTag('body')[0] ?? document
  const main = byTag('main')[0] ?? body

  const refresh = byTag('meta').find((node) => attr(node, 'http-equiv')?.toLowerCase() === 'refresh')
  const redirectTarget = refresh ? refreshTarget(attr(refresh, 'content') ?? '') : null
  const redirectTo = redirectTarget === null ? null : normalizeInternal(redirectTarget, source.route, origin) ?? redirectTarget
  const robots = byTag('meta').find((node) => attr(node, 'name')?.toLowerCase() === 'robots')
  const noindex = /\bnoindex\b/i.test(attr(robots, 'content') ?? '')
  const type: PageType = refresh ? 'redirect' : source.route === '/404.html' ? 'not-found' : noindex ? 'noindex' : 'indexable'

  const titleNode = byTag('title')[0]
  const title = titleNode ? collapse(textOf(titleNode, false)) || null : null
  const descriptionNode = byTag('meta').find((node) => attr(node, 'name')?.toLowerCase() === 'description')
  const description = collapse(attr(descriptionNode, 'content') ?? '') || null
  const canonicalNode = byTag('link').find((node) => (attr(node, 'rel') ?? '').toLowerCase().split(/\s+/).includes('canonical'))
  const canonical = attr(canonicalNode, 'href') ?? null

  const links: ParsedLink[] = []
  for (const anchor of byTag('a')) {
    const href = attr(anchor, 'href')
    if (href === null) continue
    const target = normalizeInternal(href, source.route, origin)
    if (target !== null) links.push({target, zone: zoneOf(anchor)})
  }

  const jsonLdErrors: string[] = []
  byTag('script').filter((node) => (attr(node, 'type') ?? '').toLowerCase() === 'application/ld+json').forEach((node, index) => {
    try {
      JSON.parse(textOf(node, false))
    } catch (error) {
      jsonLdErrors.push(`bloque ${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  const verifiedClaims = textBlocks(body).filter((text) => VERIFIED.test(text))
  const mainText = collapse(textOf(main, true))
  const mainElements = main === document ? elements : descendants(main)

  return {
    route: source.route,
    type,
    redirectTo,
    title,
    description,
    canonical,
    h1Count: byTag('h1').length,
    links,
    jsonLdErrors,
    verifiedClaims,
    hasHumanReview: elements.some((node) => attr(node, 'data-human-review') !== null),
    hasPrice: PRICE.test(mainText),
    hasHours: TIME_RANGE.test(mainText) || mainElements.some((node) => HEADINGS.has(node.tagName ?? '') && HOURS_HEADING.test(collapse(textOf(node, true)))),
    hasSources: elements.some((node) => attr(node, 'data-seo-sources') !== null || (node.tagName === 'section' && attr(node, 'aria-labelledby') === 'sources-title')),
    imagesWithoutAlt: byTag('img').filter((node) => attr(node, 'alt') === null).map((node) => attr(node, 'src') ?? '(sin src)'),
  }
}

export function auditSite(sources: readonly SourcePage[], options: {origin: string}): AuditResult {
  const origin = new URL(options.origin).origin
  const pages = [...sources].sort((a, b) => compare(a.route, b.route)).map((source) => parsePage(source, origin))
  const byRoute = new Map(pages.map((page) => [page.route, page]))
  const resolve = (target: string) => byRoute.get(target) ?? (target.endsWith('/') ? byRoute.get(`${target.slice(0, -1)}.html`) : undefined)

  const errors: Array<Finding<ErrorRule>> = []
  const warnings: Array<Finding<WarningRule>> = []
  const incoming = new Map<string, Set<string>>(pages.map((page) => [page.route, new Set<string>()]))
  const graph: Record<string, PageGraphEntry> = {}

  for (const page of pages) {
    graph[page.route] = {type: page.type, outgoing: unique(page.links.map((link) => link.target).filter((target) => target !== page.route)), incoming: []}
    if (page.type === 'redirect') continue
    const passesLinks = page.type === 'indexable' || page.type === 'noindex'
    const reported = new Set<string>()
    for (const link of page.links) {
      const target = resolve(link.target)
      if (target && target.route !== page.route && passesLinks) incoming.get(target.route)?.add(page.route)
      const finding: Finding<ErrorRule> | null = !target
        ? {rule: 'broken-link', route: page.route, zone: link.zone, detail: link.target}
        : target.type === 'redirect'
          ? {rule: 'link-to-redirect', route: page.route, zone: link.zone, detail: `${link.target} → ${target.redirectTo ?? '(sin destino)'}`}
          : null
      if (finding && !reported.has(findingKey(finding))) {
        reported.add(findingKey(finding))
        errors.push(finding)
      }
    }
  }

  for (const page of pages) {
    const entry = graph[page.route]
    if (entry) entry.incoming = unique([...(incoming.get(page.route) ?? [])])
    if (page.type === 'redirect') continue
    const push = (rule: ErrorRule, detail: string) => errors.push({rule, route: page.route, detail})

    if (page.type === 'indexable' && page.route !== '/' && (entry?.incoming.length ?? 0) < MIN_INCOMING_LINKS) {
      push('orphan', `${entry?.incoming.length ?? 0} enlaces entrantes (mínimo ${MIN_INCOMING_LINKS})${entry?.incoming.length ? `: ${entry.incoming.join(', ')}` : ''}`)
    }
    if (page.h1Count === 0) push('h1-missing', 'la página no tiene <h1>')
    if (page.h1Count > 1) push('h1-multiple', `${page.h1Count} elementos <h1>`)
    if (!page.title) push('title-missing', 'falta <title>')
    if (!page.description) push('description-missing', 'falta <meta name="description">')
    if (page.type === 'indexable') {
      const expected = `${origin}${page.route}`
      if (page.canonical !== expected) push('canonical-mismatch', `canonical ${page.canonical ?? '(ausente)'}; esperado ${expected}`)
    }
    for (const error of page.jsonLdErrors) push('jsonld-invalid', error)
    if (!page.hasHumanReview) for (const claim of unique(page.verifiedClaims)) push('unreviewed-verified', `«${claim}» sin [data-human-review]`)
    if ((page.hasPrice || page.hasHours) && !page.hasSources) {
      push('facts-without-sources', `${[page.hasPrice && 'precios', page.hasHours && 'horarios'].filter(Boolean).join(' y ')} sin el componente Sources`)
    }

    for (const src of unique(page.imagesWithoutAlt)) warnings.push({rule: 'img-missing-alt', route: page.route, detail: src})
    if (page.title && [...page.title].length > MAX_TITLE_LENGTH) {
      warnings.push({rule: 'title-too-long', route: page.route, detail: `${[...page.title].length} caracteres: «${page.title}»`})
    }
  }

  const indexable = pages.filter((page) => page.type === 'indexable')
  errors.push(...duplicates(indexable, 'title', 'title-duplicate'), ...duplicates(indexable, 'description', 'description-duplicate'))

  const sortedErrors = sortFindings(errors)
  const sortedWarnings = sortFindings(warnings)
  return {
    origin,
    summary: {pages: pages.length, errors: sortedErrors.length, warnings: sortedWarnings.length},
    pages: graph,
    errors: sortedErrors,
    warnings: sortedWarnings,
  }
}

/** Devuelve los errores que no están en la línea base aceptada. */
export function newFindings<Rule extends string>(findings: ReadonlyArray<Finding<Rule>>, baseline: ReadonlyArray<Finding<string>>): Array<Finding<Rule>> {
  const known = new Set(baseline.map(findingKey))
  return findings.filter((finding) => !known.has(findingKey(finding)))
}

function duplicates(pages: readonly ParsedPage[], field: 'title' | 'description', rule: ErrorRule): Array<Finding<ErrorRule>> {
  const groups = new Map<string, string[]>()
  for (const page of pages) {
    const value = page[field]
    if (value) groups.set(value, [...(groups.get(value) ?? []), page.route])
  }
  const findings: Array<Finding<ErrorRule>> = []
  for (const [value, routes] of groups) {
    if (routes.length < 2) continue
    for (const route of routes) findings.push({rule, route, detail: `«${value}» compartido con ${routes.filter((other) => other !== route).join(', ')}`})
  }
  return findings
}

function normalizeInternal(href: string, route: string, origin: string): string | null {
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith('#') || /^(?:mailto|tel|javascript|data):/i.test(trimmed)) return null
  let url: URL
  try {
    url = new URL(trimmed, `${origin}${route}`)
  } catch {
    return null
  }
  if (url.origin !== origin) return null
  const path = url.pathname
  const last = path.split('/').pop() ?? ''
  if (last.includes('.') && !last.endsWith('.html')) return null
  return last === '' || last.endsWith('.html') ? path : `${path}/`
}

function refreshTarget(content: string): string | null {
  const match = /url\s*=\s*['"]?([^'"]+)['"]?/i.exec(content)
  return match?.[1]?.trim() || null
}

function zoneOf(node: HtmlNode): LinkZone {
  let zone: LinkZone = 'body'
  for (let current = node.parentNode; current; current = current.parentNode) {
    if (current.tagName === 'footer') return 'footer'
    if (current.tagName === 'header' || current.tagName === 'nav') zone = 'menu'
  }
  return zone
}

function descendants(root: HtmlNode): HtmlNode[] {
  const result: HtmlNode[] = []
  const stack = [...(root.childNodes ?? [])].reverse()
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (node.tagName) result.push(node)
    if (node.childNodes) for (let index = node.childNodes.length - 1; index >= 0; index -= 1) stack.push(node.childNodes[index] as HtmlNode)
  }
  return result
}

function textOf(node: HtmlNode, visibleOnly: boolean): string {
  if (node.nodeName === '#text') return node.value ?? ''
  if (visibleOnly && HIDDEN_TEXT.has(node.tagName ?? '')) return ''
  return (node.childNodes ?? []).map((child) => textOf(child, visibleOnly)).join(visibleOnly ? ' ' : '')
}

/** Texto visible agrupado por nodo de texto, para citar el contexto de «verificada». */
function textBlocks(root: HtmlNode): string[] {
  const blocks: string[] = []
  const visit = (node: HtmlNode) => {
    if (HIDDEN_TEXT.has(node.tagName ?? '')) return
    if (node.nodeName === '#text') {
      const text = collapse(node.value ?? '')
      if (text) blocks.push(text)
      return
    }
    for (const child of node.childNodes ?? []) visit(child)
  }
  visit(root)
  return blocks
}

function attr(node: HtmlNode | undefined, name: string): string | null {
  return node?.attrs?.find((item) => item.name === name)?.value ?? null
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compare)
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function sortFindings<Rule extends string>(findings: ReadonlyArray<Finding<Rule>>): Array<Finding<Rule>> {
  return [...findings].sort((a, b) => compare(a.route, b.route) || compare(a.rule, b.rule) || compare(a.zone ?? '', b.zone ?? '') || compare(a.detail, b.detail))
}
