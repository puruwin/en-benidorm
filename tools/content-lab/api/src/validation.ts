import type {PipelinePhase} from '../../shared/types'

export const TOPIC_PATTERN = /^[a-z0-9][a-z0-9-]*$/
export const PHASES = ['selection', 'enrichment', 'generation', 'qa'] as const

export function validateTopic(value: unknown): string {
  if (typeof value !== 'string' || !TOPIC_PATTERN.test(value)) {
    throw new Error('Topic inválido. Usa minúsculas, números y guiones.')
  }
  return value
}

export function validatePhase(value: unknown): PipelinePhase {
  if (typeof value !== 'string' || !PHASES.includes(value as PipelinePhase)) throw new Error('Fase no soportada.')
  return value as PipelinePhase
}

export function parseRunOptions(value: unknown): {limit?: number; force?: boolean; dryRun?: boolean} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  const allowed = new Set(['limit', 'force', 'dryRun'])
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`Opción no permitida: ${key}`)
  const result: {limit?: number; force?: boolean; dryRun?: boolean} = {}
  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > 100) throw new Error('limit debe ser un entero entre 1 y 100.')
    result.limit = input.limit as number
  }
  if (input.force !== undefined) {
    if (typeof input.force !== 'boolean') throw new Error('force debe ser boolean.')
    result.force = input.force
  }
  if (input.dryRun !== undefined) {
    if (typeof input.dryRun !== 'boolean') throw new Error('dryRun debe ser boolean.')
    result.dryRun = input.dryRun
  }
  return result
}

