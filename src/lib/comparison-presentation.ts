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
    if (!group.some((item) => item.url === source.url)) group.push({...source, label: publicSourceLabel(source)})
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
