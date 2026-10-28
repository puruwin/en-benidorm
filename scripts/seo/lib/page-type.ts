import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {parse} from 'parse5'

export type PageType = 'indexable' | 'noindex' | 'redirect' | 'not-found'

interface HtmlNode {
  tagName?: string
  attrs?: Array<{name: string; value: string}>
  childNodes?: HtmlNode[]
}

/**
 * Tipo de una página según su HTML ya renderizado: meta refresh → `redirect`, `/404.html` → `not-found`,
 * robots con `noindex` → `noindex`. Lo usan `seo:audit` y el filtro del sitemap, así que los dos leen la
 * decisión que SeoHead tomó con `isIndexable`, sin repetir la regla.
 */
export function pageType(route: string, html: string): PageType {
  const metas = metaElements(parse(html) as unknown as HtmlNode)
  if (metas.some((node) => attr(node, 'http-equiv')?.toLowerCase() === 'refresh')) return 'redirect'
  if (route === '/404.html') return 'not-found'
  const robots = metas.find((node) => attr(node, 'name')?.toLowerCase() === 'robots')
  return /\bnoindex\b/i.test(attr(robots, 'content') ?? '') ? 'noindex' : 'indexable'
}

/** `/a/` → `a/index.html`; `/404.html` → `404.html`. Inversa de `routeFromFile`. */
export function distFileForRoute(route: string): string {
  const path = route.replace(/^\/+/, '')
  return path === '' || path.endsWith('/') ? `${path}index.html` : path
}

/**
 * Filtro de `@astrojs/sitemap`: la URL entra solo si su HTML existe en `dist` y es `indexable`. El
 * integration lo llama en `astro:build:done`, con el HTML ya escrito; cada pasada de `npm run build`
 * reescribe el sitemap y manda la segunda.
 */
export function sitemapIncludes(url: string, dist: string): boolean {
  const route = new URL(url).pathname
  const file = join(dist, distFileForRoute(route))
  if (!existsSync(file)) return false
  return pageType(route, readFileSync(file, 'utf8')) === 'indexable'
}

function metaElements(root: HtmlNode): HtmlNode[] {
  const result: HtmlNode[] = []
  // En orden de documento, como `descendants` de audit.ts: manda el primer robots.
  const stack = [...(root.childNodes ?? [])].reverse()
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (node.tagName === 'meta') result.push(node)
    if (node.childNodes) stack.push(...[...node.childNodes].reverse())
  }
  return result
}

function attr(node: HtmlNode | undefined, name: string): string | null {
  return node?.attrs?.find((item) => item.name === name)?.value ?? null
}
