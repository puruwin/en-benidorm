import type {ContentDocument, ContentInput} from '../../content-validation'
import {validateContent} from '../../content-validation'
import {seedInputs} from '../../validate-content'
import {sourceIsComplete, validateFactProvenance} from './enrichment'
import {normalizeText} from './normalize'
import {evaluateBusinessQualityTier} from './quality'
import type {BusinessQualityAssessment, EnrichedEntity, QAIssue, QAOutcome} from './types'

export interface QACandidate {
  id: string
  document: ContentDocument | null
  enriched?: EnrichedEntity
  qualityAssessment: BusinessQualityAssessment
  generationSkipped: boolean
}

export interface QAResult {
  id: string
  qualityTier: BusinessQualityAssessment['tier']
  generationSkipped: boolean
  outcome: QAOutcome
  issues: QAIssue[]
}

const BENIDORM_BOUNDS = {minLat: 38.48, maxLat: 38.61, minLng: -0.2, maxLng: -0.05}
const GENERIC_PATTERNS = [
  /restaurante (?:situado|ubicado) en benidorm/i, /figura como restaurante/i,
  /establecimiento de restauraci[oó]n/i, /incluido en la oferta local/i,
  /una opci[oó]n para quienes buscan/i, /informaci[oó]n b[aá]sica disponible/i,
  /consulta (?:su|el) sitio web oficial/i, /dispone de (?:una |su )?(?:p[aá]gina|sitio) web/i,
  /ubicad[oa] en benidorm/i,
]
const DISTINCTIVE_FIELDS = new Set([
  'cuisine', 'concept', 'specialties', 'services', 'bookingAvailability', 'takeaway', 'delivery',
  'terrace', 'accessibility', 'locationContext', 'distinctiveFeatures', 'openingInformation',
])

export function inspectCandidates(candidates: readonly QACandidate[]): QAResult[] {
  const issues = new Map(candidates.map(({id}) => [id, [] as QAIssue[]]))
  const publishable = candidates.filter((candidate) => candidate.qualityAssessment.tier !== 'insufficient' && candidate.document)
  const inputs: ContentInput[] = publishable.map(({document, id}) => ({document: document!, source: `candidate:${id}`, expectedType: 'business'}))
  const validation = validateContent([...seedInputs(), ...inputs])
  for (const issue of validation.issues) {
    if (issue.source.startsWith('candidate:')) add(issues, issue.source.slice(10), 'FAIL', 'schema', issue.path, issue.message)
  }
  for (const candidate of candidates) inspectCandidate(candidate, issues)
  inspectEntityDuplicates(publishable, issues)
  inspectEditorialDuplicates(publishable, issues)

  return candidates.map((candidate) => {
    const documentIssues = issues.get(candidate.id) ?? []
    const outcome: QAOutcome = candidate.qualityAssessment.tier === 'insufficient' ? 'SKIPPED'
      : documentIssues.some((issue) => issue.severity === 'FAIL') ? 'FAIL'
        : documentIssues.some((issue) => issue.severity === 'WARNING') ? 'WARNING' : 'PASS'
    return {id: candidate.id, qualityTier: candidate.qualityAssessment.tier, generationSkipped: candidate.generationSkipped, outcome, issues: documentIssues}
  })
}

