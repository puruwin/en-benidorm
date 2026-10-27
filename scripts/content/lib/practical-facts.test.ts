import assert from 'node:assert/strict'
import test from 'node:test'
import {type ContentDocument, validateContent} from '../../content-validation'
import {
  deriveFactStatus, expectedSnapshot, type FactClaim, type FactDocument, type OfficialSource, type PracticalFact,
  type PracticalFactsContext, validatePracticalFacts,
} from './practical-facts'
import type {SourceClass, SourceProvenance} from './types'

const OFFICIAL: OfficialSource[] = [{
  host: 'ayuntamiento.example', municipality: 'Benidorm', publisher: 'Ayuntamiento (ficticio)', approvedBy: 'David', approvedAt: '2026-10-01',
}]

function source(sourceClass: SourceClass, url: string | null, retrievedAt = '2026-10-20T10:00:00.000Z'): SourceProvenance {
  return {key: `${sourceClass}:${url ?? 'manual'}`, provider: 'test', identifier: url ?? 'manual', url, retrievedAt, attribution: `Fuente ${sourceClass}`, licenseUrl: null, sourceClass}
}

const municipal = (value: number, retrievedAt?: string): FactClaim => ({value, source: source('official-location', 'https://www.ayuntamiento.example/zona-azul', retrievedAt)})
const blog = (value: number, retrievedAt?: string): FactClaim => ({value, source: source('third-party', 'https://blog.example/aparcar', retrievedAt)})

function zonaAzul(claims: FactClaim[], extra: Partial<PracticalFact> = {}): PracticalFact {
  return {id: 'benidorm.zona-azul.tarifa-hora', subject: 'zona-azul', attribute: 'tarifa-hora', municipality: 'Benidorm', unit: 'EUR/h', claims, ...extra}
}

function context(facts: PracticalFact[], observations: Record<string, string | null> = {}): PracticalFactsContext {
  return {
    factFiles: [{source: 'content/facts/benidorm/aparcamiento.json', value: {facts}}],
    officialSources: OFFICIAL,
    observations: new Map(Object.entries(observations)),
  }
}

function page(id: string, type: 'place' | 'beach' | 'article', fields: Record<string, unknown>): FactDocument {
  return {document: {_id: id, _type: type, ...fields}, source: `content/generated/${id}.json`}
}

const messages = (issues: Array<{message: string}>) => issues.map((issue) => issue.message).join('\n')

test('dos tarifas contradictorias de la zona azul pasan a «conflict» y bloquean las dos páginas', () => {
  const fact = zonaAzul([municipal(0.85), blog(2.2)])
  assert.equal(deriveFactStatus(fact), 'conflict')

  const snapshot = {factId: fact.id, value: null, unit: 'EUR/h', municipality: 'Benidorm', status: 'conflict'}
  const issues = validatePracticalFacts([
    page('article-aparcar', 'article', {practicalFacts: [snapshot]}),
    page('beach-levante', 'beach', {municipality: 'Benidorm', practicalFacts: [snapshot]}),
  ], context([fact]))

  assert.deepEqual(issues.map((issue) => issue.source).sort(), ['content/generated/article-aparcar.json', 'content/generated/beach-levante.json'])
  for (const issue of issues) assert.match(issue.message, /«conflict».*0\.85 EUR\/h.*2\.2 EUR\/h/)
})

test('el mismo hecho copiado con valores distintos en dos páginas es «conflict» en ambas', () => {
  const fact = zonaAzul([municipal(0.85)])
  const good = expectedSnapshot(fact)
  const issues = validatePracticalFacts([
    page('article-aparcar', 'article', {practicalFacts: [good]}),
    page('beach-levante', 'beach', {municipality: 'Benidorm', practicalFacts: [{...good, value: '2.2'}]}),
  ], context([fact]))

  const conflicts = issues.filter((issue) => issue.message.includes('valores distintos entre páginas'))
  assert.deepEqual(conflicts.map((issue) => issue.source).sort(), ['content/generated/article-aparcar.json', 'content/generated/beach-levante.json'])
  assert.match(messages(issues), /Copia desactualizada.*value/)
})

test('el mismo valor citado en dos páginas es válido y queda «confirmed»', () => {
  const fact = zonaAzul([municipal(0.85), blog(0.85)])
  const snapshot = expectedSnapshot(fact)
  assert.equal(snapshot.status, 'confirmed')
  assert.equal(snapshot.value, '0.85')
  assert.equal(snapshot.sourceClass, 'official-location')
  assert.deepEqual(validatePracticalFacts([
    page('article-aparcar', 'article', {practicalFacts: [snapshot]}),
    page('beach-levante', 'beach', {municipality: 'Benidorm', practicalFacts: [snapshot]}),
  ], context([fact])), [])
  const numeric = validatePracticalFacts([page('article-aparcar', 'article', {practicalFacts: [{...snapshot, value: 0.85}]})], context([fact]))
  assert.match(messages(numeric), /Copia desactualizada.*value/)
})

