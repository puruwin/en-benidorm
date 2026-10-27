import type {SourceProvenance} from './types'
import {
  type FactClaim, type FactIssue, type FactValue, MUNICIPALITIES, type Municipality, type PracticalFact,
  VISITS_DIRECTORY, factValueText, normalizeFactValue, valueAppearsLiterally,
} from './practical-facts'

/**
 * Visitas de campo a playas y lugares (`content/manual/visits/*.json`).
 *
 * Contrato hermano de `scripts/comparison/schemas/manual-observation.schema.json`: aquel describe un
 * negocio por `businessId` con dimensiones de comparativa (cocina, especialidades…) y lo consume
 * `comparison:enrich`; una visita describe un lugar con municipio, el texto literal de la nota, lo que
 * se comprobó y las fotos, y alimenta los hechos prácticos de `content/facts/`. Cada comprobación cita
 * un fragmento literal del texto; un hecho solo recibe un valor escrito en esa cita.
 *
 * Todo aquí es puro; la lectura de archivos está en `scripts/content-validation.ts` y en
 * `scripts/content/process-visit.ts`.
 */

export const VISIT_CHECK_CATEGORIES = ['price', 'access', 'parking', 'accessibility', 'services'] as const
export type VisitCheckCategory = (typeof VISIT_CHECK_CATEGORIES)[number]

export const VISIT_PLACE_TYPES = ['beach', 'place'] as const
export type VisitPlaceType = (typeof VISIT_PLACE_TYPES)[number]

const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic']

export interface VisitCheck {
  category: VisitCheckCategory
  /** Fragmento copiado tal cual de `text`. */
  quote: string
  /** Hecho de `content/facts/` que esta comprobación respalda; con él, `value` es obligatorio. */
  factId?: string
  value?: FactValue
}

export interface SiteVisit {
  kind: 'site-visit'
  observedAt: string
  observer: string
  sourceType: 'first-party-observation'
  place: {
    type: VisitPlaceType
    name: string
    municipality: Municipality
    /** `_id` de la página beach/place, o null si aún no existe. */
    documentId: string | null
  }
  /** Nota de la visita tal como la escribió quien observó. */
  text: string
  checks: VisitCheck[]
  /** Fotos propias, rutas relativas a `content/manual/`. */
  photos: string[]
}

/**
 * Valida una visita. `photoExists` recibe la ruta relativa a `content/manual/`. Con errores devuelve
 * `visit: null`: una visita a medias no respalda ningún hecho.
 */
export function parseSiteVisit(raw: unknown, source: string, photoExists: (path: string) => boolean): {visit: SiteVisit | null; issues: FactIssue[]} {
  const issues: FactIssue[] = []
  const fail = (path: string, message: string) => issues.push({source, path, message})
  if (!isRecord(raw)) {
    fail('', 'La visita debe ser un objeto.')
    return {visit: null, issues}
  }
  const allowed = new Set(['kind', 'observedAt', 'observer', 'sourceType', 'place', 'text', 'checks', 'photos'])
  for (const key of Object.keys(raw)) if (!allowed.has(key)) fail(key, 'Campo no admitido en una visita de campo.')

  if (raw.kind !== 'site-visit') fail('kind', 'Debe ser "site-visit".')
  if (raw.sourceType !== 'first-party-observation') fail('sourceType', 'Debe ser "first-party-observation".')
  if (typeof raw.observedAt !== 'string' || !isIsoDate(raw.observedAt)) fail('observedAt', 'Debe ser una fecha YYYY-MM-DD.')
  else if (raw.observedAt > new Date().toISOString().slice(0, 10)) fail('observedAt', 'No puede ser una fecha futura.')
  if (!isFilled(raw.observer)) fail('observer', 'Indica quién observó.')

  const place = raw.place
  if (!isRecord(place)) fail('place', 'Indica el lugar: type, name, municipality y documentId.')
  else {
    if (!VISIT_PLACE_TYPES.includes(place.type as VisitPlaceType)) fail('place.type', `Usa uno de: ${VISIT_PLACE_TYPES.join(', ')}.`)
    if (!isFilled(place.name)) fail('place.name', 'Campo obligatorio.')
    if (!MUNICIPALITIES.includes(place.municipality as Municipality)) fail('place.municipality', `Municipio no admitido; usa uno de: ${MUNICIPALITIES.join(', ')}.`)
    if (place.documentId !== null && !isFilled(place.documentId)) fail('place.documentId', 'Debe ser el _id de la página o null.')
  }

  const text = raw.text
  if (!isFilled(text)) fail('text', 'Copia aquí la nota de la visita tal como la escribiste.')

  if (!Array.isArray(raw.checks) || raw.checks.length === 0) fail('checks', 'Registra al menos una comprobación.')
  else for (const [index, check] of raw.checks.entries()) parseCheck(check, `checks[${index}]`, isFilled(text) ? text : '', fail)

  if (!Array.isArray(raw.photos)) fail('photos', 'Debe ser un array de rutas (vacío si no hay fotos).')
  else for (const [index, photo] of raw.photos.entries()) {
    const path = `photos[${index}]`
    if (typeof photo !== 'string' || !isSafeRelative(photo)) fail(path, 'Debe ser una ruta relativa a content/manual/, sin "..".')
    else if (!PHOTO_EXTENSIONS.some((extension) => photo.toLowerCase().endsWith(extension))) fail(path, `Extensión no admitida; usa ${PHOTO_EXTENSIONS.join(', ')}.`)
    else if (!photoExists(photo)) fail(path, `No existe content/manual/${photo}.`)
  }

  return {visit: issues.length ? null : raw as unknown as SiteVisit, issues}
}

