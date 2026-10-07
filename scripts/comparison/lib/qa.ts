import {normalizeText} from '../../content/lib/normalize'
import type {ContentDocument} from '../../content-validation'
import {compactPracticalLines, hasDuplicateSectionHeadings} from '../../../src/lib/comparison-presentation'
import {comparisonCoverage} from './gate'
import {topicAliases} from './scoring'
import {
  type ComparisonClaim,
  type ComparisonEvidenceFact,
  type ComparisonEvidenceValue,
  type ComparisonQAIssue,
  type ComparisonQAResult,
  type EnrichedComparisonArtifact,
  type GeneratedComparisonArtifact,
} from './types'

const FIRST_PERSON = /\b(?:he|hemos|prob[eé]|probamos|visit[eé]|visitamos|com[ií]|comimos|recomiendo|recomendamos|mi experiencia|nuestra experiencia)\b/i
const UNSUPPORTED_VALUATION = /\b(?:mejor(?:es)?|peor(?:es)?|excelente(?:s)?|recomendad[oa]s?|calidad|popular(?:es)?|aut[eé]ntic[oa]s?|barat[oa]s?|car[oa]s?|[uú]nic[oa]s?)\b|\bes la opci[oó]n de la comparativa\b/i
const SELF_CLAIM_ATTRIBUTION = /(?:seg[uú]n|indica|describe|presenta|publica|web|declara)/i
const GENERIC_INTRO = /una selecci[oó]n de (?:los )?mejores|hay opciones para todos los gustos|descubre los mejores/i
const CONTRAST_LANGUAGE = /\b(?:mientras|frente a|en cambio|por su parte|a diferencia|unas? .{0,35} otras?|si buscas|si priorizas|seg[uú]n lo que|depende de)\b/i
const COMPARATIVE_DIMENSIONS = ['specialties', 'featuredItems', 'prices', 'services', 'location', 'practical', 'limitations'] as const