function inspectCandidate(candidate: QACandidate, issues: Map<string, QAIssue[]>): void {
  const {id, enriched} = candidate
  if (candidate.qualityAssessment.tier === 'insufficient') {
    add(issues, id, 'SKIPPED', 'INSUFFICIENT_FACTS', 'qualityTier', 'No existen facts distintivos suficientes para producir una ficha editorial útil.')
    return
  }
  if (!enriched) {
    add(issues, id, 'FAIL', 'missing-enrichment', '', 'No existe el artefacto enriquecido correspondiente.')
    return
  }
  const expectedAssessment = evaluateBusinessQualityTier(enriched.facts)
  if (expectedAssessment.tier !== candidate.qualityAssessment.tier) add(issues, id, 'FAIL', 'quality-tier-mismatch', 'qualityTier', `El tier no coincide con la evaluación central: ${expectedAssessment.tier}.`)
  for (const error of validateFactProvenance(enriched)) add(issues, id, 'FAIL', 'fact-provenance', 'facts', error)
  for (const source of enriched.sources) if (!sourceIsComplete(source)) add(issues, id, 'FAIL', 'source-provenance', 'sources', `La fuente ${source.key} no tiene procedencia completa.`)
  const document = candidate.document
  if (!document) {
    add(issues, id, 'FAIL', 'missing-document', 'document', 'El tier es publicable pero no existe documento generado.')
    return
  }
  if (!Array.isArray(document.sources) || document.sources.length === 0) add(issues, id, 'FAIL', 'sources', 'sources', 'El documento debe conservar al menos una fuente.')
  else {
    const actualUrls = document.sources.flatMap((source) => isRecord(source) && typeof source.url === 'string' ? [source.url] : []).sort()
    const expectedUrls = enriched.sources.flatMap((source) => source.url ? [source.url] : []).sort()
    if (JSON.stringify(actualUrls) !== JSON.stringify(expectedUrls)) add(issues, id, 'FAIL', 'source-integrity', 'sources', 'Las fuentes finales no coinciden con las fuentes enriquecidas.')
  }
  if (!nonEmpty(document.shortDescription)) add(issues, id, 'FAIL', 'incomplete', 'shortDescription', 'Falta la descripción corta.')
  if (!Array.isArray(document.body) || document.body.length === 0) add(issues, id, 'FAIL', 'incomplete', 'body', 'Falta la descripción editorial.')
  if (!isRecord(document.seo) || !nonEmpty(document.seo.metaTitle) || !nonEmpty(document.seo.metaDescription)) add(issues, id, 'FAIL', 'incomplete', 'seo', 'Faltan title o meta description de SEO.')
  inspectCoordinates(document, issues)
  inspectFactualIntegrity(document, enriched, issues)
  inspectEditorialQuality(document, enriched, candidate.qualityAssessment, issues)
}

function inspectEditorialQuality(document: ContentDocument, enriched: EnrichedEntity, assessment: BusinessQualityAssessment, issues: Map<string, QAIssue[]>): void {
  const text = densityText(document)
  const facts = Object.entries(enriched.facts).filter(([field, fact]) => DISTINCTIVE_FIELDS.has(field) && usefulValue(fact.value) && fact.sources.length > 0)
  const tokensByField = new Map(facts.map(([field, fact]) => [field, new Set([...factTokens([fact.value]), ...tokens(FIELD_LANGUAGE[field] ?? '')])]))
  const contentTokens = new Set(tokens(text))
  const coveredFields = [...tokensByField].filter(([, words]) => [...words].some((word) => fuzzyHas(contentTokens, word))).map(([field]) => field)
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((item) => item.trim()).filter((item) => tokens(item).length >= 3)
  const supported = sentences.filter((sentence) => {
    const sentenceTokens = new Set(tokens(sentence))
    return [...tokensByField.values()].some((words) => [...words].some((word) => fuzzyHas(sentenceTokens, word)))
  }).length
  const supportRatio = sentences.length ? supported / sentences.length : 0
  let genericSentences = 0
  for (const sentence of sentences) {
    if (!GENERIC_PATTERNS.some((pattern) => pattern.test(sentence))) continue
    const sentenceTokens = new Set(tokens(sentence))
    const specific = [...tokensByField.values()].some((words) => [...words].some((word) => fuzzyHas(sentenceTokens, word)))
    if (!specific) {
      genericSentences += 1
      add(issues, document._id, 'FAIL', 'GENERIC_EDITORIAL_CONTENT', 'body', `Frase genérica sin información específica adicional: "${sentence.slice(0, 180)}"`)
    }
  }
  for (const highlight of bodyParts(document).filter((part) => part.listItem)) {
    const highlightTokens = new Set(tokens(highlight.text))
    const supportedHighlight = [...tokensByField.values()].some((words) => [...words].some((word) => fuzzyHas(highlightTokens, word)))
    if (!supportedHighlight) add(issues, document._id, 'FAIL', 'unsupported-highlight', 'body', `Highlight sin respaldo en facts distintivos: "${highlight.text}"`)
  }
  const requiredCoverage = assessment.tier === 'rich' ? 2 : 1
  const minimumRatio = assessment.tier === 'rich' ? 0.55 : 0.35
  if (coveredFields.length < requiredCoverage || supportRatio < minimumRatio || (sentences.length > 2 && genericSentences >= Math.ceil(sentences.length / 2))) {
    add(issues, document._id, 'FAIL', 'LOW_INFORMATION_DENSITY', 'body', `Densidad factual baja para ${assessment.tier}: ${coveredFields.length} facts distintivos cubiertos y ${Math.round(supportRatio * 100)}% de frases vinculadas a facts.`)
  }
  if (assessment.tier === 'rich') {
    const headings = bodyParts(document).filter((part) => part.style === 'h2').map((part) => normalizeText(part.text))
    if (new Set(headings).size < 2) add(issues, document._id, 'WARNING', 'LOW_SECTION_VARIETY', 'body', 'La ficha rich utiliza menos de dos bloques semánticos diferenciados.')
    const short = typeof document.shortDescription === 'string' ? document.shortDescription : ''
    const paragraphs = bodyParts(document).filter((part) => part.style !== 'h2' && !part.listItem).map((part) => part.text)
    if (paragraphs.some((paragraph) => jaccard(short, paragraph) >= 0.8)) add(issues, document._id, 'WARNING', 'REPEATED_SHORT_DESCRIPTION', 'body', 'Un párrafo repite casi literalmente la descripción corta.')
  }
}

