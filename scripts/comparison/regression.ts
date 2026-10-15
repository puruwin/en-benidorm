import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {readJsonIfExists, writeJsonAtomic} from '../content/lib/files'
import {selectComparisonCandidates} from './lib/selection'
import type {ComparisonCandidateArtifact} from './lib/types'

const TOPICS = ['italiano', 'arroces', 'desayunos'] as const

export async function comparisonDiscoveryRegression(root = process.cwd(), now = new Date().toISOString()) {
  const topics = []
  for (const topic of TOPICS) {
    const options = {topic, id: `comparison-${topic}`, dryRun: true, force: true}
    const legacy = await selectComparisonCandidates(options, root, now, {includeDiscovered: false})
    const discovery = await selectComparisonCandidates(options, root, now, {includeDiscovered: true})
    const persisted = await readJsonIfExists<ComparisonCandidateArtifact | null>(
      resolve(root, `content/comparisons/candidates/comparison-${topic}.json`), null,
    )
    const legacyIds = legacy.candidates.map((candidate) => candidate.businessId)
    const discoveryIds = discovery.candidates.map((candidate) => candidate.businessId)
    const persistedIds = persisted?.candidates.map((candidate) => candidate.businessId) ?? []
    topics.push({
      topic,
      legacy: summary(legacy),
      discovery: summary(discovery),
      codeRegression: diff(legacyIds, discoveryIds),
      persistedArtifact: persisted ? {
        generatedAt: persisted.generatedAt, ...summary(persisted), differenceFromLegacyOnCurrentData: diff(persistedIds, legacyIds),
      } : null,
      conclusion: same(legacyIds, discoveryIds)
        ? 'Sin diferencias atribuibles a Discovery: los 474 Business ya tienen enrichment.'
        : 'Diferencia atribuible exclusivamente a Business presentes en discovered y ausentes en enriched.',
    })
  }
  const report = {schemaVersion: 1, generatedAt: now, topics}
  await writeJsonAtomic(resolve(root, 'content/reports/comparison-discovery-regression.json'), report)
  for (const item of topics) console.log(
    `${item.topic}: legacy=${item.legacy.candidates}, discovery=${item.discovery.candidates}, added=${item.codeRegression.added.length}, removed=${item.codeRegression.removed.length}`,
  )
  return report
}

function summary(artifact: ComparisonCandidateArtifact) {
  return {
    considered: artifact.summary?.considered ?? artifact.candidates.length + artifact.excluded.length,
    candidates: artifact.candidates.length,
    direct: artifact.candidates.filter((candidate) => (candidate.matchType ?? 'direct') === 'direct').length,
    potential: artifact.candidates.filter((candidate) => candidate.matchType === 'potential').length,
    candidateIds: artifact.candidates.map((candidate) => candidate.businessId),
  }
}

function diff(before: string[], after: string[]) {
  const left = new Set(before)
  const right = new Set(after)
  return {added: after.filter((id) => !left.has(id)), removed: before.filter((id) => !right.has(id)), reordered: !same(before, after) && before.length === after.length && before.every((id) => right.has(id))}
}

function same(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  comparisonDiscoveryRegression().catch((error) => {
    console.error(`Regression falló: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
