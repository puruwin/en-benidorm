import type {ContentDocument} from '../../content-validation'
import type {EnrichedComparisonArtifact, GeneratedComparisonArtifact, GeneratedComparisonEditorial} from './types'

export const COMPARISON_EDITORIAL_INSTRUCTIONS = [
  'Responde a la intención de búsqueda declarada ayudando a elegir, no enumerando negocios.',
  'Voz de guía local: natural, práctica, comparativa y directa; evita que el texto suene a informe o auditoría.',
  'No uses mejor, peor, excelente, recomendado, calidad, popular, auténtico, barato o caro salvo evidencia comparativa suficiente.',
  'Explica diferencias reales y no conviertas marketing de un negocio en un hecho objetivo ni declares un ganador.',
  'La intro debe explicar variedad y propósito sin enumerar nombres, precios ni los cuatro negocios.',
  'quickVerdict debe ser una sola frase breve de contraste, sin precios exactos; se mostrará dentro de “¿Cuál elegir?”.',
  'choiceGuide debe incluir una recomendación condicional breve por Business, sin repetir precios exactos ni todo el horario.',
  'bestFor debe contener uno o dos rasgos centrales de propuesta o especialidad; no mezcles ubicación, horario o reservas en esas etiquetas.',
  'Las cards deben ser breves. Un precio exacto sólo debe aparecer en featuredItem, no repetirse en strengths, intro, quickVerdict o choiceGuide.',
  'Usa lenguaje natural: “la carta incluye”, “figura a” o “no encontramos”; evita documentado, registra, evidencia y según la información publicada.',
  'practicalNotes debe usar formato compacto, por ejemplo “Mi–Sá: 13:30–16:30 / 20:30–23:00”, “Zona: …” o “Reservas: online”.',
  'No afirmes visitas ni experiencias personales. Indica que no todos los locales han sido visitados personalmente.',
  'Conserva source y retrievedAt de cada featuredItem; los precios deben llevar fecha de comprobación.',
  'No inventes inconvenientes; limitations debe quedar vacío sin evidence explícita y usar lenguaje humano como “No encontramos precios publicados”.',
]

export const PUBLIC_COMPARISON_CRITERIA = [
  'Carta y especialidades',
  'Platos y precios publicados',
  'Horarios y reservas',
  'Ubicación y servicios',
  'Diferencias útiles para elegir',
]

export function validateComparisonEditorial(editorial: GeneratedComparisonEditorial, enriched: EnrichedComparisonArtifact): string[] {
  const errors: string[] = []
  const expected = enriched.businesses.map((business) => business.businessId)
  if (!textBetween(editorial.title, 20, 90)) errors.push('title debe tener 20-90 caracteres.')
  if (!textBetween(editorial.intro, 100, 700)) errors.push('intro debe tener 100-700 caracteres.')
  if (!textBetween(editorial.quickVerdict, 80, 700)) errors.push('quickVerdict debe tener 80-700 caracteres.')
  else if (editorial.quickVerdict.split(/\n\s*\n/).filter(Boolean).length > 2) errors.push('quickVerdict debe tener uno o dos párrafos.')
  if (!Array.isArray(editorial.choiceGuide) || editorial.choiceGuide.length !== expected.length) errors.push('choiceGuide debe contener exactamente una recomendación por Business.')
  else for (const [index, choice] of editorial.choiceGuide.entries()) {
    if (choice.businessId !== expected[index]) errors.push(`choiceGuide[${index}] debe conservar businessId=${expected[index]}.`)
    if (!textBetween(choice.label, 5, 80) || !textBetween(choice.reason, 20, 220)) errors.push(`choiceGuide[${index}] no es válido.`)
  }
  if (!Array.isArray(editorial.entries) || editorial.entries.length !== expected.length) errors.push('entries debe contener exactamente los Businesses seleccionados.')
  else for (const [index, entry] of editorial.entries.entries()) {
    const wanted = expected[index]!
    if (entry.businessId !== wanted) errors.push(`entries[${index}] debe conservar businessId=${wanted}.`)
    if (!textBetween(entry.verdict, 30, 300)) errors.push(`entries[${index}].verdict no es válido.`)
    if (!stringArray(entry.strengths, 2, 3) || !stringArray(entry.limitations, 0, 3) || !stringArray(entry.bestFor, 1, 3) || !stringArray(entry.practicalNotes, 0, 3)) errors.push(`entries[${index}] contiene arrays no válidos.`)
    if (entry.featuredItem !== null && !validFeaturedItem(entry.featuredItem)) errors.push(`entries[${index}].featuredItem no es válido.`)
  }
  if (!textBetween(editorial.methodology, 100, 900)) errors.push('methodology debe tener 100-900 caracteres.')
  if (!stringArray(editorial.criteria, 3, 5)) errors.push('criteria debe contener 3-5 criterios.')
  if (!textBetween(editorial.seo?.metaTitle, 20, 60) || !textBetween(editorial.seo?.metaDescription, 70, 160)) errors.push('seo no cumple las longitudes requeridas.')
  if (!Array.isArray(editorial.claims) || editorial.claims.length === 0 || editorial.claims.some((claim) => !claim.path || !claim.claim || !Array.isArray(claim.supportedBy) || claim.supportedBy.length === 0)) errors.push('claims debe declarar soporte explícito.')
  return errors
}