function inspectCoordinates(document: ContentDocument, issues: Map<string, QAIssue[]>): void {
  if (document.location === undefined || !isRecord(document.location) || typeof document.location.lat !== 'number' || typeof document.location.lng !== 'number') return
  const {lat, lng} = document.location
  if (lat < BENIDORM_BOUNDS.minLat || lat > BENIDORM_BOUNDS.maxLat || lng < BENIDORM_BOUNDS.minLng || lng > BENIDORM_BOUNDS.maxLng) add(issues, document._id, 'WARNING', 'coordinates-outside-benidorm', 'location', 'Las coordenadas quedan fuera del bounding box de control de Benidorm; requieren revisión manual.')
}

function inspectFactualIntegrity(document: ContentDocument, enriched: EnrichedEntity, issues: Map<string, QAIssue[]>): void {
  const expectations: Array<[string, unknown, unknown]> = [
    ['name', enriched.facts.name.value, document.name], ['businessKind', enriched.facts.businessKind.value, document.businessKind],
    ['address', enriched.facts.address.value, document.address], ['phone', enriched.facts.phone.value, document.phone], ['website', enriched.facts.website.value, document.website],
  ]
  expectations.push(['location', enriched.facts.location.value === null ? null : {_type: 'geopoint', ...enriched.facts.location.value}, document.location])
  expectations.push(['lastVerified', enriched.sources.map((source) => source.retrievedAt).sort().at(-1)?.slice(0, 10) ?? null, document.lastVerified])
  for (const [field, expected, actual] of expectations) {
    if (expected === null && actual === undefined) continue
    if (JSON.stringify(expected) !== JSON.stringify(actual)) add(issues, document._id, 'FAIL', 'factual-integrity', field, 'El valor no coincide exactamente con el fact enriquecido (o se añadió sin fuente).')
  }
  for (const field of ['priceRange', 'openingHours', 'googleMapsUrl', 'rating', 'reviews', 'awards', 'services']) if (document[field] !== undefined) add(issues, document._id, 'FAIL', 'unsupported-fact', field, 'Este campo factual no tiene un fact verificado en esta fase.')
}

