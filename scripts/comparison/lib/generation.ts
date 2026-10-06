import type {ContentDocument} from '../../content-validation'
import type {EnrichedComparisonArtifact, GeneratedComparisonArtifact, GeneratedComparisonEditorial} from './types'

export const COMPARISON_EDITORIAL_INSTRUCTIONS = [
  'Voz práctica, comparativa, directa y específica; evita tono de agregador.',
  'Evita “una excelente opción”, “ideal para todos”, “sin duda”, “el mejor” e “imperdible”.',
  'Explica diferencias reales y no conviertas marketing de un negocio en un hecho objetivo.',
  'No afirmes visitas ni experiencias personales. Indica que no todos los locales han sido visitados personalmente.',
  'Los precios pueden cambiar y deben conservar la fecha de comprobación en methodology.',
  'No inventes inconvenientes; weaknesses debe quedar vacío sin evidence explícita en limitations.',
]

export const PUBLIC_RANKING_CRITERIA = [
  'Relevancia: relación directa y documentada con la cocina italiana.',
  'Especificidad: nivel de detalle verificable sobre cocina, platos y especialidades.',
  'Cobertura comparativa: número de dimensiones útiles con evidence disponible.',
  'Valor distintivo: rasgos concretos que permiten diferenciar una propuesta de otra.',
  'Utilidad práctica: reservas, horarios, ubicación, servicios y precios publicados.',
]

export function validateComparisonEditorial(editorial: GeneratedComparisonEditorial, enriched: EnrichedComparisonArtifact): string[] {
  const errors: string[] = []
  const expected = enriched.businesses.map((business, index) => ({businessId: business.businessId, rank: index + 1}))
  if (!textBetween(editorial.title, 20, 90)) errors.push('title debe tener 20-90 caracteres.')
  if (!textBetween(editorial.intro, 100, 700)) errors.push('intro debe tener 100-700 caracteres.')
  if (!textBetween(editorial.quickVerdict, 80, 700)) errors.push('quickVerdict debe tener 80-700 caracteres.')
  if (!Array.isArray(editorial.entries) || editorial.entries.length !== expected.length) errors.push('entries debe contener exactamente los Businesses seleccionados.')
  else for (const [index, entry] of editorial.entries.entries()) {
    const wanted = expected[index]!
    if (entry.businessId !== wanted.businessId || entry.rank !== wanted.rank) errors.push(`entries[${index}] debe conservar businessId=${wanted.businessId} y rank=${wanted.rank}.`)
    if (!textBetween(entry.verdict, 30, 300)) errors.push(`entries[${index}].verdict no es válido.`)
    if (!stringArray(entry.strengths, 1, 4) || !stringArray(entry.weaknesses, 0, 3) || !stringArray(entry.bestFor, 1, 3) || !stringArray(entry.practicalNotes, 0, 4)) errors.push(`entries[${index}] contiene arrays no válidos.`)
    if (entry.featuredItem !== null && !textBetween(entry.featuredItem, 3, 140)) errors.push(`entries[${index}].featuredItem no es válido.`)
    if (entry.featuredPrice !== null && !textBetween(entry.featuredPrice, 2, 80)) errors.push(`entries[${index}].featuredPrice no es válido.`)
  }
  if (!textBetween(editorial.methodology, 100, 900)) errors.push('methodology debe tener 100-900 caracteres.')
  if (!stringArray(editorial.criteria, 3, 5)) errors.push('criteria debe contener 3-5 criterios.')
  if (!textBetween(editorial.seo?.metaTitle, 20, 60) || !textBetween(editorial.seo?.metaDescription, 70, 160)) errors.push('seo no cumple las longitudes requeridas.')
  if (!Array.isArray(editorial.claims) || editorial.claims.length === 0 || editorial.claims.some((claim) => !claim.path || !claim.claim || !Array.isArray(claim.supportedBy) || claim.supportedBy.length === 0)) errors.push('claims debe declarar soporte explícito.')
  return errors
}

export function buildComparisonArtifact(enriched: EnrichedComparisonArtifact, editorial: GeneratedComparisonEditorial, now: string): GeneratedComparisonArtifact {
  const completed = completeClaimBindings(structuredClone(editorial), enriched)
  completed.criteria = [...PUBLIC_RANKING_CRITERIA]
  completed.methodology = publicMethodology(enriched)
  const validation = validateComparisonEditorial(completed, enriched)
  if (validation.length) throw new Error(`Structured Output no válido: ${validation.join(' ')}`)
  const document: ContentDocument = {
    _id: enriched.id,
    _type: 'comparison',
    title: completed.title,
    slug: {_type: 'slug', current: enriched.slug},
    language: 'es',
    topic: enriched.topic,
    category: 'donde-comer',
    intro: completed.intro,
    quickVerdict: completed.quickVerdict,
    entries: completed.entries.map((entry) => ({
      _type: 'comparisonEntry',
      business: {_type: 'reference', _ref: entry.businessId},
      rank: entry.rank,
      verdict: entry.verdict,
      strengths: entry.strengths,
      weaknesses: entry.weaknesses,
      bestFor: entry.bestFor,
      ...(entry.featuredItem ? {featuredItem: entry.featuredItem} : {}),
      ...(entry.featuredPrice ? {featuredPrice: entry.featuredPrice} : {}),
      practicalNotes: entry.practicalNotes,
    })),
    methodology: completed.methodology,
    criteria: completed.criteria,
    author: {_type: 'reference', _ref: 'author-david'},
    sources: enriched.sources.filter((source) => source.url).map((source) => ({
      _type: 'source', title: `${source.provider}: ${source.identifier}`, publisher: source.attribution,
      url: source.url, accessedAt: source.retrievedAt.slice(0, 10),
    })),
    lastVerified: latestDate(enriched),
    seo: completed.seo,
  }
  return {schemaVersion: 1, id: enriched.id, topic: enriched.topic, generatedAt: now, editorial: completed, document}
}

