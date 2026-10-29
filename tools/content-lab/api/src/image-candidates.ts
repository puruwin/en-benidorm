import {createHash} from 'node:crypto'
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import {resolve, sep} from 'node:path'
import type {CandidatesFile, ImageCandidate} from '../../../../scripts/images/lib/candidates'
import {CACHE_TTL_MS} from '../../../../scripts/images/lib/cache'
import {fetchBytes, type Fetcher} from '../../../../scripts/images/lib/http'
import type {ArtifactResponse} from '../../shared/types'
import type {ArtifactLoader} from './artifact-loader'
import {IMAGE_SLUG_PATTERN, validateImageSlug} from './validation'

export const CANDIDATES_DIR = 'content/images/candidates'
const PLANS_DIR = 'content/images/plans'
const THUMBS_DIR = 'content/images/.cache/thumbs'
const THUMBNAIL_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const CANDIDATE_ID_PATTERN = /^[a-z]+:[^/\\\s]{1,200}$/

export class ImageError extends Error {
  constructor(readonly statusCode: number, message: string, readonly issues?: string[]) {super(message)}
}

/** Ruta relativa de `<directorio>/<slug>.json`, comprobando que no sale del directorio. */
export function imageArtifactPath(root: string, directory: string, slugInput: unknown): string {
  const slug = validateImageSlug(slugInput)
  const base = resolve(root, directory)
  if (!resolve(base, `${slug}.json`).startsWith(base + sep)) throw new ImageError(400, 'Slug de candidatas inválido.')
  return `${directory}/${slug}.json`
}

export interface ImageCandidateCounts {
  candidates: number
  withPlaceBasis: number
  rejected: number
  dismissed: number
  approved: number
  imported: number
  pendingImport: number
}

export interface ImageCandidatesSummary {
  slug: string
  path: string
  status: ArtifactResponse['status']
  error?: string
  target?: CandidatesFile['target']
  generatedAt?: string
  counts?: ImageCandidateCounts
}

const list = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : []

/** Contadores del fichero. Campos opcionales ausentes (ficheros v1 anteriores) cuentan como vacíos. */
export function candidateCounts(file: Partial<CandidatesFile>): ImageCandidateCounts {
  const candidates = list<ImageCandidate>(file.candidates)
  const approvals = list<{candidateId?: unknown}>(file.approvals)
  const imported = new Set(list<{candidateId?: unknown}>(file.imports).map(record => record.candidateId))
  const dismissed = new Set(list<{candidateId?: unknown; undoneAt?: unknown}>(file.dismissals).filter(item => !item.undoneAt).map(item => item.candidateId))
  return {
    candidates: candidates.length,
    withPlaceBasis: candidates.filter(candidate => candidate?.placeBasis != null).length,
    rejected: list(file.rejected).length,
    dismissed: dismissed.size,
    approved: approvals.length,
    imported: list(file.imports).length,
    pendingImport: approvals.filter(approval => !imported.has(approval.candidateId)).length,
  }
}

/**
 * Lectura de `content/images/candidates/` y proxy de miniaturas. La URL de la miniatura sale siempre del
 * fichero, nunca del cliente, y pasa por `fetchBytes` (lista cerrada de hosts, redirects revalidados).
 */
export class ImageCandidates {
  private readonly fetcher: Fetcher | undefined
  private readonly now: () => number

  constructor(readonly root: string, private readonly loader: ArtifactLoader, options: {fetcher?: Fetcher; now?: () => number} = {}) {
    this.fetcher = options.fetcher
    this.now = options.now ?? Date.now
  }

  private relativePath(directory: string, slugInput: unknown): string {
    return imageArtifactPath(this.root, directory, slugInput)
  }

