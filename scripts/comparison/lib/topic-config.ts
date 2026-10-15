import type {BusinessKind} from '../../content/lib/types'
import type {EvidenceCategory} from './types'

export interface ComparisonTopicConfigInput {
  topic: string
  displayName?: string
  searchIntent?: string
  /** Legacy topic terms. They become directEvidence when the latter is omitted. */
  aliases?: readonly string[]
  directEvidence?: readonly string[]
  supportingEvidence?: readonly string[]
  compatibleBusinessKinds?: readonly BusinessKind[]
  researchHints?: readonly string[]
  researchDimensions?: readonly EvidenceCategory[]
  researchHintsByDimension?: Partial<Record<EvidenceCategory, readonly string[]>>
  researchEvidenceCategory?: EvidenceCategory
  supportingEvidenceCategory?: EvidenceCategory
  maxResearchPages?: number
  maxResearchDepth?: number
  researchTimeoutMs?: number
  researchCacheTtlDays?: number
  maxDirectCandidates?: number
  maxPotentialCandidates?: number
}

export interface ComparisonTopicConfig {
  topic: string
  displayName: string
  searchIntent: string
  directEvidence: readonly string[]
  supportingEvidence: readonly string[]
  compatibleBusinessKinds: readonly BusinessKind[]
  researchHints: readonly string[]
  researchDimensions: readonly EvidenceCategory[]
  researchHintsByDimension: Partial<Record<EvidenceCategory, readonly string[]>>
  researchEvidenceCategory: EvidenceCategory
  supportingEvidenceCategory: EvidenceCategory
  maxResearchPages: number
  maxResearchDepth: number
  researchTimeoutMs: number
  researchCacheTtlDays: number
  maxDirectCandidates: number
  maxPotentialCandidates: number
}

const TOPICS: Readonly<Record<string, ComparisonTopicConfigInput>> = {
  italiano: {
    topic: 'italiano',
    displayName: 'Italiano',
    searchIntent: 'elegir restaurante italiano en Benidorm',
    directEvidence: ['italiana', 'italianas', 'italiano', 'italianos', 'italian'],
  },
  sushi: {
    topic: 'sushi',
    displayName: 'Sushi',
    aliases: ['sushi', 'japonesa', 'japonesas', 'japonés', 'japoneses', 'japanese'],
  },
  arroces: {
    topic: 'arroces',
    displayName: 'Arroces',
    searchIntent: 'elegir dónde comer arroz en Benidorm',
    directEvidence: [
      'arroz', 'arroces', 'paella', 'paellas', 'arroz a banda', 'arroz negro',
      'fideuà', 'arroz meloso', 'arroz caldoso',
    ],
  },
  desayunos: {
    topic: 'desayunos',
    displayName: 'Desayunos',
    searchIntent: 'elegir dónde desayunar en Benidorm',
    directEvidence: [
      'desayuno', 'desayunos', 'breakfast', 'brunch', 'breakfast menu',
      'full english breakfast', 'continental breakfast',
    ],
    supportingEvidence: [
      'tostada', 'tostadas', 'croissant', 'croissants', 'bollería', 'pancakes', 'waffles',
      'eggs benedict',
    ],
    compatibleBusinessKinds: ['cafe'],
    researchHints: ['breakfast', 'brunch', 'desayuno', 'desayunos', 'menu', 'menú', 'carta'],
    researchEvidenceCategory: 'services',
    supportingEvidenceCategory: 'featuredItems',
    maxResearchPages: 6,
    maxPotentialCandidates: 25,
  },
}

export function normalizeTopicConfig(input: ComparisonTopicConfigInput): ComparisonTopicConfig {
  const researchEvidenceCategory = input.researchEvidenceCategory ?? 'specialties'
  const supportingEvidenceCategory = input.supportingEvidenceCategory ?? 'specialties'
  return {
    topic: input.topic,
    displayName: input.displayName ?? title(input.topic),
    searchIntent: input.searchIntent ?? `elegir ${input.topic} en Benidorm`,
    directEvidence: unique(input.directEvidence ?? input.aliases ?? [input.topic]),
    supportingEvidence: unique(input.supportingEvidence ?? []),
    compatibleBusinessKinds: [...new Set(input.compatibleBusinessKinds ?? [])],
    researchHints: unique(input.researchHints ?? []),
    researchDimensions: uniqueDimensions([...(input.researchDimensions ?? ['cuisine', 'specialties', 'services', 'location', 'practical']), researchEvidenceCategory, supportingEvidenceCategory]),
    researchHintsByDimension: Object.fromEntries(Object.entries(input.researchHintsByDimension ?? {}).map(([dimension, hints]) => [dimension, unique(hints ?? [])])),
    researchEvidenceCategory,
    supportingEvidenceCategory,
    maxResearchPages: input.maxResearchPages ?? 6,
    maxResearchDepth: input.maxResearchDepth ?? 1,
    researchTimeoutMs: input.researchTimeoutMs ?? 12_000,
    researchCacheTtlDays: input.researchCacheTtlDays ?? 30,
    maxDirectCandidates: input.maxDirectCandidates ?? 8,
    maxPotentialCandidates: input.maxPotentialCandidates ?? 0,
  }
}

export function topicConfig(topic: string): ComparisonTopicConfig {
  return normalizeTopicConfig(TOPICS[topic] ?? {topic})
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function uniqueDimensions(values: readonly EvidenceCategory[]): EvidenceCategory[] {
  return [...new Set(values)]
}

function title(value: string): string {
  return value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}
