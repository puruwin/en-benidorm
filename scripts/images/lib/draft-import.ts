import {createHash} from 'node:crypto'
import type {ImageFieldValue, PlanResult, PlannedImport} from './importer'

// Modo borrador de images:import (#71): todo se escribe en `drafts.<id>` y nunca se publica. Publicar es
// de David en el Studio. Sin red: el script lee los documentos y envía las mutaciones.

export interface SanityDoc {
  _id: string
  _type?: string
  _rev?: string
  [field: string]: unknown
}

/** Documento publicado y su borrador (`null` si no hay ninguno abierto). */
export interface DocumentState {
  published: SanityDoc
  draft: SanityDoc | null
}

export type AssignedImage = ImageFieldValue & {asset: {_type: 'reference'; _ref: string}; _key?: string}

export type DraftMutation =
  | {createIfNotExists: SanityDoc}
  | {patch: {id: string; ifRevisionID?: string; setIfMissing?: Record<string, unknown>; set?: Record<string, unknown>; insert?: {after: string; items: unknown[]}}}

export const draftId = (id: string): string => `drafts.${id}`

/** JSON con las claves ordenadas: dos valores iguales dan el mismo texto. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function sourceUrls(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value ? [value] : []
  return items.flatMap((item) => item && typeof item === 'object' && typeof (item as {sourceUrl?: unknown}).sourceUrl === 'string' ? [(item as {sourceUrl: string}).sourceUrl] : [])
}

/**
 * Completa el plan con el estado de Sanity: `append` en arrays (se conservan los cambios del borrador),
 * `replace` en campos únicos salvo que el borrador ya los haya cambiado (issue: se resuelve en el Studio),
 * y omite las imágenes cuyo `sourceUrl` ya está en el publicado o en el borrador.
 */
export function planDraftWrites(plan: PlanResult, states: ReadonlyMap<string, DocumentState>): PlanResult {
  const result: PlanResult = {imports: [], skipped: [...plan.skipped], issues: [...plan.issues]}
  const planned = new Map<string, Set<string>>()
  const replaced = new Set<string>()
  for (const item of plan.imports) {
    const label = `${item.key} → ${item.document.id}.${item.field}`
    const state = states.get(item.document.id)
    if (!state) {
      result.issues.push(`${label}: no se ha podido leer el documento publicado.`)
      continue
    }
    const slot = `${item.document.id}.${item.field}`
    const seen = planned.get(slot) ?? new Set([...sourceUrls(state.published[item.field]), ...sourceUrls(state.draft?.[item.field])])
    planned.set(slot, seen)
    const url = item.value.sourceUrl
    if (url && seen.has(url)) {
      result.skipped.push(`${label}: el documento ya tiene esa imagen (${url}).`)
      continue
    }
    if (!item.isArray) {
      if (state.draft && stableStringify(state.draft[item.field]) !== stableStringify(state.published[item.field])) {
        result.issues.push(`${label}: el borrador ya cambió ${item.field}; resuélvelo en el Studio.`)
        continue
      }
      if (replaced.has(slot)) {
        result.issues.push(`${label}: hay más de una imagen aprobada para el campo único ${item.field}.`)
        continue
      }
      replaced.add(slot)
    }
    if (url) seen.add(url)
    result.imports.push({...item, action: item.isArray ? 'append' : 'replace', draftExists: state.draft !== null})
  }
  return result
}

/**
 * Mutaciones de un documento, todas sobre `drafts.<id>`. Sin borrador, lo crea como copia del publicado en
 * la misma transacción; con borrador, el patch exige su revisión (si el Studio lo cambió, falla sin pisar).
 */
