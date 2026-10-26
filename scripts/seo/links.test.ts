import assert from 'node:assert/strict'
import test from 'node:test'
import type {PageGraphEntry, PageType} from './lib/audit'
import {classifyRoute, proposeLinks} from './lib/links'

/** Grafo a partir de los enlaces salientes; los entrantes se calculan como en seo:audit. */
function graph(outgoing: Record<string, string[]>, types: Record<string, PageType> = {}): Record<string, PageGraphEntry> {
  const pages: Record<string, PageGraphEntry> = {}
  for (const [route, targets] of Object.entries(outgoing)) pages[route] = {type: types[route] ?? 'indexable', outgoing: [...targets].sort(), incoming: []}
  for (const [route, targets] of Object.entries(outgoing)) {
    if (pages[route]?.type === 'redirect' || pages[route]?.type === 'not-found') continue
    for (const target of targets) pages[target]?.incoming.push(route)
  }
  for (const entry of Object.values(pages)) entry.incoming.sort()
  return pages
}

const pairs = (proposals: ReturnType<typeof proposeLinks>) => proposals.map((proposal) => `${proposal.from} → ${proposal.to} ${proposal.reason}`)

test('classifyRoute sigue los patrones de src/lib/routes.ts', () => {
  assert.equal(classifyRoute('/'), 'home')
  assert.equal(classifyRoute('/donde-comer/'), 'hub')
  assert.equal(classifyRoute('/donde-comer/italiano/'), 'hub')
  assert.equal(classifyRoute('/restaurantes/essenza-italiana/'), 'ficha')
  assert.equal(classifyRoute('/guias/benidorm-en-48-horas/'), 'guia')
  assert.equal(classifyRoute('/sobre-david/'), 'other')
})

test('las fichas huérfanas reciben propuestas desde el hub general y desde la otra ficha de su categoría', () => {
  const result = proposeLinks(graph({
    '/': ['/donde-comer/'],
    '/donde-comer/': ['/', '/donde-comer/italiano/'],
    '/donde-comer/italiano/': ['/', '/donde-comer/', '/restaurantes/a/', '/restaurantes/b/'],
    '/restaurantes/a/': ['/', '/donde-comer/'],
    '/restaurantes/b/': ['/', '/donde-comer/'],
  }))
  // /donde-comer/italiano/ también está por debajo del mínimo (solo la enlaza /donde-comer/).
  assert.deepEqual(pairs(result), [
    '/restaurantes/a/ → /donde-comer/italiano/ ficha-hub',
    '/restaurantes/b/ → /donde-comer/italiano/ ficha-hub',
    '/donde-comer/ → /restaurantes/a/ hub-ficha',
    '/restaurantes/b/ → /restaurantes/a/ ficha-hermana',
    '/donde-comer/ → /restaurantes/b/ hub-ficha',
    '/restaurantes/a/ → /restaurantes/b/ ficha-hermana',
  ])
  assert.ok(result.every((proposal) => proposal.targetBelowMinimum))
  assert.equal(result[0]?.detail, '/donde-comer/italiano/ ya enlaza /restaurantes/a/')
})

test('compartir solo el hub general no hace cercanas a dos fichas; la misma zona sí', () => {
  const pages = graph({
    '/donde-comer/': ['/restaurantes/a/', '/restaurantes/b/'],
    '/restaurantes/a/': ['/donde-comer/'],
    '/restaurantes/b/': ['/donde-comer/'],
  })
  assert.deepEqual(pairs(proposeLinks(pages)), [])
  const zoned = proposeLinks(pages, {zones: {'/restaurantes/a/': 'Poniente', '/restaurantes/b/': 'Poniente'}})
  assert.deepEqual(pairs(zoned), ['/restaurantes/b/ → /restaurantes/a/ misma-zona', '/restaurantes/a/ → /restaurantes/b/ misma-zona'])
  assert.equal(zoned[0]?.detail, 'zona Poniente')
})

test('un par con varios motivos se queda con el más fuerte y anota el resto', () => {
  const result = proposeLinks(graph({
    '/donde-comer/arroces/': ['/restaurantes/a/', '/restaurantes/b/'],
    '/restaurantes/a/': [],
    '/restaurantes/b/': [],
  }), {zones: {'/restaurantes/a/': 'Centro', '/restaurantes/b/': 'Centro'}})
  const ab = result.find((proposal) => proposal.from === '/restaurantes/a/' && proposal.to === '/restaurantes/b/')
  assert.equal(ab?.reason, 'ficha-hermana')
  assert.equal(ab?.detail, 'comparten /donde-comer/arroces/; zona Centro')
})

test('no propone enlaces existentes ni desde o hacia páginas no indexables', () => {
  const result = proposeLinks(graph({
    '/donde-comer/arroces/': ['/restaurantes/a/', '/restaurantes/b/', '/restaurantes/borrador/'],
    '/restaurantes/a/': ['/donde-comer/arroces/', '/restaurantes/b/'],
    '/restaurantes/b/': ['/donde-comer/arroces/', '/restaurantes/a/'],
    '/restaurantes/borrador/': [],
    '/restaurantes/vieja/': ['/restaurantes/a/'],
    '/404.html': ['/restaurantes/a/'],
  }, {'/restaurantes/borrador/': 'noindex', '/restaurantes/vieja/': 'redirect', '/404.html': 'not-found'}))
  assert.deepEqual(result, [])
})

test('el resultado no depende del orden de entrada', () => {
  const pages = graph({
    '/donde-comer/italiano/': ['/restaurantes/a/', '/restaurantes/b/', '/restaurantes/c/'],
    '/restaurantes/a/': [],
    '/restaurantes/b/': ['/restaurantes/c/'],
    '/restaurantes/c/': [],
  })
  const reversed = Object.fromEntries(Object.entries(pages).reverse())
  assert.deepEqual(proposeLinks(reversed), proposeLinks(pages))
})
