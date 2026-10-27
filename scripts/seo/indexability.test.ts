import assert from 'node:assert/strict'
import test from 'node:test'
import {comparisonIndexability, isIndexable, parseIndexabilitySignals, restaurantIndexability, structuralIndexability, type IndexabilityInput, type IndexabilityReasonCode} from '../../src/lib/indexability'
import type {BusinessDetail, ComparisonDetail} from '../../src/types/content'

const official = {title: 'official-website: https://local.test/', url: 'https://local.test/', publisher: 'Sitio web oficial de Local', accessedAt: '2026-10-06'}
const osm = {title: 'OpenStreetMap', url: 'https://www.openstreetmap.org/node/1', accessedAt: '2026-10-06'}
const creator = {creator: '@comeenbenidorm', url: 'https://www.instagram.com/reel/abc/', publishedAt: '2026-09-12', summary: 'Destaca el arroz del senyoret y la espera de 20 minutos.'}

/** Ficha que cumple todo: web oficial fechada, dirección, foto propia y dos enlaces del cuerpo. */
function ficha(overrides: Partial<IndexabilityInput> = {}): IndexabilityInput {
  return {
    route: '/restaurantes/local/', kind: 'ficha', storedNoIndex: false, demo: false,
    evidence: {officialFact: true, ownObservation: false, creatorObservations: []},
    hasAddress: true, contributions: ['own-photo'], subject: 'Casa Local',
    title: 'Casa Local: arroces en el Rincón de Loix', titleIsFallback: false, h1: 'Casa Local', incomingContextualLinks: 2,
    ...overrides,
  }
}

const codes = (input: IndexabilityInput): IndexabilityReasonCode[] => isIndexable(input).reasons.map((reason) => reason.code)

test('pasa: ficha con web oficial, dirección, foto propia y dos enlaces contextuales', () => {
  assert.deepEqual(isIndexable(ficha()), {indexable: true, reasons: []})
})

test('pasa: ficha cuya única evidencia y aportación es una observación de creador atribuida, fechada y resumida', () => {
  const input = ficha({evidence: {officialFact: false, ownObservation: false, creatorObservations: [creator]}, contributions: ['creator-summary']})
  assert.equal(isIndexable(input).indexable, true)
})

test('pasa: comparativa con aportación propia y estructural / sin enlaces', () => {
  const comparison = ficha({route: '/donde-comer/arroces/', kind: 'comparison', hasAddress: false, contributions: ['comparison', 'warning'], subject: 'Dónde comer arroz en Benidorm', title: 'Dónde comer arroz en Benidorm: comparación', h1: 'Dónde comer arroz en Benidorm: cartas y precios'})
  assert.deepEqual(codes(comparison), [])
  const home = ficha({route: '/', kind: 'structural', evidence: {officialFact: false, ownObservation: false, creatorObservations: []}, hasAddress: false, contributions: [], subject: 'Benidorm', title: 'enBenidorm · Guía de Benidorm', h1: 'Benidorm de verdad', incomingContextualLinks: null})
  assert.deepEqual(codes(home), [])
})

test('no pasa: sin evidencia (solo OSM) ni dirección', () => {
  assert.deepEqual(codes(ficha({evidence: {officialFact: false, ownObservation: false, creatorObservations: []}})), ['no-evidence'])
  assert.deepEqual(codes(ficha({hasAddress: false})), ['no-address'])
})

test('no pasa: sin aportación propia; enlazar comparativas no es una comparación', () => {
  assert.deepEqual(codes(ficha({contributions: []})), ['no-contribution'])
  // Lo que construye el adaptador para una ficha que solo «Aparece en estas comparativas».
  const signals = restaurantIndexability(business({comparisons: [{title: 'Arroces', slug: 'arroces', href: '/donde-comer/arroces/'}]}), {demo: false})
  assert.deepEqual(signals.contributions, [])
})

test('no pasa: observación de creador sin @, sin fecha o sin resumen', () => {
  const only = (observation: typeof creator) => ficha({evidence: {officialFact: false, ownObservation: false, creatorObservations: [observation]}, contributions: ['creator-summary']})
  assert.deepEqual(codes(only({...creator, creator: 'comeenbenidorm'})), ['no-evidence', 'no-contribution'])
  assert.deepEqual(codes(only({...creator, publishedAt: ''})), ['no-evidence', 'no-contribution'])
  assert.deepEqual(codes(only({...creator, summary: '  '})), ['no-contribution'])
})

test('no pasa: menos de dos enlaces contextuales o crawl.json sin la ruta', () => {
  assert.deepEqual(codes(ficha({incomingContextualLinks: 1})), ['few-links'])
  assert.deepEqual(codes(ficha({incomingContextualLinks: null})), ['links-unknown'])
})

