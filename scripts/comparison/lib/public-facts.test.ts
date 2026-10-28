import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import test from 'node:test'
import type {ContentDocument} from '../../content-validation'
import {validateContent} from '../../content-validation'
import {groupPublicSources, priceContext} from '../../../src/lib/comparison-presentation'
import {buildComparisonArtifact} from './generation'
import {canonicalSourceKey, classifyLimitation, normalizePriceUnit} from './public-facts'
import {inspectComparison} from './qa'
import type {ComparisonEvidenceFact, EnrichedComparisonArtifact, GeneratedComparisonArtifact} from './types'

// Regression for issue #10, built from the arroces comparison (content/manual/comparisons/arroces.json).

// Copia congelada de los artefactos persistidos de arroces (enriched y .staging, ignorados por Git),
// para que el replay corra igual en cualquier checkout. Actualízalos solo a propósito.
const ARROCES_ENRICHED = resolve(import.meta.dirname, '__fixtures__/comparison-arroces.enriched.json')
const ARROCES_STAGING = resolve(import.meta.dirname, '__fixtures__/comparison-arroces.staging.json')

function fact(id: string, value: string, nature: ComparisonEvidenceFact['nature'] = 'factual'): ComparisonEvidenceFact {
  return {id, value, nature, sourceKeys: ['official-website:https://example.com/carta']}
}

test('arroces: las condiciones publicadas no van a «Lo que no pudimos comprobar»', () => {
  const published = [
    fact('ongi:limitation:minimo-dos', 'Los arroces y paellas exigen un mínimo de 2 personas'),
    fact('ongi:limitation:bogavante-encargo', 'El arroz caldoso con bogavante requiere encargo'),
    fact('la-bahia:limitation:menu-grupos-minimo', 'El menú para grupos exige un mínimo de 8 personas'),
    fact('cordoba:limitation:minimo-dos', 'Los arroces y la fideuá exigen un mínimo de 2 personas'),
  ]
  for (const item of published) assert.equal(classifyLimitation(`${String(item.value)}.`, [item]), 'condition', String(item.value))

  const missing = [
    fact('jardin:limitation:carta-actualizacion', 'La carta digital está en actualización y no publica precios de los arroces', 'external_observation'),
    fact('trasto:limitation:paella-disponibilidad', 'La web no indica qué días incluye paella el menú del día', 'external_observation'),
  ]
  for (const item of missing) assert.equal(classifyLimitation(String(item.value), [item]), 'unverified', String(item.value))
})

test('una condición sin fuente o con fuentes en conflicto no se presenta como publicada', () => {
  assert.equal(classifyLimitation('Exige un mínimo de 2 personas'), 'unverified')
  const conflicted = fact('x:limitation:minimo', 'Exige un mínimo de 2 personas')
  assert.equal(classifyLimitation('Exige un mínimo de 2 personas', [conflicted], [{
    businessId: 'x', dimension: 'limitations', conflictingSourceKeys: conflicted.sourceKeys, resolution: 'Las fuentes discrepan.',
  }]), 'unverified')
})

test('arroces: variantes de idioma y de esquema de una página son una sola fuente', () => {
  const ulia = ['https://restauranteulia.es/', ...['es', 'en', 'ru', 'fr'].map((lang) => `https://restauranteulia.es/Base/ChangeLang/${lang}`)]
  assert.equal(new Set(ulia.map(canonicalSourceKey)).size, 1)
  assert.notEqual(canonicalSourceKey('https://restauranteulia.es/carta/Platos/7'), canonicalSourceKey('https://restauranteulia.es/'))
  assert.equal(canonicalSourceKey('http://www.marisqueriacordoba.com/la-carta.html'), canonicalSourceKey('https://www.marisqueriacordoba.com/la-carta.html'))
  assert.equal(canonicalSourceKey('https://trastobar.eatbu.com/?lang=es'), canonicalSourceKey('https://trastobar.eatbu.com/?lang=en'))
  assert.equal(canonicalSourceKey('https://example.com/en/carta/'), canonicalSourceKey('https://example.com/carta'))
})

test('arroces: la unidad del precio se normaliza o queda ambigua, nunca se elige una', () => {
  assert.equal(normalizePriceUnit('por persona; mínimo 2 personas'), 'per-person')
  assert.equal(normalizePriceUnit('por persona; mínimo 2 personas; por encargo'), 'per-person')
  assert.equal(normalizePriceUnit('por ración; mínimo 2 personas'), 'per-portion')
  assert.equal(normalizePriceUnit('cada unidad'), 'per-unit')
  assert.equal(normalizePriceUnit(undefined), 'ambiguous')
  assert.equal(normalizePriceUnit('desde'), 'ambiguous')
  assert.equal(normalizePriceUnit('mínimo 2 personas'), 'ambiguous')
  assert.equal(normalizePriceUnit('por persona o por ración'), 'ambiguous')
  assert.equal(normalizePriceUnit('incluye entrante, plato principal, pan y bebida'), 'ambiguous')
  assert.equal(priceContext({priceUnit: 'ambiguous'}), 'unidad no indicada en la carta')
  assert.equal(priceContext({priceQualifier: 'por ración; mínimo 2 personas', priceUnit: 'per-portion'}), 'por ración; mínimo 2 personas')
})

test('arroces: la página agrupa fuentes heredadas sin repetir variantes', () => {
  const groups = groupPublicSources([
    {title: 'Web oficial', publisher: 'Ulia', url: 'https://restauranteulia.es/'},
    {title: 'Web oficial', publisher: 'Ulia', url: 'https://restauranteulia.es/Base/ChangeLang/en'},
    {title: 'Carta', publisher: 'Marisquería Córdoba', url: 'http://www.marisqueriacordoba.com/la-carta.html'},
    {title: 'Carta', publisher: 'Marisquería Córdoba', url: 'https://www.marisqueriacordoba.com/la-carta.html'},
  ])
  assert.deepEqual(groups.map((group) => group.sources.length), [1, 1])
})

