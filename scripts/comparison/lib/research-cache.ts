import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {readJsonIfExists, writeJsonAtomic} from '../../content/lib/files'
import type {ComparisonResearchBundle} from './research'

export interface ResearchCacheEntry {
  schemaVersion: 1
  fingerprint: string
  storedAt: string
  bundle: ComparisonResearchBundle
}

export interface ResearchResultCache {
  load(fingerprint: string, now: string, ttlDays: number): Promise<ComparisonResearchBundle | null>
  save(fingerprint: string, now: string, bundle: ComparisonResearchBundle): Promise<void>
}

export class FileResearchResultCache implements ResearchResultCache {
  constructor(private readonly directory: string) {}

  async load(fingerprint: string, now: string, ttlDays: number): Promise<ComparisonResearchBundle | null> {
    const entry = await readJsonIfExists<ResearchCacheEntry | null>(this.path(fingerprint), null)
    if (!entry || entry.schemaVersion !== 1 || entry.fingerprint !== fingerprint) return null
    const age = new Date(now).getTime() - new Date(entry.storedAt).getTime()
    if (!Number.isFinite(age) || age < 0 || age > ttlDays * 86_400_000) return null
    return structuredClone(entry.bundle)
  }

  async save(fingerprint: string, now: string, bundle: ComparisonResearchBundle): Promise<void> {
    await writeJsonAtomic(this.path(fingerprint), {schemaVersion: 1, fingerprint, storedAt: now, bundle} satisfies ResearchCacheEntry)
  }

  private path(fingerprint: string): string { return resolve(this.directory, `${fingerprint}.json`) }
}

export function researchFingerprint(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value)
}