export function inspectComparison(
  generated: GeneratedComparisonArtifact,
  enriched: EnrichedComparisonArtifact,
  businessDocuments: ReadonlyMap<string, ContentDocument>,
  allGenerated: readonly GeneratedComparisonArtifact[] = [generated],
): ComparisonQAResult {
  const issues: ComparisonQAIssue[] = []
  const fail = (code: string, path: string, message: string) => issues.push({severity: 'FAIL' as const, code, path, message})
  const warn = (code: string, path: string, message: string) => issues.push({severity: 'WARNING' as const, code, path, message})
  const editorial = generated.editorial
  const entries = editorial.entries
  const coverage = comparisonCoverage(enriched)

  if (!generated.searchIntent?.trim() || generated.searchIntent !== enriched.searchIntent) {
    fail('SEARCH_INTENT_NOT_SATISFIED', 'searchIntent', 'La Comparison no conserva una intención de búsqueda explícita y coherente.')
  }
  if (!editorial.claims.some((claim) => claim.path === 'quickVerdict' && textOverlap(editorial.quickVerdict, claim.claim))) {
    fail('MISSING_CLAIM_DECLARATION', 'quickVerdict', 'El quickVerdict debe declarar su evidence en claims.')
  }
  if (entries.length < 4) fail('MINIMUM_BUSINESSES', 'entries', 'La comparativa necesita al menos 4 negocios relevantes.')
  if (entries.length > 8) fail('MAXIMUM_BUSINESSES', 'entries', 'La comparativa admite como máximo 8 negocios.')

  const enrichedById = new Map(enriched.businesses.map((business) => [business.businessId, business]))
  const expectedIds = enriched.businesses.map((business) => business.businessId)
  if (editorial.choiceGuide.length !== expectedIds.length || editorial.choiceGuide.some((choice, index) => choice.businessId !== expectedIds[index])) {
    fail('SEARCH_INTENT_NOT_SATISFIED', 'choiceGuide', '¿Cuál elegir? debe cubrir una vez y en orden cada Business seleccionado.')
  }
  if (new Set(editorial.choiceGuide.map((choice) => normalizeText(choice.label))).size < Math.min(3, editorial.choiceGuide.length)) {
    fail('LOW_COMPARATIVE_VALUE', 'choiceGuide[].label', 'Las recomendaciones condicionales no diferencian suficientes casos de uso.')
  }

  for (const choice of editorial.choiceGuide) {
    const base = `choiceGuide.${choice.businessId}`
    if (!enrichedById.has(choice.businessId)) fail('MISSING_COMPARISON_EVIDENCE', base, 'El negocio no aparece en el artefacto enriquecido.')
    if (/\bmejor\s+para\b/i.test(`${choice.label} ${choice.reason}`)) fail('UNSUPPORTED_COMPARISON_CLAIM', base, 'Usa una recomendación condicional, no “mejor para”.')
    requireClaim(editorial.claims, `${base}.reason`, choice.reason, fail)
  }

  for (const entry of entries) {
    const base = `entries.${entry.businessId}`
    const evidenceBusiness = enrichedById.get(entry.businessId)
    if (!businessDocuments.has(entry.businessId)) fail('MISSING_BUSINESS_REF', `${base}.businessId`, `No existe el Business ${entry.businessId}.`)
    if (!evidenceBusiness) { fail('MISSING_COMPARISON_EVIDENCE', base, 'El negocio no aparece en el artefacto enriquecido.'); continue }
    if (!evidenceBusiness.topicEvidence.length || evidenceBusiness.scores.topicRelevance === 0) fail('IRRELEVANT_BUSINESS', base, `El Business no es relevante para topic=${enriched.topic}.`)
    if (entry.limitations.length && evidenceBusiness.evidence.limitations.length === 0) fail('UNSUPPORTED_COMPARISON_CLAIM', `${base}.limitations`, 'No se pueden inventar limitaciones sin evidence explícita.')
    requireEntryClaims(editorial.claims, base, entry, fail)
  }

  const evidenceById = new Map<string, {businessId: string; category: string; fact: ComparisonEvidenceFact}>()
  for (const business of enriched.businesses) for (const [category, facts] of Object.entries(business.evidence)) {
    for (const fact of facts) {
      if (!fact.sourceKeys.length || fact.sourceKeys.some((key) => !business.sources.some((source) => source.key === key))) {
        fail('INVALID_EVIDENCE_PROVENANCE', `evidence.${fact.id}`, 'El fact no conserva una fuente declarada.')
      }
      if (category === 'featuredItems' && typeof fact.value === 'object' && 'name' in fact.value) {
        if (!fact.sourceKeys.includes(fact.value.source) || !/^\d{4}-\d{2}-\d{2}/.test(fact.value.retrievedAt)) {
          fail('FEATURED_ITEM_PROVENANCE', `evidence.${fact.id}`, 'El plato destacado debe conservar source y retrievedAt válidos.')
        }
      }
      evidenceById.set(fact.id, {businessId: business.businessId, category, fact})
    }
  }

  let claimsRejected = 0
  for (const [index, claim] of editorial.claims.entries()) {
    const path = `claims[${index}]`
    const supports = claim.supportedBy.flatMap((id) => {
      const found = evidenceById.get(id)
      if (!found) fail('UNSUPPORTED_COMPARISON_CLAIM', `${path}.supportedBy`, `Evidence inexistente: ${id}.`)
      return found ? [found] : []
    })
    if (supports.length === 0 || !supports.some(({fact, category}) => factSupportsClaim(fact, claim.claim, category))) {
      fail('UNSUPPORTED_COMPARISON_CLAIM', path, `La afirmación no coincide con el evidence declarado: “${claim.claim}”.`)
      claimsRejected += 1
    }
    if (UNSUPPORTED_VALUATION.test(claim.claim)) {
      fail('UNSUPPORTED_COMPARISON_CLAIM', path, `La valoración no está permitida en este MVP: “${claim.claim}”.`)
      claimsRejected += 1
    }
    if (supports.length && supports.every(({fact}) => fact.nature === 'self_claim') && !SELF_CLAIM_ATTRIBUTION.test(claim.claim)) {
      fail('SELF_CLAIM_AS_FACT', path, 'Un self_claim debe quedar atribuido al negocio o a su web.')
      claimsRejected += 1
    }
    if (claim.path.includes('featuredItem') && supports.some(({category}) => category !== 'featuredItems')) fail('FEATURED_ITEM_PROVENANCE', path, 'featuredItem necesita evidence de featuredItems.')
    if (claim.path.includes('limitations') && supports.some(({category}) => category !== 'limitations')) fail('UNSUPPORTED_COMPARISON_CLAIM', path, 'Una limitación necesita evidence de limitations.')
  }

  for (const entry of entries) {
    if (!entry.featuredItem) continue
    const evidenceBusiness = enrichedById.get(entry.businessId)
    const exact = evidenceBusiness?.evidence.featuredItems.some((fact) => {
      if (typeof fact.value !== 'object' || !('name' in fact.value)) return false
      return normalizeText(fact.value.name) === normalizeText(entry.featuredItem!.name)
        && fact.value.source === entry.featuredItem!.source
        && fact.value.retrievedAt === entry.featuredItem!.retrievedAt
        && (fact.value.price ?? null) === (entry.featuredItem!.price ?? null)
        && (fact.value.priceQualifier ?? null) === (entry.featuredItem!.priceQualifier ?? null)
    })
    if (!exact) fail('FEATURED_ITEM_PROVENANCE', `entries.${entry.businessId}.featuredItem`, 'El plato destacado no reproduce exactamente un item enriquecido y fechado.')
  }

  for (const conflict of enriched.sourceConflicts ?? []) {
    warn('SOURCE_CONFLICT', `sourceConflicts.${conflict.businessId}.${conflict.dimension}`, conflict.resolution)
  }

  inspectPriceContext(enriched, editorial, fail)
  inspectPublicPresentation(generated, warn, fail)

  const allText = comparisonText(editorial)
  if (FIRST_PERSON.test(allText)) fail('FAKE_FIRST_PERSON_EXPERIENCE', 'editorial', 'La comparativa no puede inventar experiencia en primera persona.')
  if (UNSUPPORTED_VALUATION.test(allText)) fail('UNSUPPORTED_COMPARISON_CLAIM', 'editorial', 'Hay una valoración editorial no permitida por el contrato del MVP.')
  if (GENERIC_INTRO.test(editorial.intro)) fail('GENERIC_INTRO', 'intro', 'La introducción usa una fórmula genérica.')
  if (editorial.quickVerdict.split(/\n\s*\n/).filter(Boolean).length > 2) fail('SEARCH_INTENT_NOT_SATISFIED', 'quickVerdict', 'El quickVerdict debe limitarse a uno o dos párrafos.')

  const namedInVerdict = enriched.businesses.filter((business) => normalizeText(editorial.quickVerdict).includes(normalizeText(business.name))).length
  const quickClaimCrossesBusinesses = editorial.claims.filter((claim) => claim.path === 'quickVerdict').some((claim) => new Set(claim.supportedBy.map((id) => evidenceById.get(id)?.businessId).filter(Boolean)).size >= 2)
  const searchIntentSatisfied = editorial.choiceGuide.length === expectedIds.length
    && CONTRAST_LANGUAGE.test(editorial.quickVerdict) && quickClaimCrossesBusinesses
    && namedInVerdict >= 2
  if (!searchIntentSatisfied) fail('SEARCH_INTENT_NOT_SATISFIED', 'quickVerdict', `La página enumera opciones pero no resuelve bien “${enriched.searchIntent}” mediante contrastes y recomendaciones condicionales.`)

  const contentValueSatisfied = comparativeValue(enriched, editorial.choiceGuide.map((choice) => choice.label))
  if (!contentValueSatisfied) fail('LOW_COMPARATIVE_VALUE', 'editorial', 'La página no aporta suficientes diferencias de platos, precios, servicios, ubicación u horarios frente a una lista simple.')

  const coverageSufficient = coverage.perBusiness.every((business) => business.coveredDimensions.length >= 3)
    && Object.values(coverage.perDimension).filter((dimension) => dimension.businessesCovered > 0).length >= 4
    && enriched.businesses.filter(hasDifferentialEvidence).length >= 3
  if (!coverageSufficient) fail('INSUFFICIENT_EVIDENCE_COVERAGE', 'coverage', 'La cobertura por Business o dimensión no permite sostener una comparación indexable.')

  if (!/(?:fuentes|webs? oficiales?|datos abiertos)/i.test(editorial.methodology)
    || !/(?:visitad|visita personal)/i.test(editorial.methodology)
    || !/(?:precios?.*(?:cambiar|variar)|(?:cambiar|variar).*precios?)/i.test(editorial.methodology)) {
    fail('INCOMPLETE_METHODOLOGY', 'methodology', 'La metodología debe explicar fuentes, visitas personales y variabilidad de precios.')
  }
  const seoSpecific = topicAliases(enriched.topic).some((alias) => normalizeText(editorial.seo.metaTitle).includes(normalizeText(alias)))
    && /Benidorm/i.test(editorial.seo.metaTitle)
    && /compar/i.test(editorial.seo.metaDescription) && !UNSUPPORTED_VALUATION.test(`${editorial.title} ${editorial.seo.metaTitle} ${editorial.seo.metaDescription}`)
  if (!seoSpecific) fail('GENERIC_SEO', 'seo', 'Title y description deben responder específicamente a la intención, sin prometer un ranking.')
  const duplicateSeo = allGenerated.some((other) => other.id !== generated.id && normalizeText(other.editorial.seo.metaTitle) === normalizeText(editorial.seo.metaTitle))
  if (duplicateSeo) fail('DUPLICATE_SEO', 'seo.metaTitle', 'El título SEO ya se usa en otra Comparison.')

  if (repetitiveBlocks(editorial)) warn('REPETITIVE_COMPARISON_CONTENT', 'editorial', 'Una misma afirmación aparece en varias secciones sin contexto nuevo.')

  const hasFail = issues.some((issue) => issue.severity === 'FAIL')
  const indexability = !hasFail && entries.length >= 4 && searchIntentSatisfied && contentValueSatisfied && coverageSufficient && seoSpecific ? 'index' : 'noindex'
  const outcome = hasFail ? 'FAIL' : issues.some((issue) => issue.severity === 'WARNING') ? 'WARNING' : 'PASS'
  return {
    id: generated.id, topic: generated.topic, outcome, searchIntentSatisfied, contentValueSatisfied,
    indexability, coverage, issues, claimsGenerated: editorial.claims.length, claimsRejected,
  }
}

