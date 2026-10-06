import {writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import type {ContentDocument} from '../content-validation'
import {loadJsonDirectory, readJson, writeJsonAtomic} from './lib/files'
import type {GeneratedBusinessArtifact, PhaseReport} from './lib/types'

interface PreviousReport { entries: Array<{id: string; after?: {contentQuality?: 'sufficient' | 'insufficient'}}> }

export async function createQualityTierComparison(root = process.cwd()): Promise<void> {
  const previous = await readJson<PreviousReport>(resolve(root, 'content/reports/business-before-after.json'))
  const qa = await readJson<PhaseReport>(resolve(root, 'content/reports/qa.json'))
  const artifacts = await loadJsonDirectory<GeneratedBusinessArtifact>(resolve(root, 'content/generated/.staging/businesses'))
  const previousTier = new Map(previous.entries.map((entry) => [entry.id, entry.after?.contentQuality ?? 'insufficient']))
  const entries = artifacts.map(({value}) => {
    const qaItem = qa.items.find((item) => item.id === value.id)
    return {
      id: value.id,
      distinctiveFacts: value.qualityAssessment.distinctiveFacts,
      previousTier: previousTier.get(value.id) ?? 'insufficient',
      qualityTier: value.qualityTier,
      reasons: value.qualityAssessment.reasons,
      generationExecuted: !value.generationSkipped,
      generatedContent: snapshot(value.document as ContentDocument | null),
      qaOutcome: qaItem?.outcome ?? null,
      issues: qaItem?.issues ?? [],
      missingUsefulFacts: value.qualityAssessment.missingUsefulFacts,
    }
  }).sort((a, b) => a.id.localeCompare(b.id))
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      total: entries.length,
      before: Object.fromEntries(['sufficient', 'insufficient'].map((tier) => [tier, entries.filter((entry) => entry.previousTier === tier).length])),
      now: Object.fromEntries(['rich', 'basic', 'insufficient'].map((tier) => [tier, entries.filter((entry) => entry.qualityTier === tier).length])),
      generationSkipped: entries.filter((entry) => !entry.generationExecuted).length,
      qa: Object.fromEntries(['PASS', 'WARNING', 'FAIL', 'SKIPPED'].map((outcome) => [outcome, entries.filter((entry) => entry.qaOutcome === outcome).length])),
    },
    entries,
  }
  await writeJsonAtomic(resolve(root, 'content/reports/business-quality-tier-comparison.json'), report)
  await writeFile(resolve(root, 'content/reports/business-quality-tier-comparison.md'), markdown(report), 'utf8')
}

function snapshot(document: ContentDocument | null): unknown {
  if (!document) return null
  return {
    shortDescription: document.shortDescription ?? null,
    body: Array.isArray(document.body) ? document.body.flatMap((block) => {
      if (!isRecord(block) || !Array.isArray(block.children)) return []
      const text = block.children.flatMap((child) => isRecord(child) && typeof child.text === 'string' ? [child.text] : []).join('')
      return text ? [text] : []
    }) : [],
    highlights: bodyHighlights(document),
    seo: document.seo ?? null,
  }
}

function bodyHighlights(document: ContentDocument): string[] {
  if (!Array.isArray(document.body)) return []
  return document.body.flatMap((block) => isRecord(block) && block.listItem === 'bullet' && Array.isArray(block.children)
    ? block.children.flatMap((child) => isRecord(child) && typeof child.text === 'string' ? [child.text] : []) : [])
}

function markdown(report: {generatedAt: string; summary: unknown; entries: Array<Record<string, unknown>>}): string {
  const lines = ['# Comparativa de quality tier de Business', '', `Generado: ${report.generatedAt}`, '', '## Summary', '', '```json', JSON.stringify(report.summary, null, 2), '```', '']
  for (const entry of report.entries) {
    lines.push(`## ${String(entry.id)}`, '', '```json', JSON.stringify({
      distinctiveFacts: entry.distinctiveFacts, previousTier: entry.previousTier, qualityTier: entry.qualityTier,
      reasons: entry.reasons, generationExecuted: entry.generationExecuted, generatedContent: entry.generatedContent,
      qaOutcome: entry.qaOutcome, issues: entry.issues, missingUsefulFacts: entry.missingUsefulFacts,
    }, null, 2), '```', '')
  }
  return `${lines.join('\n')}\n`
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await createQualityTierComparison()
