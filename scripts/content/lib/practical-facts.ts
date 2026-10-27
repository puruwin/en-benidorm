import {SOURCE_CLASSES, type SourceClass, type SourceProvenance} from './types'

/**
 * Hechos prácticos con procedencia (precio, horario, acceso, tarifa) para place, beach y article.
 *
 * Cada hecho vive una sola vez en `content/facts/<municipio>/<tema>.json`; las páginas lo citan por
 * id en `practicalFacts[]` con una copia (snapshot) que Sanity y Astro pintan. El estado nunca se
 * escribe a mano: se deriva de los claims. Todo aquí es puro; la lectura de archivos está en
 * `scripts/content-validation.ts`.
 */

export const HOME_MUNICIPALITY = 'Benidorm'
export const MUNICIPALITIES = [
  'Benidorm', 'Finestrat', "l'Alfàs del Pi", 'Altea', 'La Nucía', 'La Vila Joiosa', 'Polop', "Callosa d'en Sarrià",
] as const
export type Municipality = (typeof MUNICIPALITIES)[number]

export const FACT_UNITS = ['EUR', 'EUR/h', 'EUR/día', 'min', 'm', 'km', 'hh:mm', 'día-semana', 'texto', 'booleano'] as const
export type FactUnit = (typeof FACT_UNITS)[number]

export const FACT_STATUSES = ['confirmed', 'unknown', 'needs verification', 'conflict'] as const
export type FactStatus = (typeof FACT_STATUSES)[number]

export const FACT_DOCUMENT_TYPES = ['place', 'beach', 'article'] as const

export type FactValue = string | number | boolean

export interface FactClaim {
  value: FactValue
  source: SourceProvenance
  /** Ruta relativa a `content/manual/`; obligatoria si la fuente es `manual-first-party`. */
  observationRef?: string
}

/** Decisión humana sobre un conflicto. Separada de la evidencia automática; nunca la escribe Claude. */
export interface FactResolution {
  claimIndex: number
  reviewedBy: string
  reviewedAt: string
  reason: string
}

export interface PracticalFact {
  id: string
  subject: string
  attribute: string
  municipality: Municipality
  unit: FactUnit
  conditions?: string
  claims: FactClaim[]
  resolution?: FactResolution | null
}

/** Host aprobado por David como fuente oficial; `*` vale para cualquier municipio (p. ej. la Generalitat). */
export interface OfficialSource {
  host: string
  municipality: Municipality | '*'
  publisher: string
  approvedBy: string
  approvedAt: string
}

/**
 * Lo que la página guarda del hecho. `value` solo va relleno si el hecho está `confirmed`, y va como
 * texto canónico (`factValueText`) porque un campo de Sanity no admite tipos mixtos; la página lo
 * formatea según `unit`.
 */
export interface PracticalFactSnapshot {
  factId: string
  value: string | null
  unit: FactUnit
  municipality: Municipality
  status: FactStatus
  sourceTitle: string | null
  sourceUrl: string | null
  sourceClass: SourceClass | null
  retrievedAt: string | null
}

export interface FactIssue {
  source: string
  path: string
  message: string
}

export interface PracticalFactsContext {
  /** Archivos de `content/facts/<municipio>/*.json` sin interpretar. */
  factFiles: ReadonlyArray<{source: string; value: unknown}>
  /** Contenido de `content/facts/official-sources.json` sin interpretar. */
  officialSources: unknown
  /** Ruta relativa a `content/manual/` → `observedAt` del archivo (null si no lo declara). */
  observations: ReadonlyMap<string, string | null>
  /** Visitas de campo válidas (`content/manual/visits/`), por la misma ruta relativa. */
  visits?: ReadonlyMap<string, VisitEvidence>
}

/** Lo que el registro necesita de una visita de campo (`site-visits.ts`) para aceptar un claim observado. */
export interface VisitEvidence {
  observedAt: string
  checks: ReadonlyArray<{factId?: string; value?: FactValue; quote: string}>
}

