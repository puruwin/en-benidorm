import type {PracticalFactView} from '../types/content'
import {factValue, type FactRow} from './beach-presentation'

/**
 * Cómo se muestran los hechos prácticos de una guía de Información práctica. El valor y su procedencia
 * vienen siempre del snapshot (content/facts/); aquí solo se deciden la etiqueta y el grupo. Los grupos
 * siguen el sujeto del hecho (`benidorm.zona-azul.horario` → zona-azul), en el orden en que la guía los cita.
 */

const SUBJECT_TITLES: Record<string, string> = {
  'zona-azul': 'Zona azul',
  'zona-verde': 'Los otros colores',
  'zona-naranja': 'Los otros colores',
  'zona-roja': 'Los otros colores',
  'aparcamientos-disuasorios': 'La red de aparcamientos gratuitos',
  'aparcamiento-beniarda': 'Aparcamientos con plazas publicadas',
  'aparcamiento-bernat-de-sarria': 'Aparcamientos con plazas publicadas',
  'playa-poniente': 'Aparcamientos con plazas publicadas',
  'autobus-urbano': 'Autobús y TRAM',
  tram: 'Autobús y TRAM',
  zbe: 'Zona de bajas emisiones',
}

// Clave: el id sin el municipio (`zona-azul.horario.verano-visitantes`).
const LABELS: Record<string, string> = {
  'zona-azul.horario.invierno-visitantes': 'Horario para visitantes, del 1 de octubre al 14 de junio',
  'zona-azul.horario.verano-visitantes': 'Horario para visitantes en verano y Semana Santa',
  'zona-azul.horario.residentes': 'Horario para residentes empadronados',
  'zona-azul.vigencia': 'Calles reguladas todo el año o solo en verano',
  'zona-azul.estancia-maxima': 'Estancia máxima',
  'zona-azul.pago': 'Cómo se paga',
  'zona-azul.tarifa': 'Tarifa por hora',
  'zona-azul.motos': 'Motos y ciclomotores',
  'zona-azul.facilidad-aparcar': 'Facilidad para encontrar plaza',
  'zona-verde.acceso': 'Zona verde',
  'zona-naranja.acceso': 'Zona naranja',
  'zona-roja.acceso': 'Zona roja',
  'aparcamientos-disuasorios.plazas': 'Tamaño de la red',
  'aparcamientos-disuasorios.mapa': 'Dónde están',
  'aparcamientos-disuasorios.mayores': 'Los de más plazas',
  'aparcamientos-disuasorios.ocupacion': 'Cuánto se llenan en temporada alta',
  'aparcamientos-disuasorios.autobus': 'Autobús gratuito desde dos aparcamientos (oferta de 2023)',
  'aparcamientos-disuasorios.autobus-vigencia': 'Si el autobús gratuito sigue vigente',
  'aparcamiento-beniarda.plazas': 'Beniardá',
  'aparcamiento-bernat-de-sarria.plazas': 'Bernat de Sarrià',
  'aparcamiento-bernat-de-sarria.vigencia': 'Si Bernat de Sarrià sigue abierto y gratuito',
  'playa-poniente.aparcamiento-cercano': 'Poniente',
  'autobus-urbano.billetes': 'Billetes del autobús urbano',
  'autobus-urbano.transbordo': 'Transbordos',
  'autobus-urbano.tarifa': 'Precio del billete de autobús',
  'tram.tarifa-sencillo': 'Precio del billete sencillo del TRAM',
  'zbe.ambito': 'Qué abarca',
  'zbe.acceso-libre': 'Quién entra sin restricciones',
  'zbe.restricciones': 'Quién tiene restricciones',
  'zbe.restricciones-detalle': 'En qué consiste la restricción para B y sin distintivo',
  'zbe.control': 'Cómo se controla',
  'zbe.inicio': 'Desde cuándo funciona',
  'zbe.autorizaciones': 'Accesos puntuales',
  'zbe.hoteles': 'Si te alojas en un hotel del interior',
  'zbe.aparcamientos-publicos': 'Si aparcas en un parking público del interior',
  'zbe.matricula-extranjera': 'Si llegas con matrícula extranjera',
  'zbe.taxis': 'Taxis y VTC',
  'zbe.invitaciones': 'Si te invita un residente en la ZBE',
  'zbe.movilidad-reducida': 'Con tarjeta de movilidad reducida',
  'zbe.moratoria-sin-distintivo': 'Moratoria para coches sin distintivo',
  'zbe.sanciones': 'Desde cuándo se sanciona',
}

function key(factId: string): string {
  return factId.split('.').slice(1).join('.')
}

export function hasGuideFactLabel(factId: string): boolean {
  return key(factId) in LABELS
}

export function guideFactLabel(fact: PracticalFactView): string {
  return LABELS[key(fact.factId)] ?? key(fact.factId)
}

export interface GuideFactGroup {
  id: string
  title: string
  rows: FactRow[]
}

/** Agrupa los hechos de la guía por sujeto, conservando el orden en que la guía los cita. */
export function guideFactGroups(facts: readonly PracticalFactView[]): GuideFactGroup[] {
  const groups = new Map<string, GuideFactGroup>()
  for (const fact of facts) {
    const subject = fact.factId.split('.')[1] ?? ''
    const title = SUBJECT_TITLES[subject] ?? subject
    // Lo no confirmado va solo al recuadro de pendientes, para no repetirlo.
    if (fact.status !== 'confirmed') continue
    const group = groups.get(title) ?? {id: slug(title), title, rows: []}
    group.rows.push({fact, label: guideFactLabel(fact), value: factValue(fact)})
    groups.set(title, group)
  }
  return [...groups.values()]
}

/** Lo que no está confirmado: los huecos a la vista, para resumirlos y avisar. */
export function guidePendingFacts(facts: readonly PracticalFactView[]): FactRow[] {
  return facts.filter((fact) => fact.status !== 'confirmed').map((fact) => ({fact, label: guideFactLabel(fact), value: null}))
}

export function findGuideFact(facts: readonly PracticalFactView[], id: string): PracticalFactView | undefined {
  return facts.find((fact) => key(fact.factId) === id)
}

function slug(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
