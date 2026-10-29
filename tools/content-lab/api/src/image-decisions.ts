import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import type {CandidatesFile, Dismissal, StockApproval, WithdrawnApproval} from '../../../../scripts/images/lib/candidates'
import {approvalReference, validateStockApproval} from '../../../../scripts/images/lib/importer'
import {readJsonIfExists, writeJsonAtomic} from '../../../../scripts/content/lib/files'
import {CANDIDATE_ID_PATTERN, CANDIDATES_DIR, ImageError, imageArtifactPath} from './image-candidates'
import type {RunManager} from './run-manager'
import {IMAGE_SLUG_PATTERN} from './validation'

const TEXT_MAX = 300
const REASON_MIN = 3
const REASON_MAX = 200
const APPROVAL_KEYS = new Set(['candidateId', 'document', 'field', 'alt', 'caption', 'placeVerified'])

type Reference = {type: string; slug: string}
type ApprovalInput = Omit<StockApproval, 'approvedBy' | 'approvedAt' | 'via'>

function plainObject(input: unknown, allowed: ReadonlySet<string>): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new ImageError(400, 'Cuerpo inválido: se espera un objeto JSON.')
  const values = input as Record<string, unknown>
  for (const key of Object.keys(values)) if (!allowed.has(key)) throw new ImageError(400, `Opción no permitida: ${key}`)
  return values
}

function candidateId(value: unknown): string {
  if (typeof value !== 'string' || !CANDIDATE_ID_PATTERN.test(value)) throw new ImageError(400, 'candidateId inválido.')
  return value
}

function optionalReference(value: unknown): Reference | undefined {
  if (value === undefined) return undefined
  const values = plainObject(value, new Set(['type', 'slug']))
  if (typeof values.type !== 'string' || !/^[a-z]{1,40}$/.test(values.type)) throw new ImageError(400, 'document.type inválido.')
  if (typeof values.slug !== 'string' || !IMAGE_SLUG_PATTERN.test(values.slug)) throw new ImageError(400, 'document.slug inválido.')
  return {type: values.type, slug: values.slug}
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new ImageError(400, `${name} debe ser texto.`)
  const trimmed = value.trim()
  if (trimmed.length > TEXT_MAX) throw new ImageError(400, `${name} no puede superar ${TEXT_MAX} caracteres.`)
  return trimmed
}

/** Aprobación tal como llega del cliente. `approvedBy`, `approvedAt` y `via` los pone siempre el servidor. */
function parseApproval(input: unknown): ApprovalInput {
  if (input && typeof input === 'object' && ('approvedBy' in input || 'approvedAt' in input)) {
    throw new ImageError(400, 'approvedBy y approvedAt los pone el servidor con el usuario de la sesión.')
  }
  const values = plainObject(input, APPROVAL_KEYS)
  if (typeof values.placeVerified !== 'boolean') throw new ImageError(400, 'placeVerified debe ser boolean.')
  if (values.field !== undefined && (typeof values.field !== 'string' || !/^[A-Za-z]{1,40}$/.test(values.field))) throw new ImageError(400, 'field inválido.')
  const document = optionalReference(values.document)
  const caption = values.caption === undefined ? '' : text(values.caption, 'caption')
  return {
    candidateId: candidateId(values.candidateId),
    ...(document ? {document} : {}),
    ...(values.field !== undefined ? {field: values.field as string} : {}),
    alt: text(values.alt, 'alt'),
    ...(caption ? {caption} : {}),
    placeVerified: values.placeVerified,
  }
}

const sameReference = (a: Reference | undefined, b: Reference | undefined) => Boolean(a && b && a.type === b.type && a.slug === b.slug)
const activeDismissal = (file: CandidatesFile, id: string) => (file.dismissals ?? []).find((item) => item.candidateId === id && !item.undoneAt)

