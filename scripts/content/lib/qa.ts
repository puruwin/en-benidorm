import type {ContentDocument, ContentInput} from '../../content-validation'
import {validateContent} from '../../content-validation'
import {seedInputs} from '../../validate-content'
import {normalizeText} from './normalize'
import {sourceIsComplete, validateFactProvenance} from './enrichment'
import type {EnrichedEntity, QAIssue, QAOutcome} from './types'

export interface QACandidate {
  document: ContentDocument
  enriched?: EnrichedEntity
}

export interface QAResult {
  id: string
  outcome: QAOutcome
  issues: QAIssue[]
}

const BENIDORM_BOUNDS = {minLat: 38.48, maxLat: 38.61, minLng: -0.2, maxLng: -0.05}
const GENERIC_PATTERNS = [
  /restaurante (?:situado|ubicado) en benidorm/i,
  /figura como restaurante/i,
  /establecimiento de restauraci[oó]n/i,
  /incluido en la oferta local/i,
  /una opci[oó]n para quienes buscan/i,
  /informaci[oó]n b[aá]sica disponible/i,
  /consulta (?:su|el) sitio web oficial/i,
]
const BASIC_FACT_FIELDS = new Set(['name', 'businessKind', 'address', 'location', 'phone', 'website', 'openingHoursRaw'])

export function inspectCandidates(candidates: readonly QACandidate[]): QAResult[] {
  const issues = new Map(candidates.map(({document}) => [document._id, [] as QAIssue[]]))
  const inputs: ContentInput[] = candidates.map(({document}) => ({document, source: `candidate:${document._id}`, expectedType: 'business'}))
  const validation = validateContent([...seedInputs(), ...inputs])
  for (const issue of validation.issues) {
    if (!issue.source.startsWith('candidate:')) continue
    add(issues, issue.source.slice('candidate:'.length), 'FAIL', 'schema', issue.path, issue.message)
  }

  for (const candidate of candidates) inspectCandidate(candidate, issues)
  inspectEntityDuplicates(candidates, issues)
  inspectEditorialDuplicates(candidates, issues)

  return candidates.map(({document}) => {
    const documentIssues = issues.get(document._id) ?? []
    const outcome: QAOutcome = documentIssues.some((issue) => issue.severity === 'FAIL')
      ? 'FAIL'
      : documentIssues.length ? 'WARNING' : 'PASS'
    return {id: document._id, outcome, issues: documentIssues}
  })
}

function inspectCandidate(candidate: QACandidate, issues: Map<string, QAIssue[]>): void {
  const {document, enriched} = candidate
  const id = document._id
  if (!enriched) {
    add(issues, id, 'FAIL', 'missing-enrichment', '', 'No existe el artefacto enriquecido correspondiente.')
    return
  }
  for (const error of validateFactProvenance(enriched)) add(issues, id, 'FAIL', 'fact-provenance', 'facts', error)
  for (const source of enriched.sources) {
    if (!sourceIsComplete(source)) add(issues, id, 'FAIL', 'source-provenance', 'sources', `La fuente ${source.key} no tiene procedencia completa.`)
  }
  if (!Array.isArray(document.sources) || document.sources.length === 0) {
    add(issues, id, 'FAIL', 'sources', 'sources', 'El documento debe conservar al menos una fuente.')
  } else {
    const actualUrls = document.sources.flatMap((source) => isRecord(source) && typeof source.url === 'string' ? [source.url] : []).sort()
    const expectedUrls = enriched.sources.flatMap((source) => source.url ? [source.url] : []).sort()
    if (JSON.stringify(actualUrls) !== JSON.stringify(expectedUrls)) {
      add(issues, id, 'FAIL', 'source-integrity', 'sources', 'Las fuentes finales no coinciden con las fuentes enriquecidas.')
    }
  }
  if (!Array.isArray(document.body) || document.body.length === 0) add(issues, id, 'FAIL', 'incomplete', 'body', 'Falta la descripción editorial.')
  if (!isRecord(document.seo) || !nonEmpty(document.seo.metaTitle) || !nonEmpty(document.seo.metaDescription)) {
    add(issues, id, 'FAIL', 'incomplete', 'seo', 'Faltan title o meta description de SEO.')
  }
  inspectCoordinates(document, issues)
  inspectFactualIntegrity(document, enriched, issues)
  inspectEditorialQuality(document, enriched, issues)
}

