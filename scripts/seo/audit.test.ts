import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import test from 'node:test'
import {structuralIndexability, type IndexabilitySignals} from '../../src/lib/indexability'
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
  breadcrumbs?: boolean
  main?: string
  nav?: string
  footer?: string
  /** Enlaces del cuerpo fuera de <main>; por defecto, a las tres páginas de `cleanSite`. */
  related?: string
  /** Señales del meta de indexación; `null` lo omite. Por defecto, estructural con sujeto vacío. */
  indexability?: IndexabilitySignals | null
}

const structural = structuralIndexability({subject: '', h1: '', title: 'propio'})

function page(route: string, options: PageOptions = {}): SourcePage {
  const title = options.title === undefined ? `Título ${route}` : options.title
  const description = options.description === undefined ? `Descripción ${route}` : options.description
  const canonical = options.canonical === undefined ? `${origin}${route}` : options.canonical
  const html = `<!doctype html><html lang="es"><head>
    ${title === null ? '' : `<title>${title}</title>`}
    ${description === null ? '' : `<meta name="description" content="${description}">`}
    ${canonical === null ? '' : `<link rel="canonical" href="${canonical}">`}
    <meta name="robots" content="${options.robots ?? 'index,follow'}">${options.head ?? ''}
    ${options.indexability === null ? '' : `<meta name="enbenidorm-indexability" content='${JSON.stringify(options.indexability ?? structural)}'>`}
    ${options.breadcrumbs === false ? '' : '<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>'}
  </head><body>
    <header><nav>${options.nav ?? '<a href="/">Inicio</a> <a href="/a/">A</a> <a href="/b/">B</a>'}</nav></header>
    <main>${options.main ?? `<h1>Página ${route}</h1>`}</main>
    <aside>${options.related ?? '<a href="/">Inicio</a> <a href="/a/">A</a> <a href="/b/">B</a>'}</aside>
    <footer>${options.footer ?? '<a href="/b/">B</a>'}</footer>
  </body></html>`
  return {route, html}
}

/** Sitio mínimo sin errores: tres páginas enlazadas entre sí por el menú y desde el cuerpo. */
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
    '/ indexability-missing',
    '/ link-to-redirect:menu',
    '/huerfana/ breadcrumb-missing',
    '/huerfana/ broken-link:footer',
    '/huerfana/ indexability-missing',
    '/huerfana/ link-to-redirect:menu',
    '/huerfana/ orphan',
    '/restaurantes/ficha/ breadcrumb-missing',
    '/restaurantes/ficha/ broken-link:footer',
    '/restaurantes/ficha/ indexability-missing',
    '/restaurantes/ficha/ link-to-redirect:menu',
    '/sin-h1/ breadcrumb-missing',
    '/sin-h1/ broken-link:footer',
    '/sin-h1/ h1-missing',
    '/sin-h1/ indexability-missing',
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
  assert.deepEqual(result.pages['/a/'], {type: 'indexable', outgoing: ['/', '/b/'], incoming: ['/', '/b/'], incomingContextual: ['/', '/b/'], indexabilityReasons: []})
})

test('los enlaces entrantes cuentan páginas distintas, no enlaces repetidos ni la 404', () => {
  const site = [
    page('/', {nav: '', related: '<a href="/a/">A</a> <a href="/a/">A otra vez</a>', footer: ''}),
    page('/a/', {nav: '', related: '<a href="/">Inicio</a>', footer: ''}),
    page('/404.html', {robots: 'noindex', nav: '', related: '<a href="/a/">A</a>', footer: ''}),
  ]
  const result = auditSite(site, {origin})
  // /a/ se declara indexable con un solo enlace: es huérfana y además contradice la regla.
  assert.deepEqual(rules(result), ['/a/ indexability-mismatch', '/a/ orphan'])
  assert.deepEqual(result.pages['/a/']?.incoming, ['/'])
  assert.deepEqual(result.pages['/a/']?.indexabilityReasons?.map((reason) => reason.code), ['few-links'])
})

test('solo cuentan los enlaces del cuerpo: menú, migas y pie no tapan una huérfana', () => {
  const result = auditSite(cleanSite({'/': {related: '<a href="/a/">A</a>'}, '/b/': {related: '<a href="/">Inicio</a> <a href="/a/">A</a>'}}), {origin})
  assert.deepEqual(result.pages['/b/']?.incoming, ['/', '/a/'])
  assert.deepEqual(result.pages['/b/']?.incomingContextual, ['/a/'])
  assert.deepEqual(rules(result), ['/b/ indexability-mismatch', '/b/ orphan'])
})

