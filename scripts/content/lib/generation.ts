import {categories} from '../../../content/seed/categories'
import type {ContentDocument} from '../../content-validation'
import type {EnrichedEntity, GeneratedEditorial} from './types'

export const BUSINESS_DOCUMENT_SCHEMA = {
  _type: 'business',
  factualFields: ['name', 'businessKind', 'address', 'location', 'phone', 'website', 'lastVerified', 'sources'],
  editorialFields: ['shortDescription', 'body', 'seo'],
  constraints: {language: 'es', shortDescriptionMaxLength: 240, seoTitleMaxLength: 60, seoDescriptionMaxLength: 160},
}

export const EDITORIAL_INSTRUCTIONS = [
  'Escribe en español claro, útil y sobrio para una guía local de Benidorm.',
  'Usa únicamente los facts suministrados; no supongas ni completes información.',
  'No menciones direcciones, teléfonos, precios, horarios, ratings, reviews, servicios, coordenadas ni premios salvo como copia literal solicitada (no se solicita en esta fase).',
  'No uses superlativos no verificables ni afirmes que un negocio es el mejor, popular o recomendado.',
  'Los highlights deben ser editoriales y derivarse de hechos disponibles, nunca servicios inventados.',
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
    shortDescription: editorial.shortDescription,
    body: portableText(editorial),
    language: 'es',
    lastVerified: latestRetrievalDate(entity),
    sources: entity.sources.map((source) => ({
      _type: 'source',
      title: `${source.provider}: ${source.identifier}`,
      publisher: source.attribution,
      url: source.url,
      accessedAt: source.retrievedAt.slice(0, 10),
    })),
    seo: editorial.seo,
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
  return [block(editorial.description), ...editorial.highlights.map((highlight) => block(highlight, {listItem: 'bullet', level: 1}))]
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
