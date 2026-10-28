import assert from 'node:assert/strict'
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import test from 'node:test'
import {readSitemapUrls} from './lib/dist'
import {distFileForRoute, pageType, sitemapIncludes} from './lib/page-type'

const html = (head: string) => `<!doctype html><html><head><title>T</title>${head}</head><body><h1>T</h1></body></html>`
const indexable = html('<meta name="robots" content="index,follow">')
const noindex = html('<meta name="robots" content="noindex,follow">')
const redirect = html('<meta http-equiv="refresh" content="0;url=/a/"><meta name="robots" content="index,follow">')

async function withDist(files: Record<string, string>, run: (dist: string) => Promise<void> | void) {
  const dist = await mkdtemp(join(tmpdir(), 'sitemap-'))
  try {
    for (const [file, content] of Object.entries(files)) {
      await mkdir(dirname(join(dist, file)), {recursive: true})
      await writeFile(join(dist, file), content)
    }
    await run(dist)
  } finally {
    await rm(dist, {recursive: true, force: true})
  }
}

test('pageType lee el robots renderizado, el refresh y la 404', () => {
  assert.equal(pageType('/a/', indexable), 'indexable')
  assert.equal(pageType('/a/', html('')), 'indexable')
  assert.equal(pageType('/a/', noindex), 'noindex')
  assert.equal(pageType('/a/', redirect), 'redirect')
  assert.equal(pageType('/404.html', indexable), 'not-found')
})

test('distFileForRoute es la inversa de routeFromFile', () => {
  assert.equal(distFileForRoute('/'), 'index.html')
  assert.equal(distFileForRoute('/donde-comer/arroces/'), 'donde-comer/arroces/index.html')
  assert.equal(distFileForRoute('/404.html'), '404.html')
})

test('sitemapIncludes solo deja entrar páginas indexables con HTML en dist', () => withDist({
  'index.html': indexable,
  'a/index.html': indexable,
  'ficha/index.html': noindex,
  'antigua/index.html': redirect,
  '404.html': indexable,
}, (dist) => {
  const included = ['/', '/a/', '/ficha/', '/antigua/', '/404.html', '/no-existe/'].filter((route) => sitemapIncludes(`https://ejemplo.test${route}`, dist))
  assert.deepEqual(included, ['/', '/a/'])
}))

test('readSitemapUrls sigue el índice hasta los sitemaps del build', () => withDist({
  'sitemap-index.xml': '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://ejemplo.test/sitemap-0.xml</loc></sitemap><sitemap><loc>https://ejemplo.test/sitemap-1.xml</loc></sitemap></sitemapindex>',
  'sitemap-0.xml': '<?xml version="1.0"?><urlset><url><loc>https://ejemplo.test/</loc></url><url><loc>https://ejemplo.test/a/</loc></url></urlset>',
  'sitemap-1.xml': '<?xml version="1.0"?><urlset><url><loc>https://ejemplo.test/b/</loc></url></urlset>',
}, async (dist) => {
  assert.deepEqual(await readSitemapUrls(dist), ['https://ejemplo.test/', 'https://ejemplo.test/a/', 'https://ejemplo.test/b/'])
}))

test('readSitemapUrls sin sitemap devuelve una lista vacía', () => withDist({'index.html': indexable}, async (dist) => {
  assert.deepEqual(await readSitemapUrls(dist), [])
}))
