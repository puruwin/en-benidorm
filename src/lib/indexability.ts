import type {BusinessDetail, ComparisonDetail, SourceItem} from '../types/content'
import {sourceKind} from './business-presentation'

/**
 * Regla única de indexación (issue #15). La usan `SeoHead` (meta robots) y `seo:audit`, con las mismas
 * entradas: la página declara sus señales de contenido y SeoHead las deja en
 * `<meta name="enbenidorm-indexability">` para que el audit repita la decisión con el grafo recién rastreado.
 *
 * Contrato. Una página es indexable solo si cumple todo:
 *
 * 1. No tiene `noIndex` guardado (decisión editorial o QA de comparison: la regla nunca la sobrescribe)
 *    y no es contenido demo.
 * 2. Evidencia (salvo `structural`): al menos un hecho confirmado por fuente oficial con fecha, una
 *    observación propia o una observación de creador atribuida (`@creador`, URL) y fechada (#29).
 *    Una `ficha` tiene además dirección.
 * 3. Aportación (salvo `structural`): al menos algo que no está en la web del local ni en su ficha de
 *    Maps y que se muestra en la propia página: foto propia, comparación, condición práctica,
 *    advertencia u observación de creador resumida con palabras propias. Un enlace a una comparativa
 *    no es una comparación.
 * 4. Al menos `MIN_INCOMING_LINKS` páginas distintas la enlazan desde el cuerpo (zona `body` de
 *    crawl.json: no cuentan menú, migas ni pie). `/` está exenta. Sin crawl.json no se sabe y no pasa.
 * 5. Título propio (no el de respaldo) y H1, y los dos contienen el sujeto de la página (sin
 *    mayúsculas ni tildes). Es el mínimo determinista; si describen bien la página lo juzga `revisor-calidad`.
 *
 * `structural` (inicio, hubs, autor) solo exige 1, 4 y 5. Es pura: sin I/O ni fechas actuales.
 */

export const MIN_INCOMING_LINKS = 2

/** Nombre del meta en el que SeoHead deja las señales para `seo:audit`. */
export const INDEXABILITY_META = 'enbenidorm-indexability'

export type IndexabilityKind = 'structural' | 'ficha' | 'comparison' | 'guide'

export type Contribution = 'own-photo' | 'comparison' | 'practical-condition' | 'warning' | 'creator-summary'

/** Observación de creador (#29) tal como la muestra la página. */
export interface CreatorObservationRef {
  creator: string
  url: string
  publishedAt: string
  /** Resumen con palabras de quien vio el vídeo, no transcripción. */
  summary?: string
}

/** Lo que la página declara de su contenido. Es lo que viaja en el meta para el audit. */
export interface IndexabilitySignals {
  kind: IndexabilityKind
  storedNoIndex: boolean
  demo: boolean
  evidence: {
    officialFact: boolean
    ownObservation: boolean
    creatorObservations: CreatorObservationRef[]
  }
  hasAddress: boolean
  contributions: Contribution[]
  /** Lo que título y H1 deben nombrar: el local, el tema de la comparativa, el hub. */
  subject: string
  /** H1 que pinta la página. El audit usa el del HTML. */
  h1: string
  /** El título sale del respaldo y no del documento. */
  titleIsFallback: boolean
}

export interface IndexabilityInput extends Omit<IndexabilitySignals, 'h1'> {
  route: string
  title: string | null
  h1: string | null
  /** Páginas distintas que la enlazan desde el cuerpo; `null` si crawl.json no existe o no tiene la ruta. */
  incomingContextualLinks: number | null
}

export type IndexabilityReasonCode =
  | 'stored-noindex'
  | 'demo'
  | 'no-evidence'
  | 'no-address'
  | 'no-contribution'
  | 'links-unknown'
  | 'few-links'
  | 'title-missing'
  | 'title-fallback'
  | 'h1-missing'
  | 'title-subject'
  | 'h1-subject'

export interface IndexabilityReason {
  code: IndexabilityReasonCode
  detail: string
}

export interface IndexabilityResult {
  indexable: boolean
  /** Todos los motivos por los que no pasa, en el orden del contrato. Vacío si es indexable. */
  reasons: IndexabilityReason[]
}

export function isIndexable(page: IndexabilityInput): IndexabilityResult {
  const reasons: IndexabilityReason[] = []
  const fail = (code: IndexabilityReasonCode, detail: string) => reasons.push({code, detail})

  if (page.storedNoIndex) fail('stored-noindex', 'el documento está marcado como noIndex')
  if (page.demo) fail('demo', 'contenido de demostración')

  if (page.kind !== 'structural') {
    const {officialFact, ownObservation, creatorObservations} = page.evidence
    if (!officialFact && !ownObservation && !creatorObservations.some(isAttributedAndDated)) {
      fail('no-evidence', 'sin hecho de fuente oficial fechado, observación propia ni observación de creador atribuida y fechada')
    }
    if (page.kind === 'ficha' && !page.hasAddress) fail('no-address', 'sin dirección')
    if (validContributions(page).length === 0) fail('no-contribution', 'sin aportación propia (foto, comparación, condición práctica, advertencia o resumen de creador)')
  }

  if (page.route !== '/') {
    if (page.incomingContextualLinks === null) fail('links-unknown', 'crawl.json no tiene la ruta: ejecuta npm run build')
    else if (page.incomingContextualLinks < MIN_INCOMING_LINKS) fail('few-links', `${page.incomingContextualLinks} enlaces contextuales entrantes (mínimo ${MIN_INCOMING_LINKS})`)
  }

  const subject = normalize(page.subject)
  const title = page.title?.trim() ?? ''
  const h1 = page.h1?.trim() ?? ''
  if (!title) fail('title-missing', 'sin título')
  else if (page.titleIsFallback) fail('title-fallback', `título de respaldo «${title}»`)
  else if (!normalize(title).includes(subject)) fail('title-subject', `el título «${title}» no nombra «${page.subject}»`)
  if (!h1) fail('h1-missing', 'sin H1')
  else if (!normalize(h1).includes(subject)) fail('h1-subject', `el H1 «${h1}» no nombra «${page.subject}»`)

  return {indexable: reasons.length === 0, reasons}
}

