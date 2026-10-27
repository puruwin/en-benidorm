import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {
  type FactClaim, type OfficialSource, type PracticalFact, type PracticalFactsContext, type VisitEvidence,
  expectedSnapshot, validatePracticalFacts, valueAppearsLiterally,
} from './practical-facts'
import {checkVisitAgainstFacts, isVisitPath, parseSiteVisit, planVisitClaims, type SiteVisit, visitSource} from './site-visits'

const REF = 'visits/2026-10-20-levante.json'
const PHOTO = 'visits/fotos/2026-10-20-levante-1.jpg'
const OFFICIAL: OfficialSource[] = [{
  host: 'ayuntamiento.example', municipality: 'Benidorm', publisher: 'Ayuntamiento (ficticio)', approvedBy: 'David', approvedAt: '2026-10-01',
}]

function visit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'site-visit',
    observedAt: '2026-10-20',
    observer: 'David',
    sourceType: 'first-party-observation',
    place: {type: 'beach', name: 'Playa de Levante', municipality: 'Benidorm', documentId: 'beach-levante'},
    text: 'La zona azul de la avenida cobra 0,85 € la hora. Hay pasarela hasta la orilla.',
    checks: [
      {category: 'parking', quote: 'La zona azul de la avenida cobra 0,85 € la hora.', factId: 'benidorm.zona-azul.tarifa-hora', value: 0.85},
      {category: 'accessibility', quote: 'Hay pasarela hasta la orilla.'},
    ],
    photos: [PHOTO],
    ...overrides,
  }
}

const parse = (raw: unknown, photos: string[] = [PHOTO]) => parseSiteVisit(raw, `content/manual/${REF}`, (path) => photos.includes(path))
const messages = (issues: Array<{path: string; message: string}>) => issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n')

function zonaAzul(claims: FactClaim[] = []): PracticalFact {
  return {id: 'benidorm.zona-azul.tarifa-hora', subject: 'zona-azul', attribute: 'tarifa-hora', municipality: 'Benidorm', unit: 'EUR/h', claims}
}

function context(facts: PracticalFact[], visits: Record<string, VisitEvidence>): PracticalFactsContext {
  return {
    factFiles: [{source: 'content/facts/benidorm/aparcamiento.json', value: {facts}}],
    officialSources: OFFICIAL,
    observations: new Map(Object.entries(visits).map(([ref, item]) => [ref, item.observedAt])),
    visits: new Map(Object.entries(visits)),
  }
}

function parsedVisit(overrides: Record<string, unknown> = {}): SiteVisit {
  const {visit: parsed, issues} = parse(visit(overrides))
  assert.equal(messages(issues), '')
  return parsed!
}

test('una visita completa valida y conserva texto, comprobaciones y fotos tal cual', () => {
  const parsed = parsedVisit()
  assert.equal(parsed.text, visit().text)
  assert.equal(parsed.checks.length, 2)
  assert.deepEqual(parsed.photos, [PHOTO])
})

test('la plantilla del repo no es una visita válida ni se trata como tal', async () => {
  const template: unknown = JSON.parse(await readFile(new URL('../../../content/manual/_plantilla-visita.json', import.meta.url), 'utf8'))
  const {visit: parsed, issues} = parse(template, [])
  assert.equal(parsed, null)
  assert.match(messages(issues), /observedAt: Debe ser una fecha/)
  assert.equal(isVisitPath('_plantilla-visita.json'), false)
  assert.equal(isVisitPath('visits/_borrador.json'), false)
  assert.equal(isVisitPath(REF), true)
})

test('exige fecha, lugar, quién observó, texto, comprobaciones y fotos existentes', () => {
  const {issues} = parse(visit({observedAt: '2026-13-01', observer: ' ', place: {type: 'mercado', name: '', municipality: 'Madrid', documentId: ''}, text: '', checks: [], photos: ['../fuera.jpg', 'visits/fotos/no-existe.jpg', 'visits/nota.txt']}))
  const text = messages(issues)
  for (const field of ['observedAt', 'observer', 'place.type', 'place.name', 'place.municipality', 'place.documentId', 'text', 'checks', 'photos[0]', 'photos[1]', 'photos[2]']) {
    assert.match(text, new RegExp(`^${field.replace(/[.[\]]/g, '\\$&')}:`, 'm'), `falta error en ${field}`)
  }
})

