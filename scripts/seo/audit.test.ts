import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import test from 'node:test'
import {auditSite, findingKey, newFindings, routeFromFile, type SourcePage} from './lib/audit'
import {readDistPages, readSitemapOrigin} from './lib/dist'

const origin = 'https://ejemplo.test'
const fixtures = resolve(import.meta.dirname, 'fixtures/encalpe')

interface PageOptions {
  title?: string | null
  description?: string | null
  canonical?: string | null
  robots?: string
  head?: string
  main?: string
  nav?: string
  footer?: string
}

function page(route: string, options: PageOptions = {}): SourcePage {
  const title = options.title === undefined ? `Título ${route}` : options.title
  const description = options.description === undefined ? `Descripción ${route}` : options.description
  const canonical = options.canonical === undefined ? `${origin}${route}` : options.canonical
  const html = `<!doctype html><html lang="es"><head>
    ${title === null ? '' : `<title>${title}</title>`}
    ${description === null ? '' : `<meta name="description" content="${description}">`}
    ${canonical === null ? '' : `<link rel="canonical" href="${canonical}">`}
    <meta name="robots" content="${options.robots ?? 'index,follow'}">${options.head ?? ''}
  </head><body>
    <header><nav>${options.nav ?? '<a href="/">Inicio</a> <a href="/a/">A</a> <a href="/b/">B</a>'}</nav></header>
    <main>${options.main ?? `<h1>Página ${route}</h1>`}</main>
    <footer>${options.footer ?? '<a href="/b/">B</a>'}</footer>
  </body></html>`
  return {route, html}
}

/** Sitio mínimo sin errores: tres páginas enlazadas entre sí por el menú. */
function cleanSite(overrides: Record<string, PageOptions> = {}): SourcePage[] {
  return ['/', '/a/', '/b/'].map((route) => page(route, overrides[route]))
}

function rules(result: ReturnType<typeof auditSite>) {
  return result.errors.map((error) => `${error.route} ${error.rule}${error.zone ? `:${error.zone}` : ''}`)
}

test('routeFromFile convierte rutas de archivo del build en rutas públicas', () => {
  assert.equal(routeFromFile('index.html'), '/')
  assert.equal(routeFromFile('donde-comer/arroces/index.html'), '/donde-comer/arroces/')
  assert.equal(routeFromFile('404.html'), '/404.html')
})

test('reproduce los hallazgos de la auditoría de encalpe', async () => {
  const pages = await readDistPages(fixtures)
  const site = await readSitemapOrigin(fixtures)
  assert.equal(site, 'https://encalpe.test')
  const result = auditSite(pages, {origin: site ?? ''})

  assert.deepEqual(rules(result), [
    '/ broken-link:footer',
    '/ link-to-redirect:menu',
    '/huerfana/ broken-link:footer',
    '/huerfana/ link-to-redirect:menu',
    '/huerfana/ orphan',
    '/restaurantes/ficha/ broken-link:footer',
    '/restaurantes/ficha/ link-to-redirect:menu',
    '/sin-h1/ broken-link:footer',
    '/sin-h1/ h1-missing',
    '/sin-h1/ link-to-redirect:menu',
  ])
  const footer = result.errors.find((error) => error.rule === 'broken-link')
  assert.equal(footer?.detail, '/aviso-legal/')
  const redirect = result.errors.find((error) => error.rule === 'link-to-redirect')
  assert.equal(redirect?.detail, '/donde-comer/ → /restaurantes/ficha/')
  assert.equal(result.pages['/donde-comer/']?.type, 'redirect')
  assert.equal(result.pages['/404.html']?.type, 'not-found')
  assert.deepEqual(result.pages['/huerfana/']?.incoming, [])
  assert.deepEqual(result.pages['/restaurantes/ficha/']?.incoming, ['/', '/sin-h1/'])
  assert.deepEqual(result.pages['/']?.outgoing, ['/aviso-legal/', '/donde-comer/', '/restaurantes/ficha/', '/sin-h1/'])
})

test('un sitio correcto no produce errores ni avisos', () => {
  const result = auditSite(cleanSite(), {origin})
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.pages['/a/'], {type: 'indexable', outgoing: ['/', '/b/'], incoming: ['/', '/b/']})
})

test('los enlaces entrantes cuentan páginas distintas, no enlaces repetidos ni la 404', () => {
  const site = [
    page('/', {nav: '<a href="/a/">A</a> <a href="/a/">A otra vez</a>', footer: ''}),
    page('/a/', {nav: '<a href="/">Inicio</a>', footer: ''}),
    page('/404.html', {robots: 'noindex', nav: '<a href="/a/">A</a>', footer: ''}),
  ]
  const result = auditSite(site, {origin})
  assert.deepEqual(rules(result), ['/a/ orphan'])
  assert.deepEqual(result.pages['/a/']?.incoming, ['/'])
})

test('las páginas noindex no exigen enlaces entrantes ni canonical propio', () => {
  const result = auditSite([...cleanSite(), page('/borrador/', {robots: 'noindex,follow', canonical: `${origin}/a/`})], {origin})
  assert.deepEqual(result.errors, [])
})