export function buildComparisonArtifact(enriched: EnrichedComparisonArtifact, editorial: GeneratedComparisonEditorial, now: string): GeneratedComparisonArtifact {
  const completed = completeClaimBindings(structuredClone(editorial), enriched)
  completed.criteria = [...PUBLIC_COMPARISON_CRITERIA]
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
    choiceGuide: completed.choiceGuide.map((choice) => ({
      _type: 'comparisonChoice', business: {_type: 'reference', _ref: choice.businessId}, label: choice.label, reason: choice.reason,
    })),
    entries: completed.entries.map((entry) => ({
      _type: 'comparisonEntry',
      business: {_type: 'reference', _ref: entry.businessId},
      verdict: entry.verdict,
      strengths: entry.strengths,
      limitations: entry.limitations,
      bestFor: entry.bestFor,
      ...(entry.featuredItem ? {featuredItem: {
        _type: 'comparisonFeaturedItem', name: entry.featuredItem.name,
        ...(typeof entry.featuredItem.price === 'number' ? {
          price: entry.featuredItem.price,
          currency: entry.featuredItem.currency,
          ...(entry.featuredItem.priceQualifier ? {priceQualifier: entry.featuredItem.priceQualifier} : {}),
        } : {}),
        source: entry.featuredItem.source, retrievedAt: entry.featuredItem.retrievedAt,
      }} : {}),
      practicalNotes: entry.practicalNotes,
    })),
    methodology: completed.methodology,
    criteria: completed.criteria,
    author: {_type: 'reference', _ref: 'author-david'},
    sources: publicSources(enriched),
    lastVerified: latestDate(enriched),
    seo: {...completed.seo, noIndex: true},
  }
  return {
    schemaVersion: 1, id: enriched.id, topic: enriched.topic, searchIntent: enriched.searchIntent,
    indexability: 'noindex', generatedAt: now, editorial: completed, document,
  }
}

