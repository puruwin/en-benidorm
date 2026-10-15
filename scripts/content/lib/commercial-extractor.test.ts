import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import test from 'node:test'
import {extractCommercialInformation} from './commercial-extractor'
import type {SourceProvenance} from './types'
import {crawlOfficialWebsite, htmlToText, type CrawledWebsitePage} from './website-crawler'

const NOW = '2026-10-15T10:00:00.000Z'
const FIXTURES = resolve('scripts/content/fixtures/commercial')

test('HTML semántico conserva enlaces y exige moneda para crear un precio', async () => {
  const html = await readFile(resolve(FIXTURES, 'menu.html'), 'utf8')
  const result = extractCommercialInformation([page('https://local.example/carta', html)])
  const tosta = result.items.find((item) => item.name === 'Tosta mediterránea')
  assert.equal(tosta?.price?.amount, 8.5)
  assert.equal(tosta?.url, 'https://local.example/productos/tosta')
  assert.equal(result.items.find((item) => item.name === 'Café filtrado')?.price?.amount, 2.4)
  assert.equal(result.items.some((item) => item.name.includes('experiencia inolvidable')), false)
  assert.equal(result.items.find((item) => item.name.includes('Menú degustación'))?.price, undefined)
  assert.ok(result.openingHours.some((item) => item.value.includes('09:00-18:30')))
  assert.match(htmlToText('<a href="/catalogo"><strong>Catálogo de verano</strong></a>'), /Catálogo de verano/)
})

test('cards comerciales con clase genérica single-menu producen un único ítem explícito', () => {
  const html = `<section id="menu">
    <div class="single-menu"><div class="details"><h3>Brioche vegetal <span>9,90 €</span></h3><p>Descripción promocional extensa.</p></div></div>
    <div class="single-menu"><h3>Todas las opciones van acompañadas de patatas</h3></div>
  </section>`
  const result = extractCommercialInformation([page('https://local.example/', html)])
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0]?.name, 'Brioche vegetal')
  assert.equal(result.items[0]?.price?.amount, 9.9)
})

test('JSON-LD extrae Product, Service, Offer y horarios sin duplicar la card HTML', async () => {
  const html = await readFile(resolve(FIXTURES, 'shop-jsonld.html'), 'utf8')
  const result = extractCommercialInformation([page('https://shop.example/', html)], [], {expectedName: 'Tienda Ejemplo'})
  assert.equal(result.items.filter((item) => item.name === 'Aceite corporal').length, 1)
  assert.equal(result.items.find((item) => item.name === 'Aceite corporal')?.format, 'json-ld')
  assert.equal(result.items.find((item) => item.name === 'Asesoría personalizada')?.kind, 'service')
  assert.equal(result.items.find((item) => item.name === 'Asesoría personalizada')?.price?.amount, 25)
  assert.ok(result.openingHours.some((item) => item.value === 'Monday, Tuesday: 10:00-19:00'))
})

test('datos embebidos sólo se aceptan cuando tienen una estructura comercial reconocible', () => {
  const html = `<script type="application/json">{"name":"Bono mensual","price":"30","priceCurrency":"EUR"}</script>
    <script>window.payload={name:'No ejecutar',price:'1'}</script>`
  const result = extractCommercialInformation([page('https://service.example/', html)])
  assert.deepEqual(result.items.map((item) => item.name), ['Bono mensual'])
  assert.equal(result.items[0]?.format, 'embedded-json')
})

test('una página multiestablecimiento requiere identidad exacta y descarta el HTML global', async () => {
  const html = await readFile(resolve(FIXTURES, 'multiple-businesses.html'), 'utf8')
  const selected = extractCommercialInformation([page('https://group.example/', html)], [], {expectedName: 'Local Norte'})
  assert.deepEqual(selected.items.map((item) => item.name), ['Sopa del norte'])
  assert.ok(selected.summary.discarded.some((item) => item.reason.includes('varios establecimientos')))
  const ambiguous = extractCommercialInformation([page('https://group.example/', html)])
  assert.equal(ambiguous.items.length, 0)
  assert.ok(ambiguous.summary.discarded.some((item) => item.reason.includes('ambiguos')))
})

test('crawler procesa PDF oficial textual y distingue un PDF sin texto', async () => {
  const textPdf = Buffer.from((await readFile(resolve(FIXTURES, 'text-catalog.pdf.b64'), 'utf8')).trim(), 'base64')
  const blankPdf = Buffer.from((await readFile(resolve(FIXTURES, 'blank.pdf.b64'), 'utf8')).trim(), 'base64')
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/')) return htmlResponse('<a href="/catalog.pdf">Catálogo PDF</a><a href="/blank.pdf">Tarifas PDF</a>')
    const bytes = url.endsWith('blank.pdf') ? blankPdf : textPdf
    return new Response(bytes, {status: 200, headers: {'content-type': 'application/pdf', 'content-length': String(bytes.byteLength)}})
  }) as typeof fetch
  const crawl = await crawlOfficialWebsite('https://docs.example/', NOW, {fetcher, linkHints: ['catalog'], maxDocuments: 2})
  assert.equal(crawl.documents.length, 2)
  assert.equal(crawl.documents.find((item) => item.url.endsWith('catalog.pdf'))?.status, 'processed')
  assert.equal(crawl.documents.find((item) => item.url.endsWith('blank.pdf'))?.status, 'no-extractable-text')
  assert.ok(crawl.diagnostics.discardedUrls.some((item) => item.reason.includes('sin texto extraíble')))
  const extracted = extractCommercialInformation(crawl.pages, crawl.documents)
  assert.ok(extracted.items.some((item) => item.name === 'Massage' && item.kind === 'service' && item.pageNumber === 1))
  assert.match(extracted.items.find((item) => item.name === 'Massage')?.sourceKey ?? '', /official-document/)
})

test('crawler rechaza falsos PDF, límites de tamaño y documentos externos', async () => {
  let externalCalls = 0
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/')) return htmlResponse('<a href="/fake.pdf">Carta</a><a href="/large.pdf">Tarifas</a><a href="https://external.example/menu.pdf">Menú externo</a>')
    if (url.includes('external.example')) externalCalls += 1
    if (url.endsWith('large.pdf')) return new Response('%PDF-', {headers: {'content-type': 'application/pdf', 'content-length': '999999'}})
    return new Response('<html>No es PDF</html>', {headers: {'content-type': 'text/html'}})
  }) as typeof fetch
  const crawl = await crawlOfficialWebsite('https://safe.example/', NOW, {fetcher, maxPdfBytes: 100, maxDocuments: 3})
  assert.equal(crawl.documents.length, 0)
  assert.equal(externalCalls, 0)
  assert.ok(crawl.diagnostics.discardedUrls.some((item) => item.reason.includes('Tipo de contenido no PDF')))
  assert.ok(crawl.diagnostics.discardedUrls.some((item) => item.reason.includes('supera el límite')))
  assert.ok(crawl.diagnostics.discardedUrls.some((item) => item.reason.includes('otro dominio')))
})

function page(url: string, html: string): CrawledWebsitePage {
  return {url, html, text: htmlToText(html), source: source(url)}
}
function source(url: string): SourceProvenance {
  return {key: `official:${url}`, provider: 'official-website', identifier: url, url, retrievedAt: NOW, attribution: 'Fixture', licenseUrl: null, sourceClass: 'official-location', claimScope: 'establishment'}
}
function htmlResponse(body: string): Response { return new Response(`<!doctype html><html><body>${body}</body></html>`, {headers: {'content-type': 'text/html'}}) }
