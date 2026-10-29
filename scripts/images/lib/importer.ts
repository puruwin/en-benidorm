import {randomUUID} from 'node:crypto'
import type {SiteVisit} from '../../content/lib/site-visits'
import {namedPlaces} from '../../seo/lib/audit'
import {IMAGE_FIELDS, isStockDocumentType, type CandidatesFile, type ImageCandidate, type StockApproval, type StockDocumentType} from './candidates'

/** Valor de `imageWithAlt` sin el asset, que se añade tras subir el fichero. */
export interface ImageFieldValue {
  _type: 'imageWithAlt'
  alt: string
  caption?: string
  origin: 'propia' | 'stock'
  provider?: string
  sourceUrl?: string
  author?: string
  authorUrl?: string
  license?: {id: string; url: string}
  takenAt?: string
  retrievedAt?: string
  placeVerified: boolean
  approvedBy: string
}

export interface TargetDocument {
  type: string
  id: string
  slug: string
  name: string
}

export interface PlannedImport {
  /** `candidateId` en stock; ruta de la foto en propias. */
  key: string
  document: TargetDocument
  field: string
  isArray: boolean
  /** Fichero a descargar (stock) o ruta local relativa a `content/manual/` (propia). */
  source: {kind: 'url'; url: string} | {kind: 'file'; path: string}
  filename: string
  value: ImageFieldValue
  credit: string
}