/** Adds deterministic leaf-level bindings only when the generated text overlaps supplied evidence. */
export function completeClaimBindings(editorial: GeneratedComparisonEditorial, enriched: EnrichedComparisonArtifact): GeneratedComparisonEditorial {
  const businessById = new Map(enriched.businesses.map((business) => [business.businessId, business]))
  editorial.quickVerdict = conciseQuickVerdict(editorial.quickVerdict, enriched.businesses.map((business) => business.name))
  const globalFacts = enriched.businesses.flatMap((business) => Object.entries(business.evidence)
    .flatMap(([category, facts]) => facts.map((fact) => ({businessId: business.businessId, category, fact}))))

  // Structured generation occasionally returns a plausible but synthetic evidence id. Repair only
  // those bindings that can be matched back to facts already present in the enriched artifact.
  const globalFactIds = new Set(globalFacts.map(({fact}) => fact.id))
  for (const claim of editorial.claims) {
    if (claim.supportedBy.every((id) => globalFactIds.has(id))) continue
    const matches = matchingFacts(claim.claim, globalFacts)
    if (matches.length) claim.supportedBy = matches.slice(0, 8).map(({fact}) => fact.id)
  }

  for (const choice of editorial.choiceGuide) {
    const business = businessById.get(choice.businessId)
    if (!business) continue
    const allFacts = Object.entries(business.evidence).flatMap(([category, facts]) => facts.map((fact) => ({category, fact})))
    // Labels are navigation copy rather than factual prose; their reason carries the evidence.
    // Injecting attribution inside a short label can split noun phrases and make it unreadable.
    choice.label = naturalizePublicCopy(choice.label)
    choice.reason = removeExactHours(naturalizePublicCopy(attributeSelfClaims(choice.reason, allFacts)))
    const path = `choiceGuide.${choice.businessId}.reason`
    const localFactIds = new Set(allFacts.map(({fact}) => fact.id))
    const existingLabelClaim = editorial.claims.find((candidate) => candidate.path === `choiceGuide.${choice.businessId}.label`)
    if (existingLabelClaim) existingLabelClaim.claim = choice.label
    const existingReasonClaim = editorial.claims.find((candidate) => candidate.path === path)
    if (existingReasonClaim) existingReasonClaim.claim = choice.reason
    for (const claim of editorial.claims.filter((candidate) => candidate.path === path && candidate.supportedBy.some((id) => !localFactIds.has(id)))) {
      const matches = matchingFacts(claim.claim, allFacts)
      if (matches.length) claim.supportedBy = matches.slice(0, 6).map(({fact}) => fact.id)
    }
    if (!editorial.claims.some((claim) => claim.path === path)) {
      const matches = matchingFacts(choice.reason, allFacts)
      if (matches.length) editorial.claims.push({path, claim: choice.reason, supportedBy: matches.slice(0, 6).map(({fact}) => fact.id)})
    }
  }
  for (const entry of editorial.entries) {
    const business = businessById.get(entry.businessId)
    if (!business) continue
    const allFacts = Object.entries(business.evidence).flatMap(([category, facts]) => facts.map((fact) => ({category, fact})))
    entry.verdict = naturalizePublicCopy(attributeSelfClaims(entry.verdict, allFacts))
    entry.strengths = entry.strengths.map((value) => naturalizePublicCopy(attributeSelfClaims(value, allFacts)))
    const editorialBestFor = entry.bestFor.filter((value) => !isPracticalBestFor(value))
    if (editorialBestFor.length) {
      entry.bestFor = editorialBestFor
      editorial.claims = editorial.claims.filter((claim) => !claim.path.startsWith(`entries.${entry.businessId}.bestFor.`))
    }
    entry.bestFor = entry.bestFor.map((value, index) => {
      const matches = matchingFacts(value, allFacts)
      const exactMorphology = matches.find(({fact}) => typeof fact.value === 'string' && sameWordsIgnoringPlural(value, fact.value))
      const normalizedValue = exactMorphology && typeof exactMorphology.fact.value === 'string' ? exactMorphology.fact.value : value
      const attributedValue = matches.length > 0 && matches.every(({fact}) => fact.nature === 'self_claim') && !/(?:seg[uú]n|indica|web|declara)/i.test(normalizedValue)
        ? `${normalizedValue} según su web`
        : normalizedValue
      const claim = editorial.claims.find((candidate) => candidate.path === `entries.${entry.businessId}.bestFor.${index}`)
      if (claim) claim.claim = attributedValue
      return attributedValue
    })
    const conciseVerdict = removeSentencesRepeatedAsLimitations(entry.verdict, entry.limitations)
    if (conciseVerdict !== entry.verdict) {
      entry.verdict = conciseVerdict
      const verdictClaim = editorial.claims.find((candidate) => candidate.path === `entries.${entry.businessId}.verdict`)
      if (verdictClaim) verdictClaim.claim = conciseVerdict
    }
    const localFactIds = new Set(allFacts.map(({fact}) => fact.id))
    for (const claim of editorial.claims.filter((candidate) => candidate.path.startsWith(`entries.${entry.businessId}.`))) {
      if (claim.supportedBy.some((id) => !localFactIds.has(id))) {
        const candidates = claim.path.includes('.limitations.') ? allFacts.filter(({category}) => category === 'limitations') : allFacts
        const matches = matchingFacts(claim.claim, candidates)
        if (matches.length) claim.supportedBy = matches.slice(0, 6).map(({fact}) => fact.id)
      }
    }
    const featuredFacts = allFacts.filter(({category}) => category === 'featuredItems')
    for (const claim of editorial.claims.filter((candidate) => candidate.path.startsWith(`entries.${entry.businessId}.featuredItem`))) {
      const matches = matchingFacts(claim.claim, featuredFacts)
      if (matches.length) claim.supportedBy = matches.map(({fact}) => fact.id)
    }
    const leaves: Array<{path: string; value: string; categories?: string[]}> = [
      {path: `entries.${entry.businessId}.verdict`, value: entry.verdict},
      ...entry.strengths.map((value, index) => ({path: `entries.${entry.businessId}.strengths.${index}`, value})),
      ...entry.limitations.map((value, index) => ({path: `entries.${entry.businessId}.limitations.${index}`, value, categories: ['limitations']})),
      ...entry.bestFor.map((value, index) => ({path: `entries.${entry.businessId}.bestFor.${index}`, value, categories: bestForCategories(value)})),
      ...entry.practicalNotes.map((value, index) => ({path: `entries.${entry.businessId}.practicalNotes.${index}`, value})),
      ...(entry.featuredItem ? [{path: `entries.${entry.businessId}.featuredItem`, value: featuredItemText(entry.featuredItem), categories: ['featuredItems']}] : []),
    ]
    for (const leaf of leaves) {
      const existing = editorial.claims.find((claim) => claim.path === leaf.path)
      if (existing) {
        existing.claim = leaf.value
        continue
      }
      const candidates = leaf.categories ? allFacts.filter(({category}) => leaf.categories!.includes(category)) : allFacts
      const scopedMatches = leaf.categories?.includes('prices') && /\bprecios?\b/i.test(leaf.value) ? candidates : matchingFacts(leaf.value, candidates)
      const matches = scopedMatches.length ? scopedMatches : matchingFacts(leaf.value, allFacts)
      if (matches.length) editorial.claims.push({path: leaf.path, claim: leaf.value, supportedBy: matches.slice(0, 6).map(({fact}) => fact.id)})
    }
  }

  // Search-intent QA needs one genuinely cross-business synthesis. Keep the model's individual
  // claims, and add a single binding for the public verdict using at most two facts per business.
  const crossBusinessFacts = [...new Set(globalFacts.map(({businessId}) => businessId))].flatMap((businessId) =>
    matchingFacts(editorial.quickVerdict, globalFacts.filter((candidate) => candidate.businessId === businessId)).slice(0, 2))
  if (new Set(crossBusinessFacts.map(({businessId}) => businessId)).size >= 2
    && !editorial.claims.some((claim) => claim.path === 'quickVerdict'
      && new Set(claim.supportedBy.map((id) => globalFacts.find(({fact}) => fact.id === id)?.businessId).filter(Boolean)).size >= 2)) {
    editorial.claims.push({path: 'quickVerdict', claim: editorial.quickVerdict, supportedBy: crossBusinessFacts.map(({fact}) => fact.id)})
  }
  return editorial
}