  async list(): Promise<ImageCandidatesSummary[]> {
    let files: string[]
    try {files = await readdir(resolve(this.root, CANDIDATES_DIR))} catch {return []}
    const slugs = files.filter(file => file.endsWith('.json')).map(file => file.slice(0, -'.json'.length)).filter(slug => IMAGE_SLUG_PATTERN.test(slug)).sort()
    return Promise.all(slugs.map(async slug => {
      const artifact = await this.loader.readKnown<Partial<CandidatesFile>>(this.relativePath(CANDIDATES_DIR, slug))
      const summary: ImageCandidatesSummary = {slug, path: artifact.path, status: artifact.status, ...(artifact.error ? {error: artifact.error} : {})}
      const data = artifact.data
      if (artifact.status !== 'available' || !data || typeof data !== 'object') return summary
      return {
        ...summary,
        ...(data.target ? {target: data.target} : {}),
        ...(typeof data.generatedAt === 'string' ? {generatedAt: data.generatedAt} : {}),
        counts: candidateCounts(data),
      }
    }))
  }

  async detail(slugInput: unknown) {
    const slug = validateImageSlug(slugInput)
    const [file, plan] = await Promise.all([
      this.loader.readKnown<CandidatesFile>(this.relativePath(CANDIDATES_DIR, slug)),
      this.loader.readKnown(this.relativePath(PLANS_DIR, slug)),
    ])
    return {slug, file, plan}
  }

  async thumbnail(slugInput: unknown, candidateInput: unknown): Promise<{bytes: Buffer; contentType: string}> {
    const path = this.relativePath(CANDIDATES_DIR, slugInput)
    if (typeof candidateInput !== 'string' || !CANDIDATE_ID_PATTERN.test(candidateInput)) throw new ImageError(400, 'Candidata inválida.')
    const artifact = await this.loader.readKnown<Partial<CandidatesFile>>(path)
    if (artifact.status === 'missing') throw new ImageError(404, 'Fichero de candidatas no encontrado.')
    if (artifact.status === 'invalid') throw new ImageError(422, 'El fichero de candidatas no es JSON válido.')
    const candidate = list<ImageCandidate>(artifact.data?.candidates).find(item => item?.id === candidateInput)
    if (!candidate || typeof candidate.thumbnailUrl !== 'string') throw new ImageError(404, 'La candidata no existe en este fichero.')

    const key = createHash('sha256').update(candidate.thumbnailUrl).digest('hex')
    const cached = await this.readCache(key)
    if (cached) return cached
    let response: {bytes: Buffer; contentType: string}
    try {
      response = await fetchBytes(candidate.thumbnailUrl, {timeoutMs: 10_000, maxBytes: 2_000_000}, this.fetcher)
    } catch (error) {
      throw new ImageError(502, `Miniatura no disponible: ${error instanceof Error ? error.message : String(error)}`)
    }
    const contentType = response.contentType.split(';')[0]!.trim().toLowerCase()
    if (!THUMBNAIL_TYPES.has(contentType)) throw new ImageError(502, 'La miniatura no es una imagen JPEG, PNG o WebP.')
    await this.writeCache(key, response.bytes, contentType)
    return {bytes: response.bytes, contentType}
  }

  // Caché de 24 h (condiciones de Pixabay). Un fallo de lectura es un fallo de caché, no un error.
  private async readCache(key: string): Promise<{bytes: Buffer; contentType: string} | undefined> {
    try {
      const meta = JSON.parse(await readFile(resolve(this.root, THUMBS_DIR, `${key}.json`), 'utf8')) as {storedAt?: unknown; contentType?: unknown}
      if (typeof meta.storedAt !== 'number' || this.now() - meta.storedAt >= CACHE_TTL_MS) return undefined
      if (typeof meta.contentType !== 'string' || !THUMBNAIL_TYPES.has(meta.contentType)) return undefined
      return {bytes: await readFile(resolve(this.root, THUMBS_DIR, `${key}.bin`)), contentType: meta.contentType}
    } catch {
      return undefined
    }
  }

  private async writeCache(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const directory = resolve(this.root, THUMBS_DIR)
    await mkdir(directory, {recursive: true})
    await writeFile(resolve(directory, `${key}.bin`), bytes)
    await writeFile(resolve(directory, `${key}.json`), JSON.stringify({storedAt: this.now(), contentType}))
  }
}
