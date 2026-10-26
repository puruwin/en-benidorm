import {readFile, readdir} from 'node:fs/promises'
import {join, relative} from 'node:path'
import {routeFromFile, type SourcePage} from './audit'

/** Lee todos los `.html` de un build estático, ordenados por ruta. */
export async function readDistPages(dist: string): Promise<SourcePage[]> {
  const entries = await readdir(dist, {recursive: true, withFileTypes: true})
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => relative(dist, join(entry.parentPath, entry.name)))
    .sort()
  const pages = await Promise.all(files.map(async (file) => ({route: routeFromFile(file), html: await readFile(join(dist, file), 'utf8')})))
  return pages.sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0))
}

/** Origen del sitio según el sitemap que genera el mismo build (`site` de astro.config.mjs). */
export async function readSitemapOrigin(dist: string): Promise<string | null> {
  for (const name of ['sitemap-index.xml', 'sitemap-0.xml']) {
    try {
      const xml = await readFile(join(dist, name), 'utf8')
      const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(xml)?.[1]
      if (loc) return new URL(loc).origin
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return null
}
