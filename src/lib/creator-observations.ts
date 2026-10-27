import {PRICE_UNITS, PRICE_UNIT_LABELS, type PriceUnit} from './comparison-presentation'

/**
 * Observaciones de creador (`content/manual/creator-observations/*.json`).
 *
 * Contrato hermano de `scripts/comparison/schemas/manual-observation.schema.json`: aquella es una
 * observación de primera mano; esta es lo que una persona anotó, con sus palabras, después de ver el
 * vídeo de un creador. Es evidencia de tercero: nunca confirma un dato, nunca entra en las dimensiones
 * de Comparison y nunca rellena huecos de la web oficial. Solo se muestra atribuida y enlazada.
 *
 * Módulo puro: lo usan `comparison:enrich`, `creator:process`, `content:validate` y las páginas.
 */

export const CREATOR_OBSERVATIONS_DIRECTORY = 'creator-observations/'
export const PAID_COLLABORATION_VALUES = ['sí', 'no', 'desconocido'] as const
export type PaidCollaboration = (typeof PAID_COLLABORATION_VALUES)[number]
export const CREATOR_PERMISSION_VALUES = ['sí', 'no', 'pendiente'] as const
export type CreatorPermission = (typeof CREATOR_PERMISSION_VALUES)[number]

/** Hosts admitidos y el nombre de la plataforma que se muestra en el enlace. */
const VIDEO_HOSTS: Record<string, string> = {
  'instagram.com': 'Instagram',
  'www.instagram.com': 'Instagram',
  'tiktok.com': 'TikTok',
  'www.tiktok.com': 'TikTok',
  'youtube.com': 'YouTube',
  'www.youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
}

// Límites pensados para notas, no para transcripciones.
export const CREATOR_NOTE_LIMITS = {summary: 300, note: 200, dish: 80, dishes: 8, prices: 5} as const

// Quien vio el vídeo es una persona. Un asistente o modelo no puede registrar una observación.
const AUTOMATED_RECORDER = /\b(?:claude|chatgpt|gpt|openai|gemini|copilot|ia|ai|bot|llm|asistente|modelo|agente)\b/i

export interface CreatorPriceSeen {
  concepto: string
  importe: number
  moneda: 'EUR'
  unidad: PriceUnit
  /** Fecha a la que corresponde el precio visto: la del vídeo, o la de la visita si el creador la dice. */
  vistoEl: string
}

export interface CreatorObservation {
  kind: 'creator-observation'
  businessId: string
  sourceType: 'third-party-creator-video'
  urlVideo: string
  creador: string
  publicadoEl: string
  registradoPor: string
  registradoEl: string
  /** Resumen de quien vio el vídeo, con sus palabras. */
  resumen: string
  loQueSeMuestra: {
    platos?: string[]
    precios?: CreatorPriceSeen[]
    ambiente?: string
    espera?: string
  }
  colaboracionPagada: PaidCollaboration
  permisoCreador: CreatorPermission
}

export interface CreatorObservationIssue {
  source: string
  path: string
  message: string
}

const TOP_LEVEL_FIELDS = [
  'kind', 'businessId', 'sourceType', 'urlVideo', 'creador', 'publicadoEl', 'registradoPor', 'registradoEl',
  'resumen', 'loQueSeMuestra', 'colaboracionPagada', 'permisoCreador',
]

/**
 * Valida una observación de creador. No comprueba que `businessId` exista: eso depende del catálogo
 * y lo hace quien lo tiene (`comparison:enrich`, `creator:process`, `content:validate`). Con errores
 * devuelve `observation: null`.
 */
