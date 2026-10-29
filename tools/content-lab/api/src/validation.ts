import type {PipelinePhase} from '../../shared/types'

export const TOPIC_PATTERN = /^[a-z0-9][a-z0-9-]*$/
export const PHASES = ['selection', 'enrichment', 'generation', 'qa'] as const

export function validateTopic(value: unknown): string {
  if (typeof value !== 'string' || !TOPIC_PATTERN.test(value)) {
    throw new Error('Topic inválido. Usa minúsculas, números y guiones.')
  }
  return value
}

export function validateBusinessId(value: unknown): string {
  if (typeof value !== 'string' || !/^business-[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error('Business ID inválido.')
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

export const IMAGE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}$/

export function validateImageDoc(value: unknown): string {
  if (typeof value === 'string' && value.startsWith('business:')) throw new Error('Las fichas de negocio no admiten imágenes de stock: solo fotos propias.')
  if (typeof value !== 'string' || !/^(place|area|beach|article):[a-z0-9][a-z0-9-]{0,100}$/.test(value)) throw new Error('Documento inválido. Usa place|area|beach|article:<slug>.')
  return value
}

export function validateImageTerm(value: unknown): string {
  const term = typeof value === 'string' ? value.trim() : ''
  // El primer carácter no puede ser «-»: el término nunca debe parecer una bandera.
  if (term.length < 2 || term.length > 100 || !/^[\p{L}\p{N}][\p{L}\p{N} .,'-]*$/u.test(term)) throw new Error('Término inválido. Usa 2–100 letras, números, espacios y . , \' -')
  return term
}

export function validateImageCategory(value: unknown): string {
  if (typeof value !== 'string' || !/^Category:[^\n\r|#<>[\]{}]{1,200}$/.test(value)) throw new Error('Categoría inválida. Debe empezar por «Category:».')
  return value
}

export function validateImageRadius(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 50 || (value as number) > 5000) throw new Error('radius debe ser un entero entre 50 y 5000.')
  return value as number
}

export function validateImageSlug(value: unknown): string {
  if (typeof value !== 'string' || !IMAGE_SLUG_PATTERN.test(value)) throw new Error('Slug de candidatas inválido.')
  return value
}

export function validateActor(value: unknown): string {
  if (typeof value !== 'string' || !/^\w[\w.@-]{0,99}$/.test(value)) throw new Error('Usuario inválido.')
  return value
}

export function validatePlanHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Hash de plan inválido.')
  return value
}
