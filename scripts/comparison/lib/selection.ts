import {resolve} from 'node:path'
import {readJsonIfExists, loadJsonDirectory} from '../../content/lib/files'
import {evaluateBusinessQualityTier} from '../../content/lib/quality'
import type {ContentManifest, EnrichedEntity, QualityTier} from '../../content/lib/types'
import {
  classifyTopicMatch, comparePotentialCandidates, compareScores, legacyEvidenceLabel,
  potentialCandidateScore, scoreBusiness,
} from './scoring'
import {topicConfig} from './topic-config'
import type {ComparisonCandidate, ComparisonCandidateArtifact, ComparisonOptions, ExcludedCandidate} from './types'

export async function selectComparisonCandidates(
  options: ComparisonOptions,
  root = process.cwd(),
  now = new Date().toISOString(),
): Promise<ComparisonCandidateArtifact> {
  const topic = options.topic!
  const id = options.id!
  const config = topicConfig(topic)
  const enrichedFiles = await loadJsonDirectory<EnrichedEntity>(resolve(root, 'content/enriched'))
  const manifest = await readJsonIfExists<ContentManifest>(resolve(root, 'content/manifest.json'), {version: 1, updatedAt: null, entries: []})
  const manifestById = new Map(manifest.entries.map((entry) => [entry.id, entry]))
  const excluded: ExcludedCandidate[] = []
  const direct: ComparisonCandidate[] = []
  const potential: ComparisonCandidate[] = []

  for (const {value: entity} of enrichedFiles) {
    const assessment = evaluateBusinessQualityTier(entity.facts)
    const qualityTier: QualityTier = manifestById.get(entity.id)?.qualityTier === 'insufficient' ? 'insufficient' : assessment.tier
    if (!hasMinimumIdentity(entity)) {
      excluded.push({
        businessId: entity.id, reason: 'missing-identity', qualityTier,
        details: ['Identidad o ubicación sin provenance mínima para investigar el Business.'],
      })
      continue
    }

    const match = classifyTopicMatch(entity, topic)
    if (match.matchType === 'excluded') {
      excluded.push({
        businessId: entity.id, reason: 'not-relevant', qualityTier,
        details: [`Sin evidence directa ni señales de apoyo para topic=${topic}`],
      })
      continue
    }

    const scores = scoreBusiness(entity, topic)
    const candidate: ComparisonCandidate = {
      businessId: entity.id,
      qualityTier,
      matchType: match.matchType,
      evidence: match.evidence,
      topicEvidence: match.evidence.filter((item) => item.strength === 'direct').map(legacyEvidenceLabel),
      scores,
      ...(match.matchType === 'potential'
        ? {potentialScore: potentialCandidateScore(entity, qualityTier, match.evidence)}
        : {}),
    }
    if (match.matchType === 'direct') direct.push(candidate)
    else potential.push(candidate)
  }

  direct.sort(compareScores)
  potential.sort(comparePotentialCandidates)
  const directLimit = options.limit ?? config.maxDirectCandidates
  const potentialLimit = config.maxPotentialCandidates
  for (const candidate of direct.slice(directLimit)) excluded.push({
    businessId: candidate.businessId, reason: 'outside-limit', qualityTier: candidate.qualityTier,
    ...(candidate.evidence ? {evidence: candidate.evidence} : {}),
    details: [`Direct candidate fuera del límite ${directLimit} tras el orden determinista.`],
  })
  for (const candidate of potential.slice(potentialLimit)) excluded.push({
    businessId: candidate.businessId, reason: 'outside-potential-limit', qualityTier: candidate.qualityTier,
    ...(candidate.evidence ? {evidence: candidate.evidence} : {}),
    ...(candidate.potentialScore ? {potentialScore: candidate.potentialScore} : {}),
    details: [`Potential candidate fuera del límite de investigación ${potentialLimit}.`],
  })

  const selectedDirect = direct.slice(0, directLimit)
  const selectedPotential = potential.slice(0, potentialLimit)
  const candidates = [...selectedDirect, ...selectedPotential]
  return {
    schemaVersion: 2,
    id,
    topic,
    searchIntent: config.searchIntent,
    slug: topic,
    generatedAt: now,
    candidateCount: candidates.length,
    summary: {
      considered: enrichedFiles.length,
      direct: selectedDirect.length,
      potential: selectedPotential.length,
      excluded: excluded.length,
      insufficient: candidates.filter((candidate) => candidate.qualityTier === 'insufficient').length
        + excluded.filter((candidate) => candidate.qualityTier === 'insufficient').length,
    },
    candidates,
    excluded,
  }
}

function hasMinimumIdentity(entity: EnrichedEntity): boolean {
  const sourced = (field: 'name' | 'address' | 'location') => entity.facts[field].value !== null && entity.facts[field].sources.length > 0
  return sourced('name') && (sourced('address') || sourced('location'))
}