export function isAttributedAndDated(observation: CreatorObservationRef): boolean {
  return /^@[\w.]+$/.test(observation.creator.trim())
    && /^https:\/\//.test(observation.url.trim())
    && /^\d{4}-\d{2}-\d{2}/.test(observation.publishedAt)
    && !Number.isNaN(Date.parse(observation.publishedAt))
}

/** Un resumen de creador solo cuenta si la observación está atribuida, fechada y resumida. */
function validContributions(page: Pick<IndexabilityInput, 'contributions' | 'evidence'>): Contribution[] {
  const summarized = page.evidence.creatorObservations.some((observation) => isAttributedAndDated(observation) && Boolean(observation.summary?.trim()))
  return page.contributions.filter((contribution) => contribution !== 'creator-summary' || summarized)
}

/** Fuente oficial con fecha de consulta: la web del propio local (nivel 1 de la jerarquía de evidencia). */
function hasDatedOfficialSource(sources: readonly SourceItem[]): boolean {
  return sources.some((source) => sourceKind(source) === 'official-website' && Boolean(source.accessedAt))
}

/**
 * Ficha de restaurante. Hoy no hay campo de foto propia (#23) ni de observación de creador (#29), y
 * «Aparece en estas comparativas» es un enlace, no una comparación: ninguna ficha tiene aportación todavía.
 */
export function restaurantIndexability(business: BusinessDetail, options: {demo: boolean}): IndexabilitySignals {
  return {
    kind: 'ficha',
    storedNoIndex: business.seo.noIndex === true,
    demo: options.demo,
    evidence: {
      officialFact: hasDatedOfficialSource(business.sources),
      ownObservation: business.sources.some((source) => sourceKind(source) === 'manual-observation'),
      creatorObservations: [],
    },
    hasAddress: business.address.street.trim().length > 0,
    contributions: [],
    subject: business.name,
    h1: business.name,
    titleIsFallback: !filled(business.seo.title),
  }
}

/** Comparativa: la comparación es su aportación; condiciones y «lo que no pudimos comprobar» suman. */
export function comparisonIndexability(comparison: ComparisonDetail): IndexabilitySignals {
  const contributions: Contribution[] = []
  if (comparison.entries.length > 0) contributions.push('comparison')
  if (comparison.entries.some((entry) => entry.conditions.length > 0 || entry.practicalNotes.length > 0)) contributions.push('practical-condition')
  if (comparison.entries.some((entry) => entry.limitations.length > 0)) contributions.push('warning')
  return {
    kind: 'comparison',
    storedNoIndex: comparison.seo.noIndex === true,
    demo: false,
    evidence: {
      officialFact: hasDatedOfficialSource(comparison.sources),
      ownObservation: comparison.sources.some((source) => sourceKind(source) === 'manual-observation'),
      creatorObservations: [],
    },
    hasAddress: false,
    contributions,
    // El tema es lo que el H1 declara antes de los dos puntos: «Dónde comer arroz en Benidorm: …».
    subject: comparison.title.split(':')[0]!.trim(),
    h1: comparison.title,
    titleIsFallback: !filled(comparison.seo.title),
  }
}

/** Inicio, hubs y autor: solo título/H1 y enlaces. */
export function structuralIndexability(page: {subject: string; h1: string; storedNoIndex?: boolean | undefined; title?: string | undefined}): IndexabilitySignals {
  return {
    kind: 'structural',
    storedNoIndex: page.storedNoIndex === true,
    demo: false,
    evidence: {officialFact: false, ownObservation: false, creatorObservations: []},
    hasAddress: false,
    contributions: [],
    subject: page.subject,
    h1: page.h1,
    titleIsFallback: !filled(page.title),
  }
}

/** Lee las señales del meta. Devuelve `null` si faltan o no tienen la forma del contrato. */
export function parseIndexabilitySignals(content: string | null): IndexabilitySignals | null {
  if (!content) return null
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return null
  }
  if (!isRecord(value) || !isRecord(value.evidence)) return null
  const {evidence} = value
  const kinds: readonly string[] = ['structural', 'ficha', 'comparison', 'guide']
  const valid = typeof value.kind === 'string' && kinds.includes(value.kind)
    && typeof value.storedNoIndex === 'boolean' && typeof value.demo === 'boolean'
    && typeof evidence.officialFact === 'boolean' && typeof evidence.ownObservation === 'boolean' && Array.isArray(evidence.creatorObservations)
    && typeof value.hasAddress === 'boolean' && Array.isArray(value.contributions)
    && typeof value.subject === 'string' && typeof value.h1 === 'string' && typeof value.titleIsFallback === 'boolean'
  return valid ? value as unknown as IndexabilitySignals : null
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function filled(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
