import {readdir, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {loadEnvFile} from 'node:process'
import type {ContentDocument} from '../content-validation'
import {readJson, writeJsonAtomic} from './lib/files'
import type {EnrichedEntity, GeneratedBusinessArtifact, PhaseReport} from './lib/types'

interface TextSnapshot {
  shortDescription: unknown
  body: string[]
  seo: unknown
}

export async function createComparisonReport(beforeDirectory: string, beforeQaPath: string, root = process.cwd()): Promise<void> {
  try { loadEnvFile(resolve(root, '.env')) } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const beforeQa = await readJson<PhaseReport>(beforeQaPath)
  const afterQa = await readJson<PhaseReport>(resolve(root, 'content/reports/qa.json'))
  const names = (await readdir(beforeDirectory)).filter((name) => name.endsWith('.json')).sort()
  const entries = await Promise.all(names.map(async (name) => {
    const before = await readJson<ContentDocument>(resolve(beforeDirectory, name))
    const enriched = await readJson<EnrichedEntity>(resolve(root, 'content/enriched', name))
    const artifact = await readJson<GeneratedBusinessArtifact>(resolve(root, 'content/generated/.staging/businesses', name))
    return {
      id: before._id,
      facts: {
        openStreetMap: presentFacts(enriched.factsBySource.openStreetMap),
        officialWebsite: presentFacts(enriched.factsBySource.officialWebsite),
      },
      provenance: {
        openStreetMap: enriched.sources.filter((source) => source.provider === 'openstreetmap'),
        officialWebsite: enriched.sources.filter((source) => source.provider === 'official-website'),
      },
      before: textSnapshot(before),
      previousContentQuality: before.contentQuality ?? null,
      qualityTier: artifact.qualityTier,
      after: textSnapshot(artifact.document as ContentDocument | null),
      qaBefore: beforeQa.items.find((item) => item.id === before._id) ?? null,
      qaAfter: afterQa.items.find((item) => item.id === before._id) ?? null,
    }
  }))
  const report = {
    generatedAt: new Date().toISOString(),
    sampleIds: entries.map((entry) => entry.id),
    model: process.env.OPENAI_CONTENT_MODEL ?? 'configured in .env',
    summary: {
      before: beforeQa.totals,
      after: afterQa.totals,
      qualityTier: Object.fromEntries(['rich', 'basic', 'insufficient'].map((tier) => [tier, entries.filter((entry) => entry.qualityTier === tier).length])),
      officialWebsiteReached: entries.filter((entry) => entry.provenance.officialWebsite.length > 0).length,
      officialWebsiteWithFacts: entries.filter((entry) => Object.keys(entry.facts.officialWebsite).length > 0).length,
    },
    entries,
  }
  await writeJsonAtomic(resolve(root, 'content/reports/business-before-after.json'), report)
  await writeFile(resolve(root, 'content/reports/business-before-after.md'), markdown(report), 'utf8')
}

function presentFacts(facts: object): Record<string, unknown> {
  const entries = Object.entries(facts) as Array<[string, {value: unknown; sources: string[]}]>
  return Object.fromEntries(entries.filter(([, fact]) => fact.value !== null).map(([field, fact]) => [field, fact]))
}

function textSnapshot(document: ContentDocument | null): TextSnapshot {
  if (!document) return {shortDescription: null, body: [], seo: null}
  return {
    shortDescription: document.shortDescription ?? null,
    body: Array.isArray(document.body) ? document.body.flatMap((block) => {
      if (!isRecord(block) || !Array.isArray(block.children)) return []
      const text = block.children.flatMap((child) => isRecord(child) && typeof child.text === 'string' ? [child.text] : []).join('')
      return text ? [text] : []
    }) : [],
    seo: document.seo ?? null,
  }
}

function markdown(report: {generatedAt: string; summary: unknown; entries: Array<Record<string, unknown>>}): string {
  const lines = ['# Comparativa Business: before / after', '', `Generado: ${report.generatedAt}`, '', '## Resumen', '', '```json', JSON.stringify(report.summary, null, 2), '```', '']
  for (const raw of report.entries) {
    const entry = raw as {id: string; facts: unknown; provenance: unknown; before: TextSnapshot; after: TextSnapshot; qaBefore: unknown; qaAfter: unknown}
    lines.push(`## ${entry.id}`, '', '### Facts OSM / web oficial', '', '```json', JSON.stringify({facts: entry.facts, provenance: entry.provenance}, null, 2), '```', '')
    lines.push('### Texto anterior', '', textForMarkdown(entry.before), '', '### Texto nuevo', '', textForMarkdown(entry.after), '')
    lines.push('### QA anterior / nuevo', '', '```json', JSON.stringify({before: entry.qaBefore, after: entry.qaAfter}, null, 2), '```', '')
  }
  return `${lines.join('\n')}\n`
}

function textForMarkdown(snapshot: TextSnapshot): string {
  return ['```json', JSON.stringify(snapshot, null, 2), '```'].join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function main(): Promise<void> {
  const before = process.argv.find((argument) => argument.startsWith('--before='))?.slice('--before='.length)
  const beforeQa = process.argv.find((argument) => argument.startsWith('--before-qa='))?.slice('--before-qa='.length)
  if (!before || !beforeQa) throw new Error('Uso: --before=<directorio> --before-qa=<qa.json>')
  await createComparisonReport(before, beforeQa)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