function parseCheck(raw: unknown, path: string, text: string, fail: (path: string, message: string) => void): void {
  if (!isRecord(raw)) return fail(path, 'Cada comprobación debe ser un objeto.')
  for (const key of Object.keys(raw)) if (!['category', 'quote', 'factId', 'value'].includes(key)) fail(`${path}.${key}`, 'Campo no admitido en una comprobación.')
  if (!VISIT_CHECK_CATEGORIES.includes(raw.category as VisitCheckCategory)) fail(`${path}.category`, `Usa una de: ${VISIT_CHECK_CATEGORIES.join(', ')}.`)
  if (!isFilled(raw.quote)) fail(`${path}.quote`, 'Copia el fragmento de text que recoge esta comprobación.')
  else if (!normalizeText(text).includes(normalizeText(raw.quote))) fail(`${path}.quote`, 'No aparece literalmente en text.')
  if (raw.factId === undefined) {
    if (raw.value !== undefined) fail(`${path}.value`, 'Sin factId no hay hecho que respaldar: quita value.')
    return
  }
  if (!isFilled(raw.factId)) fail(`${path}.factId`, 'Debe ser el id de un hecho de content/facts/.')
  const value = raw.value
  if (!(typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || isFilled(value))) {
    fail(`${path}.value`, 'Con factId, value es obligatorio (número, texto o booleano).')
  }
}

/**
 * Comprueba una visita contra el registro de hechos: cada `factId` existe, su valor encaja con la
 * unidad y está escrito literalmente en la cita. No mira claims: eso es `planVisitClaims`.
 */
export function checkVisitAgainstFacts(visit: SiteVisit, source: string, facts: ReadonlyMap<string, PracticalFact>): FactIssue[] {
  const issues: FactIssue[] = []
  for (const [index, check] of visit.checks.entries()) {
    if (check.factId === undefined) continue
    const path = `checks[${index}]`
    const fact = facts.get(check.factId)
    if (!fact) {
      issues.push({source, path: `${path}.factId`, message: `El hecho "${check.factId}" no existe en content/facts/ o tiene errores. Créalo antes (con claims: []).`})
      continue
    }
    if (!valueAppearsLiterally(check.value!, fact.unit, check.quote)) {
      issues.push({source, path: `${path}.value`, message: `${factValueText(check.value!)} (${fact.unit}) no está escrito literalmente en la cita «${check.quote}».`})
    }
  }
  return issues
}

export interface PlannedClaim {
  factId: string
  checkIndex: number
  claim: FactClaim
  /** El claim ya está en el registro (el comando es idempotente). */
  alreadyPresent: boolean
  /** Valor que no se lee literalmente (booleano): David debe confirmarlo. */
  needsConfirmation: boolean
  /** Otros valores que ya tiene el hecho; si difieren, el claim lo dejará en «conflict». */
  otherValues: string[]
}

/** Claims `manual-first-party` que la visita aporta a cada hecho. `ref` es la ruta relativa a `content/manual/`. */
export function planVisitClaims(visit: SiteVisit, ref: string, facts: ReadonlyMap<string, PracticalFact>): PlannedClaim[] {
  const plans: PlannedClaim[] = []
  for (const [index, check] of visit.checks.entries()) {
    if (check.factId === undefined || check.value === undefined) continue
    const fact = facts.get(check.factId)
    if (!fact) continue
    const claim: FactClaim = {value: check.value, source: visitSource(visit, ref, index), observationRef: ref}
    const key = normalizeFactValue(check.value)
    plans.push({
      factId: fact.id,
      checkIndex: index,
      claim,
      alreadyPresent: fact.claims.some((existing) => existing.observationRef === ref && normalizeFactValue(existing.value) === key),
      needsConfirmation: typeof check.value === 'boolean',
      otherValues: [...new Set(fact.claims.filter((existing) => normalizeFactValue(existing.value) !== key)
        .map((existing) => `${factValueText(existing.value)} (${existing.source.attribution})`))],
    })
  }
  return plans
}

export function visitSource(visit: SiteVisit, ref: string, checkIndex: number): SourceProvenance {
  return {
    key: `manual-visit:${ref}#checks[${checkIndex}]`,
    provider: 'manual-observation',
    identifier: `${ref}#checks[${checkIndex}]`,
    url: null,
    retrievedAt: `${visit.observedAt}T00:00:00.000Z`,
    attribution: `Comprobado en persona · ${visit.observer} · ${visit.observedAt}`,
    licenseUrl: null,
    sourceClass: 'manual-first-party',
    claimScope: 'establishment',
  }
}

export function isVisitPath(ref: string): boolean {
  return ref.startsWith(VISITS_DIRECTORY) && !ref.split('/').some((segment) => segment.startsWith('_'))
}

function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim()
}

function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isSafeRelative(path: string): boolean {
  return path.trim().length > 0 && !path.startsWith('/') && !path.split(/[\\/]/).includes('..')
}