test('una resolución humana cierra el conflicto y un claim posterior lo reabre', () => {
  const resolution = {claimIndex: 0, reviewedBy: 'David', reviewedAt: '2026-10-21', reason: 'El blog cita la tarifa de 2024.'}
  assert.equal(deriveFactStatus(zonaAzul([municipal(0.85), blog(2.2)], {resolution})), 'confirmed')
  assert.equal(deriveFactStatus(zonaAzul([municipal(0.85), blog(2.2, '2026-10-25T09:00:00.000Z')], {resolution})), 'conflict')
})

test('sin claims el hecho es «unknown»; solo con terceros es «needs verification» y no publica cifra', () => {
  assert.equal(deriveFactStatus(zonaAzul([])), 'unknown')
  const fact = zonaAzul([blog(0.85)])
  assert.equal(deriveFactStatus(fact), 'needs verification')
  assert.equal(expectedSnapshot(fact).value, null)

  const issues = validatePracticalFacts([
    page('article-aparcar', 'article', {practicalFacts: [{...expectedSnapshot(fact), value: '0.85'}]}),
  ], context([fact]))
  assert.match(messages(issues), /«needs verification»: no se publica la cifra/)
})

test('un hecho de fuente oficial necesita una URL de un host aprobado', () => {
  const noUrl = zonaAzul([{value: 0.85, source: source('official-location', null)}])
  assert.match(messages(validatePracticalFacts([], context([noUrl]))), /necesita la URL oficial/)

  const candidate = zonaAzul([{value: 0.85, source: source('official-location', 'https://benidorm-parking.example/tarifas')}])
  assert.match(messages(validatePracticalFacts([], context([candidate]))), /no está aprobado como oficial para Benidorm/)

  const otherMunicipality = {...zonaAzul([municipal(0.85)]), id: 'finestrat.zona-azul.tarifa-hora', municipality: 'Finestrat' as const}
  assert.match(messages(validatePracticalFacts([], context([otherMunicipality]))), /no está aprobado como oficial para Finestrat/)
})

test('un hecho observado necesita una observación manual registrada con la misma fecha', () => {
  const observed = (observationRef?: string): PracticalFact => zonaAzul([{
    value: 0.85, source: source('manual-first-party', null, '2026-08-01T00:00:00.000Z'), ...(observationRef ? {observationRef} : {}),
  }])
  assert.match(messages(validatePracticalFacts([], context([observed()]))), /necesita la observación manual registrada/)
  assert.match(messages(validatePracticalFacts([], context([observed('observaciones/zona-azul.json')]))), /No existe la observación/)
  assert.match(messages(validatePracticalFacts([], context([observed('observaciones/zona-azul.json')], {'observaciones/zona-azul.json': '2026-08-02'}))), /No coincide con el observedAt/)
  assert.deepEqual(validatePracticalFacts([], context([observed('observaciones/zona-azul.json')], {'observaciones/zona-azul.json': '2026-08-01'})), [])
  assert.equal(deriveFactStatus(observed('observaciones/zona-azul.json')), 'confirmed')
})

