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
}

export interface ImportRecord {
  candidateId: string
  documentId: string
  field: string
  assetId: string
  importedAt: string
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
}

/**
 * Une una búsqueda nueva con el fichero anterior: conserva aprobaciones, importaciones y cualquier
 * candidata ya aprobada aunque la búsqueda nueva no la devuelva.
 */
export function mergeCandidates(previous: CandidatesFile | null, next: CandidatesFile): CandidatesFile {
  if (!previous) return next
  const approved = new Set(previous.approvals.map((approval) => approval.candidateId))
  const ids = new Set(next.candidates.map((candidate) => candidate.id))
  const kept = previous.candidates.filter((candidate) => approved.has(candidate.id) && !ids.has(candidate.id))
  return {...next, candidates: [...next.candidates, ...kept], approvals: previous.approvals, imports: previous.imports}
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
