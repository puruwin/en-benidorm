import type {PriceUnit} from '../../../src/lib/comparison-presentation'
import type {ComparisonEvidenceFact, ComparisonSourceConflict} from './types'

// Shared with the public page so the pipeline and the template agree on units and source identity.
export {PRICE_UNITS, PRICE_UNIT_LABELS, canonicalSourceKey, isLanguageVariant, sourceDomain, type PriceUnit} from '../../../src/lib/comparison-presentation'

/**
 * Deterministic helpers that decide how already-approved evidence is presented publicly.
 * They never add facts: they only classify, normalise or deduplicate what the pipeline has.
 */

export type LimitationKind = 'condition' | 'unverified'

// A limitation is "unverified" only when the text itself states that something is absent,
// unclear or contradictory. Conditions the source does publish (minimums, pre-orders, group
// menus, seasonal changes) belong to «Condiciones publicadas», not to «Lo que no pudimos comprobar».
const UNVERIFIED_LIMITATION = new RegExp([
  String.raw`\bno\s+(?:se\s+)?(?:publica|publican|indica|indican|consta|constan|especifica|especifican|detalla|detallan|aclara|aclaran|muestra|muestran|figura|figuran|encontramos|hemos\s+podido|pudimos|confirma|confirman)\b`,
  String.raw`\bsin\s+(?:precios?|horarios?|datos|informaci[oó]n|confirmar|publicar|indicar|detallar)\b`,
  String.raw`\ben\s+actualizaci[oó]n\b`,
  String.raw`\bcontradic`,
  String.raw`\bconflict`,
  String.raw`\bdesconoc`,
  String.raw`\bno\s+est[aá]\s+claro\b`,
  String.raw`\bpendiente\s+de\s+(?:confirmar|verificar)\b`,
].join('|'), 'i')

export function classifyLimitation(
  text: string,
  supportingFacts: readonly ComparisonEvidenceFact[] = [],
  conflicts: readonly ComparisonSourceConflict[] = [],
): LimitationKind {
  if (UNVERIFIED_LIMITATION.test(text)) return 'unverified'
  const conflictingKeys = new Set(conflicts.flatMap((conflict) => conflict.conflictingSourceKeys))
  if (supportingFacts.some((fact) => fact.sourceKeys.some((key) => conflictingKeys.has(key)))) return 'unverified'
  // Without a sourced fact behind it, a text cannot be presented as a published condition.
  return supportingFacts.some((fact) => fact.sourceKeys.length > 0 && typeof fact.value === 'string' && !UNVERIFIED_LIMITATION.test(fact.value))
    ? 'condition'
    : 'unverified'
}

const PRICE_UNIT_PATTERNS: Array<[Exclude<PriceUnit, 'ambiguous'>, RegExp]> = [
  ['per-person', /\b(?:por|cada|\/)\s*(?:persona|pers\.?|comensal)\b|\bp\.\s?p\.?(?=\s|$|[;,)])|\bpax\b|\bper\s+person\b|\bpp\b/i],
  ['per-portion', /\b(?:media\s+)?raci[oó]n\b|\bper\s+portion\b/i],
  ['per-unit', /\b(?:por|cada|la|el)\s+unidad\b|\bunidad\b|\bud\.|\b\/\s*ud\b|\beach\b|\bper\s+(?:unit|piece)\b/i],
]

/**
 * Maps a free-text price qualifier to one canonical unit. «mínimo N personas» is a condition, not
 * a unit, and «desde» is a bound, not a unit. Missing or contradictory units stay `ambiguous`:
 * we never guess one for the reader.
 */
export function normalizePriceUnit(qualifier: string | null | undefined): PriceUnit {
  if (!qualifier?.trim()) return 'ambiguous'
  const withoutConditions = qualifier.replace(/\bm[ií]n(?:imo|\.)?\s*(?:de\s+)?\d+\s*(?:personas?|pax|comensales)\b/gi, ' ')
  const units = new Set(PRICE_UNIT_PATTERNS.filter(([, pattern]) => pattern.test(withoutConditions)).map(([unit]) => unit))
  return units.size === 1 ? [...units][0]! : 'ambiguous'
}
