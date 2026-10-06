import {categories} from '../../../content/seed/categories'
import type {ContentDocument} from '../../content-validation'
import type {EnrichedEntity, GeneratedEditorial} from './types'

export const BUSINESS_DOCUMENT_SCHEMA = {
  _type: 'business',
  factualFields: ['name', 'businessKind', 'address', 'location', 'phone', 'website', 'lastVerified', 'sources'],
  editorialFields: ['contentQuality', 'shortDescription', 'body', 'seo'],
  constraints: {language: 'es', shortDescriptionMaxLength: 240, seoTitleMaxLength: 60, seoDescriptionMaxLength: 160},
}

export const EDITORIAL_INSTRUCTIONS = [
  'Escribe en español claro, útil y sobrio para una guía local de Benidorm.',
  'Usa únicamente los facts suministrados; no supongas ni completes información.',
  'OSM y OfficialWebsite son fuentes independientes: usa sólo valores con provenance y no resuelvas contradicciones por tu cuenta.',
  'No copies literalmente el texto de la web oficial: sintetiza y parafrasea sus facts verificables.',
  'No uses superlativos no verificables ni afirmes que un negocio es el mejor, popular o recomendado.',
  'Los highlights, goodFor y cada sección deben derivarse de rasgos concretos, nunca de la mera categoría, ciudad, disponibilidad de web o existencia de una ficha.',
  'No uses como relleno: "restaurante situado en Benidorm", "restaurante ubicado en Benidorm", "figura como restaurante", "establecimiento de restauración", "incluido en la oferta local", "una opción para quienes buscan", "información básica disponible" ni "consulta su sitio web oficial". Sólo podrían aparecer dentro de una frase que añada información factual específica.',
  'Devuelve insufficient si no hay al menos dos rasgos específicos útiles además de nombre, tipo, dirección, teléfono, web y coordenadas. No rellenes espacio.',
]

export const BUSINESS_TAXONOMY = categories.map((category) => ({id: category._id, title: category.title, group: category.group}))

export function buildBusinessDocument(entity: EnrichedEntity, editorial: GeneratedEditorial): ContentDocument {
  const facts = entity.facts
  if (!facts.name.value || !facts.businessKind.value) throw new Error('Faltan name o businessKind factuales.')
  const document: ContentDocument = {
    _id: entity.id,
    _type: 'business',
    name: facts.name.value,
    slug: {_type: 'slug', current: entity.slug},
    businessKind: facts.businessKind.value,
    contentQuality: editorial.contentQuality,
    shortDescription: editorial.shortDescription ?? '',
    body: editorial.contentQuality === 'sufficient' ? portableText(editorial) : [],
    language: 'es',
    lastVerified: latestRetrievalDate(entity),
    sources: entity.sources.map((source) => ({
      _type: 'source',
      title: `${source.provider}: ${source.identifier}`,
      publisher: source.attribution,
      url: source.url,
      accessedAt: source.retrievedAt.slice(0, 10),
    })),
    ...(editorial.seo ? {seo: editorial.seo} : {}),
  }
  assignFact(document, 'address', facts.address.value)
  if (facts.location.value) document.location = {_type: 'geopoint', ...facts.location.value}
  assignFact(document, 'phone', facts.phone.value)
  assignFact(document, 'website', facts.website.value)
  const category = categoryFor(entity.type)
  if (category) document.categories = [{_type: 'reference', _ref: category}]
  return document
}

function portableText(editorial: GeneratedEditorial): unknown[] {
  const block = (text: string, extra: Record<string, unknown> = {}) => ({
    _type: 'block', style: 'normal', markDefs: [], children: [{_type: 'span', marks: [], text}], ...extra,
  })
  const section = (title: string, value: string | null) => value ? [block(title, {style: 'h2'}), block(value)] : []
  return [
    ...section('Qué es', editorial.whatIsIt),
    ...section('Qué esperar', editorial.whatToExpect),
    ...section('Por qué ir', editorial.whyGo),
    ...(editorial.goodFor.length ? [block('Para quién es', {style: 'h2'}), ...editorial.goodFor.map((item) => block(item, {listItem: 'bullet', level: 1}))] : []),
    ...(editorial.highlights.length ? [block('Lo más destacado', {style: 'h2'}), ...editorial.highlights.map((highlight) => block(highlight, {listItem: 'bullet', level: 1}))] : []),
  ]
}

function latestRetrievalDate(entity: EnrichedEntity): string {
  const dates = entity.sources.map((source) => source.retrievedAt).sort()
  const latest = dates.at(-1)
  if (!latest) throw new Error('No hay fecha de consulta en las fuentes.')
  return latest.slice(0, 10)
}

function categoryFor(type: EnrichedEntity['type']): string | undefined {
  if (type === 'restaurant') return 'category-restaurantes'
  if (type === 'cafe') return 'category-cafeterias'
  return undefined
}

function assignFact(document: ContentDocument, field: string, value: unknown): void {
  if (value !== null) document[field] = value
}
