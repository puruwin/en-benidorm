import type {PipelinePhase} from '../../shared/types'
import {validateActor, validateImageCategory, validateImageDoc, validateImageRadius, validateImageSlug, validateImageTerm, validatePhase, validatePlanHash, validateTopic} from './validation'

const SCRIPTS: Record<PipelinePhase, string> = {
  selection: 'comparison:select',
  enrichment: 'comparison:enrich',
  generation: 'comparison:generate',
  qa: 'comparison:qa',
}

export interface CommandOptions {limit?: number; force?: boolean; dryRun?: boolean}

export function buildCommand(topicInput: unknown, phaseInput: unknown, options: CommandOptions = {}): {command: string; args: string[]; display: string} {
  const topic = validateTopic(topicInput)
  const phase = validatePhase(phaseInput)
  const args = ['run', SCRIPTS[phase], '--', '--topic', topic]
  if (options.limit !== undefined) args.push('--limit', String(options.limit))
  if (options.force) args.push('--force')
  if (options.dryRun) args.push('--dry-run')
  return {command: 'npm', args, display: ['npm', ...args].join(' ')}
}

export type ImagesAction = 'find' | 'import'
export interface ImagesFindInput {action: 'find'; doc?: string; term?: string; category?: string; radius?: number}
export interface ImagesImportInput {action: 'import'; slug: string; write?: boolean; by?: string; expectPlan?: string}

const IMAGE_SCRIPTS: Record<ImagesAction, string> = {
  find: 'scripts/images/find-candidates.ts',
  import: 'scripts/images/import-approved.ts',
}
const IMAGE_KEYS: Record<ImagesAction, Set<string>> = {
  find: new Set(['action', 'doc', 'term', 'category', 'radius']),
  import: new Set(['action', 'slug', 'write', 'by', 'expectPlan']),
}

// Lanza node directamente (como los scripts de package.json) y no `npm run`, que pasa el argv por `sh -c`.
// Los valores van siempre como `--opcion=valor`: un valor nunca puede leerse como otra bandera.
export function buildImagesCommand(input: unknown): {command: string; args: string[]; display: string; label: string} {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Petición de imágenes inválida.')
  const values = input as Record<string, unknown>
  const action = values.action
  if (action !== 'find' && action !== 'import') throw new Error('Acción de imágenes no soportada.')
  for (const key of Object.keys(values)) if (!IMAGE_KEYS[action].has(key)) throw new Error(`Opción no permitida: ${key}`)
  const flags: string[] = []
  let label: string
  if (action === 'find') {
    if ((values.doc === undefined) === (values.term === undefined)) throw new Error('Usa doc o term, no los dos.')
    if (values.doc !== undefined) flags.push(`--doc=${validateImageDoc(values.doc)}`)
    else flags.push(`--term=${validateImageTerm(values.term)}`)
    if (values.category !== undefined) flags.push(`--category=${validateImageCategory(values.category)}`)
    if (values.radius !== undefined) flags.push(`--radius=${validateImageRadius(values.radius)}`)
    label = `images:find ${values.doc !== undefined ? values.doc : `«${validateImageTerm(values.term)}»`}`
  } else {
    const slug = validateImageSlug(values.slug)
    if (values.write !== undefined && typeof values.write !== 'boolean') throw new Error('write debe ser boolean.')
    flags.push(`content/images/candidates/${slug}.json`)
    if (values.write) {
      if (values.by === undefined || values.expectPlan === undefined) throw new Error('Importar exige by y expectPlan.')
      flags.push('--write')
    }
    if (values.by !== undefined) flags.push(`--by=${validateActor(values.by)}`)
    if (values.expectPlan !== undefined) flags.push(`--expect-plan=${validatePlanHash(values.expectPlan)}`)
    label = `images:import ${slug}${values.write ? '' : ' (simulación)'}`
  }
  const args = ['--import', 'tsx', IMAGE_SCRIPTS[action], ...flags]
  return {command: process.execPath, args, display: ['node', ...args].join(' '), label}
}

const BASE_ENV = ['PATH', 'HOME', 'TZ', 'SANITY_PROJECT_ID', 'SANITY_DATASET']

/** Entorno del hijo con lista cerrada. Nunca `OPENAI_*` ni el `SANITY_API_TOKEN` general. */
export function buildImagesEnv(action: ImagesAction, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  const copy = (key: string) => { if (source[key] !== undefined) env[key] = source[key] }
  for (const key of BASE_ENV) copy(key)
  for (const key of Object.keys(source)) if (key.startsWith('NODE_')) copy(key)
  if (action === 'find') { copy('PIXABAY_API_KEY'); copy('PEXELS_API_KEY') }
  if (action === 'import' && source.SANITY_IMAGES_TOKEN) env.SANITY_API_TOKEN = source.SANITY_IMAGES_TOKEN
  // scripts/sanity-client.ts no lee .env con este marcador: si no, en local volverían las claves excluidas.
  env.CONTENT_LAB_CLOSED_ENV = '1'
  return env
}
