import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'

/**
 * Enlaces contextuales entrantes según `content/reports/seo/crawl.json`, que escribe `seo:audit`.
 * `npm run build` hace dos pasadas (build → `seo:audit --graph-only` → build) para que la segunda lea
 * el grafo del mismo contenido. Sin archivo, o con uno anterior a `incomingContextual`, devuelve `null`.
 */
export const CRAWL_REPORT = 'content/reports/seo/crawl.json'

let graph: Record<string, {incomingContextual?: unknown}> | null | undefined

export function incomingContextualLinks(route: string): number | null {
  if (graph === undefined) graph = readGraph()
  const incoming = graph?.[route]?.incomingContextual
  return Array.isArray(incoming) ? incoming.length : null
}

function readGraph(): Record<string, {incomingContextual?: unknown}> | null {
  try {
    const report = JSON.parse(readFileSync(resolve(process.cwd(), CRAWL_REPORT), 'utf8')) as {pages?: Record<string, {incomingContextual?: unknown}>}
    return report.pages ?? null
  } catch {
    return null
  }
}