export function parseCreatorObservation(raw: unknown, source: string, today = new Date().toISOString().slice(0, 10)): {observation: CreatorObservation | null; issues: CreatorObservationIssue[]} {
  const issues: CreatorObservationIssue[] = []
  const fail = (path: string, message: string) => issues.push({source, path, message})
  if (!isRecord(raw)) {
    fail('', 'La observación debe ser un objeto.')
    return {observation: null, issues}
  }
  for (const key of Object.keys(raw)) if (!TOP_LEVEL_FIELDS.includes(key)) fail(key, 'Campo no admitido en una observación de creador.')

  if (raw.kind !== 'creator-observation') fail('kind', 'Debe ser "creator-observation".')
  if (raw.sourceType !== 'third-party-creator-video') fail('sourceType', 'Debe ser "third-party-creator-video".')
  if (!isFilled(raw.businessId)) fail('businessId', 'Campo obligatorio.')

  if (typeof raw.urlVideo !== 'string') fail('urlVideo', 'Pega el enlace del vídeo.')
  else {
    const problem = videoUrlProblem(raw.urlVideo)
    if (problem) fail('urlVideo', problem)
  }
  if (typeof raw.creador !== 'string' || !/^@[A-Za-z0-9._]{1,30}$/.test(raw.creador)) fail('creador', 'Usa el @usuario del creador, por ejemplo "@comeenbenidorm".')

  const publishedAt = dateField(raw.publicadoEl, 'publicadoEl', today, fail)
  if (!isFilled(raw.registradoPor)) fail('registradoPor', 'Indica qué persona vio el vídeo.')
  else if (AUTOMATED_RECORDER.test(raw.registradoPor)) fail('registradoPor', 'Debe ser la persona que vio el vídeo, no un asistente ni un modelo.')
  const recordedAt = dateField(raw.registradoEl, 'registradoEl', today, fail)
  if (publishedAt && recordedAt && recordedAt < publishedAt) fail('registradoEl', 'No puede ser anterior a publicadoEl: nadie vio el vídeo antes de publicarse.')

  noteField(raw.resumen, 'resumen', CREATOR_NOTE_LIMITS.summary, true, fail)

  const shown = raw.loQueSeMuestra
  if (!isRecord(shown)) fail('loQueSeMuestra', 'Anota al menos uno de: platos, precios, ambiente, espera.')
  else {
    for (const key of Object.keys(shown)) if (!['platos', 'precios', 'ambiente', 'espera'].includes(key)) fail(`loQueSeMuestra.${key}`, 'Campo no admitido; usa platos, precios, ambiente o espera.')
    if (!['platos', 'precios', 'ambiente', 'espera'].some((key) => shown[key] !== undefined)) fail('loQueSeMuestra', 'Anota al menos uno de: platos, precios, ambiente, espera.')
    if (shown.platos !== undefined) {
      if (!Array.isArray(shown.platos) || shown.platos.length === 0 || shown.platos.length > CREATOR_NOTE_LIMITS.dishes) fail('loQueSeMuestra.platos', `Entre 1 y ${CREATOR_NOTE_LIMITS.dishes} platos (o quita el campo).`)
      else shown.platos.forEach((dish, index) => noteField(dish, `loQueSeMuestra.platos[${index}]`, CREATOR_NOTE_LIMITS.dish, true, fail))
    }
    if (shown.precios !== undefined) {
      if (!Array.isArray(shown.precios) || shown.precios.length === 0 || shown.precios.length > CREATOR_NOTE_LIMITS.prices) fail('loQueSeMuestra.precios', `Entre 1 y ${CREATOR_NOTE_LIMITS.prices} precios (o quita el campo).`)
      else shown.precios.forEach((price, index) => parsePrice(price, `loQueSeMuestra.precios[${index}]`, publishedAt, today, fail))
    }
    if (shown.ambiente !== undefined) noteField(shown.ambiente, 'loQueSeMuestra.ambiente', CREATOR_NOTE_LIMITS.note, true, fail)
    if (shown.espera !== undefined) noteField(shown.espera, 'loQueSeMuestra.espera', CREATOR_NOTE_LIMITS.note, true, fail)
  }

  if (!PAID_COLLABORATION_VALUES.includes(raw.colaboracionPagada as PaidCollaboration)) fail('colaboracionPagada', `Usa uno de: ${PAID_COLLABORATION_VALUES.join(', ')}.`)
  if (!CREATOR_PERMISSION_VALUES.includes(raw.permisoCreador as CreatorPermission)) fail('permisoCreador', `Usa uno de: ${CREATOR_PERMISSION_VALUES.join(', ')}.`)

  return {observation: issues.length ? null : raw as unknown as CreatorObservation, issues}
}

