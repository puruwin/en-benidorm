import assert from 'node:assert/strict'
import test from 'node:test'
import {imageCredit} from '../../src/lib/image-credit'
import {structuralIndexability, type IndexabilitySignals} from '../../src/lib/indexability'
import {auditSite, namedPlaces, type SourcePage} from './lib/audit'

const origin = 'https://ejemplo.test'
const structural = structuralIndexability({subject: '', h1: '', title: 'propio'})
const signals = (kind: 'ficha' | 'guide', h1: string): IndexabilitySignals => ({
  ...structural, kind, subject: h1, h1, evidence: {officialFact: true, ownObservation: false, creatorObservations: []},
})

function page(route: string, main: string, indexability: IndexabilitySignals = structural, robots = 'index,follow'): SourcePage {
  return {route, html: `<!doctype html><html lang="es"><head>
    <title>Título ${route}</title><meta name="description" content="Descripción ${route}">
    <link rel="canonical" href="${origin}${route}"><meta name="robots" content="${robots}">
    <meta name="enbenidorm-indexability" content='${JSON.stringify(indexability)}'>
    <script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
  </head><body><main><h1>${indexability.h1 || `Página ${route}`}</h1>${main}</main>
    <aside><a href="/">Inicio</a> <a href="/a/">A</a> <a href="/b/">B</a></aside></body></html>`}
}

const STOCK = 'data-image-origin="stock" data-image-provider="commons" data-image-license="cc-by-sa-4.0" data-image-author="Ana" data-image-source="https://commons.wikimedia.org/wiki/File:X.jpg"'

function imageErrors(main: string, options: {placeNames?: string[]} = {}) {
  const result = auditSite([page('/', ''), page('/a/', main), page('/b/', '')], {origin, ...options})
  return result.errors.filter((error) => error.rule.startsWith('image-')).map((error) => `${error.route} ${error.rule} ${error.detail}`)
}

test('crédito de una foto propia: «Foto: enBenidorm, <fecha>»', () => {
  assert.equal(imageCredit({alt: 'x', origin: 'propia', takenAt: '2026-10-20'})?.text, 'Foto: enBenidorm, 20 de octubre de 2026')
  assert.equal(imageCredit({alt: 'x', origin: 'propia'}), null)
})

test('crédito de stock: autor / proveedor · licencia, con enlaces', () => {
  const credit = imageCredit({alt: 'x', origin: 'stock', provider: 'commons', author: 'Ana', authorUrl: 'https://commons.wikimedia.org/wiki/User:Ana', sourceUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg', license: {id: 'cc-by-sa-4.0'}})
  assert.equal(credit?.text, 'Ana / Wikimedia Commons · CC BY-SA 4.0')
  assert.deepEqual(credit?.parts.filter((part) => part.href).map((part) => part.href), [
    'https://commons.wikimedia.org/wiki/User:Ana',
    'https://commons.wikimedia.org/wiki/File:X.jpg',
    'https://creativecommons.org/licenses/by-sa/4.0/deed.es',
  ])
  assert.equal(imageCredit({alt: 'x', origin: 'stock', provider: 'pexels', author: 'Ana', sourceUrl: 'https://www.pexels.com/photo/1/'}), null, 'sin licencia no hay crédito')
  assert.equal(imageCredit({alt: 'x'}), null)
})

test('error si una imagen no tiene origen', () => {
  assert.deepEqual(imageErrors('<img src="/x.jpg" alt="Arena">'), ['/a/ image-origin-missing /x.jpg'])
})

test('error si una imagen de stock no tiene licencia, autor o fuente', () => {
  assert.deepEqual(imageErrors('<img src="/x.jpg" alt="Arena" data-image-origin="stock" data-image-provider="pexels">'), [
    '/a/ image-stock-incomplete /x.jpg: falta licencia, autor, URL de origen',
  ])
  assert.deepEqual(imageErrors(`<img src="/x.jpg" alt="Arena" ${STOCK}>`), [])
})

test('error si hay stock en un negocio, en la ficha o en una tarjeta', () => {
  assert.deepEqual(imageErrors(`<img src="/x.jpg" alt="Paella" ${STOCK} data-image-subject="business"><img src="/x.jpg" alt="Paella" ${STOCK} data-image-subject="business">`), [
    '/a/ image-stock-business /x.jpg: imagen de stock en un negocio',
  ])
  assert.deepEqual(imageErrors('<img src="/x.jpg" alt="Paella" data-image-origin="propia" data-image-subject="business">'), [])
})

test('error si el alt o el pie nombran un lugar sin verificar', () => {
  const places = {placeNames: ['Castell de Guadalest']}
  assert.deepEqual(imageErrors(`<img src="/x.jpg" alt="Vista del castell de Guadalest" ${STOCK} data-place-verified="false">`, places), [
    '/a/ image-place-unverified /x.jpg: nombra «Castell de Guadalest» sin lugar verificado',
  ])
  assert.deepEqual(imageErrors(`<figure><img src="/x.jpg" alt="Montaña al atardecer" ${STOCK} data-place-verified="false"><figcaption><span data-image-caption>Camino al Castell de Guadalest</span></figcaption></figure>`, places), [
    '/a/ image-place-unverified /x.jpg: nombra «Castell de Guadalest» sin lugar verificado',
  ])
  assert.deepEqual(imageErrors(`<img src="/x.jpg" alt="Vista del Castell de Guadalest" ${STOCK} data-place-verified="true">`, places), [])
  assert.deepEqual(imageErrors(`<img src="/x.jpg" alt="Montaña al atardecer" ${STOCK} data-place-verified="false">`, places), [])
})

test('el H1 de las fichas del rastreo entra en el nomenclátor', () => {
  const pages = [
    page('/', ''),
    page('/a/', `<img src="/x.jpg" alt="Arena en la Playa de Levante" ${STOCK} data-place-verified="false">`),
    page('/b/', '', signals('ficha', 'Playa de Levante')),
  ]
  const errors = auditSite(pages, {origin}).errors.filter((error) => error.rule === 'image-place-unverified')
  assert.deepEqual(errors.map((error) => error.route), ['/a/'])
})

test('namedPlaces compara sin tildes ni mayúsculas y por palabras completas', () => {
  assert.deepEqual(namedPlaces('Atardecer en ALTEA', ['Altea']), ['Altea'])
  assert.deepEqual(namedPlaces('Saltear verduras', ['Altea']), [])
  assert.deepEqual(namedPlaces("Calle de l'Alfas del Pi", ["L'Alfàs del Pi"]), ["L'Alfàs del Pi"])
})

test('aviso si una página indexable no estructural no tiene ninguna foto propia', () => {
  const guide = signals('guide', 'Guía')
  const pages = [page('/', ''), page('/a/', `<img src="/x.jpg" alt="Arena" ${STOCK}>`, guide), page('/b/', '<img src="/y.jpg" alt="Arena" data-image-origin="propia">', guide)]
  const warnings = auditSite(pages, {origin}).warnings.filter((warning) => warning.rule === 'image-no-own-photo')
  assert.deepEqual(warnings.map((warning) => warning.route), ['/a/'])
})