function requireEntryClaims(
  claims: ComparisonClaim[],
  base: string,
  entry: GeneratedComparisonArtifact['editorial']['entries'][number],
  fail: (code: string, path: string, message: string) => void,
): void {
  const leaves: Array<[string, string]> = [
    [`${base}.verdict`, entry.verdict],
    ...entry.strengths.map((value, index) => [`${base}.strengths.${index}`, value] as [string, string]),
    ...entry.limitations.map((value, index) => [`${base}.limitations.${index}`, value] as [string, string]),
    ...entry.bestFor.map((value, index) => [`${base}.bestFor.${index}`, value] as [string, string]),
    ...entry.practicalNotes.map((value, index) => [`${base}.practicalNotes.${index}`, value] as [string, string]),
    ...(entry.featuredItem ? [[`${base}.featuredItem`, featuredItemText(entry.featuredItem)] as [string, string]] : []),
  ]
  for (const [path, value] of leaves) requireClaim(claims, path, value, fail)
}

function requireClaim(claims: ComparisonClaim[], path: string, value: string, fail: (code: string, path: string, message: string) => void): void {
  if (!claims.some((claim) => claim.path === path && textOverlap(value, claim.claim))) fail('MISSING_CLAIM_DECLARATION', path, 'El texto no declara su evidence en claims.')
}