function inspectEntityDuplicates(candidates: readonly QACandidate[], issues: Map<string, QAIssue[]>): void {
  const fingerprints = new Map<string, string>()
  for (const {document} of candidates) {
    if (!document) continue
    const location = isRecord(document.location) ? document.location : {}
    const fingerprint = `${normalizeText(String(document.name ?? ''))}:${typeof location.lat === 'number' ? location.lat.toFixed(4) : 'unknown'}:${typeof location.lng === 'number' ? location.lng.toFixed(4) : 'unknown'}`
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
  for (let left = 0; left < candidates.length; left += 1) for (let right = left + 1; right < candidates.length; right += 1) {
    const first = candidates[left]?.document; const second = candidates[right]?.document
    if (!first || !second) continue
    const firstParagraphs = bodyParts(first).filter((part) => part.style !== 'h2' && !part.listItem).map((part) => part.text)
    const secondParagraphs = bodyParts(second).filter((part) => part.style !== 'h2' && !part.listItem).map((part) => part.text)
    const similarParagraphs = mostSimilarPair(firstParagraphs, secondParagraphs)
    const comparisons: Array<[string, string, string]> = [
      ['shortDescription', String(first.shortDescription ?? ''), String(second.shortDescription ?? '')],
      ['seo.metaDescription', isRecord(first.seo) ? String(first.seo.metaDescription ?? '') : '', isRecord(second.seo) ? String(second.seo.metaDescription ?? '') : ''],
      ['body.paragraphs', similarParagraphs[0], similarParagraphs[1]],
      ['body.structure', sectionSequence(first).join('|'), sectionSequence(second).join('|')],
    ]
    for (const [path, firstText, secondText] of comparisons) {
      if (tokens(firstText).length < 2 || tokens(secondText).length < 2) continue
      const lexical = jaccard(firstText, secondText); const semantic = cosineSimilarity(semanticTokens(firstText), semanticTokens(secondText))
      const structure = path === 'body.structure'
      const structureMatch = structure && firstText === secondText && sectionSequence(first).length >= 2
      if ((!structure && (lexical >= 0.68 || semantic >= 0.88)) || structureMatch) {
        add(issues, first._id, 'WARNING', 'similar-content', path, `Patrón similar a ${second._id}: léxico ${Math.round(lexical * 100)}%, semántico ${Math.round(semantic * 100)}%.`)
        add(issues, second._id, 'WARNING', 'similar-content', path, `Patrón similar a ${first._id}: léxico ${Math.round(lexical * 100)}%, semántico ${Math.round(semantic * 100)}%.`)
      }
    }
  }
}

function exactDuplicate(candidates: readonly QACandidate[], issues: Map<string, QAIssue[]>, path: string, value: (document: ContentDocument) => unknown, code: string): void {
  const seen = new Map<string, string>()
  for (const {document} of candidates) {
    if (!document) continue
    const current = value(document)
    if (typeof current !== 'string' || !current.trim()) continue
    const key = normalizeText(current); const previous = seen.get(key)
    if (previous) {
      add(issues, document._id, 'FAIL', code, path, `Valor duplicado con ${previous}.`); add(issues, previous, 'FAIL', code, path, `Valor duplicado con ${document._id}.`)
    } else seen.set(key, document._id)
  }
}

export function jaccard(first: string, second: string): number {
  const a = new Set(tokens(first)); const b = new Set(tokens(second))
  if (a.size === 0 && b.size === 0) return 1
  return [...a].filter((word) => b.has(word)).length / new Set([...a, ...b]).size
}

export function cosineSimilarity(first: string[], second: string[]): number {
  const a = frequency(first); const b = frequency(second)
  const dot = [...a].reduce((sum, [word, count]) => sum + count * (b.get(word) ?? 0), 0)
  const magnitude = (values: Map<string, number>) => Math.sqrt([...values.values()].reduce((sum, value) => sum + value * value, 0))
  const denominator = magnitude(a) * magnitude(b)
  return denominator ? dot / denominator : 0
}

function densityText(document: ContentDocument): string {
  return [document.shortDescription, ...bodyParts(document).filter((part) => part.style !== 'h2').map((part) => part.text)]
    .filter((value): value is string => typeof value === 'string').join('\n')
}
function bodyParts(document: ContentDocument): Array<{text: string; style: string; listItem: boolean}> {
  if (!Array.isArray(document.body)) return []
  return document.body.flatMap((block) => {
    if (!isRecord(block) || !Array.isArray(block.children)) return []
    const text = block.children.flatMap((child) => isRecord(child) && typeof child.text === 'string' ? [child.text] : []).join('')
    return text ? [{text, style: typeof block.style === 'string' ? block.style : 'normal', listItem: typeof block.listItem === 'string'}] : []
  })
}
function sectionSequence(document: ContentDocument): string[] { return bodyParts(document).filter((part) => part.style === 'h2').map((part) => normalizeText(part.text)) }
function factTokens(values: unknown[]): Set<string> { return new Set(values.flatMap((value) => tokens(typeof value === 'string' ? value : JSON.stringify(value))).filter((word) => word.length >= 4 && !GENERIC_WORDS.has(word))) }
function tokens(value: string): string[] { return normalizeText(value).split(' ').filter(Boolean) }
const GENERIC_WORDS = new Set(tokens('restaurante benidorm negocio establecimiento opcion sitio web oficial informacion cocina servicio servicios disponible ciudad local tiene para como desde sobre'))
const FIELD_LANGUAGE: Record<string, string> = {
  cuisine: 'cocina gastronomia culinaria', concept: 'concepto propuesta', specialties: 'especialidad especialidades plato platos arroz arroces pasta pizza focaccia',
  services: 'servicio servicios desayuno cena menu', bookingAvailability: 'reserva reservas reservar', takeaway: 'llevar recogida recoger',
  delivery: 'domicilio entrega reparto', terrace: 'terraza exterior', accessibility: 'accesibilidad accesible',
  locationContext: 'playa levante poniente primera linea paseo casco centro', distinctiveFeatures: 'vistas azotea rooftop mar panoramica',
  openingInformation: 'horario horarios abre abierto dias lunes martes miercoles jueves viernes sabado domingo',
}
function mostSimilarPair(first: string[], second: string[]): [string, string] {
  let best: [string, string] = ['', '']; let score = 0
  for (const left of first) for (const right of second) {
    const current = Math.max(jaccard(left, right), cosineSimilarity(semanticTokens(left), semanticTokens(right)))
    if (current > score) { score = current; best = [left, right] }
  }
  return best
}
function fuzzyHas(haystack: Set<string>, needle: string): boolean { const stem = needle.slice(0, Math.min(5, needle.length)); return [...haystack].some((word) => word === needle || (stem.length >= 4 && word.startsWith(stem))) }
function semanticTokens(value: string): string[] {
  const synonyms: Record<string, string> = {restaurante: 'local', establecimiento: 'local', negocio: 'local', situado: 'ubicacion', ubicada: 'ubicacion', ubicado: 'ubicacion', cocina: 'gastronomia', culinaria: 'gastronomia', platos: 'comida', especialidades: 'comida', terraza: 'exterior', reservar: 'reserva', reservas: 'reserva', domicilio: 'delivery', entrega: 'delivery', llevar: 'takeaway'}
  return tokens(value).filter((word) => word.length > 2).map((word) => synonyms[word] ?? word)
}
function frequency(values: string[]): Map<string, number> { const result = new Map<string, number>(); for (const value of values) result.set(value, (result.get(value) ?? 0) + 1); return result }
function usefulValue(value: unknown): boolean { return value !== null && value !== false && (typeof value !== 'string' || value.trim().length > 0) && (!Array.isArray(value) || value.length > 0) }
function add(issues: Map<string, QAIssue[]>, id: string, severity: QAIssue['severity'], code: string, path: string, message: string): void { issues.get(id)?.push({severity, code, path, message}) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function nonEmpty(value: unknown): boolean { return typeof value === 'string' && value.trim().length > 0 }