function inspectEditorialQuality(document: ContentDocument, enriched: EnrichedEntity, issues: Map<string, QAIssue[]>): void {
  const id = document._id
  const quality = document.contentQuality
  const usefulFacts = Object.entries(enriched.facts).filter(([field, fact]) => !BASIC_FACT_FIELDS.has(field) && fact.value !== null)
  if (quality === 'insufficient' || usefulFacts.length < 2) {
    add(issues, id, 'FAIL', 'INSUFFICIENT_FACTS', 'contentQuality', `Sólo hay ${usefulFacts.length} grupos de facts específicos; la ficha no puede ser útil sin relleno.`)
  }
  const text = editorialText(document)
  const specificTokens = factTokens(usefulFacts.map(([, fact]) => fact.value))
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean)) {
    if (!GENERIC_PATTERNS.some((pattern) => pattern.test(sentence))) continue
    const sentenceTokens = new Set(tokens(sentence))
    if (![...specificTokens].some((token) => sentenceTokens.has(token))) {
      add(issues, id, 'FAIL', 'GENERIC_EDITORIAL_CONTENT', 'body', `Frase genérica sin información específica adicional: "${sentence.slice(0, 180)}"`)
    }
  }
  if (quality === 'sufficient') {
    const words = tokens(text)
    const covered = new Set(words.filter((word) => specificTokens.has(word)))
    const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((item) => item.trim()).filter((item) => tokens(item).length >= 4)
    const supported = sentences.filter((sentence) => tokens(sentence).some((word) => specificTokens.has(word))).length
    const supportRatio = sentences.length ? supported / sentences.length : 0
    if (covered.size < 2 || supportRatio < 0.5) {
      add(issues, id, 'FAIL', 'LOW_INFORMATION_DENSITY', 'body', `Densidad factual baja: ${covered.size} términos específicos y ${Math.round(supportRatio * 100)}% de frases vinculadas a facts.`)
    }
  }
}

function inspectCoordinates(document: ContentDocument, issues: Map<string, QAIssue[]>): void {
  if (document.location === undefined) return
  if (!isRecord(document.location) || typeof document.location.lat !== 'number' || typeof document.location.lng !== 'number') return
  const {lat, lng} = document.location
  if (lat < BENIDORM_BOUNDS.minLat || lat > BENIDORM_BOUNDS.maxLat || lng < BENIDORM_BOUNDS.minLng || lng > BENIDORM_BOUNDS.maxLng) {
    add(issues, document._id, 'WARNING', 'coordinates-outside-benidorm', 'location', 'Las coordenadas quedan fuera del bounding box de control de Benidorm; requieren revisión manual.')
  }
}

function inspectFactualIntegrity(document: ContentDocument, enriched: EnrichedEntity, issues: Map<string, QAIssue[]>): void {
  const expectations: Array<[string, unknown, unknown]> = [
    ['name', enriched.facts.name.value, document.name],
    ['businessKind', enriched.facts.businessKind.value, document.businessKind],
    ['address', enriched.facts.address.value, document.address],
    ['phone', enriched.facts.phone.value, document.phone],
    ['website', enriched.facts.website.value, document.website],
  ]
  const expectedLocation = enriched.facts.location.value === null ? null : {_type: 'geopoint', ...enriched.facts.location.value}
  expectations.push(['location', expectedLocation, document.location])
  const expectedVerified = enriched.sources.map((source) => source.retrievedAt).sort().at(-1)?.slice(0, 10) ?? null
  expectations.push(['lastVerified', expectedVerified, document.lastVerified])
  for (const [field, expected, actual] of expectations) {
    if (expected === null && actual === undefined) continue
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      add(issues, document._id, 'FAIL', 'factual-integrity', field, 'El valor no coincide exactamente con el fact enriquecido (o se añadió sin fuente).')
    }
  }
  for (const field of ['priceRange', 'openingHours', 'googleMapsUrl', 'rating', 'reviews', 'awards', 'services']) {
    if (document[field] !== undefined) add(issues, document._id, 'FAIL', 'unsupported-fact', field, 'Este campo factual no tiene un fact verificado en esta fase.')
  }
}

function inspectEntityDuplicates(candidates: readonly QACandidate[], issues: Map<string, QAIssue[]>): void {
  const fingerprints = new Map<string, string>()
  for (const {document} of candidates) {
    const location = isRecord(document.location) ? document.location : {}
    const lat = typeof location.lat === 'number' ? location.lat.toFixed(4) : 'unknown'
    const lng = typeof location.lng === 'number' ? location.lng.toFixed(4) : 'unknown'
    const fingerprint = `${normalizeText(String(document.name ?? ''))}:${lat}:${lng}`
    const previous = fingerprints.get(fingerprint)
    if (previous) {
      add(issues, document._id, 'FAIL', 'duplicate-entity', 'name', `Posible duplicado de ${previous}.`)
      add(issues, previous, 'FAIL', 'duplicate-entity', 'name', `Posible duplicado de ${document._id}.`)
    } else fingerprints.set(fingerprint, document._id)
  }
}