function latestDate(enriched: EnrichedComparisonArtifact): string {
  const value = enriched.sources.map((source) => source.retrievedAt.slice(0, 10)).sort().at(-1)
  if (!value) throw new Error('Comparison necesita al menos una fuente fechada.')
  return value
}
function publicMethodology(_enriched: EnrichedComparisonArtifact): string {
  return 'Comparamos cartas, especialidades, precios publicados, horarios, reservas, ubicación y servicios a partir de webs oficiales, cartas públicas y OpenStreetMap. No todos los establecimientos han sido visitados personalmente y los precios pueden cambiar.'
}

function publicSources(enriched: EnrichedComparisonArtifact): Array<Record<string, unknown>> {
  return enriched.businesses.flatMap((business) => {
    const byUrl = new Map<string, (typeof business.sources)[number]>()
    for (const source of business.sources) if (source.url) {
      const previous = byUrl.get(source.url)
      if (!previous || sourceLabelPriority(publicSourceLabel(source)) > sourceLabelPriority(publicSourceLabel(previous))) byUrl.set(source.url, source)
    }
    return [...byUrl.values()].map((source) => ({
      _type: 'source', title: publicSourceLabel(source), publisher: business.name,
      url: source.url, accessedAt: source.retrievedAt.slice(0, 10),
    }))
  })
}