function comparativeValue(enriched: EnrichedComparisonArtifact, labels: string[]): boolean {
  const uniqueLabels = new Set(labels.map(normalizeText)).size
  const withUsefulDifferences = enriched.businesses.filter(hasDifferentialEvidence).length
  const dimensions = COMPARATIVE_DIMENSIONS.filter((dimension) => enriched.businesses.some((business) => business.evidence[dimension].length > 0)).length
  return uniqueLabels >= Math.min(3, labels.length) && withUsefulDifferences >= 3 && dimensions >= 3
}

function hasDifferentialEvidence(business: EnrichedComparisonArtifact['businesses'][number]): boolean {
  return COMPARATIVE_DIMENSIONS.some((dimension) => business.evidence[dimension].length > 0)
}

function factSupportsClaim(fact: ComparisonEvidenceFact, claim: string, category: string): boolean {
  if (category === 'prices' && /\bprecios?\b/i.test(claim)) return true
  if (category === 'practical' && /\b(?:horario|abre|apertura|cierra|mediod[ií]a|noche|d[ií]as?)\b/i.test(claim) && /\d{1,2}:\d{2}/.test(evidenceValueText(fact.value))) return true
  const factTokens = new Set(tokens(evidenceValueText(fact.value)))
  const claimTokens = tokens(claim)
  return claimTokens.some((token) => factTokens.has(token))
    || (typeof fact.value === 'object' && 'value' in fact.value && claim.includes(String(fact.value.value)))
}