test('rechaza una fecha futura y campos que el contrato no recoge (opiniones, valoraciones)', () => {
  const {issues} = parse(visit({observedAt: '2999-01-01', rating: 5, checks: [{category: 'services', quote: 'Hay pasarela hasta la orilla.', opinion: 'muy cómoda'}]}))
  const text = messages(issues)
  assert.match(text, /observedAt: No puede ser una fecha futura/)
  assert.match(text, /^rating: Campo no admitido/m)
  assert.match(text, /checks\[0\]\.opinion: Campo no admitido/)
})

test('una cita que no está literalmente en el texto invalida la visita', () => {
  const {visit: parsed, issues} = parse(visit({checks: [{category: 'access', quote: 'Hay una pasarela muy cómoda hasta la orilla.'}]}))
  assert.equal(parsed, null)
  assert.match(messages(issues), /checks\[0\]\.quote: No aparece literalmente en text/)
})

test('factId sin value, o value sin factId, no valida', () => {
  const {issues} = parse(visit({checks: [
    {category: 'price', quote: 'La zona azul de la avenida cobra 0,85 € la hora.', factId: 'benidorm.zona-azul.tarifa-hora'},
    {category: 'price', quote: 'La zona azul de la avenida cobra 0,85 € la hora.', value: 0.85},
  ]}))
  assert.match(messages(issues), /checks\[0\]\.value: Con factId, value es obligatorio/)
  assert.match(messages(issues), /checks\[1\]\.value: Sin factId no hay hecho/)
})

test('el valor tiene que estar escrito en la cita: números, horas y texto', () => {
  assert.equal(valueAppearsLiterally(0.85, 'EUR/h', 'cobra 0,85 € la hora'), true)
  assert.equal(valueAppearsLiterally(0.85, 'EUR/h', 'cobra 0.85 € la hora'), true)
  assert.equal(valueAppearsLiterally(2, 'EUR', 'la hamaca cuesta 2,00 €'), true)
  assert.equal(valueAppearsLiterally(2, 'EUR', 'la hamaca cuesta 12 €'), false)
  assert.equal(valueAppearsLiterally(2, 'EUR', 'la hamaca cuesta 2,50 €'), false)
  assert.equal(valueAppearsLiterally(0.85, 'EUR/h', 'cobra menos de un euro la hora'), false)
  assert.equal(valueAppearsLiterally('09:00-21:00', 'hh:mm', 'Socorrismo de 9:00 a 21:00'), true)
  assert.equal(valueAppearsLiterally('09:00-21:00', 'hh:mm', 'Socorrismo por la mañana'), false)
  assert.equal(valueAppearsLiterally('pasarela', 'texto', 'Hay Pasarela hasta la orilla.'), true)
  assert.equal(valueAppearsLiterally('pasarela accesible', 'texto', 'Hay pasarela hasta la orilla.'), false)
})

test('contra el registro: un factId inexistente o un valor que no está en la cita se reporta', () => {
  const facts = new Map([[zonaAzul().id, zonaAzul()]])
  const missing = parsedVisit({checks: [{category: 'parking', quote: 'La zona azul de la avenida cobra 0,85 € la hora.', factId: 'benidorm.parking-x.tarifa-hora', value: 0.85}]})
  assert.match(messages(checkVisitAgainstFacts(missing, REF, facts)), /no existe en content\/facts/)
  const invented = parsedVisit({checks: [{category: 'parking', quote: 'La zona azul de la avenida cobra 0,85 € la hora.', factId: 'benidorm.zona-azul.tarifa-hora', value: 1.2}]})
  assert.match(messages(checkVisitAgainstFacts(invented, REF, facts)), /1\.2 \(EUR\/h\) no está escrito literalmente/)
  assert.deepEqual(checkVisitAgainstFacts(parsedVisit(), REF, facts), [])
})

