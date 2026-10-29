import type {ImageProvider} from '../../../src/types/content'
import type {NormalizedLicense} from './licenses'

/** Tipos de documento que pueden recibir imágenes de stock. `business` nunca: solo fotos propias (#23). */
export const STOCK_DOCUMENT_TYPES = ['place', 'area', 'beach', 'article'] as const
export type StockDocumentType = (typeof STOCK_DOCUMENT_TYPES)[number]

/** Campo de imagen de cada tipo: `images` es un array; los demás, una sola imagen. */
export const IMAGE_FIELDS: Record<StockDocumentType, readonly string[]> = {
  place: ['images'],
  beach: ['images'],
  area: ['image'],
  article: ['heroImage'],
}

export function isStockDocumentType(value: unknown): value is StockDocumentType {
  return typeof value === 'string' && (STOCK_DOCUMENT_TYPES as readonly string[]).includes(value)
}

export interface Coordinates {
  lat: number
  lng: number
}

export type CandidateTarget =
  | {kind: 'document'; type: StockDocumentType; id: string; slug: string; name: string; coordinates?: Coordinates}
  | {kind: 'term'; term: string}

/** Por qué la imagen podría ser del lugar. `null`: no se puede verificar y solo vale como ambiental. */
export type PlaceBasis = 'commons-category' | 'coordinates' | null

export interface ImageCandidate {
  /** `<proveedor>:<id del proveedor>`, estable entre búsquedas. */
  id: string
  provider: ImageProvider
  title: string
  thumbnailUrl: string
  sourceUrl: string
  originalUrl: string
  author: string
  authorUrl?: string
  license: NormalizedLicense
  /** Texto de la fuente; el alt aprobado no puede copiarlo. */
  sourceDescription?: string
  takenAt?: string
  retrievedAt: string
  width?: number
  height?: number
  distanceMeters?: number
  use: 'lugar' | 'ambiental'
  placeBasis: PlaceBasis
  warnings: string[]
}

export interface RejectedCandidate {
  id: string
  reason: string
}

/** Lo rellena David a mano. Claude no escribe aprobaciones. */
export interface StockApproval {
  candidateId: string
  approvedBy: string
  approvedAt: string
  /** Obligatorio si la búsqueda fue por término; si no, el documento de la búsqueda. */
  document?: {type: string; slug: string}
  field?: string
  alt: string
  caption?: string
  placeVerified: boolean
  /** Dónde se aprobó. Ausente en las aprobaciones anteriores a Content Lab (escritas a mano). */
  via?: 'content-lab' | 'manual'
}

/** Descarte de David, distinto de `rejected` (automático). Deshacerlo rellena `undoneAt`/`undoneBy`; no se borra. */
export interface Dismissal {
  candidateId: string
  dismissedBy: string
  dismissedAt: string
  reason: string
  undoneAt?: string
  undoneBy?: string
}

/** Aprobación retirada antes de importarla: sale de `approvals` y queda aquí con quién y cuándo. */
export interface WithdrawnApproval extends StockApproval {
  withdrawnBy: string
  withdrawnAt: string
}

export interface ImportRecord {
  candidateId: string
  documentId: string
  field: string
  assetId: string
  importedAt: string
  /** Ausente = `published`: los registros anteriores al modo borrador escribían en el documento publicado. */
  mode?: 'published' | 'draft'
  draftId?: string
  importedBy?: string
  runId?: string
}

export interface CandidatesFile {
  version: 1
  target: CandidateTarget
  generatedAt: string
  query: {category?: string; categorySuggested?: boolean; radiusMeters?: number; term?: string}
  warnings: string[]
  candidates: ImageCandidate[]
  rejected: RejectedCandidate[]
  approvals: StockApproval[]
  imports: ImportRecord[]
  /** Ausente = `[]` (ficheros anteriores). */
  dismissals?: Dismissal[]
  /** Ausente = `[]` (ficheros anteriores). */
  withdrawn?: WithdrawnApproval[]
  /** Dónde se creó el fichero, que es donde se edita. Ausente en los ficheros anteriores. */
  createdIn?: 'content-lab' | 'local'
}

/**
 * Une una búsqueda nueva con el fichero anterior: conserva las decisiones de David (aprobaciones,
 * importaciones, descartes y retiradas) y cualquier candidata con una decisión aunque la búsqueda nueva
 * no la devuelva, para que ninguna desaparezca sin motivo.
 */
export function mergeCandidates(previous: CandidatesFile | null, next: CandidatesFile): CandidatesFile {
  if (!previous) return next
  const dismissals = previous.dismissals ?? []
  const withdrawn = previous.withdrawn ?? []
  const decided = new Set([...previous.approvals, ...previous.imports, ...dismissals, ...withdrawn].map((decision) => decision.candidateId))
  const ids = new Set(next.candidates.map((candidate) => candidate.id))
  const kept = previous.candidates.filter((candidate) => decided.has(candidate.id) && !ids.has(candidate.id))
  return {
    ...next,
    ...(previous.createdIn ? {createdIn: previous.createdIn} : {}),
    candidates: [...next.candidates, ...kept],
    approvals: previous.approvals,
    imports: previous.imports,
    ...(dismissals.length ? {dismissals} : {}),
    ...(withdrawn.length ? {withdrawn} : {}),
  }
}

export function slugify(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'imagen'
}

export function candidatesSlug(target: CandidateTarget): string {
  return target.kind === 'document' ? `${target.type}-${target.slug}` : `termino-${slugify(target.term)}`
}

/** Distancia en metros (haversine). */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const dLat = radians(b.lat - a.lat)
  const dLng = radians(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)))
}