test('una página noindex por la regla no es un error; una indexable sin meta sí', () => {
  const ficha = {...structuralIndexability({subject: 'Casa', h1: 'Casa', title: 'Casa'}), kind: 'ficha' as const}
  const result = auditSite([...cleanSite(), page('/ficha/', {robots: 'noindex,follow', indexability: ficha, title: 'Casa', main: '<h1>Casa</h1>'}), page('/sin-meta/', {indexability: null})], {origin})
  assert.deepEqual(result.pages['/ficha/']?.indexabilityReasons?.map((reason) => reason.code), ['no-evidence', 'no-address', 'no-contribution', 'few-links'])
  assert.deepEqual(rules(result), ['/sin-meta/ indexability-missing', '/sin-meta/ orphan'])
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
  assert.deepEqual(rules(result), ['/ h1-multiple', '/ title-duplicate', '/a/ description-missing', '/a/ title-duplicate', '/b/ indexability-mismatch', '/b/ title-missing'])
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

test('JSON-LD con valoraciones agregadas o reseñas es un error', () => {
  const head = '<script type="application/ld+json">{"@type":"Restaurant","name":"X","aggregateRating":{"@type":"AggregateRating","ratingValue":4.5},"review":[{"@type":"Review"}]}</script>'
  const result = auditSite(cleanSite({'/a/': {head}}), {origin})
  assert.deepEqual(rules(result), ['/a/ jsonld-invalid', '/a/ jsonld-invalid'])
  assert.deepEqual(result.errors.map((error) => error.detail.match(/«(\w+)»/)?.[1]).sort(), ['aggregateRating', 'review'])
})

test('toda página indexable salvo la de inicio lleva BreadcrumbList', () => {
  const result = auditSite(cleanSite({'/': {breadcrumbs: false}, '/a/': {breadcrumbs: false}, '/b/': {breadcrumbs: false, robots: 'noindex,follow', indexability: {...structural, storedNoIndex: true}}}), {origin})
  assert.deepEqual(rules(result), ['/a/ breadcrumb-missing'])
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
  const result = auditSite(cleanSite({'/a/': {title: longTitle, main: '<h1>A</h1><img src="/x.jpg" data-image-origin="propia"><img src="/y.jpg" alt="" data-image-origin="propia">'}}), {origin})
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
  assert.deepEqual(fresh.map(findingKey), ['orphan|/huerfana/||0 enlaces contextuales entrantes (mínimo 2)'])
})

const sitemapOf = (routes: readonly string[]) => routes.map((route) => `${origin}${route}`)

test('un sitemap con exactamente las páginas indexables no produce errores', () => {
  const site = [...cleanSite(), page('/borrador/', {robots: 'noindex,follow'}), page('/404.html', {robots: 'noindex'})]
  const result = auditSite(site, {origin, sitemap: sitemapOf(['/', '/a/', '/b/'])})
  assert.deepEqual(result.errors, [])
})

test('sin la opción sitemap no se compara con el sitemap', () => {
  const result = auditSite([...cleanSite(), page('/borrador/', {robots: 'noindex,follow'})], {origin})
  assert.deepEqual(result.errors, [])
})

test('sitemap-noindex: el sitemap lista una página noindex, una redirección, la 404 o una ruta sin HTML', () => {
  const ficha = {...structuralIndexability({subject: 'Casa', h1: 'Casa', title: 'Casa'}), kind: 'ficha' as const}
  const site = [
    ...cleanSite(),
    page('/ficha/', {robots: 'noindex,follow', indexability: ficha, title: 'Casa', main: '<h1>Casa</h1>'}),
    page('/antigua/', {head: '<meta http-equiv="refresh" content="0;url=/a/">'}),
    page('/404.html', {robots: 'noindex'}),
  ]
  const result = auditSite(site, {origin, sitemap: sitemapOf(['/', '/a/', '/b/', '/ficha/', '/antigua/', '/404.html', '/no-existe/'])})
  assert.deepEqual(result.errors.map((error) => `${error.route} ${error.rule} ${error.detail}`), [
    '/404.html sitemap-noindex 404: página de error',
    '/antigua/ sitemap-noindex redirect → /a/',
    '/ficha/ sitemap-noindex noindex (no-evidence, no-address, no-contribution, few-links)',
    '/no-existe/ sitemap-noindex 404: no hay HTML en el build',
  ])
})

test('sitemap-noindex: una URL de otro origen no cuenta como listada', () => {
  const result = auditSite(cleanSite(), {origin, sitemap: [...sitemapOf(['/', '/b/']), 'https://otro.test/a/']})
  assert.deepEqual(rules(result), ['/a/ sitemap-missing-indexable', '/a/ sitemap-noindex'])
})

test('sitemap-missing-indexable: falta una página indexable; una noindex ausente no es error', () => {
  const result = auditSite([...cleanSite(), page('/borrador/', {robots: 'noindex,follow'})], {origin, sitemap: sitemapOf(['/', '/a/'])})
  assert.deepEqual(rules(result), ['/b/ sitemap-missing-indexable'])
})

test('un sitemap vacío deja fuera todas las indexables', () => {
  const result = auditSite(cleanSite(), {origin, sitemap: []})
  assert.deepEqual(rules(result), ['/ sitemap-missing-indexable', '/a/ sitemap-missing-indexable', '/b/ sitemap-missing-indexable'])
})