test('planVisitClaims propone un claim manual-first-party por hecho y es idempotente', () => {
  const parsed = parsedVisit()
  const [plan, ...rest] = planVisitClaims(parsed, REF, new Map([[zonaAzul().id, zonaAzul()]]))
  assert.equal(rest.length, 0)
  assert.equal(plan!.factId, 'benidorm.zona-azul.tarifa-hora')
  assert.equal(plan!.claim.value, 0.85)
  assert.equal(plan!.claim.observationRef, REF)
  assert.equal(plan!.claim.source.sourceClass, 'manual-first-party')
  assert.equal(plan!.claim.source.retrievedAt, '2026-10-20T00:00:00.000Z')
  assert.equal(plan!.alreadyPresent, false)

  const again = planVisitClaims(parsed, REF, new Map([[zonaAzul().id, zonaAzul([plan!.claim])]]))
  assert.equal(again[0]!.alreadyPresent, true)
})

test('un booleano se marca para confirmar y un valor distinto avisa del conflicto', () => {
  const parsed = parsedVisit({checks: [{category: 'accessibility', quote: 'Hay pasarela hasta la orilla.', factId: 'benidorm.levante.pasarela', value: true}]})
  const pasarela: PracticalFact = {id: 'benidorm.levante.pasarela', subject: 'levante', attribute: 'pasarela', municipality: 'Benidorm', unit: 'booleano', claims: [{value: false, source: {...visitSource(parsed, 'visits/otra.json', 0), attribution: 'Visita anterior'}, observationRef: 'visits/otra.json'}]}
  const [plan] = planVisitClaims(parsed, REF, new Map([[pasarela.id, pasarela]]))
  assert.equal(plan!.needsConfirmation, true)
  assert.deepEqual(plan!.otherValues, ['false (Visita anterior)'])
})

test('un claim respaldado por la visita confirma el hecho como «Comprobado en persona»', () => {
  const parsed = parsedVisit()
  const [plan] = planVisitClaims(parsed, REF, new Map([[zonaAzul().id, zonaAzul()]]))
  const fact = zonaAzul([plan!.claim])
  const snapshot = expectedSnapshot(fact)
  assert.equal(snapshot.status, 'confirmed')
  assert.equal(snapshot.sourceClass, 'manual-first-party')
  assert.equal(snapshot.value, '0.85')

  const page = {document: {_id: 'beach-levante', _type: 'beach', municipality: 'Benidorm', practicalFacts: [snapshot]}, source: 'content/generated/beach-levante.json'}
  assert.deepEqual(validatePracticalFacts([page], context([fact], {[REF]: parsed})), [])
})

test('el registro rechaza claims de visita que la visita no respalda', () => {
  const parsed = parsedVisit()
  const base = visitSource(parsed, REF, 0)

  const otherValue = validatePracticalFacts([], context([zonaAzul([{value: 2.2, source: base, observationRef: REF}])], {[REF]: parsed}))
  assert.match(messages(otherValue), /No coincide con el valor anotado en la visita/)

  const noCheck = parsedVisit({checks: [{category: 'accessibility', quote: 'Hay pasarela hasta la orilla.'}]})
  const unchecked = validatePracticalFacts([], context([zonaAzul([{value: 0.85, source: base, observationRef: REF}])], {[REF]: noCheck}))
  assert.match(messages(unchecked), /no registra ninguna comprobación de "benidorm\.zona-azul\.tarifa-hora"/)

  const invalid: PracticalFactsContext = {...context([zonaAzul([{value: 0.85, source: base, observationRef: REF}])], {}), observations: new Map([[REF, '2026-10-20']])}
  assert.match(messages(validatePracticalFacts([], invalid)), /no supera la validación de visitas de campo/)
})

test('el registro rechaza un claim de visita cuyo valor no está escrito en la cita', () => {
  const tampered: VisitEvidence = {observedAt: '2026-10-20', checks: [{factId: 'benidorm.zona-azul.tarifa-hora', value: 0.85, quote: 'La zona azul es barata.'}]}
  const claim: FactClaim = {value: 0.85, source: visitSource(parsedVisit(), REF, 0), observationRef: REF}
  assert.match(messages(validatePracticalFacts([], context([zonaAzul([claim])], {[REF]: tampered}))), /no está escrito literalmente en la cita/)
})