export function draftMutations(state: DocumentState, entries: ReadonlyArray<{field: string; isArray: boolean; value: AssignedImage}>): DraftMutation[] {
  const id = draftId(state.published._id)
  const mutations: DraftMutation[] = []
  if (!state.draft) {
    const {_rev, _createdAt, _updatedAt, ...copy} = state.published
    mutations.push({createIfNotExists: {...copy, _id: id}})
  }
  const patch: Extract<DraftMutation, {patch: unknown}>['patch'] = {id, ...(state.draft?._rev ? {ifRevisionID: state.draft._rev} : {})}
  const arrays = [...new Set(entries.filter((entry) => entry.isArray).map((entry) => entry.field))]
  if (arrays.length > 1) throw new Error(`Más de un campo array en ${state.published._id}: ${arrays.join(', ')}.`)
  const [array] = arrays
  if (array) {
    patch.setIfMissing = {[array]: []}
    patch.insert = {after: `${array}[-1]`, items: entries.filter((entry) => entry.isArray).map((entry) => entry.value)}
  }
  const singles = entries.filter((entry) => !entry.isArray)
  if (singles.length) patch.set = Object.fromEntries(singles.map((entry) => [entry.field, entry.value]))
  mutations.push({patch})
  return mutations
}

export interface MutationSink {
  mutate: (mutations: DraftMutation[], options: {visibility: 'sync'}) => Promise<unknown>
}

/**
 * Única vía de escritura de documentos del importador: solo `createIfNotExists` y `patch`, y solo sobre
 * ids `drafts.*`. Ni publish ni delete. El token de imágenes es Editor (plan Free de Sanity): la garantía
 * de que no se publica está aquí, no en el rol.
 */
export function draftWriter(client: MutationSink): MutationSink {
  return {
    mutate: async (mutations, options) => {
      for (const mutation of mutations as unknown[]) {
        const keys = mutation && typeof mutation === 'object' ? Object.keys(mutation) : []
        const [kind] = keys
        if (keys.length !== 1 || (kind !== 'createIfNotExists' && kind !== 'patch')) throw new Error(`Mutación no permitida en modo borrador: ${keys.join(', ') || String(mutation)}.`)
        const body = (mutation as Record<string, {_id?: unknown; id?: unknown}>)[kind]
        const id = kind === 'patch' ? body?.id : body?._id
        if (typeof id !== 'string' || !id.startsWith('drafts.') || id.length <= 'drafts.'.length) throw new Error(`Solo se escriben borradores: ${kind} sobre «${String(id)}».`)
      }
      return client.mutate(mutations, options)
    },
  }
}

export interface ImportPlanArtifact {
  version: 1
  /** Fichero de aprobaciones, relativo a la raíz del repo. */
  file: string
  fileHash: string
  generatedAt: string
  mode: 'draft'
  imports: Array<{key: string; document: {type: string; id: string; slug: string}; field: string; action: 'append' | 'replace'; draftExists: boolean; credit: string}>
  skipped: string[]
  issues: string[]
  planHash: string
}

export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

/** Plan de importación con `planHash` sobre todo salvo `generatedAt`: dos simulaciones iguales dan el mismo hash. */
export function buildPlanArtifact(input: {file: string; fileHash: string; plan: PlanResult; now: Date}): ImportPlanArtifact {
  const content = {
    version: 1 as const,
    file: input.file,
    fileHash: input.fileHash,
    mode: 'draft' as const,
    imports: input.plan.imports.map((item: PlannedImport) => ({
      key: item.key,
      document: {type: item.document.type, id: item.document.id, slug: item.document.slug},
      field: item.field,
      action: item.action ?? (item.isArray ? 'append' : 'replace'),
      draftExists: item.draftExists ?? false,
      credit: item.credit,
    })),
    skipped: input.plan.skipped,
    issues: input.plan.issues,
  }
  return {...content, generatedAt: input.now.toISOString(), planHash: sha256(stableStringify(content))}
}

/** `--expect-plan`: si el plan recalculado no es el que se aprobó, no se escribe nada. */
export function assertExpectedPlan(artifact: ImportPlanArtifact, expected: string | undefined): void {
  if (expected !== undefined && artifact.planHash !== expected) {
    throw new Error(`El plan ha cambiado desde la simulación (esperado ${expected}, ahora ${artifact.planHash}). Vuelve a simular. No se ha escrito nada.`)
  }
}
