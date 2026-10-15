import {normalizeText} from './normalize'
import type {SourceRecord} from './adapters'
import type {DiscoveredEntity, ProbableDuplicate} from './types'

export function findProbableDuplicates(
  incoming: readonly SourceRecord[],
  existing: readonly DiscoveredEntity[],
): ProbableDuplicate[] {
  const matches: ProbableDuplicate[] = []
  for (const record of incoming) for (const entity of existing) {
    if (record.sources.some((source) => entity.sources.some((candidate) => candidate.key === source.key))) continue
    const incomingProviders = new Set(record.sources.map((source) => source.provider))
    if (entity.sources.some((source) => incomingProviders.has(source.provider))) continue
    const signals: ProbableDuplicate['signals'] = []
    if (nameSimilarity(record.raw.name, entity.raw.name) >= 0.8) signals.push('name')
    const distanceMeters = distance(record.raw.latitude, record.raw.longitude, entity.raw.latitude, entity.raw.longitude)
    if (distanceMeters !== undefined && distanceMeters <= 100) signals.push('proximity')
    if (samePhone(record.raw.tags, entity.raw.tags)) signals.push('phone')
    if (sameDomain(record.raw.tags, entity.raw.tags)) signals.push('domain')
    const strong = (signals.includes('phone') || signals.includes('domain'))
      && (signals.includes('name') || signals.includes('proximity'))
    const probable = signals.includes('name') && signals.includes('proximity')
    if (!strong && !probable) continue
    matches.push({
      incomingSourceKeys: record.sources.map((source) => source.key), existingBusinessId: entity.id,
      confidence: strong ? 'strong' : 'probable', signals,
      ...(distanceMeters !== undefined ? {distanceMeters: Math.round(distanceMeters)} : {}),
    })
  }
  return matches.sort((a, b) => a.existingBusinessId.localeCompare(b.existingBusinessId)
    || a.incomingSourceKeys.join().localeCompare(b.incomingSourceKeys.join()))
}

function nameSimilarity(left: string, right: string): number {
  const a = new Set(normalizeText(left).split(' ').filter(Boolean))
  const b = new Set(normalizeText(right).split(' ').filter(Boolean))
  if (!a.size || !b.size) return 0
  const intersection = [...a].filter((token) => b.has(token)).length
  return intersection / new Set([...a, ...b]).size
}

function samePhone(left: Record<string, string>, right: Record<string, string>): boolean {
  const a = normalizePhone(left['contact:phone'] ?? left.phone)
  const b = normalizePhone(right['contact:phone'] ?? right.phone)
  return Boolean(a && b && a === b)
}

function normalizePhone(value?: string): string | undefined {
  const digits = value?.replace(/\D/g, '')
  return digits && digits.length >= 7 ? digits.slice(-9) : undefined
}

function sameDomain(left: Record<string, string>, right: Record<string, string>): boolean {
  const a = domain(left['contact:website'] ?? left.website)
  const b = domain(right['contact:website'] ?? right.website)
  return Boolean(a && b && a === b)
}

function domain(value?: string): string | undefined {
  if (!value) return undefined
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, '')
  } catch { return undefined }
}

function distance(latA: number | null, lonA: number | null, latB: number | null, lonB: number | null): number | undefined {
  if (latA === null || lonA === null || latB === null || lonB === null) return undefined
  const radians = (degrees: number) => degrees * Math.PI / 180
  const latitude = radians(latB - latA)
  const longitude = radians(lonB - lonA)
  const value = Math.sin(latitude / 2) ** 2
    + Math.cos(radians(latA)) * Math.cos(radians(latB)) * Math.sin(longitude / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}