test('arroces: replay del artefacto persistido separa condiciones, deduplica fuentes y fija la unidad', async () => {
  const enriched = JSON.parse(await readFile(ARROCES_ENRICHED, 'utf8')) as EnrichedComparisonArtifact
  const legacy = JSON.parse(await readFile(ARROCES_STAGING, 'utf8')) as GeneratedComparisonArtifact
  const businesses = new Map<string, ContentDocument>(enriched.businesses.map((business) => [business.businessId, {_id: business.businessId, _type: 'business'}]))

  // The artifact generated before the fix shows the three defects in QA.
  const legacyCodes = new Set(inspectComparison(legacy, enriched, businesses).issues.map((issue) => issue.code))
  for (const code of ['PUBLISHED_CONDITION_AS_UNVERIFIED', 'DUPLICATE_SOURCE_VARIANT', 'PRICE_UNIT_MISMATCH']) assert.ok(legacyCodes.has(code), code)

  // Rebuilt in memory from the same editorial: nothing is regenerated or written.
  const rebuilt = buildComparisonArtifact(enriched, legacy.editorial, legacy.generatedAt)
  const entries = new Map(rebuilt.editorial.entries.map((entry) => [entry.businessId, entry]))
  assert.deepEqual(entries.get('business-ongi-etorri')?.conditions, ['Los arroces y paellas exigen un mínimo de 2 personas.', 'El arroz caldoso con bogavante requiere encargo.'])
  assert.deepEqual(entries.get('business-ongi-etorri')?.limitations, [])
  assert.ok(entries.get('business-cafeteria-la-bahia')?.conditions?.includes('El menú para grupos exige un mínimo de 8 personas.'))
  assert.deepEqual(entries.get('business-jardin-mediterraneo')?.limitations, ['La carta digital está en actualización y no publica precios de los arroces.'])
  assert.deepEqual(entries.get('business-restaurante-trasto-bar')?.limitations, ['La web no indica qué días incluye paella el menú del día.'])
  assert.ok(rebuilt.editorial.claims.some((claim) => claim.path === 'entries.business-ongi-etorri.conditions.0' && claim.supportedBy.includes('ongi:limitation:minimo-dos')))
  assert.ok(!rebuilt.editorial.claims.some((claim) => claim.path === 'entries.business-ongi-etorri.limitations.0'))

  const sources = rebuilt.document.sources as Array<{publisher: string; url: string}>
  const ulia = sources.filter((source) => source.publisher === 'Ulia').map((source) => source.url)
  assert.deepEqual(ulia, ['https://www.openstreetmap.org/node/4405971162', 'https://restauranteulia.es/', 'https://restauranteulia.es/carta/Platos/7'])
  const cordobaCarta = sources.filter((source) => source.publisher === 'Marisquería Córdoba' && source.url.endsWith('/la-carta.html'))
  assert.deepEqual(cordobaCarta.map((source) => source.url), ['https://www.marisqueriacordoba.com/la-carta.html'])

  const documentEntries = rebuilt.document.entries as Array<{business: {_ref: string}; featuredItem?: {priceUnit?: string}}>
  const unit = (id: string) => documentEntries.find((entry) => entry.business._ref === id)?.featuredItem?.priceUnit
  assert.equal(unit('business-ongi-etorri'), 'per-person')
  assert.equal(unit('business-marisqueria-cordoba'), 'per-portion')
  assert.equal(unit('business-la-cava-aragonesa'), 'per-unit')
  assert.equal(unit('business-ulia'), 'ambiguous')
  assert.equal(unit('business-cafeteria-la-bahia'), undefined, 'sin precio no hay unidad')

  const issues = inspectComparison(rebuilt, enriched, businesses).issues
  for (const code of ['PUBLISHED_CONDITION_AS_UNVERIFIED', 'DUPLICATE_SOURCE_VARIANT', 'PRICE_UNIT_MISMATCH']) assert.ok(!issues.some((issue) => issue.code === code), code)
  assert.ok(issues.some((issue) => issue.code === 'PRICE_UNIT_AMBIGUOUS' && issue.path === 'entries.business-ulia.featuredItem.priceUnit' && issue.severity === 'WARNING'))
  assert.deepEqual(validateContent([{document: rebuilt.document, source: 'test', expectedType: 'comparison'}], {allowUnresolvedReferences: true}).issues, [])
})

test('QA marca una unidad de precio que no sale de la carta', async () => {
  const enriched = JSON.parse(await readFile(ARROCES_ENRICHED, 'utf8')) as EnrichedComparisonArtifact
  const legacy = JSON.parse(await readFile(ARROCES_STAGING, 'utf8')) as GeneratedComparisonArtifact
  const rebuilt = buildComparisonArtifact(enriched, legacy.editorial, legacy.generatedAt)
  const ulia = (rebuilt.document.entries as Array<{business: {_ref: string}; featuredItem?: {priceUnit?: string}}>).find((entry) => entry.business._ref === 'business-ulia')!
  ulia.featuredItem!.priceUnit = 'per-person'
  const businesses = new Map<string, ContentDocument>(enriched.businesses.map((business) => [business.businessId, {_id: business.businessId, _type: 'business'}]))
  assert.ok(inspectComparison(rebuilt, enriched, businesses).issues.some((issue) => issue.code === 'PRICE_UNIT_MISMATCH' && issue.path === 'entries.business-ulia.featuredItem.priceUnit'))
})
