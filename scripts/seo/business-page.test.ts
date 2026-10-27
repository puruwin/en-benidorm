import assert from 'node:assert/strict'
import test from 'node:test'
import {descriptionSections, provenanceLines, sourceKind} from '../../src/lib/business-presentation'
import type {SourceItem} from '../../src/types/content'

const osm: SourceItem = {title: 'openstreetmap: node/1', url: 'https://www.openstreetmap.org/node/1', publisher: '© OpenStreetMap contributors', accessedAt: '2026-10-07'}
const web: SourceItem = {title: 'official-website: https://ulia.example/', url: 'https://ulia.example/', publisher: 'Sitio web oficial (ulia.example)', accessedAt: '2026-10-08'}
const manualJson: SourceItem = {title: 'manual-json: cucina-official', url: 'https://cucina.example/', publisher: 'Sitio web oficial de Cucina', accessedAt: '2026-10-06'}
const manual: SourceItem = {title: 'manual-observation: business-x:2026-10-09:David', url: 'https://enbenidorm.es/', publisher: 'Observación local de primera mano · David', accessedAt: '2026-10-09'}

test('sourceKind distingue OSM, web oficial (también manual-json y etiquetas de comparativa) y observación manual', () => {
  assert.equal(sourceKind(osm), 'openstreetmap')
  assert.equal(sourceKind({title: 'OpenStreetMap', url: 'https://www.openstreetmap.org/node/2', publisher: 'Ulia'}), 'openstreetmap')
  assert.equal(sourceKind(web), 'official-website')
  assert.equal(sourceKind(manualJson), 'official-website')
  assert.equal(sourceKind({title: 'Carta', url: 'https://ulia.example/carta', publisher: 'Ulia'}), 'official-website')
  assert.equal(sourceKind(manual), 'manual-observation')
  assert.equal(sourceKind({title: 'Blog', url: 'https://blog.example/', publisher: 'Blog'}), 'other')
})

test('provenanceLines describe consultas automáticas y nunca afirma verificación', () => {
  assert.deepEqual(provenanceLines([osm, web]), [{kind: 'consulted', label: 'Datos de OpenStreetMap y la web oficial consultados', from: '2026-10-07', to: '2026-10-08'}])
  assert.deepEqual(provenanceLines([osm], '2026-10-07'), [{kind: 'consulted', label: 'Datos de OpenStreetMap consultados', from: '2026-10-07', to: '2026-10-07'}])
  for (const line of provenanceLines([osm, web, manual])) assert.doesNotMatch(line.label, /verificad|✓/i)
})

test('provenanceLines separa la observación en persona de las fuentes automáticas', () => {
  assert.deepEqual(provenanceLines([manual, web]).map((line) => [line.kind, line.label, line.to]), [
    ['observed', 'Comprobado en persona', '2026-10-09'],
    ['consulted', 'Datos de la web oficial consultados', '2026-10-08'],
  ])
})

test('provenanceLines sin fuentes fechadas solo muestra la fecha de consulta, y nada si no hay fecha', () => {
  assert.deepEqual(provenanceLines([], '2026-10-06'), [{kind: 'consulted', label: 'Datos consultados', from: '2026-10-06', to: '2026-10-06'}])
  assert.deepEqual(provenanceLines([]), [])
})

const h2 = (text: string) => ({text, style: 'h2'})
const p = (text: string) => ({text, style: 'normal'})
const li = (text: string) => ({text, style: 'normal', listItem: 'bullet'})

test('descriptionSections: un solo hecho se muestra en una sección y sin destacados que lo repitan', () => {
  const sections = descriptionSections([
    p('Amigos Bistro es un restaurante en la Avinguda de l\'Armada Espanyola.'),
    h2('La experiencia'), p('El establecimiento dispone de terraza.'),
    h2('Lo más destacado'), li('Terraza disponible'),
  ])
  assert.deepEqual(sections, [{title: 'Qué encontrarás', paragraphs: ['Amigos Bistro es un restaurante en la Avinguda de l\'Armada Espanyola.', 'El establecimiento dispone de terraza.'], items: []}])
})

test('descriptionSections no repite el mismo texto en «Qué encontrarás» y «La experiencia»', () => {
  const sections = descriptionSections([
    p('Dispone de terraza.'), h2('La experiencia'), p('Dispone de terraza'),
    h2('Cocina'), p('Cocina mediterránea.'), h2('Servicios'), p('Admite reservas.'),
  ])
  assert.deepEqual(sections.map((section) => [section.title, section.paragraphs]), [
    ['Qué encontrarás', ['Dispone de terraza.']],
    ['Cocina', ['Cocina mediterránea.']],
    ['Servicios', ['Admite reservas.']],
  ])
})

test('descriptionSections conserva encabezados y destacados cuando hay varios hechos', () => {
  const sections = descriptionSections([h2('Cocina'), p('Pasta fresca.'), h2('Información práctica'), p('Abre a mediodía.'), h2('Lo más destacado'), li('Pasta fresca y pizzas')])
  assert.deepEqual(sections.map((section) => section.title), ['Cocina', 'Información práctica', 'Lo más destacado'])
  assert.deepEqual(sections.at(-1)?.items, ['Pasta fresca y pizzas'])
})