function parsePrice(raw: unknown, path: string, publishedAt: string | null, today: string, fail: (path: string, message: string) => void): void {
  if (!isRecord(raw)) return fail(path, 'Cada precio debe ser un objeto con concepto, importe, moneda, unidad y vistoEl.')
  for (const key of Object.keys(raw)) if (!['concepto', 'importe', 'moneda', 'unidad', 'vistoEl'].includes(key)) fail(`${path}.${key}`, 'Campo no admitido en un precio.')
  noteField(raw.concepto, `${path}.concepto`, CREATOR_NOTE_LIMITS.dish, true, fail)
  if (typeof raw.importe !== 'number' || !Number.isFinite(raw.importe) || raw.importe <= 0) fail(`${path}.importe`, 'Debe ser un número positivo, sin símbolo (16.5).')
  if (raw.moneda !== 'EUR') fail(`${path}.moneda`, 'Debe ser "EUR".')
  if (!PRICE_UNITS.includes(raw.unidad as PriceUnit)) fail(`${path}.unidad`, `Usa una de: ${PRICE_UNITS.join(', ')} (ambiguous si el vídeo no lo dice).`)
  const seenAt = dateField(raw.vistoEl, `${path}.vistoEl`, today, fail)
  if (seenAt && publishedAt && seenAt > publishedAt) fail(`${path}.vistoEl`, 'Un precio visto en el vídeo no puede ser posterior a publicadoEl.')
}

function dateField(value: unknown, path: string, today: string, fail: (path: string, message: string) => void): string | null {
  if (typeof value !== 'string' || !isIsoDate(value)) {
    fail(path, 'Debe ser una fecha YYYY-MM-DD.')
    return null
  }
  if (value > today) {
    fail(path, 'No puede ser una fecha futura.')
    return null
  }
  return value
}

function noteField(value: unknown, path: string, max: number, required: boolean, fail: (path: string, message: string) => void): void {
  if (!isFilled(value)) {
    if (required) fail(path, 'No puede estar vacío.')
    return
  }
  if (value.trim().length > max) fail(path, `Máximo ${max} caracteres: son notas de quien vio el vídeo, no una transcripción.`)
}

/** Motivo por el que la URL no vale, o null. */
export function videoUrlProblem(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'No es una URL válida.'
  }
  if (url.protocol !== 'https:') return 'Debe empezar por https://.'
  if (!(url.hostname in VIDEO_HOSTS)) return `Host no admitido; usa ${[...new Set(Object.values(VIDEO_HOSTS))].join(', ')}.`
  if (url.username || url.password) return 'No puede llevar usuario ni contraseña.'
  const allowedQuery = url.hostname.endsWith('youtube.com') && url.pathname === '/watch' ? ['v'] : []
  if ([...url.searchParams.keys()].some((key) => !allowedQuery.includes(key)) || url.hash) return 'Quita los parámetros de seguimiento (?igsh=…, ?utm_…) y el #.'
  return null
}

export function videoPlatform(url: string): string {
  try {
    return VIDEO_HOSTS[new URL(url).hostname] ?? 'la plataforma del creador'
  } catch {
    return 'la plataforma del creador'
  }
}

/** Solo se muestra si el creador no ha negado el permiso. */
export function isPublishable(observation: CreatorObservation): boolean {
  return observation.permisoCreador !== 'no'
}

export function isCreatorObservationPath(ref: string): boolean {
  return ref.startsWith(CREATOR_OBSERVATIONS_DIRECTORY) && !ref.split('/').some((segment) => segment.startsWith('_'))
}

/** Más recientes primero; empate estable por URL. */
export function sortCreatorObservations<T extends Pick<CreatorObservation, 'publicadoEl' | 'urlVideo'>>(observations: readonly T[]): T[] {
  return [...observations].sort((left, right) => right.publicadoEl.localeCompare(left.publicadoEl) || left.urlVideo.localeCompare(right.urlVideo))
}

/** 2026-09-12 → 12/09/2026, sin pasar por la zona horaria. */
export function formatObservationDate(value: string): string {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

export function collaborationNotice(value: PaidCollaboration): string | null {
  if (value === 'sí') return 'El vídeo se presenta como colaboración pagada o invitación del local.'
  if (value === 'desconocido') return 'No consta si el vídeo fue una colaboración pagada o una invitación.'
  return null
}

const euro = new Intl.NumberFormat('es-ES', {style: 'currency', currency: 'EUR'})

export function priceSeenText(price: CreatorPriceSeen): string {
  const unit = price.unidad === 'ambiguous' ? 'unidad no indicada en el vídeo' : PRICE_UNIT_LABELS[price.unidad]
  return `${price.concepto} — ${euro.format(price.importe)} (${unit}; visto en el vídeo, ${formatObservationDate(price.vistoEl)})`
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
