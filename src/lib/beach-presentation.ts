import type {BeachDetail, PracticalFactView} from '../types/content'
import {factAttribute} from './indexability'

/**
 * Cómo se muestran los hechos prácticos de una playa. El valor y su procedencia vienen siempre del
 * snapshot (content/facts/); aquí solo se decide la etiqueta, el formato según la unidad y el grupo.
 */

const LABELS: Record<string, string> = {
  ubicacion: 'Ubicación',
  entorno: 'Entorno',
  longitud: 'Longitud',
  'anchura-maxima': 'Anchura máxima',
  arena: 'Arena',
  'bandera-azul': 'Bandera Azul',
  socorrismo: 'Socorrismo',
  'atencion-sanitaria': 'Atención sanitaria',
  aseos: 'Aseos',
  'accesos-pasarela': 'Accesos',
  'alquiler-y-ocio': 'Alquiler y ocio',
  'areas-de-juego': 'Áreas de juego',
  'punto-accesible': 'Punto de playa accesible',
  'punto-accesible-equipamiento': 'Equipamiento del punto accesible',
  'aparcamiento-adaptado': 'Aparcamiento reservado',
  'aparcamiento-cercano': 'Aparcamiento en la zona',
  perros: 'Perros',
  afluencia: 'Afluencia y ambiente',
}

const QUALIFIER_LABELS: Record<string, string> = {verano: 'Horario del punto accesible en verano', invierno: 'Horario del punto accesible el resto del año'}

export const FACT_GROUPS = [
  {id: 'como-es', title: 'Cómo es', attributes: ['ubicacion', 'entorno', 'longitud', 'anchura-maxima', 'arena', 'bandera-azul']},
  {id: 'seguridad-y-servicios', title: 'Seguridad y servicios', attributes: ['socorrismo', 'atencion-sanitaria', 'aseos', 'accesos-pasarela', 'alquiler-y-ocio', 'areas-de-juego']},
  {id: 'accesibilidad', title: 'Accesibilidad', attributes: ['punto-accesible', 'punto-accesible-equipamiento', 'horario']},
  {id: 'normas', title: 'Normas', attributes: ['perros']},
  {id: 'aparcamiento', title: 'Aparcamiento', attributes: ['aparcamiento-cercano', 'aparcamiento-adaptado']},
] as const

export function factLabel(fact: PracticalFactView): string {
  const qualifier = fact.factId.split('.')[3]
  if (qualifier && QUALIFIER_LABELS[qualifier]) return QUALIFIER_LABELS[qualifier]
  return LABELS[factAttribute(fact.factId)] ?? factAttribute(fact.factId)
}

const number = new Intl.NumberFormat('es-ES')

/** Valor legible según la unidad; `null` si el hecho no está confirmado (no se publica cifra). */
export function factValue(fact: PracticalFactView): string | null {
  if (fact.status !== 'confirmed' || fact.value === null) return null
  if (fact.unit === 'm' || fact.unit === 'km' || fact.unit === 'min') return `${number.format(Number(fact.value))} ${fact.unit}`
  if (fact.unit === 'booleano') return fact.value === 'true' ? 'Sí' : 'No'
  return fact.value
}

/** Texto para lo que no está confirmado. Nunca afirma una verificación que no hay. */
export function pendingText(fact: PracticalFactView): string {
  if (fact.status === 'conflict') return 'Las fuentes no coinciden: pendiente de revisión'
  if (fact.status === 'needs verification') return 'Sin fuente oficial aprobada: pendiente de confirmar'
  return 'Pendiente: sin fuente oficial ni visita registrada'
}

/**
 * Procedencia de un hecho sin confirmar: se nombra quién lo publica, sin enlace. Enlazarla llevaría al
 * lector a la cifra que la página no publica (#17: sin fuente municipal, sin cifra).
 */
export function unconfirmedSourceText(fact: PracticalFactView): string | null {
  if (fact.status === 'confirmed' || !fact.sourceTitle) return null
  return `Lo publica ${fact.sourceTitle.split(':')[0]}, una fuente que no tenemos aprobada como oficial; no la enlazamos mientras no se confirme.`
}

export interface FactRow {
  fact: PracticalFactView
  label: string
  value: string | null
}

export function factRows(facts: readonly PracticalFactView[], attributes: readonly string[]): FactRow[] {
  return facts
    .filter((fact) => attributes.includes(factAttribute(fact.factId)))
    .map((fact) => ({fact, label: factLabel(fact), value: factValue(fact)}))
}

/** Hechos sin fuente: los huecos que quedan por comprobar, para resumirlos y avisar. */
export function pendingFacts(facts: readonly PracticalFactView[]): FactRow[] {
  return facts.filter((fact) => fact.status === 'unknown').map((fact) => ({fact, label: factLabel(fact), value: null}))
}

export function findFact(beach: BeachDetail, attribute: string): PracticalFactView | undefined {
  return beach.facts.find((fact) => factAttribute(fact.factId) === attribute && fact.factId.split('.').length === 3)
}

const date = new Intl.DateTimeFormat('es-ES', {dateStyle: 'long'})

export function formatRetrievedAt(retrievedAt: string): string {
  return date.format(new Date(retrievedAt))
}

/** Fecha más reciente de consulta de los hechos confirmados; la usa la línea de procedencia del hub. */
export function latestRetrievedAt(beaches: readonly BeachDetail[]): string | null {
  return beaches.flatMap((beach) => beach.facts.flatMap((fact) => fact.status === 'confirmed' && fact.retrievedAt ? [fact.retrievedAt] : [])).sort().at(-1) ?? null
}