function evidenceValueText(value: ComparisonEvidenceValue): string {
  if (typeof value !== 'object') return String(value)
  if ('name' in value) return `${value.name} ${value.price ?? ''} ${value.currency ?? ''} ${value.priceQualifier ?? ''}`
  return `${value.item} ${value.value} ${value.currency} ${value.priceQualifier ?? ''}`
}
function featuredItemText(value: NonNullable<GeneratedComparisonArtifact['editorial']['entries'][number]['featuredItem']>): string {
  return `${value.name}${typeof value.price === 'number' ? ` ${value.price} ${value.currency ?? 'EUR'} ${value.priceQualifier ?? ''}` : ''}`.trim()
}
function tokens(value: string): string[] {
  return normalizeText(value).replace(/\bdiari[oa]s?\b/g, 'dias').split(' ')
    .filter((token) => (token.length >= 4 || /^\d+$/.test(token)) && !STOP_WORDS.has(token))
    .map(singularizeToken)
}
function singularizeToken(token: string): string {
  if (token.length > 5 && token.endsWith('es')) return token.slice(0, -2)
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1)
  return token
}
const STOP_WORDS = new Set(['para', 'como', 'esta', 'este', 'tiene', 'cuenta', 'segun', 'desde', 'entre', 'sobre', 'restaurante', 'elige', 'buscas', 'publica'])
function textOverlap(first: string, second: string): boolean { const a = new Set(tokens(first)); return tokens(second).some((token) => a.has(token)) }
function comparisonText(editorial: GeneratedComparisonArtifact['editorial']): string {
  return [editorial.title, editorial.intro, editorial.quickVerdict, editorial.methodology, ...editorial.criteria,
    ...editorial.choiceGuide.flatMap((choice) => [choice.label, choice.reason]),
    ...editorial.entries.flatMap((entry) => [entry.verdict, ...entry.strengths, ...entry.limitations, ...entry.bestFor, entry.featuredItem?.name ?? '', ...entry.practicalNotes])].join('\n')
}

function repetitiveBlocks(editorial: GeneratedComparisonArtifact['editorial']): boolean {
  const blocks = [
    {zone: 'intro', value: editorial.intro}, {zone: 'quick', value: editorial.quickVerdict},
    ...editorial.choiceGuide.map((choice) => ({zone: 'choice', value: choice.reason})),
    ...editorial.entries.flatMap((entry) => [
      {zone: 'entry', value: entry.verdict}, ...entry.strengths.map((value) => ({zone: 'entry', value})),
      ...entry.practicalNotes.map((value) => ({zone: 'practical', value})),
    ]),
  ].filter((block) => tokens(block.value).length >= 6)
  for (let leftIndex = 0; leftIndex < blocks.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < blocks.length; rightIndex += 1) {
    const left = blocks[leftIndex]!
    const right = blocks[rightIndex]!
    if (left.zone === right.zone) continue
    const a = new Set(tokens(left.value)); const b = new Set(tokens(right.value)); const union = new Set([...a, ...b])
    if (union.size && [...a].filter((token) => b.has(token)).length / union.size >= 0.7) return true
  }
  return false
}