export const VISITS_DIRECTORY = 'visits/'

export const EMPTY_PRACTICAL_FACTS_CONTEXT: PracticalFactsContext = {factFiles: [], officialSources: [], observations: new Map()}

export interface FactDocument {
  document: Record<string, unknown> & {_id: string; _type: string}
  source: string
}

export interface ResolvedFact {
  status: FactStatus
  /** Claim que respalda lo publicado: el elegido por la resolución o el mejor según la jerarquía. */
  claim: FactClaim | null
}

const ID_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CONFIRMING_CLASSES: ReadonlySet<SourceClass> = new Set(['official-location', 'official-brand', 'manual-first-party'])
const OFFICIAL_CLASSES: ReadonlySet<SourceClass> = new Set(['official-location', 'official-brand'])

// --- Estado -------------------------------------------------------------------------------------

/** Clave de comparación de un valor: mismo tipo y mismo texto normalizado. */
export function normalizeFactValue(value: FactValue): string {
  if (typeof value === 'string') return `string:${value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()}`
  return `${typeof value}:${String(value)}`
}

/** Texto canónico de un valor en el snapshot: `0.85`, `true`, `domingo`. */
export function factValueText(value: FactValue): string {
  return typeof value === 'string' ? value : String(value)
}

/**
 * Estado derivado de los claims:
 * - sin claims → `unknown`;
 * - valores distintos → `conflict`, salvo una resolución humana posterior al claim más reciente;
 * - algún claim oficial u observado en persona → `confirmed`;
 * - solo datos abiertos o terceros → `needs verification`.
 */
export function resolveFact(fact: PracticalFact): ResolvedFact {
  if (fact.claims.length === 0) return {status: 'unknown', claim: null}
  const distinct = new Set(fact.claims.map((claim) => normalizeFactValue(claim.value)))
  if (distinct.size > 1) {
    const chosen = effectiveResolution(fact)
    if (!chosen) return {status: 'conflict', claim: null}
    return {status: CONFIRMING_CLASSES.has(classOf(chosen)) ? 'confirmed' : 'needs verification', claim: chosen}
  }
  const best = bestClaim(fact.claims)
  return {status: CONFIRMING_CLASSES.has(classOf(best)) ? 'confirmed' : 'needs verification', claim: best}
}

export function deriveFactStatus(fact: PracticalFact): FactStatus {
  return resolveFact(fact).status
}

/** La resolución solo cuenta si es igual o posterior al claim más reciente: un claim nuevo reabre el conflicto. */
function effectiveResolution(fact: PracticalFact): FactClaim | null {
  const resolution = fact.resolution
  if (!resolution) return null
  const chosen = fact.claims[resolution.claimIndex]
  if (!chosen || !isIsoDate(resolution.reviewedAt)) return null
  const latest = fact.claims.map((claim) => claim.source.retrievedAt.slice(0, 10)).sort().at(-1)!
  return resolution.reviewedAt >= latest ? chosen : null
}

/** Mejor claim según la jerarquía de los principios §4; a igualdad, el más reciente y luego el primero. */
function bestClaim(claims: readonly FactClaim[]): FactClaim {
  return claims
    .map((claim, index) => ({claim, index}))
    .sort((a, b) => SOURCE_CLASSES.indexOf(classOf(a.claim)) - SOURCE_CLASSES.indexOf(classOf(b.claim))
      || b.claim.source.retrievedAt.localeCompare(a.claim.source.retrievedAt)
      || a.index - b.index)[0]!.claim
}

function classOf(claim: FactClaim): SourceClass {
  // Una fuente sin clase se trata como la de menor confianza; nunca se promueve.
  return claim.source.sourceClass ?? 'third-party'
}