/**
 * Decisiones de David sobre un fichero de candidatas: aprobar, descartar, deshacer un descarte y retirar una
 * aprobación. Cada escritura relee el fichero dentro de un lock por fichero, se niega si un run de imágenes
 * lo está escribiendo y nunca borra: descartes y retiradas quedan registrados.
 */
export class ImageDecisions {
  private readonly runs: Pick<RunManager, 'active'> | undefined
  private readonly now: () => Date
  private places: Promise<readonly string[]> | undefined
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(readonly root: string, options: {runs?: Pick<RunManager, 'active'>; now?: () => Date; places?: readonly string[]} = {}) {
    this.runs = options.runs
    this.now = options.now ?? (() => new Date())
    if (options.places) this.places = Promise.resolve(options.places)
  }

  async validate(slug: unknown, body: unknown, actor: string): Promise<{issues: string[]}> {
    const input = parseApproval(body)
    const file = await this.read(imageArtifactPath(this.root, CANDIDATES_DIR, slug))
    return {issues: await this.approvalIssues(file, this.approval(input, actor))}
  }

  async approve(slug: unknown, body: unknown, actor: string): Promise<{approval: StockApproval; file: CandidatesFile}> {
    const input = parseApproval(body)
    return this.mutate(slug, async (file) => {
      const approval = this.approval(input, actor)
      const issues = await this.approvalIssues(file, approval)
      if (issues.length) throw new ImageError(400, issues.join(' '), issues)
      file.approvals.push(approval)
      return {approval}
    })
  }

