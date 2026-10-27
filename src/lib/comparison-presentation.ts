import type {SourceItem} from '../types/content'

export const COMPARISON_SECTION_HEADINGS = [
  '¿Cuál elegir?',
  'Comparación rápida',
  'Los restaurantes',
  'Qué hemos comparado',
  'Cómo hacemos esta guía',
  'Fuentes consultadas',
] as const

export interface PublicSourceGroup {
  name: string
  sources: Array<SourceItem & {label: string}>
}

export function hasDuplicateSectionHeadings(headings: readonly string[] = COMPARISON_SECTION_HEADINGS): boolean {
  const normalized = headings.map((heading) => heading.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
  return new Set(normalized).size !== normalized.length
}

export function compactPracticalLines(notes: readonly string[]): string[] {
  return notes.flatMap((note) => {
    let value = note.trim()
      .replace(/^Horario (?:publicado|consultado):\s*/i, '')
      .replace(/miércoles, jueves, viernes y sábado/gi, 'Mi–Sá')
      .replace(/miércoles a sábado/gi, 'Mi–Sá')
      .replace(/miércoles a lunes/gi, 'Mi–Lu')
      .replace(/todos los días/gi, 'Todos los días')
      .replace(/domingo/gi, 'Do')
      .replace(/martes cerrado/gi, 'Ma: cerrado')
      .replace(/\bde\s+(\d{1,2}:\d{2})\s+a\s+(\d{1,2}:\d{2})/gi, '$1–$2')
      .replace(/\s+y\s+(?=\d{1,2}:\d{2}–)/g, ' / ')
      .replace(/^(Mi–(?:Sá|Lu)|Do|Todos los días)\s+(?=\d)/, '$1: ')
    value = value.replace(/\.$/, '')
    return value.split(/;\s+(?=(?:Lu|Ma|Mi|Ju|Vi|Sá|Do|Todos los días|Zona|Reservas):?)/)
      .map((line) => line.trim().replace(/^(Mi–(?:Sá|Lu)|Do|Todos los días)\s+(?=\d)/, '$1: '))
      .filter(Boolean)
  })
}

export function groupPublicSources(sources: readonly SourceItem[]): PublicSourceGroup[] {
  const groups = new Map<string, PublicSourceGroup['sources']>()
  for (const source of sources) {
    const name = publicPublisher(source.publisher)
    const group = groups.get(name) ?? []
    // Artifacts generated before deduplication may still list http/https or language variants of one page.
    if (!group.some((item) => canonicalSourceKey(item.url) === canonicalSourceKey(source.url))) group.push({...source, label: publicSourceLabel(source)})
    groups.set(name, group)
  }
  return [...groups].map(([name, groupSources]) => ({name, sources: groupSources}))
}

function publicPublisher(publisher?: string): string {
  if (!publisher || /^(?:©|sitio web|carta pública|openstreetmap)/i.test(publisher)) return 'Otras fuentes'
  return publisher.replace(/^(?:official-website|manual-json):\s*/i, '').trim()
}

function publicSourceLabel(source: SourceItem): string {
  if (/openstreetmap|(?:node|way|relation)\//i.test(`${source.title} ${source.url}`)) return 'OpenStreetMap'
  if (!/^\w[\w\sáéíóúüñ-]{1,40}$/i.test(source.title) || /official-website|manual-json|https?:/i.test(source.title)) {
    const url = new URL(source.url)
    const path = url.pathname.toLocaleLowerCase('es')
    if (/carta|menu-cocina/.test(path)) return 'Carta'
    if (/reserv/.test(path)) return 'Reservas'
    if (/\/menu(?:\/|$)/.test(path)) return 'Menú'
    if (/about|nosotros/.test(path)) return 'Sobre el restaurante'
    return 'Web oficial'
  }
  return source.title
}

export const PRICE_UNITS = ['per-person', 'per-portion', 'per-unit', 'ambiguous'] as const
export type PriceUnit = (typeof PRICE_UNITS)[number]

export const PRICE_UNIT_LABELS: Record<PriceUnit, string> = {
  'per-person': 'por persona',
  'per-portion': 'por ración',
  'per-unit': 'por unidad',
  ambiguous: 'unidad no indicada en la carta',
}

/** Price context shown next to a price: the published qualifier, plus an explicit note when the unit is unclear. */
export function priceContext(item: {priceQualifier?: string; priceUnit?: PriceUnit}): string | undefined {
  const parts = [item.priceQualifier?.trim(), item.priceUnit === 'ambiguous' ? PRICE_UNIT_LABELS.ambiguous : undefined].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}

const LANGUAGE_CODES = new Set(['es', 'en', 'fr', 'de', 'ru', 'it', 'nl', 'pt', 'ca', 'va', 'eu', 'gl', 'sv', 'no', 'da', 'pl', 'zh', 'ja'])
const LANGUAGE_PARAMS = new Set(['lang', 'language', 'locale', 'hl', 'idioma'])
const LANGUAGE_SWITCH_SEGMENT = /^(?:change-?lang(?:uage)?|set-?lang(?:uage)?|switch-?lang(?:uage)?)$/i

/** Same page regardless of scheme, `www`, trailing slash or language variant. */
export function canonicalSourceKey(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { return value.trim() }
  const host = sourceDomain(value)
  const segments = url.pathname.split('/').filter(Boolean)
  // Language switch endpoints (`/Base/ChangeLang/en`) only redirect to the same site in another language.
  const switchIndex = segments.findIndex((segment) => LANGUAGE_SWITCH_SEGMENT.test(segment))
  const path = switchIndex >= 0 ? [] : segments.filter((segment, index) => !(index === 0 && LANGUAGE_CODES.has(segment.toLowerCase())))
  const params = [...url.searchParams].filter(([key]) => !LANGUAGE_PARAMS.has(key.toLowerCase())).sort(([left], [right]) => left.localeCompare(right))
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : ''
  return `${host}/${path.join('/')}${query}`.toLowerCase()
}

export function sourceDomain(value: string): string {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, '') } catch { return value.trim().toLowerCase() }
}

/** True when the URL is itself a language variant (so a plain variant of the same page is preferred). */
export function isLanguageVariant(value: string): boolean {
  try {
    const url = new URL(value)
    const segments = url.pathname.split('/').filter(Boolean)
    return segments.some((segment) => LANGUAGE_SWITCH_SEGMENT.test(segment))
      || LANGUAGE_CODES.has(segments[0]?.toLowerCase() ?? '')
      || [...url.searchParams.keys()].some((key) => LANGUAGE_PARAMS.has(key.toLowerCase()))
  } catch { return false }
}
