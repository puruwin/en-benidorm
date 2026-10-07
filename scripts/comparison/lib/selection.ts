import {resolve} from 'node:path'
import {readJsonIfExists, loadJsonDirectory} from '../../content/lib/files'
import {evaluateBusinessQualityTier} from '../../content/lib/quality'
import type {ContentManifest, EnrichedEntity} from '../../content/lib/types'
import {compareScores, scoreBusiness, topicEvidence} from './scoring'
import type {ComparisonCandidateArtifact, ComparisonOptions, ExcludedCandidate} from './types'

const SEARCH_INTENTS: Readonly<Record<string, string>> = {
  italiano: 'elegir restaurante italiano en Benidorm',
  arroces: 'elegir dónde comer arroz en Benidorm',
}

export async function selectComparisonCandidates(
  options: ComparisonOptions,
  root = process.cwd(),
  now = new Date().toISOString(),
): Promise<ComparisonCandidateArtifact> {
  const topic = options.topic!
  const id = options.id!
  const enrichedFiles = await loadJsonDirectory<EnrichedEntity>(resolve(root, 'content/enriched'))
  const manifest = await readJsonIfExists<ContentManifest>(resolve(root, 'content/manifest.json'), {version: 1, updatedAt: null, entries: []})
  const manifestById = new Map(manifest.entries.map((entry) => [entry.id, entry]))
  const excluded: ExcludedCandidate[] = []
  const candidates = enrichedFiles.flatMap(({value: entity}) => {
    const assessment = evaluateBusinessQualityTier(entity.facts)
    const manifestTier = manifestById.get(entity.id)?.qualityTier
    if (assessment.tier === 'insufficient' || manifestTier === 'insufficient') {
      excluded.push({businessId: entity.id, reason: 'insufficient', details: assessment.reasons})
      return []
    }
    const evidence = topicEvidence(entity, topic)
    if (evidence.length === 0) {
      excluded.push({businessId: entity.id, reason: 'not-relevant', details: [`Sin evidence verificable para topic=${topic}`]})
      return []
    }
    return [{businessId: entity.id, qualityTier: assessment.tier, topicEvidence: evidence, scores: scoreBusiness(entity, topic)}]
  }).sort(compareScores)
  const limit = options.limit ?? 8
  for (const candidate of candidates.slice(limit)) excluded.push({
    businessId: candidate.businessId,
    reason: 'outside-limit',
    details: [`Quedó fuera del límite ${limit} tras el orden determinista.`],
  })
  const selected = candidates.slice(0, limit)
  return {schemaVersion: 1, id, topic, searchIntent: searchIntentFor(topic), slug: topic, generatedAt: now, candidateCount: selected.length, candidates: selected, excluded}
}

function searchIntentFor(topic: string): string {
  return SEARCH_INTENTS[topic] ?? `elegir ${topic} en Benidorm`
}
