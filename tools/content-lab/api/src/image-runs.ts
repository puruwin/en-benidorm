import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import type {PipelineRun} from '../../shared/types'
import type {ImportPlanArtifact} from '../../../../scripts/images/lib/draft-import'
import {buildImagesCommand, buildImagesEnv} from './command-builder'
import {CANDIDATES_DIR, ImageError, imageArtifactPath} from './image-candidates'
import type {RunManager} from './run-manager'
import {validatePlanHash} from './validation'

const PLANS_DIR = 'content/images/plans'
const SEARCH_KEYS = new Set(['doc', 'term', 'category', 'radius'])

function plainObject(input: unknown, allowed: ReadonlySet<string>): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new ImageError(400, 'Cuerpo inválido: se espera un objeto JSON.')
  const values = input as Record<string, unknown>
  for (const key of Object.keys(values)) if (!allowed.has(key)) throw new ImageError(400, `Opción no permitida: ${key}`)
  return values
}

/** Los errores de validación de buildImagesCommand son siempre del body: 400. */
function build(input: Record<string, unknown>) {
  try {return buildImagesCommand(input)} catch (error) {throw new ImageError(400, error instanceof Error ? error.message : String(error))}
}

/**
 * Búsqueda e importación de imágenes como runs. Importar escribe en Sanity (solo borradores) y exige el
 * `planHash` de la última simulación guardada; el script lo vuelve a comprobar con `--expect-plan`.
 */
export class ImageRuns {
  constructor(readonly root: string, private readonly runs: Pick<RunManager, 'startCommand'>, private readonly environment: NodeJS.ProcessEnv = process.env) {}

  search(body: unknown): PipelineRun {
    const values = plainObject(body ?? {}, SEARCH_KEYS)
    const built = build({action: 'find', ...values})
    return this.runs.startCommand({kind: 'images', label: built.label, command: built.command, args: built.args, env: buildImagesEnv('find', this.environment), files: built.files})
  }

  async plan(slug: unknown): Promise<PipelineRun> {
    await this.requireCandidates(slug)
    const built = build({action: 'import', slug, planOut: true})
    return this.runs.startCommand({kind: 'images', label: built.label, command: built.command, args: built.args, env: buildImagesEnv('import', this.environment), files: built.files})
  }

  async import(slug: unknown, body: unknown, actor: string): Promise<PipelineRun> {
    const values = plainObject(body, new Set(['planHash']))
    let planHash: string
    try {planHash = validatePlanHash(values.planHash)} catch {throw new ImageError(400, 'planHash inválido: se espera el sha256 del plan simulado.')}
    await this.requireCandidates(slug)
    // Sin alternativa: SANITY_API_TOKEN es el token general y no entra en este run.
    if (!this.environment.SANITY_IMAGES_TOKEN?.trim()) throw new ImageError(409, 'Falta SANITY_IMAGES_TOKEN: configura el token de imágenes en el servidor.')
    const saved = await this.savedPlan(slug)
    if (saved.planHash !== planHash) throw new ImageError(409, 'El planHash no coincide con el plan simulado guardado. Vuelve a simular.')
    if (saved.issues?.length) throw new ImageError(409, 'El plan simulado tiene errores: corrígelos y vuelve a simular.')
    if (!saved.imports?.length) throw new ImageError(409, 'El plan simulado no tiene nada que importar.')
    const id = randomUUID()
    const built = build({action: 'import', slug, write: true, by: actor, expectPlan: planHash, runId: id})
    return this.runs.startCommand({kind: 'images', label: built.label, command: built.command, args: built.args, env: buildImagesEnv('import', this.environment), files: built.files, id})
  }

  private async requireCandidates(slug: unknown): Promise<void> {
    const path = imageArtifactPath(this.root, CANDIDATES_DIR, slug)
    try {await readFile(resolve(this.root, path))} catch {throw new ImageError(404, 'Fichero de candidatas no encontrado.')}
  }

  private async savedPlan(slug: unknown): Promise<Partial<ImportPlanArtifact>> {
    let raw: string
    try {raw = await readFile(resolve(this.root, imageArtifactPath(this.root, PLANS_DIR, slug)), 'utf8')} catch {throw new ImageError(409, 'No hay plan simulado: simula la importación antes.')}
    try {
      const data: unknown = JSON.parse(raw)
      if (data && typeof data === 'object' && !Array.isArray(data)) return data as Partial<ImportPlanArtifact>
    } catch { /* abajo */ }
    throw new ImageError(409, 'El plan simulado guardado no es válido: vuelve a simular.')
  }
}