function inspectPublicPresentation(
  generated: GeneratedComparisonArtifact,
  warn: (code: string, path: string, message: string) => void,
  fail: (code: string, path: string, message: string) => void,
): void {
  if (hasDuplicateSectionHeadings()) {
    warn('DUPLICATE_SECTION_HEADING', 'presentation.headings', 'Dos secciones públicas usan el mismo heading o significado visible.')
  }

  const editorial = generated.editorial
  const publicStrings = [
    editorial.title, editorial.intro, editorial.quickVerdict, editorial.methodology, ...editorial.criteria,
    ...editorial.choiceGuide.flatMap((choice) => [choice.label, choice.reason]),
    ...editorial.entries.flatMap((entry) => [entry.verdict, ...entry.strengths, ...entry.limitations, ...entry.bestFor, ...entry.practicalNotes]),
  ]
  const publicText = publicStrings.join('\n')
  const hardTechnical = /\b(?:evidence|claims?|selection\s*score|structured\s*output)\b/i
  const auditLanguage = /\b(?:documentad[oa]s?|se documentaron|registra(?:do|da)?|seg[uú]n la informaci[oó]n publicada)\b/i
  if (hardTechnical.test(publicText) || auditLanguage.test(publicText)) {
    warn('TECHNICAL_LANGUAGE_EXPOSED', 'editorial', 'El texto público conserva lenguaje técnico o de auditoría que debería expresarse de forma natural.')
  }

  const sources = Array.isArray(generated.document.sources) ? generated.document.sources : []
  if (sources.some((source) => isRecord(source) && /official-website:|manual-json:|openstreetmap:\s*(?:node|way|relation)\/|https?:\/\//i.test(`${source.title ?? ''} ${source.publisher ?? ''}`))) {
    fail('RAW_SOURCE_IDENTIFIER_EXPOSED', 'sources', 'Las fuentes públicas exponen identificadores internos del adapter o URLs como etiqueta.')
  }

  if (!editorial.choiceGuide.length || !editorial.entries.length || !editorial.criteria.length || sources.length === 0) {
    fail('EMPTY_PUBLIC_SECTION', 'presentation', 'Una sección pública obligatoria quedaría vacía.')
  }

  for (const entry of editorial.entries) {
    if (entry.bestFor.join(' · ').length > 72 || compactPracticalLines(entry.practicalNotes).some((line) => line.length > 90)) {
      warn('OVERLONG_TABLE_CELL', `entries.${entry.businessId}`, 'Una celda de la comparación rápida contiene demasiado texto para escanearse bien.')
    }
  }

  const priceCounts = new Map<string, number>()
  for (const entry of editorial.entries) if (typeof entry.featuredItem?.price === 'number') {
    const key = entry.featuredItem.price.toFixed(2)
    priceCounts.set(key, (priceCounts.get(key) ?? 0) + 2)
  }
  for (const value of publicStrings) for (const match of value.matchAll(/\b(\d{1,3}(?:[.,]\d{1,2})?)\s*€/g)) {
    const key = Number(match[1]!.replace(',', '.')).toFixed(2)
    priceCounts.set(key, (priceCounts.get(key) ?? 0) + 1)
  }
  if ([...priceCounts.values()].some((count) => count > 2)) {
    warn('PUBLIC_INFORMATION_REPETITION', 'editorial', 'Un mismo precio exacto aparece más de dos veces en la experiencia pública.')
  }
  const timeRangeCounts = new Map<string, number>()
  for (const value of publicStrings) for (const match of value.matchAll(/\b(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})\b/g)) {
    const key = `${match[1]}–${match[2]}`
    timeRangeCounts.set(key, (timeRangeCounts.get(key) ?? 0) + 1)
  }
  if ([...timeRangeCounts.values()].some((count) => count > 2)) {
    warn('PUBLIC_INFORMATION_REPETITION', 'editorial', 'Un mismo horario exacto aparece en demasiadas secciones públicas.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function inspectPriceContext(
  enriched: EnrichedComparisonArtifact,
  editorial: GeneratedComparisonArtifact['editorial'],
  fail: (code: string, path: string, message: string) => void,
): void {
  const choicesByBusiness = new Map(editorial.choiceGuide.map((choice) => [choice.businessId, `${choice.label}\n${choice.reason}`]))
  const entriesByBusiness = new Map(editorial.entries.map((entry) => [entry.businessId, [
    entry.verdict, ...entry.strengths, ...entry.limitations, ...entry.bestFor, ...entry.practicalNotes,
    ...(entry.featuredItem ? [featuredItemText(entry.featuredItem)] : []),
  ].join('\n')]))
  const globalText = [editorial.title, editorial.intro, editorial.quickVerdict, editorial.methodology, ...editorial.criteria].join('\n')

  for (const business of enriched.businesses) for (const fact of business.evidence.prices) {
    if (typeof fact.value !== 'object' || !('item' in fact.value) || !fact.value.priceQualifier) continue
    const publicText = `${globalText}\n${choicesByBusiness.get(business.businessId) ?? ''}\n${entriesByBusiness.get(business.businessId) ?? ''}`
    if (!containsPublishedPrice(publicText, fact.value.value)) continue
    const publicTokens = new Set(normalizeText(publicText).split(' ').filter(Boolean))
    const qualifierTokens = normalizeText(fact.value.priceQualifier).split(' ').filter(Boolean)
    if (!qualifierTokens.every((token) => publicTokens.has(token))) {
      fail('PRICE_CONTEXT_LOST', `evidence.${fact.id}`, `El precio de ${fact.value.item} aparece sin conservar “${fact.value.priceQualifier}”.`)
    }
  }
}

function containsPublishedPrice(text: string, price: number): boolean {
  const [integer, decimals] = price.toFixed(2).split('.') as [string, string]
  const amount = decimals === '00' ? integer : `${integer}[.,]${decimals}`
  return new RegExp(`\\b${amount}\\s*(?:€|EUR)`, 'i').test(text)
}