/** Adds deterministic leaf-level bindings only when the generated text overlaps supplied evidence. */
export function completeClaimBindings(editorial: GeneratedComparisonEditorial, enriched: EnrichedComparisonArtifact): GeneratedComparisonEditorial {
  const businessById = new Map(enriched.businesses.map((business) => [business.businessId, business]))
  for (const entry of editorial.entries) {
    const business = businessById.get(entry.businessId)
    if (!business) continue
    const allFacts = Object.entries(business.evidence).flatMap(([category, facts]) => facts.map((fact) => ({category, fact})))
    if (entry.featuredItem && !/(?:seg[uú]n|indica|web|declara)/i.test(entry.featuredItem)) {
      const matches = matchingFacts(entry.featuredItem, allFacts.filter(({category}) => category === 'featuredItems' || category === 'specialties'))
      if (matches.length && matches.every(({fact}) => fact.nature === 'self_claim')) entry.featuredItem = `${entry.featuredItem} (según su web)`
    }
    const leaves: Array<{path: string; value: string; categories?: string[]}> = [
      {path: `entries.${entry.businessId}.verdict`, value: entry.verdict},
      ...entry.strengths.map((value, index) => ({path: `entries.${entry.businessId}.strengths.${index}`, value})),
      ...entry.weaknesses.map((value, index) => ({path: `entries.${entry.businessId}.weaknesses.${index}`, value, categories: ['limitations']})),
      ...entry.bestFor.map((value, index) => ({path: `entries.${entry.businessId}.bestFor.${index}`, value})),
      ...entry.practicalNotes.map((value, index) => ({path: `entries.${entry.businessId}.practicalNotes.${index}`, value})),
      ...(entry.featuredItem ? [{path: `entries.${entry.businessId}.featuredItem`, value: entry.featuredItem, categories: ['featuredItems', 'specialties']}] : []),
      ...(entry.featuredPrice ? [{path: `entries.${entry.businessId}.featuredPrice`, value: entry.featuredPrice, categories: ['prices']}] : []),
    ]
    for (const leaf of leaves) {
      if (editorial.claims.some((claim) => claim.path === leaf.path)) continue
      const candidates = leaf.categories ? allFacts.filter(({category}) => leaf.categories!.includes(category)) : allFacts
      const matches = matchingFacts(leaf.value, candidates)
      if (matches.length) editorial.claims.push({path: leaf.path, claim: leaf.value, supportedBy: matches.slice(0, 6).map(({fact}) => fact.id)})
    }
  }
  return editorial
}

function latestDate(enriched: EnrichedComparisonArtifact): string {
  const value = enriched.sources.map((source) => source.retrievedAt.slice(0, 10)).sort().at(-1)
  if (!value) throw new Error('Comparison necesita al menos una fuente fechada.')
  return value
}
function publicMethodology(enriched: EnrichedComparisonArtifact): string {
  const date = new Intl.DateTimeFormat('es-ES', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'}).format(new Date(`${latestDate(enriched)}T00:00:00.000Z`))
  return `La posición se calcula con cinco criterios explícitos: relevancia, especificidad, cobertura comparativa, valor distintivo y utilidad práctica; los empates se resuelven de forma estable. Para esta guía se consultaron datos abiertos de OpenStreetMap, webs oficiales y cartas públicas, con última comprobación el ${date}. No todos los locales han sido visitados personalmente. Los precios son referencias fechadas y pueden cambiar; conviene confirmarlos antes de reservar.`
}
function textBetween(value: unknown, min: number, max: number): value is string { return typeof value === 'string' && value.trim().length >= min && value.length <= max }
function stringArray(value: unknown, min: number, max: number): value is string[] { return Array.isArray(value) && value.length >= min && value.length <= max && value.every((item) => typeof item === 'string' && item.trim().length > 0) }
function matchingFacts(value: string, candidates: Array<{category: string; fact: EnrichedComparisonArtifact['businesses'][number]['evidence'][keyof EnrichedComparisonArtifact['businesses'][number]['evidence']][number]}>): typeof candidates {
  const normalized = normalize(value)
  const tokens = normalized.split(' ').filter((token) => token.length >= 3 || /^\d+$/.test(token))
  return candidates.filter(({fact}) => {
    const factValue = typeof fact.value === 'object' ? `${fact.value.item} ${fact.value.value} ${fact.value.currency}` : String(fact.value)
    const factText = normalize(factValue)
    return tokens.some((token) => factText.includes(token)) || normalize(factValue).split(' ').some((token) => token.length >= 4 && normalized.includes(token))
  })
}
function normalize(value: string): string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\bdiari[oa]s?\b/g, 'dias').trim() }
