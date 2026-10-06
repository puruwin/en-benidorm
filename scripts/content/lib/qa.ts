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
      const similarity = jaccard(String(first.shortDescription ?? ''), String(second.shortDescription ?? ''))
      if (similarity >= 0.82) {
        add(issues, first._id, 'WARNING', 'similar-content', 'shortDescription', `Similitud ${Math.round(similarity * 100)}% con ${second._id}.`)
        add(issues, second._id, 'WARNING', 'similar-content', 'shortDescription', `Similitud ${Math.round(similarity * 100)}% con ${first._id}.`)
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

function add(issues: Map<string, QAIssue[]>, id: string, severity: QAIssue['severity'], code: string, path: string, message: string): void {
  issues.get(id)?.push({severity, code, path, message})
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}