/** Snapshot que una página debe llevar para este hecho. */
export function expectedSnapshot(fact: PracticalFact): PracticalFactSnapshot {
  const {status, claim} = resolveFact(fact)
  return {
    factId: fact.id,
    value: status === 'confirmed' && claim ? factValueText(claim.value) : null,
    unit: fact.unit,
    municipality: fact.municipality,
    status,
    sourceTitle: claim?.source.attribution ?? null,
    sourceUrl: claim?.source.url ?? null,
    sourceClass: claim ? classOf(claim) : null,
    retrievedAt: claim?.source.retrievedAt ?? null,
  }
}

// --- Registro -----------------------------------------------------------------------------------

export function municipalitySlug(municipality: string): string {
  return municipality.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Lee y valida los archivos del registro. Un hecho con errores de estructura no entra en el registro. */
export function buildFactRegistry(
  files: PracticalFactsContext['factFiles'],
  officialSources: readonly OfficialSource[],
  observations: PracticalFactsContext['observations'],
  visits: NonNullable<PracticalFactsContext['visits']> = new Map(),
): {facts: Map<string, PracticalFact>; issues: FactIssue[]} {
  const facts = new Map<string, PracticalFact>()
  const origin = new Map<string, string>()
  const issues: FactIssue[] = []
  for (const file of files) {
    const issue = (path: string, message: string) => issues.push({source: file.source, path, message})
    if (!isRecord(file.value) || !Array.isArray(file.value.facts)) {
      issue('facts', 'El archivo debe ser un objeto con un array "facts".')
      continue
    }
    for (const [index, raw] of file.value.facts.entries()) {
      const fact = parseFact(raw, `facts[${index}]`, issue)
      if (!fact) continue
      const previous = origin.get(fact.id)
      if (previous) {
        issue(`facts[${index}].id`, `Id duplicado "${fact.id}"; también aparece en ${previous}.`)
        continue
      }
      validateClaimSources(fact, `facts[${index}]`, officialSources, observations, visits, issue)
      origin.set(fact.id, file.source)
      facts.set(fact.id, fact)
    }
  }
  return {facts, issues}
}

function parseFact(raw: unknown, path: string, issue: (path: string, message: string) => void): PracticalFact | null {
  if (!isRecord(raw)) {
    issue(path, 'Cada hecho debe ser un objeto.')
    return null
  }
  let failed = false
  const fail = (field: string, message: string) => {
    failed = true
    issue(`${path}.${field}`, message)
  }
  const {id, subject, attribute, municipality, unit, conditions, claims, resolution} = raw
  if (typeof subject !== 'string' || !ID_SEGMENT.test(subject)) fail('subject', 'Debe ser un slug (a-z, 0-9, guiones).')
  if (typeof attribute !== 'string' || !ID_SEGMENT.test(attribute)) fail('attribute', 'Debe ser un slug (a-z, 0-9, guiones).')
  if (!MUNICIPALITIES.includes(municipality as Municipality)) fail('municipality', `Municipio no admitido; usa uno de: ${MUNICIPALITIES.join(', ')}.`)
  if (!FACT_UNITS.includes(unit as FactUnit)) fail('unit', `Unidad no admitida; usa una de: ${FACT_UNITS.join(', ')}.`)
  if (conditions !== undefined && (typeof conditions !== 'string' || !conditions.trim())) fail('conditions', 'Si existe, debe ser una cadena no vacía.')
  if (typeof id !== 'string') fail('id', 'Campo obligatorio.')
  else if (typeof subject === 'string' && typeof attribute === 'string' && typeof municipality === 'string') {
    const prefix = `${municipalitySlug(municipality)}.${subject}.${attribute}`
    const qualifier = id.slice(prefix.length)
    if (!id.startsWith(prefix) || (qualifier !== '' && !(qualifier.startsWith('.') && ID_SEGMENT.test(qualifier.slice(1))))) {
      fail('id', `Debe ser "${prefix}" o "${prefix}.<calificador>".`)
    }
  }
  if (!Array.isArray(claims)) fail('claims', 'Debe ser un array (vacío si no hay fuente: el hecho queda «unknown»).')
  else for (const [index, claim] of claims.entries()) parseClaim(claim, unit, `claims[${index}]`, fail)
  if (resolution !== undefined && resolution !== null) parseResolution(resolution, Array.isArray(claims) ? claims.length : 0, fail)
  return failed ? null : raw as unknown as PracticalFact
}

function parseClaim(raw: unknown, unit: unknown, path: string, fail: (field: string, message: string) => void): void {
  if (!isRecord(raw)) return fail(path, 'Cada claim debe ser un objeto.')
  const value = raw.value
  const validValue = unit === 'booleano' ? typeof value === 'boolean'
    : ['EUR', 'EUR/h', 'EUR/día', 'min', 'm', 'km'].includes(String(unit)) ? typeof value === 'number' && Number.isFinite(value) && value >= 0
      : unit === 'hh:mm' ? typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d(?:-([01]\d|2[0-3]):[0-5]\d)?$/.test(value)
        : typeof value === 'string' && value.trim().length > 0
  if (!validValue) fail(`${path}.value`, `Valor no válido para la unidad ${String(unit)}.`)
  const source = raw.source
  if (!isRecord(source)) return fail(`${path}.source`, 'La fuente es obligatoria.')
  for (const field of ['key', 'provider', 'attribution'] as const) {
    if (typeof source[field] !== 'string' || !source[field].trim()) fail(`${path}.source.${field}`, 'Campo obligatorio.')
  }
  if (typeof source.retrievedAt !== 'string' || !isIsoDate(source.retrievedAt.slice(0, 10)) || Number.isNaN(Date.parse(source.retrievedAt))) {
    fail(`${path}.source.retrievedAt`, 'Debe ser una fecha ISO.')
  }
  if (!SOURCE_CLASSES.includes(source.sourceClass as SourceClass)) {
    fail(`${path}.source.sourceClass`, `Obligatorio en hechos prácticos; usa uno de: ${SOURCE_CLASSES.join(', ')}.`)
  }
  if (source.url !== null && source.url !== undefined && (typeof source.url !== 'string' || !isHttpUrl(source.url))) {
    fail(`${path}.source.url`, 'Debe ser una URL http(s) o null.')
  }
  if (raw.observationRef !== undefined && (typeof raw.observationRef !== 'string' || !isSafeRelativeJson(raw.observationRef))) {
    fail(`${path}.observationRef`, 'Debe ser una ruta .json relativa a content/manual/, sin "..".')
  }
}

function parseResolution(raw: unknown, claimCount: number, fail: (field: string, message: string) => void): void {
  if (!isRecord(raw)) return fail('resolution', 'Debe ser un objeto o null.')
  if (typeof raw.claimIndex !== 'number' || !Number.isInteger(raw.claimIndex) || raw.claimIndex < 0 || raw.claimIndex >= claimCount) {
    fail('resolution.claimIndex', 'Debe señalar un claim existente.')
  }
  if (typeof raw.reviewedAt !== 'string' || !isIsoDate(raw.reviewedAt)) fail('resolution.reviewedAt', 'Debe ser una fecha YYYY-MM-DD.')
  for (const field of ['reviewedBy', 'reason'] as const) {
    if (typeof raw[field] !== 'string' || !raw[field].trim()) fail(`resolution.${field}`, 'Campo obligatorio.')
  }
}

/** Requisitos por tipo de fuente: oficial → URL de un host aprobado; observada → observación registrada. */
function validateClaimSources(
  fact: PracticalFact,
  path: string,
  officialSources: readonly OfficialSource[],
  observations: PracticalFactsContext['observations'],
  visits: NonNullable<PracticalFactsContext['visits']>,
  issue: (path: string, message: string) => void,
): void {
  for (const [index, claim] of fact.claims.entries()) {
    const claimPath = `${path}.claims[${index}]`
    const sourceClass = classOf(claim)
    const url = claim.source.url
    if (OFFICIAL_CLASSES.has(sourceClass)) {
      if (!url) issue(`${claimPath}.source.url`, 'Un hecho de fuente oficial necesita la URL oficial.')
      else if (!isApprovedOfficialUrl(url, fact.municipality, officialSources)) {
        issue(`${claimPath}.source.url`, `El host de ${url} no está aprobado como oficial para ${fact.municipality} en content/facts/official-sources.json.`)
      }
    } else if (sourceClass === 'manual-first-party') {
      if (!claim.observationRef) {
        issue(`${claimPath}.observationRef`, 'Un hecho observado necesita la observación manual registrada en content/manual/.')
        continue
      }
      if (!observations.has(claim.observationRef)) {
        issue(`${claimPath}.observationRef`, `No existe la observación content/manual/${claim.observationRef}.`)
        continue
      }
      const observedAt = observations.get(claim.observationRef)
      if (observedAt !== claim.source.retrievedAt.slice(0, 10)) {
        issue(`${claimPath}.source.retrievedAt`, `No coincide con el observedAt de la observación (${observedAt ?? 'sin fecha'}).`)
      }
      if (claim.observationRef.startsWith(VISITS_DIRECTORY)) validateVisitClaim(fact, claim, claimPath, visits, issue)
    } else if (!url) {
      issue(`${claimPath}.source.url`, 'Los datos abiertos y las fuentes de terceros necesitan URL consultable.')
    }
  }
}

/**
 * Un claim que cita una visita de campo solo vale si la visita registra una comprobación de ese hecho,
 * con el mismo valor y escrito literalmente en la cita. Así no entra nada que David no anotara.
 */
function validateVisitClaim(
  fact: PracticalFact,
  claim: FactClaim,
  claimPath: string,
  visits: NonNullable<PracticalFactsContext['visits']>,
  issue: (path: string, message: string) => void,
): void {
  const ref = claim.observationRef!
  const visit = visits.get(ref)
  if (!visit) return issue(`${claimPath}.observationRef`, `La visita content/manual/${ref} no supera la validación de visitas de campo.`)
  const checks = visit.checks.filter((check) => check.factId === fact.id)
  if (checks.length === 0) return issue(`${claimPath}.observationRef`, `La visita content/manual/${ref} no registra ninguna comprobación de "${fact.id}".`)
  const backing = checks.find((check) => check.value !== undefined && normalizeFactValue(check.value) === normalizeFactValue(claim.value))
  if (!backing) return issue(`${claimPath}.value`, `No coincide con el valor anotado en la visita content/manual/${ref} para "${fact.id}".`)
  if (!valueAppearsLiterally(backing.value!, fact.unit, backing.quote)) {
    issue(`${claimPath}.value`, `El valor ${factValueText(backing.value!)} no está escrito literalmente en la cita de la visita: «${backing.quote}».`)
  }
}

/**
 * ¿Está el valor escrito tal cual en la cita? Los números admiten coma o punto decimal y dos decimales
 * (`0.85` → «0,85», `2` → «2» o «2,00»); las horas admiten el cero inicial omitido (`09:00` → «9:00»);
 * el texto se compara sin mayúsculas. Un booleano nunca está escrito literalmente: es la lectura que
 * David hace de la cita, así que se acepta y `/procesar-visita` se lo muestra para que lo confirme.
 */
export function valueAppearsLiterally(value: FactValue, unit: FactUnit, quote: string): boolean {
  const text = quote.normalize('NFC').replace(/\s+/g, ' ')
  if (typeof value === 'boolean') return unit === 'booleano'
  if (typeof value === 'number') {
    const forms = new Set([String(value), value.toFixed(2)].flatMap((form) => [form, form.replace('.', ',')]))
    return [...forms].some((form) => new RegExp(`(?<![\\d.,])${escapeRegExp(form)}(?![\\d]|[.,]\\d)`).test(text))
  }
  if (unit === 'hh:mm') {
    return value.split('-').every((time) => [time, time.replace(/^0(\d)/, '$1')]
      .some((form) => new RegExp(`(?<!\\d)${escapeRegExp(form)}(?!\\d)`).test(text)))
  }
  return text.toLowerCase().includes(value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase())
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function isApprovedOfficialUrl(url: string, municipality: Municipality, officialSources: readonly OfficialSource[]): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return officialSources.some((source) => (source.municipality === '*' || source.municipality === municipality)
    && (host === source.host || host.endsWith(`.${source.host}`)))
}

export function parseOfficialSources(raw: unknown, source: string): {sources: OfficialSource[]; issues: FactIssue[]} {
  const issues: FactIssue[] = []
  if (!Array.isArray(raw)) return {sources: [], issues: [{source, path: '', message: 'Debe ser un array.'}]}
  const sources: OfficialSource[] = []
  for (const [index, item] of raw.entries()) {
    const path = `[${index}]`
    if (!isRecord(item)) {
      issues.push({source, path, message: 'Cada fuente oficial debe ser un objeto.'})
      continue
    }
    const errors: string[] = []
    if (typeof item.host !== 'string' || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(item.host)) errors.push('host debe ser un nombre de dominio en minúsculas, sin esquema ni ruta')
    if (item.municipality !== '*' && !MUNICIPALITIES.includes(item.municipality as Municipality)) errors.push('municipality debe ser un municipio admitido o "*"')
    for (const field of ['publisher', 'approvedBy'] as const) if (typeof item[field] !== 'string' || !item[field].trim()) errors.push(`${field} es obligatorio`)
    if (typeof item.approvedAt !== 'string' || !isIsoDate(item.approvedAt)) errors.push('approvedAt debe ser YYYY-MM-DD')
    if (errors.length) issues.push({source, path, message: `${errors.join('; ')}.`})
    else sources.push(item as unknown as OfficialSource)
  }
  return {sources, issues}
}

// --- Páginas ------------------------------------------------------------------------------------

/**
 * Valida los hechos que citan las páginas place/beach/article. Cada error bloquea `content:validate`
 * y `content:import` para la página afectada.
 */
export function validatePracticalFacts(documents: readonly FactDocument[], context: PracticalFactsContext): FactIssue[] {
  const official = parseOfficialSources(context.officialSources, 'content/facts/official-sources.json')
  const registry = buildFactRegistry(context.factFiles, official.sources, context.observations, context.visits)
  const issues: FactIssue[] = [...official.issues, ...registry.issues]
  const citations = new Map<string, Array<{doc: FactDocument; snapshot: Record<string, unknown>}>>()

  for (const input of documents) {
    const doc = input.document
    if (!(FACT_DOCUMENT_TYPES as readonly string[]).includes(doc._type)) continue
    const issue = (path: string, message: string) => issues.push({source: input.source, path, message})
    const municipalities = new Set<string>()

    if (doc.municipality !== undefined) {
      if (doc._type === 'article') issue('municipality', 'Los artículos toman los municipios de sus hechos; no declaran municipality.')
      else if (!MUNICIPALITIES.includes(doc.municipality as Municipality)) issue('municipality', `Municipio no admitido; usa uno de: ${MUNICIPALITIES.join(', ')}.`)
      else municipalities.add(doc.municipality as string)
    }

    if (doc.practicalFacts !== undefined) {
      if (!Array.isArray(doc.practicalFacts)) {
        issue('practicalFacts', 'Debe ser un array.')
      } else {
        if (doc._type !== 'article' && doc.municipality === undefined) issue('municipality', 'Obligatorio cuando la página cita hechos prácticos.')
        for (const field of ['parking', 'accessInfo']) {
          if (typeof doc[field] === 'string' && doc[field].trim()) {
            issue(field, 'Campo libre heredado: con practicalFacts, el dato debe ir como hecho con procedencia.')
          }
        }
        for (const [index, snapshot] of doc.practicalFacts.entries()) {
          const path = `practicalFacts[${index}]`
          if (!isRecord(snapshot) || typeof snapshot.factId !== 'string') {
            issue(`${path}.factId`, 'Cada hecho citado necesita factId.')
            continue
          }
          const fact = registry.facts.get(snapshot.factId)
          if (!fact) {
            issue(`${path}.factId`, `El hecho "${snapshot.factId}" no existe en content/facts/ o tiene errores.`)
            continue
          }
          municipalities.add(fact.municipality)
          const list = citations.get(fact.id) ?? []
          list.push({doc: input, snapshot})
          citations.set(fact.id, list)

          const expected = expectedSnapshot(fact)
          if (expected.status === 'conflict') {
            const values = fact.claims.map((claim) => `${String(claim.value)} ${fact.unit} (${claim.source.attribution})`).join(' / ')
            issue(path, `«conflict»: el hecho "${fact.id}" tiene valores distintos (${values}); bloquea la publicación hasta que se resuelva.`)
            continue
          }
          if (snapshot.value !== null && snapshot.value !== undefined && expected.status !== 'confirmed') {
            issue(`${path}.value`, `El hecho está «${expected.status}»: no se publica la cifra (value debe ser null).`)
          }
          const stale = (Object.keys(expected) as Array<keyof PracticalFactSnapshot>)
            .filter((key) => !sameSnapshotValue(snapshot[key], expected[key]))
          if (stale.length) issue(path, `Copia desactualizada respecto a content/facts/ en: ${stale.join(', ')}.`)
        }
      }
    }

    validateTravelNotes(doc, municipalities, issue)
  }

  // Un mismo hecho citado con valores distintos en dos páginas es un conflicto que bloquea a todas.
  for (const [factId, list] of citations) {
    const variants = new Set(list.map(({snapshot}) => `${typeof snapshot.value === 'string' ? normalizeFactValue(snapshot.value) : String(snapshot.value)}|${String(snapshot.unit)}|${String(snapshot.status)}`))
    if (variants.size < 2) continue
    const pages = list.map(({doc, snapshot}) => `${doc.document._id} = ${String(snapshot.value)} ${String(snapshot.unit)}`).join('; ')
    for (const {doc} of list) {
      issues.push({source: doc.source, path: 'practicalFacts', message: `«conflict»: el hecho "${factId}" aparece con valores distintos entre páginas (${pages}); bloquea su publicación.`})
    }
  }

  return issues
}

/** Un lugar fuera de Benidorm exige que la página explique el traslado, una nota por municipio. */
function validateTravelNotes(doc: FactDocument['document'], municipalities: ReadonlySet<string>, issue: (path: string, message: string) => void): void {
  const notes = doc.travelNotes
  if (notes !== undefined && !Array.isArray(notes)) {
    issue('travelNotes', 'Debe ser un array.')
    return
  }
  const covered = new Set<string>()
  for (const [index, note] of (notes ?? []).entries()) {
    if (!isRecord(note) || !MUNICIPALITIES.includes(note.municipality as Municipality) || typeof note.text !== 'string' || !note.text.trim()) {
      issue(`travelNotes[${index}]`, 'Cada nota necesita municipality (admitido) y text no vacío.')
      continue
    }
    covered.add(note.municipality as string)
  }
  for (const municipality of [...municipalities].sort()) {
    if (municipality !== HOME_MUNICIPALITY && !covered.has(municipality)) {
      issue('travelNotes', `La página incluye un lugar en ${municipality}: debe explicar el traslado desde ${HOME_MUNICIPALITY}.`)
    }
  }
}

/** Todos los campos del snapshot son texto o null; un número donde va texto cuenta como copia distinta. */
function sameSnapshotValue(actual: unknown, expected: string | null): boolean {
  if (expected === null) return actual === null || actual === undefined
  return typeof actual === 'string' && normalizeFactValue(actual) === normalizeFactValue(expected)
}

// --- Utilidades ---------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isSafeRelativeJson(path: string): boolean {
  return path.endsWith('.json') && !path.startsWith('/') && !path.split(/[\\/]/).includes('..')
}
