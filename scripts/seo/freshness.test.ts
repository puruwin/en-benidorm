import assert from 'node:assert/strict'
import test from 'node:test'
import {ageInDays, artifactDates, extractPageDates, staleItems, type DatedItem} from './lib/freshness'

const item = (date: string, label = 'Web oficial'): DatedItem => ({route: '/a/', label, source: 'https://example.com/', date, origin: 'página'})

test('staleItems: 90 días no caduca, 91 sí', () => {
  const stale = staleItems([item('2026-07-28', 'noventa'), item('2026-07-27', 'noventa y uno')], '2026-10-26')
  assert.deepEqual(stale.map((entry) => [entry.label, entry.ageDays]), [['noventa y uno', 91]])
})

test('staleItems conserva las fechas no válidas como «sin fecha válida»', () => {
  const stale = staleItems([item('2026-02-30'), item('ayer'), item('2026-10-20')], '2026-10-26')
  assert.deepEqual(stale.map((entry) => [entry.date, entry.ageDays]), [['2026-02-30', null], ['ayer', null]])
})

test('staleItems ordena por ruta y del más antiguo al más reciente, sin duplicados', () => {
  const stale = staleItems([
    item('2026-05-01', 'b'),
    {...item('2026-01-01', 'z'), route: '/z/'},
    item('2026-01-01', 'a'),
    item('2026-01-01', 'a'),
  ], '2026-10-26')
  assert.deepEqual(stale.map((entry) => `${entry.route} ${entry.label}`), ['/a/ a', '/a/ b', '/z/ z'])
})

test('staleItems rechaza una fecha de referencia no válida', () => {
  assert.throws(() => staleItems([item('2026-01-01')], '26/10/2026'), /Fecha de referencia no válida/)
})

test('ageInDays cuenta días naturales sin depender de la zona horaria', () => {
  assert.equal(ageInDays('2026-03-28', '2026-03-30'), 2)
  assert.equal(ageInDays('2026-10-26', '2026-10-26'), 0)
})

test('extractPageDates lee las fuentes con «consultada» y el <time> de LastVerified', () => {
  const html = `<html><body>
    <p><span aria-hidden="true">✓</span> Información verificada el <time datetime="2026-06-01">1 de junio de 2026</time></p>
    <ul>
      <li><a href="https://example.com/carta">Carta<span class="sr-only"> de Bar</span></a> · Bar · consultada 2026-05-02</li>
      <li><a href="https://example.com/">Web sin fecha</a></li>
    </ul>
  </body></html>`
  assert.deepEqual(extractPageDates('/restaurantes/bar/', html), [
    {route: '/restaurantes/bar/', label: 'Información verificada', source: 'página', date: '2026-06-01', origin: 'página'},
    {route: '/restaurantes/bar/', label: 'Carta', source: 'https://example.com/carta', date: '2026-05-02', origin: 'página'},
  ])
})

test('artifactDates lee accessedAt y el retrievedAt del precio destacado, no lastVerified', () => {
  const comparison = {
    _type: 'comparison',
    slug: {_type: 'slug', current: 'arroces'},
    lastVerified: '2026-01-01',
    sources: [{title: 'Web oficial', publisher: 'Ongi Etorri', url: 'https://ongi.example/', accessedAt: '2026-10-07'}, {title: 'Sin fecha', url: 'https://x.example/'}],
    entries: [
      {business: {_ref: 'business-ongi-etorri'}, featuredItem: {name: 'Arroz a banda', price: 16.5, priceQualifier: 'por persona', source: 'official-website:https://ongi.example/carta', retrievedAt: '2026-10-07'}},
      {business: {_ref: 'business-sin-precio'}},
    ],
  }
  assert.deepEqual(artifactDates(comparison), [
    {route: '/donde-comer/arroces/', label: 'Web oficial · Ongi Etorri', source: 'https://ongi.example/', date: '2026-10-07', origin: 'artefacto'},
    {route: '/donde-comer/arroces/', label: 'business-ongi-etorri: Arroz a banda 16.5 € (por persona)', source: 'official-website:https://ongi.example/carta', date: '2026-10-07', origin: 'artefacto'},
  ])
  assert.equal(artifactDates({_type: 'business', slug: {current: 'bar'}, sources: [{title: 'OSM', url: 'https://osm.example/', accessedAt: '2026-01-02'}]})[0]?.route, '/restaurantes/bar/')
  assert.deepEqual(artifactDates({_type: 'article', slug: {current: 'x'}, sources: [{title: 'a', url: 'b', accessedAt: '2026-01-01'}]}), [])
})