test('detecta H1 múltiple, title y description ausentes o duplicados', () => {
  const result = auditSite(cleanSite({
    '/': {main: '<h1>Uno</h1><h1>Dos</h1>', title: 'Repetido'},
    '/a/': {title: 'Repetido', description: null},
    '/b/': {title: null},
  }), {origin})
  assert.deepEqual(rules(result), ['/ h1-multiple', '/ title-duplicate', '/a/ description-missing', '/a/ title-duplicate', '/b/ title-missing'])
})

test('exige canonical a la propia URL en páginas indexables', () => {
  const result = auditSite(cleanSite({'/a/': {canonical: `${origin}/b/`}, '/b/': {canonical: null}}), {origin})
  assert.deepEqual(rules(result), ['/a/ canonical-mismatch', '/b/ canonical-mismatch'])
})

test('detecta JSON-LD que no parsea', () => {
  const head = '<script type="application/ld+json">{"@type":"Thing"}</script><script type="application/ld+json">{"@type":}</script>'
  const result = auditSite(cleanSite({'/a/': {head}}), {origin})
  assert.deepEqual(rules(result), ['/a/ jsonld-invalid'])
  assert.match(result.errors[0]?.detail ?? '', /^bloque 2:/)
})

test('«verificada» solo se admite con revisión humana marcada', () => {
  const claim = '<p>Información verificada el <time datetime="2026-10-06">6 de octubre</time></p>'
  const result = auditSite(cleanSite({
    '/a/': {main: `<h1>A</h1>${claim}`},
    '/b/': {main: `<h1>B</h1><div data-human-review="2026-10-06">${claim}</div>`},
  }), {origin})
  assert.deepEqual(rules(result), ['/a/ unreviewed-verified'])
  assert.equal(result.errors[0]?.detail, '«Información verificada el» sin [data-human-review]')
})

test('precios u horarios exigen el componente Sources en la misma página', () => {
  const sources = '<section aria-labelledby="sources-title" data-seo-sources><h2 id="sources-title">Fuentes</h2></section>'
  const result = auditSite(cleanSite({
    '/': {main: '<h1>Inicio</h1><p>Menú del día 12,50 €</p>'},
    '/a/': {main: '<h1>A</h1><h3>Horario</h3><dl><dt>Lunes</dt><dd>Cerrado</dd></dl>'},
    '/b/': {main: `<h1>B</h1><p>13:00–23:00</p><p>Arroz 18 €</p>${sources}`},
  }), {origin})
  assert.deepEqual(rules(result), ['/ facts-without-sources', '/a/ facts-without-sources'])
  assert.equal(result.errors[0]?.detail, 'precios sin el componente Sources')
  assert.equal(result.errors[1]?.detail, 'horarios sin el componente Sources')
})

test('imágenes sin alt y title largo son avisos, no errores', () => {
  const longTitle = 'Un título demasiado largo para la página de resultados de búsqueda'
  const result = auditSite(cleanSite({'/a/': {title: longTitle, main: '<h1>A</h1><img src="/x.jpg"><img src="/y.jpg" alt="">'}}), {origin})
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings.map((warning) => `${warning.rule} ${warning.detail}`), [
    'img-missing-alt /x.jpg',
    `title-too-long ${[...longTitle].length} caracteres: «${longTitle}»`,
  ])
})

test('ignora enlaces externos, anclas, mailto y recursos estáticos', () => {
  const nav = '<a href="/">Inicio</a> <a href="/a/">A</a> <a href="/b/">B</a> <a href="https://otro.test/x/">Fuera</a> <a href="#top">Arriba</a> <a href="mailto:a@b.c">Correo</a> <a href="/favicon.svg">Icono</a>'
  const result = auditSite(cleanSite({'/': {nav}}), {origin})
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.pages['/']?.outgoing, ['/a/', '/b/'])
})

test('normaliza enlaces relativos, absolutos del mismo origen y sin barra final', () => {
  const nav = `<a href="${origin}/a/">A</a> <a href="b">B</a> <a href="/a?x=1#y">A</a>`
  const result = auditSite(cleanSite({'/a/': {nav: `<a href="/">Inicio</a> ${nav}`}}), {origin})
  assert.deepEqual(result.pages['/a/']?.outgoing, ['/', '/a/b/', '/b/'])
  assert.deepEqual(rules(result), ['/a/ broken-link:menu'])
})

test('el resultado no depende del orden de entrada', () => {
  const site = [...cleanSite({'/a/': {main: '<h2>sin h1</h2>'}}), page('/huerfana/')]
  assert.deepEqual(auditSite([...site].reverse(), {origin}), auditSite(site, {origin}))
})

test('la línea base solo deja pasar los errores ya conocidos', async () => {
  const result = auditSite(await readDistPages(fixtures), {origin: 'https://encalpe.test'})
  const baseline = result.errors.filter((error) => error.rule !== 'orphan')
  const fresh = newFindings(result.errors, baseline)
  assert.deepEqual(fresh.map(findingKey), ['orphan|/huerfana/||0 enlaces entrantes (mínimo 2)'])
})