test('no pasa: título de respaldo, o título o H1 que no nombran el sujeto', () => {
  assert.deepEqual(codes(ficha({titleIsFallback: true})), ['title-fallback'])
  assert.deepEqual(codes(ficha({title: null, h1: null})), ['title-missing', 'h1-missing'])
  assert.deepEqual(codes(ficha({title: 'Restaurante en Benidorm', h1: 'Arroces'})), ['title-subject', 'h1-subject'])
  // Sin mayúsculas ni tildes.
  assert.deepEqual(codes(ficha({subject: 'Café Ñandú', title: 'CAFE ÑANDU en Levante', h1: 'café ñandú'})), [])
})

test('no pasa aunque cumpla todo: noIndex guardado o demo', () => {
  assert.deepEqual(codes(ficha({storedNoIndex: true})), ['stored-noindex'])
  assert.deepEqual(codes(ficha({demo: true})), ['demo'])
})

test('devuelve todos los motivos, no solo el primero', () => {
  const input = ficha({demo: true, evidence: {officialFact: false, ownObservation: false, creatorObservations: []}, hasAddress: false, contributions: [], incomingContextualLinks: 0, titleIsFallback: true})
  assert.deepEqual(codes(input), ['demo', 'no-evidence', 'no-address', 'no-contribution', 'few-links', 'title-fallback'])
})

test('restaurantIndexability: web oficial fechada y observación manual son evidencia; OSM no', () => {
  assert.equal(restaurantIndexability(business({sources: [osm]}), {demo: false}).evidence.officialFact, false)
  assert.equal(restaurantIndexability(business({sources: [osm, official]}), {demo: false}).evidence.officialFact, true)
  assert.equal(restaurantIndexability(business({sources: [{...official, accessedAt: undefined as unknown as string}]}), {demo: false}).evidence.officialFact, false)
  const manual = {title: 'manual-observation: visita', url: 'https://enbenidorm.es/', publisher: 'Observación local de primera mano', accessedAt: '2026-10-06'}
  assert.equal(restaurantIndexability(business({sources: [manual]}), {demo: false}).evidence.ownObservation, true)
  assert.equal(restaurantIndexability(business({seo: {}}), {demo: false}).titleIsFallback, true)
})

test('comparisonIndexability: comparación, condiciones y advertencias; el sujeto es el tema del H1', () => {
  const signals = comparisonIndexability(comparison())
  assert.deepEqual(signals.contributions, ['comparison', 'practical-condition', 'warning'])
  assert.equal(signals.subject, 'Dónde comer arroz en Benidorm')
  assert.equal(signals.evidence.officialFact, true)
  assert.equal(comparisonIndexability(comparison({seo: {title: 'T', noIndex: true}})).storedNoIndex, true)
})

test('las señales sobreviven al meta y un meta roto se rechaza', () => {
  const signals = structuralIndexability({subject: 'Dónde comer', h1: 'Dónde comer en Benidorm', title: 'Dónde comer en Benidorm · enBenidorm'})
  assert.deepEqual(parseIndexabilitySignals(JSON.stringify(signals)), signals)
  assert.equal(parseIndexabilitySignals('{"kind":"ficha"}'), null)
  assert.equal(parseIndexabilitySignals('no es json'), null)
  assert.equal(parseIndexabilitySignals(null), null)
})

function business(overrides: Partial<BusinessDetail> = {}): BusinessDetail {
  return {
    name: 'Casa Local', slug: 'local', href: '/restaurantes/local/', shortDescription: 'Arroces.', kind: 'Restaurante', categories: [],
    description: [], address: {street: 'Calle Mayor 1', postalCode: '03501', locality: 'Benidorm', province: 'Alicante', country: 'España'},
    hours: [], features: [], images: [], sources: [official], seo: {title: 'Casa Local en Benidorm', description: 'D'},
    ...overrides,
  }
}

function comparison(overrides: Partial<ComparisonDetail> = {}): ComparisonDetail {
  const entry = {verdict: 'V', strengths: ['S'], conditions: ['Reserva para 2'], limitations: ['Horario sin confirmar'], bestFor: [], practicalNotes: [], business: {name: 'Casa Local', slug: 'local', href: '/restaurantes/local/', kind: 'Restaurante'}}
  return {
    title: 'Dónde comer arroz en Benidorm: cartas y precios', slug: 'arroces', href: '/donde-comer/arroces/', topic: 'arroces', intro: 'I', quickVerdict: 'Q',
    choiceGuide: [], entries: [entry], methodology: 'M', criteria: [], author: {name: 'David', slug: 'david'}, sources: [{...official, title: 'Web oficial'}],
    lastVerified: '2026-10-06', seo: {title: 'Dónde comer arroz en Benidorm: comparación'},
    ...overrides,
  }
}