  async dismiss(slug: unknown, body: unknown, actor: string): Promise<{dismissal: Dismissal; file: CandidatesFile}> {
    const values = plainObject(body, new Set(['candidateId', 'reason']))
    const id = candidateId(values.candidateId)
    if (typeof values.reason !== 'string') throw new ImageError(400, 'reason debe ser texto.')
    const reason = values.reason.trim()
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) throw new ImageError(400, `El motivo debe tener entre ${REASON_MIN} y ${REASON_MAX} caracteres.`)
    return this.mutate(slug, (file) => {
      if (!file.candidates.some((item) => item.id === id)) throw new ImageError(400, 'No hay ninguna candidata con ese id en este fichero.')
      if (file.approvals.some((item) => item.candidateId === id)) throw new ImageError(400, 'La candidata está aprobada: retira la aprobación antes de descartarla.')
      if (activeDismissal(file, id)) throw new ImageError(400, 'La candidata ya está descartada.')
      const dismissal: Dismissal = {candidateId: id, dismissedBy: actor, dismissedAt: this.now().toISOString(), reason}
      file.dismissals = [...(file.dismissals ?? []), dismissal]
      return {dismissal}
    })
  }

  async undismiss(slug: unknown, body: unknown, actor: string): Promise<{dismissal: Dismissal; file: CandidatesFile}> {
    const id = candidateId(plainObject(body, new Set(['candidateId'])).candidateId)
    return this.mutate(slug, (file) => {
      const dismissal = activeDismissal(file, id)
      if (!dismissal) throw new ImageError(400, 'La candidata no tiene un descarte activo.')
      dismissal.undoneAt = this.now().toISOString()
      dismissal.undoneBy = actor
      return {dismissal}
    })
  }

  async withdraw(slug: unknown, body: unknown, actor: string): Promise<{withdrawn: WithdrawnApproval; file: CandidatesFile}> {
    const values = plainObject(body, new Set(['candidateId', 'document']))
    const id = candidateId(values.candidateId)
    const document = optionalReference(values.document)
    return this.mutate(slug, (file) => {
      const matches = file.approvals.filter((item) => item.candidateId === id && (!document || sameReference(approvalReference(file, item), document)))
      if (!matches.length) throw new ImageError(400, 'No hay ninguna aprobación de esa candidata.')
      if (matches.length > 1) throw new ImageError(400, 'La candidata tiene varias aprobaciones: indica document {type, slug}.')
      // Sin el documento de destino en `imports` (es el _id de Sanity), cualquier importación de la candidata bloquea.
      if (file.imports.some((item) => item.candidateId === id)) throw new ImageError(409, 'La candidata ya está importada: la aprobación no se puede retirar.')
      const approval = matches[0]!
      const withdrawn: WithdrawnApproval = {...approval, withdrawnBy: actor, withdrawnAt: this.now().toISOString()}
      file.approvals = file.approvals.filter((item) => item !== approval)
      file.withdrawn = [...(file.withdrawn ?? []), withdrawn]
      return {withdrawn}
    })
  }

  private approval(input: ApprovalInput, actor: string): StockApproval {
    return {...input, approvedBy: actor, approvedAt: this.now().toISOString().slice(0, 10), via: 'content-lab'}
  }

  /** `validateStockApproval` más lo que depende del resto del fichero: rechazada, duplicada o descartada. */
  private async approvalIssues(file: CandidatesFile, approval: StockApproval): Promise<string[]> {
    const reference = approvalReference(file, approval)
    const target = file.target
    const documentName = target.kind === 'document' && sameReference(reference, target) ? target.name : undefined
    const {issues} = validateStockApproval(file, approval, {places: await this.loadPlaces(), documentName})
    const label = `aprobación ${approval.candidateId}`
    if (file.rejected.some((item) => item.id === approval.candidateId)) issues.unshift(`${label}: la candidata está rechazada por licencia o formato.`)
    if (file.approvals.some((item) => item.candidateId === approval.candidateId && sameReference(approvalReference(file, item), reference))) {
      issues.push(`${label}: ya está aprobada para ${reference!.type}:${reference!.slug}.`)
    }
    if (activeDismissal(file, approval.candidateId)) issues.push(`${label}: la candidata está descartada; deshaz el descarte antes.`)
    return issues
  }

  private loadPlaces(): Promise<readonly string[]> {
    this.places ??= readJsonIfExists<{places?: string[]}>(resolve(this.root, 'scripts/seo/place-names.json'), {}).then((value) => value.places ?? [])
    return this.places
  }

  private async read(path: string): Promise<CandidatesFile> {
    let raw: string
    try {raw = await readFile(resolve(this.root, path), 'utf8')} catch {throw new ImageError(404, 'Fichero de candidatas no encontrado.')}
    let data: unknown
    try {data = JSON.parse(raw)} catch {throw new ImageError(422, 'El fichero de candidatas no es JSON válido.')}
    const file = data as Partial<CandidatesFile> | null
    if (!file || typeof file !== 'object' || !file.target || typeof file.target !== 'object' || ![file.candidates, file.rejected, file.approvals, file.imports].every(Array.isArray)) {
      throw new ImageError(422, 'El fichero de candidatas no tiene la forma esperada.')
    }
    return file as CandidatesFile
  }

  private assertNoRun(path: string): void {
    const run = this.runs?.active()
    if (!run || run.kind !== 'images') return
    // Un run de imágenes sin `files` no dice qué escribe: bloquea por prudencia.
    if (!run.files || run.files.includes(path)) throw new ImageError(409, 'Hay una ejecución de imágenes activa sobre este fichero; espera a que termine.')
  }

  /** Lock por fichero, relectura justo antes de escribir y escritura atómica. */
  private async mutate<T extends object>(slug: unknown, change: (file: CandidatesFile) => T | Promise<T>): Promise<T & {file: CandidatesFile}> {
    const path = imageArtifactPath(this.root, CANDIDATES_DIR, slug)
    this.assertNoRun(path)
    const previous = this.locks.get(path) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(async () => {
      this.assertNoRun(path)
      const file = await this.read(path)
      const result = await change(file)
      await writeJsonAtomic(resolve(this.root, path), file)
      return {...result, file}
    })
    const tail = current.catch(() => undefined)
    this.locks.set(path, tail)
    try {
      return await current
    } finally {
      if (this.locks.get(path) === tail) this.locks.delete(path)
    }
  }
}
