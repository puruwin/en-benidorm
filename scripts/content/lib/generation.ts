import {categories} from '../../../content/seed/categories'
import type {ContentDocument} from '../../content-validation'
import type {BusinessQualityAssessment, EnrichedEntity, GeneratedBusinessArtifact, GeneratedEditorial} from './types'

export const BUSINESS_DOCUMENT_SCHEMA = {
  _type: 'business',
  factualFields: ['name', 'businessKind', 'address', 'location', 'phone', 'website', 'lastVerified', 'sources'],
  editorialFields: ['shortDescription', 'body', 'seo'],
  constraints: {language: 'es', shortDescriptionMaxLength: 240, seoTitleMaxLength: 60, seoDescriptionMaxLength: 160},
}

export const EDITORIAL_INSTRUCTIONS = [
  'Escribe en español claro, útil y sobrio para una guía local de Benidorm.',
  'Usa únicamente los facts suministrados; no supongas ni completes información.',
  'OSM y OfficialWebsite son fuentes independientes: usa sólo valores con provenance y no resuelvas contradicciones por tu cuenta.',
  'No copies literalmente el texto de la web oficial: sintetiza y parafrasea sus facts verificables.',
  'No uses superlativos no verificables ni afirmes que un negocio es el mejor, popular o recomendado.',
  'Los highlights y cada sección deben derivarse de rasgos concretos, nunca de la mera categoría, ciudad, disponibilidad de web o existencia de una ficha.',
  'No uses como relleno: "restaurante situado en Benidorm", "restaurante ubicado en Benidorm", "figura como restaurante", "establecimiento de restauración", "incluido en la oferta local", "una opción para quienes buscan", "información básica disponible" ni "consulta su sitio web oficial". Sólo podrían aparecer dentro de una frase que añada información factual específica.',
  'La aplicación ya ha fijado qualityTier de forma determinista. Respétalo y adapta la profundidad al tier; no decidas ni eleves el tier.',
  'Para basic crea una descripción breve con una o dos secciones como máximo. Un solo highlight es válido.',
  'Para rich elige únicamente las secciones semánticas justificadas por los facts. No fuerces una estructura ni una longitud fija.',
]

export const BUSINESS_TAXONOMY = categories.map((category) => ({id: category._id, title: category.title, group: category.group}))

export function buildBusinessDocument(entity: EnrichedEntity, editorial: GeneratedEditorial): ContentDocument {
  const facts = entity.facts
  if (!facts.name.value || !facts.businessKind.value) throw new Error('Faltan name o businessKind factuales.')
  if (editorial.qualityTier === 'insufficient' || !editorial.shortDescription || !editorial.seo) throw new Error('No se puede construir un documento publicable desde contenido insufficient o incompleto.')
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

export function buildGenerationArtifact(
  entity: EnrichedEntity,
  assessment: BusinessQualityAssessment,
  editorial?: GeneratedEditorial,
): GeneratedBusinessArtifact {
  if (assessment.tier === 'insufficient') return {
    schemaVersion: 1, id: entity.id, type: entity.type, qualityTier: assessment.tier,
    qualityAssessment: assessment, generationSkipped: true, reason: 'insufficient-facts', document: null,
  }
  if (!editorial) throw new Error(`Falta contenido editorial para el tier ${assessment.tier}.`)
  return {
    schemaVersion: 1, id: entity.id, type: entity.type, qualityTier: assessment.tier,
    qualityAssessment: assessment, generationSkipped: false, reason: null,
    document: buildBusinessDocument(entity, editorial),
  }
}

function portableText(editorial: GeneratedEditorial): unknown[] {
  const block = (text: string, extra: Record<string, unknown> = {}) => ({
    _type: 'block', style: 'normal', markDefs: [], children: [{_type: 'span', marks: [], text}], ...extra,
  })
  const titles: Record<string, string> = {
    food: 'Cocina', experience: 'La experiencia', location: 'Ubicación', services: 'Servicios',
    practical: 'Información práctica', goodFor: 'Puede interesarte si…', highlights: 'Lo más destacado',
  }
  const body: unknown[] = []
  for (const item of editorial.description) {
    if (item.section !== 'overview') body.push(block(titles[item.section] ?? item.section, {style: 'h2'}))
    body.push(block(item.text))
  }
  if (editorial.highlights.length) {
    body.push(block('Lo más destacado', {style: 'h2'}))
    body.push(...editorial.highlights.map((highlight) => block(highlight, {listItem: 'bullet', level: 1})))
  }
  return body
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
