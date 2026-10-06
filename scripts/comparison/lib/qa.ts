import {normalizeText} from '../../content/lib/normalize'
import type {ContentDocument} from '../../content-validation'
import type {
  ComparisonClaim, ComparisonEvidenceFact, ComparisonQAIssue, ComparisonQAResult,
  EnrichedComparisonArtifact, GeneratedComparisonArtifact,
} from './types'

const SUPERLATIVE = /\b(?:el|la|los|las)\s+mejor(?:es)?\b|\bimperdible\b|\bsin duda\b/i
const FIRST_PERSON = /\b(?:he|hemos|prob[eé]|probamos|visit[eé]|visitamos|com[ií]|comimos|recomiendo|recomendamos|mi experiencia|nuestra experiencia)\b/i
const SENSITIVE_COMPARISON = /\b(?:mejor|peor|m[aá]s barat[oa]s?|m[aá]s car[oa]s?|m[aá]s r[aá]pid[oa]s?|m[aá]s tranquil[oa]s?|popular|alta calidad|grupos?|familias?)\b/i
const GENERIC_INTRO = /una selecci[oó]n de (?:los )?mejores|hay opciones para todos los gustos|descubre los mejores/i

export function inspectComparison(
  generated: GeneratedComparisonArtifact,
  enriched: EnrichedComparisonArtifact,
  businessDocuments: ReadonlyMap<string, ContentDocument>,
  allGenerated: readonly GeneratedComparisonArtifact[] = [generated],
): ComparisonQAResult {
  const issues: ComparisonQAIssue[] = []
  const fail = (code: string, path: string, message: string) => issues.push({severity: 'FAIL', code, path, message})
  const warn = (code: string, path: string, message: string) => issues.push({severity: 'WARNING', code, path, message})
  const editorial = generated.editorial
  const entries = editorial.entries
  if (!editorial.claims.some((claim) => claim.path === 'quickVerdict' && normalizeText(editorial.quickVerdict).includes(normalizeText(claim.claim)))) fail('MISSING_CLAIM_DECLARATION', 'quickVerdict', 'El veredicto rápido debe declarar su evidence en claims.')
  if (entries.length < 4) fail('MINIMUM_BUSINESSES', 'entries', 'La comparativa necesita al menos 4 negocios.')
  if (entries.length > 8) fail('MAXIMUM_BUSINESSES', 'entries', 'La comparativa admite como máximo 8 negocios.')
  const ranks = entries.map((entry) => entry.rank)
  if (new Set(ranks).size !== ranks.length) fail('DUPLICATE_RANK', 'entries[].rank', 'Los ranks deben ser únicos.')
  if (JSON.stringify([...ranks].sort((a, b) => a - b)) !== JSON.stringify(entries.map((_, index) => index + 1))) fail('NON_CONSECUTIVE_RANK', 'entries[].rank', 'Los ranks deben ser consecutivos y no contener ties.')

  const enrichedById = new Map(enriched.businesses.map((business) => [business.businessId, business]))
  for (const [index, entry] of entries.entries()) {
    const base = `entries.${entry.businessId}`
    const evidenceBusiness = enrichedById.get(entry.businessId)
    if (!businessDocuments.has(entry.businessId)) fail('MISSING_BUSINESS_REF', `${base}.businessId`, `No existe el Business ${entry.businessId}.`)
    if (!evidenceBusiness) { fail('MISSING_COMPARISON_EVIDENCE', base, 'El negocio no aparece en el artefacto enriquecido.'); continue }
    if (!evidenceBusiness.topicEvidence.length || evidenceBusiness.scores.topicRelevance === 0) fail('IRRELEVANT_BUSINESS', base, `El Business no es relevante para topic=${enriched.topic}.`)
    if (entry.rank !== index + 1 || enriched.businesses[index]?.businessId !== entry.businessId) fail('RANKING_MISMATCH', `${base}.rank`, 'El rank no coincide con el orden determinista de scores.')
    if (entry.weaknesses.length && evidenceBusiness.evidence.limitations.length === 0) fail('UNSUPPORTED_WEAKNESS', `${base}.weaknesses`, 'No se pueden inventar inconvenientes sin evidence en limitations.')
    requireClaims(editorial.claims, base, entry, fail)
  }

  const evidenceById = new Map<string, {businessId: string; category: string; fact: ComparisonEvidenceFact}>()
  for (const business of enriched.businesses) for (const [category, facts] of Object.entries(business.evidence)) {
    for (const fact of facts) {
      if (!fact.sourceKeys.length || fact.sourceKeys.some((key) => !business.sources.some((source) => source.key === key))) fail('INVALID_EVIDENCE_PROVENANCE', `evidence.${fact.id}`, 'El fact no conserva una fuente declarada.')
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
    if (supports.length === 0 || !supports.some(({fact}) => factSupportsClaim(fact, claim.claim))) {
      fail('UNSUPPORTED_COMPARISON_CLAIM', path, `La afirmación no coincide con el evidence declarado: “${claim.claim}”.`)
      claimsRejected += 1
    }
    const businesses = new Set(supports.map((support) => support.businessId))
    if (SENSITIVE_COMPARISON.test(claim.claim) && businesses.size < 2) {
      fail('UNSUPPORTED_COMPARATIVE_CLAIM', path, `La afirmación sensible necesita evidence de al menos dos negocios: “${claim.claim}”.`)
      claimsRejected += 1
    }
    if (supports.length && supports.every(({fact}) => fact.nature === 'self_claim') && !/(?:seg[uú]n|indica|describe|presenta|web|declara)/i.test(claim.claim)) {
      fail('SELF_CLAIM_AS_FACT', path, 'Un self_claim debe quedar atribuido al negocio o a su web.')
      claimsRejected += 1
    }
    if (claim.path.includes('featuredPrice') && supports.some(({category}) => category !== 'prices')) fail('PRICE_PROVENANCE', path, 'featuredPrice sólo puede apoyarse en evidence de prices.')
    if (claim.path.includes('featuredItem') && supports.some(({category}) => category !== 'featuredItems' && category !== 'specialties')) fail('FEATURED_ITEM_PROVENANCE', path, 'featuredItem necesita evidence de featuredItems o specialties.')
    if (claim.path.includes('weaknesses') && supports.some(({category}) => category !== 'limitations')) fail('WEAKNESS_PROVENANCE', path, 'Una weakness necesita evidence de limitations.')
  }

  const allText = comparisonText(editorial)
  if (SUPERLATIVE.test(allText)) fail('UNSUPPORTED_SUPERLATIVE', 'editorial', 'Hay un superlativo o absoluto no permitido.')
  if (FIRST_PERSON.test(allText)) fail('FAKE_FIRST_PERSON_EXPERIENCE', 'editorial', 'La comparativa no puede inventar experiencia en primera persona.')
  if (GENERIC_INTRO.test(editorial.intro)) fail('GENERIC_INTRO', 'intro', 'La introducción usa una fórmula genérica.')
  const namedInVerdict = enriched.businesses.filter((business) => normalizeText(editorial.quickVerdict).includes(normalizeText(business.name))).length
  if (namedInVerdict < 2) fail('NON_SPECIFIC_QUICK_VERDICT', 'quickVerdict', 'El quick verdict debe diferenciar por nombre al menos dos negocios.')
  if (!/(?:fuentes|webs? oficiales?|datos abiertos)/i.test(editorial.methodology) || !/(?:visitad|visita personal)/i.test(editorial.methodology) || !/(?:precios?.*(?:cambiar|variar)|(?:cambiar|variar).*precios?)/i.test(editorial.methodology)) fail('INCOMPLETE_METHODOLOGY', 'methodology', 'La metodología debe explicar fuentes, visitas personales y variabilidad de precios.')

  const duplicateSeo = allGenerated.some((other) => other.id !== generated.id && normalizeText(other.editorial.seo.metaTitle) === normalizeText(editorial.seo.metaTitle))
  if (duplicateSeo) fail('DUPLICATE_SEO', 'seo.metaTitle', 'El título SEO ya se usa en otra Comparison.')
  if (repetitionRatio(entries.map((entry) => entry.verdict)) >= 0.75) warn('EXCESSIVE_REPETITION', 'entries[].verdict', 'Los veredictos repiten demasiado vocabulario.')

  const outcome = issues.some((issue) => issue.severity === 'FAIL') ? 'FAIL' : issues.some((issue) => issue.severity === 'WARNING') ? 'WARNING' : 'PASS'
  return {id: generated.id, topic: generated.topic, outcome, issues, claimsGenerated: editorial.claims.length, claimsRejected}
}

function requireClaims(claims: ComparisonClaim[], base: string, entry: GeneratedComparisonArtifact['editorial']['entries'][number], fail: (code: string, path: string, message: string) => void): void {
  const leaves: Array<[string, string]> = [
    [`${base}.verdict`, entry.verdict],
    ...entry.strengths.map((value, index) => [`${base}.strengths.${index}`, value] as [string, string]),
    ...entry.weaknesses.map((value, index) => [`${base}.weaknesses.${index}`, value] as [string, string]),
    ...entry.bestFor.map((value, index) => [`${base}.bestFor.${index}`, value] as [string, string]),
    ...entry.practicalNotes.map((value, index) => [`${base}.practicalNotes.${index}`, value] as [string, string]),
    ...(entry.featuredItem ? [[`${base}.featuredItem`, entry.featuredItem] as [string, string]] : []),
    ...(entry.featuredPrice ? [[`${base}.featuredPrice`, entry.featuredPrice] as [string, string]] : []),
  ]
  for (const [path, value] of leaves) {
    if (!claims.some((claim) => claim.path === path && textOverlap(value, claim.claim))) fail('MISSING_CLAIM_DECLARATION', path, 'El texto no declara su evidence en claims.')
  }
}

function factSupportsClaim(fact: ComparisonEvidenceFact, claim: string): boolean {
  const factText = typeof fact.value === 'object' ? `${fact.value.item} ${fact.value.value} ${fact.value.currency}` : String(fact.value)
  const factTokens = new Set(tokens(factText))
  const claimTokens = tokens(claim)
  return claimTokens.some((token) => factTokens.has(token)) || (typeof fact.value === 'object' && claim.includes(String(fact.value.value)))
}
function tokens(value: string): string[] { return normalizeText(value).replace(/\bdiari[oa]s?\b/g, 'dias').split(' ').filter((token) => (token.length >= 4 || /^\d+$/.test(token)) && !STOP_WORDS.has(token)) }
const STOP_WORDS = new Set(['para', 'como', 'esta', 'este', 'tiene', 'cuenta', 'segun', 'desde', 'entre', 'sobre', 'restaurante'])
function textOverlap(first: string, second: string): boolean { const a = new Set(tokens(first)); const b = tokens(second); return b.some((token) => a.has(token)) }
function comparisonText(editorial: GeneratedComparisonArtifact['editorial']): string { return [editorial.title, editorial.intro, editorial.quickVerdict, editorial.methodology, ...editorial.criteria, ...editorial.entries.flatMap((entry) => [entry.verdict, ...entry.strengths, ...entry.weaknesses, ...entry.bestFor, entry.featuredItem ?? '', entry.featuredPrice ?? '', ...entry.practicalNotes])].join('\n') }
function repetitionRatio(values: string[]): number { if (values.length < 2) return 0; const sets = values.map((value) => new Set(tokens(value))); let max = 0; for (let a = 0; a < sets.length; a += 1) for (let b = a + 1; b < sets.length; b += 1) { const left = sets[a]!; const right = sets[b]!; const union = new Set([...left, ...right]); if (union.size) max = Math.max(max, [...left].filter((token) => right.has(token)).length / union.size) } return max }
