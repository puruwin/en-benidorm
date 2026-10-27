import type {DescriptionBlock, SourceItem} from '../types/content'

/**
 * Qué pasó realmente con los datos de una página, según lo que guardan sus `sources`.
 *
 * `lastVerified` lo rellena el pipeline con la fecha de consulta más reciente de las fuentes
 * automáticas: no es una revisión humana. El modelo actual no tiene un estado de revisión humana
 * (`verified`), así que ninguna línea afirma una revisión ni lleva el símbolo ✓.
 */
export type SourceKind = 'openstreetmap' | 'official-website' | 'manual-observation' | 'other'

export interface ProvenanceLine {
  kind: 'consulted' | 'observed'
  /** Texto antes de la fecha: «Datos de OpenStreetMap y la web oficial consultados». */
  label: string
  from: string
  to: string
}

const AUTOMATIC_LABELS: Record<Exclude<SourceKind, 'manual-observation'>, string> = {
  'openstreetmap': 'OpenStreetMap',
  'official-website': 'la web oficial',
  'other': 'otras fuentes públicas',
}

export function sourceKind(source: SourceItem): SourceKind {
  const title = source.title.trim()
  const publisher = source.publisher ?? ''
  if (/^manual-observation\b/i.test(title) || /observaci[oó]n local de primera mano/i.test(publisher)) return 'manual-observation'
  if (/openstreetmap/i.test(`${title} ${publisher} ${source.url}`)) return 'openstreetmap'
  // Las fichas generadas guardan `official-website: <url>`; las comparativas, etiquetas públicas.
  // `manual-json` es una fuente registrada a mano que apunta a la web oficial, no una visita.
  if (/^official-website\b/i.test(title) || /^(?:web oficial|web oficial y carta|carta|men[uú]|reservas|sobre el restaurante)$/i.test(title)
    || /sitio web oficial/i.test(publisher)) return 'official-website'
  return 'other'
}

export function provenanceLines(sources: readonly SourceItem[], lastVerified?: string | undefined): ProvenanceLine[] {
  const dated = sources.filter((source): source is SourceItem & {accessedAt: string} => typeof source.accessedAt === 'string' && source.accessedAt.length > 0)
  const lines: ProvenanceLine[] = []
  const manual = dated.filter((source) => sourceKind(source) === 'manual-observation')
  if (manual.length > 0) lines.push({kind: 'observed', label: 'Comprobado en persona', ...range(manual)})

  const automatic = dated.filter((source) => sourceKind(source) !== 'manual-observation')
  if (automatic.length > 0) {
    const kinds = (['openstreetmap', 'official-website', 'other'] as const).filter((kind) => automatic.some((source) => sourceKind(source) === kind))
    lines.push({kind: 'consulted', label: `Datos de ${joinSpanish(kinds.map((kind) => AUTOMATIC_LABELS[kind]))} consultados`, ...range(automatic)})
  } else if (lines.length === 0 && lastVerified) {
    // Sin fuentes fechadas solo sabemos cuándo se consultaron los datos, no de dónde.
    lines.push({kind: 'consulted', label: 'Datos consultados', from: lastVerified, to: lastVerified})
  }
  return lines
}

export interface DescriptionSection {
  title: string
  paragraphs: string[]
  items: string[]
}

export const OVERVIEW_TITLE = 'Qué encontrarás'
const HIGHLIGHTS_TITLE = /^lo más destacado$/i

/**
 * Agrupa el cuerpo por sus encabezados sin repetir texto. Si solo hay un hecho además de la
 * presentación, se muestra una única sección: la lista de destacados solo lo repetiría.
 */
export function descriptionSections(blocks: readonly DescriptionBlock[]): DescriptionSection[] {
  const sections: DescriptionSection[] = [{title: OVERVIEW_TITLE, paragraphs: [], items: []}]
  const seen = new Set<string>()
  for (const block of blocks) {
    const text = block.text.trim()
    if (!text) continue
    if (/^h[2-4]$/.test(block.style ?? '')) {
      sections.push({title: text, paragraphs: [], items: []})
      continue
    }
    const key = normalize(text)
    if (seen.has(key)) continue
    seen.add(key)
    const current = sections.at(-1)!
    if (block.listItem) current.items.push(text)
    else current.paragraphs.push(text)
  }

  const filled = sections.filter((section) => section.paragraphs.length > 0 || section.items.length > 0)
  const facts = filled.filter((section) => section.title !== OVERVIEW_TITLE && !HIGHLIGHTS_TITLE.test(section.title))
  if (facts.length > 1) return filled
  const kept = filled.filter((section) => !HIGHLIGHTS_TITLE.test(section.title))
  if (kept.length === 0) return filled
  return [{title: OVERVIEW_TITLE, paragraphs: kept.flatMap((section) => section.paragraphs), items: kept.flatMap((section) => section.items)}]
}

function range(sources: ReadonlyArray<{accessedAt: string}>): {from: string; to: string} {
  const dates = sources.map((source) => source.accessedAt.slice(0, 10)).sort()
  return {from: dates[0]!, to: dates.at(-1)!}
}

function joinSpanish(parts: readonly string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`
}

function normalize(text: string): string {
  return text.toLocaleLowerCase('es').replace(/[.\s]+/g, ' ').trim()
}