function sourceLabelPriority(label: string): number {
  return label === 'Web oficial' ? 1 : label === 'OpenStreetMap' ? 2 : 3
}

function publicSourceLabel(source: EnrichedComparisonArtifact['sources'][number]): string {
  if (/openstreetmap/i.test(source.provider)) return 'OpenStreetMap'
  const url = new URL(source.url ?? 'https://example.invalid')
  const path = `${url.pathname} ${source.attribution}`.toLocaleLowerCase('es')
  if ((url.pathname === '/' || url.pathname === '') && /\bcarta\b/.test(path)) return 'Web oficial y carta'
  if (/carta|menu-cocina/.test(path)) return 'Carta'
  if (/reserv/.test(path)) return 'Reservas'
  if (/\/menu(?:\/|$)|\bmen[uú]\b/.test(path)) return 'Menú'
  if (/about|nosotros|sobre el restaurante/.test(path)) return 'Sobre el restaurante'
  return 'Web oficial'
}
function textBetween(value: unknown, min: number, max: number): value is string { return typeof value === 'string' && value.trim().length >= min && value.length <= max }
function stringArray(value: unknown, min: number, max: number): value is string[] { return Array.isArray(value) && value.length >= min && value.length <= max && value.every((item) => typeof item === 'string' && item.trim().length > 0) }
function matchingFacts<T extends {category: string; fact: EnrichedComparisonArtifact['businesses'][number]['evidence'][keyof EnrichedComparisonArtifact['businesses'][number]['evidence']][number]}>(value: string, candidates: T[]): T[] {
  const normalized = normalize(value)
  const tokens = normalized.split(' ').filter((token) => token.length >= 3 || /^\d+$/.test(token))
  return candidates.filter(({fact}) => {
    const factValue = evidenceValueText(fact.value)
    const factText = normalize(factValue)
    return tokens.some((token) => factText.includes(token)) || normalize(factValue).split(' ').some((token) => token.length >= 4 && normalized.includes(token))
  })
}
function normalize(value: string): string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\bdiari[oa]s?\b/g, 'dias').trim() }
function sameWordsIgnoringPlural(first: string, second: string): boolean {
  const words = (value: string) => normalize(value).split(' ').map((word) => word.length > 4 ? word.replace(/(?:es|s)$/, '') : word).join(' ')
  return words(first) === words(second)
}
function removeSentencesRepeatedAsLimitations(value: string, limitations: string[]): string {
  if (!limitations.length) return value
  const tokens = (text: string) => new Set(normalize(text).split(' ').filter((token) => token.length >= 4))
  const limitationTokens = limitations.map(tokens)
  const parts = value.match(/[^,.!?;]+[,.!?;]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [value]
  const kept = parts.filter((part) => {
    const partTokens = tokens(part)
    return !limitationTokens.some((candidate) => {
      const denominator = Math.min(partTokens.size, candidate.size)
      return denominator > 0 && [...partTokens].filter((token) => candidate.has(token)).length / denominator >= 0.5
    })
  })
  const result = kept.join(' ').replace(/[,;]\s*$/, '.').trim()
  return result.length >= 40 ? result : value
}
function naturalizePublicCopy(value: string): string {
  return value
    .replace(/\bacepta reservas y (?:(?:ofrece|dispone de|cuenta con) )?reservas online\b/gi, (match) => match[0] === match[0]?.toUpperCase() ? 'Acepta reservas online' : 'acepta reservas online')
    .replace(/\bdispone de reservas y reservas online\b/gi, (match) => match[0] === match[0]?.toUpperCase() ? 'Dispone de reservas online' : 'dispone de reservas online')
    .replace(/\bofrece reservas y reservas online\b/gi, (match) => match[0] === match[0]?.toUpperCase() ? 'Ofrece reservas online' : 'ofrece reservas online')
    .replace(/,\s*reservas y reservas online\b/gi, ' y reservas online')
}
function conciseQuickVerdict(value: string, businessNames: string[]): string {
  const firstContrast = value.split(';')[0]?.trim()
  if (!firstContrast || firstContrast.length < 80 || !/\b(?:mientras|frente a|en cambio)\b/i.test(firstContrast)) return value
  const namedBusinesses = businessNames.filter((name) => normalize(firstContrast).includes(normalize(name))).length
  return namedBusinesses >= 2 ? `${firstContrast.replace(/[.!?]+$/, '')}.` : value
}
function removeExactHours(value: string): string {
  return value.replace(/\s+(?:de\s+)?\d{1,2}:\d{2}\s*(?:a|[–-])\s*\d{1,2}:\d{2}/gi, '').replace(/\s{2,}/g, ' ').trim()
}
function attributeSelfClaims<T extends {category: string; fact: EnrichedComparisonArtifact['businesses'][number]['evidence'][keyof EnrichedComparisonArtifact['businesses'][number]['evidence']][number]}>(value: string, facts: T[]): string {
  if (/(?:seg[uú]n|indica|describe|presenta|publica|web|declara)/i.test(value)) return value
  for (const {fact} of facts) {
    if (fact.nature !== 'self_claim') continue
    const phrase = evidenceValueText(fact.value).replace(/\s*\(?\s*seg[uú]n su web\s*\)?/gi, '').trim()
    if (phrase.length < 6) continue
    const index = value.toLocaleLowerCase('es').indexOf(phrase.toLocaleLowerCase('es'))
    if (index >= 0) {
      const punctuation = value.match(/[.!?]$/)?.[0] ?? ''
      const body = punctuation ? value.slice(0, -1) : value
      return `${body} (según su web)${punctuation}`
    }
  }
  return value
}
function evidenceValueText(value: EnrichedComparisonArtifact['businesses'][number]['evidence'][keyof EnrichedComparisonArtifact['businesses'][number]['evidence']][number]['value']): string {
  if (typeof value !== 'object') return String(value)
  if ('name' in value) return `${value.name} ${value.price ?? ''} ${value.currency ?? ''} ${value.priceQualifier ?? ''}`
  return `${value.item} ${value.value} ${value.currency} ${value.priceQualifier ?? ''}`
}
function featuredItemText(value: NonNullable<GeneratedComparisonEditorial['entries'][number]['featuredItem']>): string {
  return `${value.name}${typeof value.price !== 'number' ? '' : ` ${value.price} ${value.currency ?? 'EUR'} ${value.priceQualifier ?? ''}`}`.trim()
}
function validFeaturedItem(value: NonNullable<GeneratedComparisonEditorial['entries'][number]['featuredItem']>): boolean {
  return textBetween(value.name, 3, 140) && typeof value.source === 'string' && value.source.length > 0
    && /^\d{4}-\d{2}-\d{2}/.test(value.retrievedAt)
    && (value.price == null || (typeof value.price === 'number' && value.price >= 0 && value.currency === 'EUR'))
    && (value.priceQualifier == null || (typeof value.priceQualifier === 'string' && value.priceQualifier.trim().length > 0))
}
function bestForCategories(value: string): string[] | undefined {
  if (/\bprecios?\b/i.test(value)) return ['prices']
  if (/\b(?:reserva|llevar)\b/i.test(value)) return ['services']
  if (/\bmen[uú]\b/i.test(value)) return ['services', 'prices']
  if (/\b(?:horario|apertura|diari[oa])\b/i.test(value)) return ['practical']
  return undefined
}
function isPracticalBestFor(value: string): boolean {
  return /\b(?:horario|apertura|servicio diario|todos los d[ií]as|zona|ubicaci[oó]n|reservas?)\b/i.test(value)
}