export interface PlanResult {
  imports: PlannedImport[]
  skipped: string[]
  issues: string[]
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** Comprobaciones comunes de una aprobación de David. */
function approvalIssues(label: string, approval: {approvedBy?: unknown; approvedAt?: unknown; alt?: unknown; caption?: unknown; placeVerified?: unknown}, places: readonly string[], sourceDescription?: string): string[] {
  const issues: string[] = []
  if (typeof approval.approvedBy !== 'string' || !approval.approvedBy.trim()) issues.push(`${label}: falta approvedBy.`)
  if (typeof approval.approvedAt !== 'string' || !DATE.test(approval.approvedAt)) issues.push(`${label}: approvedAt debe ser AAAA-MM-DD.`)
  if (typeof approval.alt !== 'string' || !approval.alt.trim()) issues.push(`${label}: falta el alt.`)
  if (approval.caption !== undefined && typeof approval.caption !== 'string') issues.push(`${label}: caption debe ser texto.`)
  if (typeof approval.placeVerified !== 'boolean') issues.push(`${label}: placeVerified debe ser true o false.`)
  if (typeof approval.alt === 'string' && sourceDescription && fold(approval.alt) === fold(sourceDescription)) {
    issues.push(`${label}: el alt copia la descripción de la fuente; describe lo que se ve.`)
  }
  if (approval.placeVerified === false) {
    const named = namedPlaces(`${typeof approval.alt === 'string' ? approval.alt : ''} ${typeof approval.caption === 'string' ? approval.caption : ''}`, places)
    if (named.length) issues.push(`${label}: alt o pie nombran ${named.map((place) => `«${place}»`).join(', ')} con placeVerified = false.`)
  }
  return issues
}

function resolveField(label: string, type: StockDocumentType, field: string | undefined): {field: string; isArray: boolean} | string {
  const allowed = IMAGE_FIELDS[type]
  const chosen = field ?? allowed[0]!
  if (!allowed.includes(chosen)) return `${label}: el campo «${chosen}» no es de imagen en ${type} (usa ${allowed.join(', ')}).`
  return {field: chosen, isArray: chosen === 'images'}
}

function extension(url: string): string {
  return /\.(jpe?g|png|webp)$/i.exec(new URL(url, 'https://x.invalid').pathname)?.[1]?.toLowerCase().replace('jpeg', 'jpg') ?? 'jpg'
}

export interface StockApprovalCheck {
  issues: string[]
  /** Solo si la candidata, el destino y el campo son válidos (aunque haya otros `issues`). */
  target?: {candidate: ImageCandidate; type: StockDocumentType; slug: string; field: string; isArray: boolean}
}

/** Documento al que va una aprobación: el suyo o, si no lo indica, el de la búsqueda. */
export function approvalReference(file: CandidatesFile, approval: Partial<StockApproval>): {type: string; slug: string} | undefined {
  return approval.document ?? (file.target.kind === 'document' ? {type: file.target.type, slug: file.target.slug} : undefined)
}

/**
 * Reglas de una aprobación de stock (#23), sin red: la candidata existe, el destino es de stock (nunca
 * `business`), el campo es de imagen, una ambiental no tiene el lugar verificado, el alt no copia la fuente
 * y alt o pie no nombran un lugar sin verificar. `documentName` es el nombre del documento destino, que
 * cuenta como lugar nombrado.
 */
export function validateStockApproval(
  file: CandidatesFile,
  approval: Partial<StockApproval>,
  options: {places: readonly string[]; documentName?: string | undefined},
): StockApprovalCheck {
  const label = `aprobación ${approval.candidateId ?? '(sin candidateId)'}`
  const candidate = approval.candidateId ? file.candidates.find((item) => item.id === approval.candidateId) : undefined
  if (!candidate) return {issues: [`${label}: no hay ninguna candidata con ese id.`]}
  const reference = approvalReference(file, approval)
  if (!reference) return {issues: [`${label}: la búsqueda fue por término; indica document {type, slug}.`]}
  if (reference.type === 'business') return {issues: [`${label}: las fichas de negocio no admiten imágenes de stock.`]}
  if (!isStockDocumentType(reference.type)) return {issues: [`${label}: tipo de documento no admitido: ${reference.type}.`]}
  const field = resolveField(label, reference.type, approval.field)
  if (typeof field === 'string') return {issues: [field]}
  const places = options.documentName ? [...options.places, options.documentName] : options.places
  const issues = approvalIssues(label, approval, places, candidate.sourceDescription)
  if (approval.placeVerified === true && candidate.use === 'ambiental') issues.push(`${label}: la candidata es ambiental (${candidate.provider}); no puede tener el lugar verificado.`)
  return {issues, target: {candidate, type: reference.type, slug: reference.slug, ...field}}
}

/**
 * Plan de importación de las candidatas de stock aprobadas. Aplica `validateStockApproval` y además exige
 * que el documento destino exista publicado.
 */
export async function planStockImports(
  file: CandidatesFile,
  options: {places: readonly string[]; resolveDocument: (type: string, slug: string) => Promise<TargetDocument | null>},
): Promise<PlanResult> {
  const result: PlanResult = {imports: [], skipped: [], issues: []}
  for (const approval of file.approvals as Array<Partial<StockApproval>>) {
    const structural = validateStockApproval(file, approval, {places: options.places})
    if (!structural.target) {
      result.issues.push(...structural.issues)
      continue
    }
    const {candidate, type, slug} = structural.target
    const document = await options.resolveDocument(type, slug)
    if (!document) {
      result.issues.push(`aprobación ${candidate.id}: no existe ${type}:${slug} publicado.`)
      continue
    }
    const {issues} = validateStockApproval(file, approval, {places: options.places, documentName: document.name})
    if (issues.length) {
      result.issues.push(...issues)
      continue
    }
    const field = {field: structural.target.field, isArray: structural.target.isArray}
    if (file.imports.some((record) => record.candidateId === candidate.id && record.documentId === document.id && record.field === field.field)) {
      result.skipped.push(`${candidate.id} → ${document.id}.${field.field}: ya importada.`)
      continue
    }
    const value: ImageFieldValue = {
      _type: 'imageWithAlt',
      alt: approval.alt!.trim(),
      ...(approval.caption?.trim() ? {caption: approval.caption.trim()} : {}),
      origin: 'stock',
      provider: candidate.provider,
      sourceUrl: candidate.sourceUrl,
      author: candidate.author,
      ...(candidate.authorUrl ? {authorUrl: candidate.authorUrl} : {}),
      license: candidate.license,
      ...(candidate.takenAt ? {takenAt: candidate.takenAt} : {}),
      retrievedAt: candidate.retrievedAt,
      placeVerified: approval.placeVerified === true,
      approvedBy: approval.approvedBy!.trim(),
    }
    result.imports.push({
      key: candidate.id,
      document,
      ...field,
      source: {kind: 'url', url: candidate.originalUrl},
      filename: `${document.slug}-${candidate.provider}-${candidate.id.split(':').slice(1).join('-').replace(/[^\w.-]+/g, '_').slice(0, 60)}.${extension(candidate.originalUrl)}`,
      value,
      credit: `${candidate.author} / ${candidate.provider} · ${candidate.license.id}`,
    })
  }
  return result
}

/** Aprobación de fotos propias: la escribe David en `content/images/own/<visita>.json`. */
export interface OwnPhotosFile {
  /** Ruta de la visita relativa a `content/manual/`. */
  visit: string
  approvals: Array<{photo: string; approvedBy: string; approvedAt: string; field?: string; alt: string; caption?: string; placeVerified: boolean}>
  imports: Array<{photo: string; documentId: string; field: string; assetId: string; importedAt: string}>
}

/**
 * Plan de importación de fotos propias de una visita (#14). El documento es el de la visita; la fecha
 * de la foto, la de la observación. Alt y pie salen de la aprobación de David, nunca se generan.
 */
export function planOwnImports(own: OwnPhotosFile, visit: SiteVisit, options: {places: readonly string[]; slug: string}): PlanResult {
  const result: PlanResult = {imports: [], skipped: [], issues: []}
  if (!visit.place.documentId) {
    result.issues.push(`La visita ${own.visit} no tiene documentId: crea antes la página del lugar.`)
    return result
  }
  const document: TargetDocument = {type: visit.place.type, id: visit.place.documentId, slug: options.slug, name: visit.place.name}
  for (const approval of own.approvals) {
    const label = `foto ${approval.photo}`
    if (!visit.photos.includes(approval.photo)) {
      result.issues.push(`${label}: no está en photos de la visita.`)
      continue
    }
    const field = resolveField(label, visit.place.type, approval.field)
    if (typeof field === 'string') {
      result.issues.push(field)
      continue
    }
    const issues = approvalIssues(label, approval, [...options.places, visit.place.name])
    if (issues.length) {
      result.issues.push(...issues)
      continue
    }
    if (own.imports.some((record) => record.photo === approval.photo && record.documentId === document.id && record.field === field.field)) {
      result.skipped.push(`${approval.photo} → ${document.id}.${field.field}: ya importada.`)
      continue
    }
    result.imports.push({
      key: approval.photo,
      document,
      ...field,
      source: {kind: 'file', path: approval.photo},
      filename: approval.photo.split('/').pop()!,
      value: {
        _type: 'imageWithAlt',
        alt: approval.alt.trim(),
        ...(approval.caption?.trim() ? {caption: approval.caption.trim()} : {}),
        origin: 'propia',
        takenAt: visit.observedAt,
        placeVerified: approval.placeVerified,
        approvedBy: approval.approvedBy.trim(),
      },
      credit: `Foto: enBenidorm, ${visit.observedAt}`,
    })
  }
  return result
}

export interface ImportDeps {
  read: (source: PlannedImport['source']) => Promise<Buffer>
  strip: (bytes: Buffer) => Promise<{bytes: Buffer}>
  upload: (bytes: Buffer, plan: PlannedImport) => Promise<string>
  patch: (plan: PlannedImport, value: ImageFieldValue & {asset: {_type: 'reference'; _ref: string}; _key?: string}) => Promise<void>
  now: () => Date
}

/** Descarga, quita EXIF, sube y asigna. Devuelve lo importado para dejar constancia en el fichero. */
export async function executeImports(plans: readonly PlannedImport[], deps: ImportDeps): Promise<Array<{plan: PlannedImport; assetId: string; importedAt: string}>> {
  const done: Array<{plan: PlannedImport; assetId: string; importedAt: string}> = []
  for (const plan of plans) {
    const original = await deps.read(plan.source)
    const {bytes} = await deps.strip(original)
    const assetId = await deps.upload(bytes, plan)
    await deps.patch(plan, {...plan.value, asset: {_type: 'reference', _ref: assetId}, ...(plan.isArray ? {_key: randomUUID().slice(0, 12)} : {})})
    done.push({plan, assetId, importedAt: deps.now().toISOString()})
  }
  return done
}