function inspectEditorialDuplicates(candidates: readonly QACandidate[], issues: Map<string, QAIssue[]>): void {
  exactDuplicate(candidates, issues, 'seo.metaTitle', (document) => isRecord(document.seo) ? document.seo.metaTitle : undefined, 'duplicate-seo-title')
  exactDuplicate(candidates, issues, 'seo.metaDescription', (document) => isRecord(document.seo) ? document.seo.metaDescription : undefined, 'duplicate-meta-description')
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const first = candidates[left]?.document
      const second = candidates[right]?.document
      if (!first || !second) continue
      const firstText = editorialText(first)
      const secondText = editorialText(second)
      if (tokens(firstText).length === 0 || tokens(secondText).length === 0) continue
      const lexical = jaccard(firstText, secondText)
      const semantic = cosineSimilarity(semanticTokens(firstText), semanticTokens(secondText))
      if (lexical >= 0.68 || semantic >= 0.86) {
        const message = `Similitud con ${second._id}: léxica ${Math.round(lexical * 100)}%, semántica aproximada ${Math.round(semantic * 100)}%.`
        add(issues, first._id, 'WARNING', 'SIMILAR_EDITORIAL_CONTENT', 'body', message)
        add(issues, second._id, 'WARNING', 'SIMILAR_EDITORIAL_CONTENT', 'body', message.replace(second._id, first._id))
      }
    }
  }
}

function exactDuplicate(
  candidates: readonly QACandidate[],
  issues: Map<string, QAIssue[]>,
  path: string,
  value: (document: ContentDocument) => unknown,
  code: string,
): void {
  const seen = new Map<string, string>()
  for (const {document} of candidates) {
    const current = value(document)
    if (typeof current !== 'string' || !current.trim()) continue
    const key = normalizeText(current)
    const previous = seen.get(key)
    if (previous) {
      add(issues, document._id, 'FAIL', code, path, `Valor duplicado con ${previous}.`)
      add(issues, previous, 'FAIL', code, path, `Valor duplicado con ${document._id}.`)
    } else seen.set(key, document._id)
  }
}

export function jaccard(first: string, second: string): number {
  const a = new Set(normalizeText(first).split(' ').filter(Boolean))
  const b = new Set(normalizeText(second).split(' ').filter(Boolean))
  if (a.size === 0 && b.size === 0) return 1
  const intersection = [...a].filter((word) => b.has(word)).length
  return intersection / new Set([...a, ...b]).size
}

export function cosineSimilarity(first: string[], second: string[]): number {
  const a = frequency(first)
  const b = frequency(second)
  const dot = [...a].reduce((sum, [word, count]) => sum + count * (b.get(word) ?? 0), 0)
  const magnitude = (values: Map<string, number>) => Math.sqrt([...values.values()].reduce((sum, value) => sum + value * value, 0))
  const denominator = magnitude(a) * magnitude(b)
  return denominator ? dot / denominator : 0
}

function editorialText(document: ContentDocument): string {
  const body = Array.isArray(document.body) ? document.body.flatMap((block) => {
    if (!isRecord(block) || !Array.isArray(block.children)) return []
    return block.children.flatMap((child) => isRecord(child) && typeof child.text === 'string' ? [child.text] : [])
  }) : []
  const seo = isRecord(document.seo) ? [document.seo.metaTitle, document.seo.metaDescription] : []
  return [document.shortDescription, ...body, ...seo].filter((value): value is string => typeof value === 'string').join('\n')
}

function factTokens(values: unknown[]): Set<string> {
  return new Set(values.flatMap((value) => tokens(typeof value === 'string' ? value : JSON.stringify(value)))
    .filter((word) => word.length >= 4 && !GENERIC_WORDS.has(word)))
}

function tokens(value: string): string[] {
  return normalizeText(value).split(' ').filter(Boolean)
}

const GENERIC_WORDS = new Set(tokens('restaurante benidorm negocio establecimiento opcion sitio web oficial informacion cocina servicio servicios disponible ciudad local'))

function semanticTokens(value: string): string[] {
  const synonyms: Record<string, string> = {
    restaurante: 'local', establecimiento: 'local', negocio: 'local', situado: 'ubicacion', ubicada: 'ubicacion', ubicado: 'ubicacion',
    cocina: 'gastronomia', culinaria: 'gastronomia', platos: 'comida', especialidades: 'comida', terraza: 'exterior',
    reservar: 'reserva', reservas: 'reserva', domicilio: 'delivery', entrega: 'delivery', llevar: 'takeaway',
  }
  return tokens(value).filter((word) => word.length > 2).map((word) => synonyms[word] ?? word)
}

function frequency(values: string[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1)
  return result
}

function add(issues: Map<string, QAIssue[]>, id: string, severity: QAIssue['severity'], code: string, path: string, message: string): void {
  issues.get(id)?.push({severity, code, path, message})
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}