test('un lugar fuera de Benidorm exige que la página mencione el traslado', () => {
  const market: PracticalFact = {
    id: 'l-alfas-del-pi.mercadillo-albir.dia', subject: 'mercadillo-albir', attribute: 'dia', municipality: "l'Alfàs del Pi", unit: 'día-semana',
    claims: [{value: 'domingo', source: source('third-party', 'https://agenda.example/albir')}],
  }
  const cite = {practicalFacts: [expectedSnapshot(market)]}
  assert.match(messages(validatePracticalFacts([page('article-mercadillos', 'article', cite)], context([market]))), /lugar en l'Alfàs del Pi: debe explicar el traslado/)
  assert.deepEqual(validatePracticalFacts([page('article-mercadillos', 'article', {
    ...cite, travelNotes: [{municipality: "l'Alfàs del Pi", text: 'Está a unos 15 minutos en autobús desde Benidorm.'}],
  })], context([market])), [])

  assert.match(messages(validatePracticalFacts([page('beach-cala', 'beach', {municipality: 'Finestrat'})], context([]))), /lugar en Finestrat/)
})

test('ids estables: formato, duplicados y hechos inexistentes', () => {
  const badId = zonaAzul([municipal(0.85)], {id: 'zona-azul-benidorm'})
  assert.match(messages(validatePracticalFacts([], context([badId]))), /Debe ser "benidorm\.zona-azul\.tarifa-hora"/)

  const duplicated: PracticalFactsContext = {
    ...context([zonaAzul([municipal(0.85)])]),
    factFiles: [
      {source: 'content/facts/benidorm/a.json', value: {facts: [zonaAzul([municipal(0.85)])]}},
      {source: 'content/facts/benidorm/b.json', value: {facts: [zonaAzul([municipal(0.85)])]}},
    ],
  }
  assert.match(messages(validatePracticalFacts([], duplicated)), /Id duplicado.*content\/facts\/benidorm\/a\.json/)

  const issues = validatePracticalFacts([page('article-x', 'article', {practicalFacts: [{factId: 'benidorm.no-existe.precio'}]})], context([]))
  assert.match(messages(issues), /no existe en content\/facts/)
})

test('con hechos citados, los campos libres heredados no pueden duplicar el dato; sin ellos todo sigue igual', () => {
  const fact = zonaAzul([municipal(0.85)])
  const issues = validatePracticalFacts([page('beach-levante', 'beach', {municipality: 'Benidorm', parking: 'Zona azul a 0,85 €/h', practicalFacts: [expectedSnapshot(fact)]})], context([fact]))
  assert.match(messages(issues), /Campo libre heredado/)
  assert.deepEqual(validatePracticalFacts([page('beach-levante', 'beach', {parking: 'Zona azul cercana'})], context([fact])), [])
})

test('validateContent bloquea la página en conflicto y, sin registro cargado, cualquier hecho citado', () => {
  const fact = zonaAzul([municipal(0.85), blog(2.2)])
  const beach: ContentDocument = {
    _id: 'beach-levante', _type: 'beach', name: 'Playa de Levante', slug: {_type: 'slug', current: 'levante'},
    shortDescription: 'Playa urbana.', language: 'es', municipality: 'Benidorm', seo: {},
    practicalFacts: [{factId: fact.id, value: null, unit: 'EUR/h', municipality: 'Benidorm', status: 'conflict'}],
  }
  const input = [{document: beach, source: 'content/generated/beaches/beach-levante.json', expectedType: 'beach'}]

  const withRegistry = validateContent(input, {practicalFacts: context([fact])}).issues
  assert.match(messages(withRegistry), /«conflict»/)
  assert.match(messages(validateContent(input).issues), /no existe en content\/facts/)
})

test('una tarifa que exige fuente municipal solo se confirma con el Ayuntamiento; sin él queda «needs verification» y sin cifra', () => {
  const generalitat: OfficialSource = {host: 'generalitat.example', municipality: '*', publisher: 'Generalitat (ficticia)', approvedBy: 'David', approvedAt: '2026-10-01'}
  const strict = (claims: FactClaim[]) => zonaAzul(claims, {requiresMunicipalSource: true})
  const visit: FactClaim = {value: 0.5, source: source('manual-first-party', null, '2026-10-20T00:00:00.000Z'), observationRef: 'parquimetro.json'}
  const brand: FactClaim = {value: 0.5, source: source('official-brand', 'https://www.ayuntamiento.example/marca')}

  assert.equal(deriveFactStatus(strict([municipal(0.5)])), 'confirmed')
  for (const claims of [[blog(0.5)], [visit], [brand]]) {
    const fact = strict(claims)
    assert.equal(deriveFactStatus(fact), 'needs verification')
    assert.equal(expectedSnapshot(fact).value, null)
  }
  // Sin la marca, la misma observación propia sí confirma: la regla no cambia otros hechos.
  assert.equal(deriveFactStatus(zonaAzul([visit])), 'confirmed')

  // Un host oficial de alcance `*` (Generalitat) no es fuente municipal.
  const fact = strict([{value: 0.5, source: source('official-location', 'https://dogv.generalitat.example/tarifas')}])
  const issues = validatePracticalFacts([], {...context([fact]), officialSources: [...OFFICIAL, generalitat]})
  assert.match(messages(issues), /exige fuente municipal/)
  assert.deepEqual(validatePracticalFacts([], {...context([strict([municipal(0.5)])]), officialSources: [...OFFICIAL, generalitat]}), [])

  const page2 = page('article-aparcar', 'article', {practicalFacts: [{...expectedSnapshot(strict([blog(0.5)])), value: '0.5'}]})
  assert.match(messages(validatePracticalFacts([page2], context([strict([blog(0.5)])]))), /no se publica la cifra/)
})

test('una resolución humana puede fijar un valor propio (p. ej. un rango) citando la fuente de un claim', () => {
  const fact: PracticalFact = {
    id: 'benidorm.aparcamientos.plazas', subject: 'aparcamientos', attribute: 'plazas', municipality: 'Benidorm', unit: 'texto',
    claims: [
      {value: 'Más de 8.000 plazas', source: source('official-location', 'https://www.ayuntamiento.example/nota')},
      {value: '7.005 plazas', source: source('official-location', 'https://www.ayuntamiento.example/plano')},
    ],
  }
  assert.equal(deriveFactStatus(fact), 'conflict')
  const resolved = {...fact, resolution: {claimIndex: 1, value: 'De 7.000 a 8.000 plazas', reviewedBy: 'David', reviewedAt: '2026-10-27', reason: 'Dos cifras oficiales de 2023.'}}
  const snapshot = expectedSnapshot(resolved)
  assert.equal(snapshot.status, 'confirmed')
  assert.equal(snapshot.value, 'De 7.000 a 8.000 plazas')
  assert.equal(snapshot.sourceUrl, 'https://www.ayuntamiento.example/plano')
  assert.deepEqual(validatePracticalFacts([], context([resolved])), [])
  // El valor debe valer para la unidad del hecho.
  const invalid = {...resolved, unit: 'EUR' as const, claims: resolved.claims.map((claim, index) => ({...claim, value: index + 1}))}
  assert.ok(validatePracticalFacts([], context([invalid])).some((issue) => issue.path.endsWith('resolution.value')))
})
