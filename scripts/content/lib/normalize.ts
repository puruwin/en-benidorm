import {createHash} from 'node:crypto'

export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function slugify(value: string): string {
  return normalizeText(value).replace(/ /g, '-').replace(/^-+|-+$/g, '') || 'sin-nombre'
}

export function deterministicBusinessId(slug: string): string {
  return `business-${slug}`
}

export function sourceKey(provider: string, identifier: string): string {
  return `${provider}:${identifier}`
}

export function shortHash(value: string, length = 8): string {
  return createHash('sha1').update(value).digest('hex').slice(0, length)
}

export function uniqueSlug(base: string, used: ReadonlySet<string>, discriminator: string): string {
  if (!used.has(base)) return base
  return `${base}-${shortHash(discriminator, 6)}`
}

export function entityFingerprint(value: {
  type: string
  name: string
  latitude: number | null
  longitude: number | null
}): string {
  const coordinates = value.latitude === null || value.longitude === null
    ? 'unknown'
    : `${value.latitude.toFixed(4)},${value.longitude.toFixed(4)}`
  return `${value.type}:${normalizeText(value.name)}:${coordinates}`
}

export function deduplicateBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    const value = key(item)
    if (seen.has(value)) continue
    seen.add(value)
    unique.push(item)
  }
  return unique
}
