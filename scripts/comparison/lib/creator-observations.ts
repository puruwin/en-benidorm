import {basename} from 'node:path'
import {loadJsonDirectory} from '../../content/lib/files'
import type {SourceProvenance} from '../../content/lib/types'
import {
  type CreatorObservation, formatObservationDate, isPublishable, parseCreatorObservation, sortCreatorObservations,
} from '../../../src/lib/creator-observations'
import type {EnrichedComparisonArtifact} from './types'

/**
 * Observaciones de creador en Comparison Enrichment.
 *
 * Son evidencia de tercero (nivel 5 de la jerarquía de `enbenidorm-editorial-principles.md`). Por eso
 * se adjuntan aparte, en `creatorObservations` de cada Business confirmado, y nunca en `evidence`:
 * no puntúan, no confirman candidatos, no cuentan para el gate, no rellenan huecos de la web oficial
 * y no llegan al prompt de Generation (`withoutCreatorObservations`).
 */

export interface CreatorObservationRecord {
  /** Ruta relativa a `content/manual/`. */
  ref: string
  observation: CreatorObservation
  source: SourceProvenance
}

export interface CreatorObservationData {
  records: CreatorObservationRecord[]
}

export const EMPTY_CREATOR_OBSERVATIONS: CreatorObservationData = {records: []}

/**
 * Lee `content/manual/creator-observations/`. Los archivos `_*.json` son plantillas. Un directorio
 * inexistente significa que no hay observaciones; un archivo no válido o con un businessId que no está
 * en el catálogo detiene la fase, como las observaciones manuales.
 */
export async function loadCreatorObservations(directory: string, businessIds: ReadonlySet<string>, today?: string): Promise<CreatorObservationData> {
  const files = (await loadJsonDirectory<unknown>(directory)).filter(({path}) => !basename(path).startsWith('_'))
  const records = files.map(({path, value}) => {
    const ref = `creator-observations/${basename(path)}`
    const {observation, issues} = parseCreatorObservation(value, `content/manual/${ref}`, today)
    if (!observation) throw new Error(`Creator observation ${basename(path)}: ${issues.map((issue) => `${issue.path || '(raíz)'}: ${issue.message}`).join(' ')}`)
    if (!businessIds.has(observation.businessId)) throw new Error(`Creator observation ${basename(path)}: businessId inexistente: ${observation.businessId}.`)
    return {ref, observation, source: creatorSource(observation, ref)}
  })
  return {records}
}

export function creatorSource(observation: CreatorObservation, ref: string): SourceProvenance {
  return {
    key: `creator-observation:${ref}`,
    provider: 'creator-observation',
    identifier: ref,
    url: observation.urlVideo,
    retrievedAt: `${observation.registradoEl}T00:00:00.000Z`,
    attribution: `Vídeo de ${observation.creador} (${formatObservationDate(observation.publicadoEl)}) · notas de ${observation.registradoPor}`,
    licenseUrl: null,
    sourceClass: 'third-party',
    claimScope: 'establishment',
  }
}

export interface AttachedCreatorObservation {
  ref: string
  publishable: boolean
  observation: CreatorObservation
  source: SourceProvenance
}

/**
 * Devuelve una copia del artefacto con `creatorObservations` en cada Business confirmado que las tenga.
 * Un Business sin observaciones queda idéntico. No toca `evidence`, `scores`, `sources` ni las
 * investigaciones: se llama después del gate de datos.
 */
export function attachCreatorObservations(artifact: EnrichedComparisonArtifact, data: CreatorObservationData): EnrichedComparisonArtifact {
  if (data.records.length === 0) return artifact
  return {
    ...artifact,
    businesses: artifact.businesses.map((business) => {
      const records = data.records.filter((record) => record.observation.businessId === business.businessId)
      if (records.length === 0) return business
      const order = sortCreatorObservations(records.map((record) => record.observation))
      records.sort((left, right) => order.indexOf(left.observation) - order.indexOf(right.observation))
      return {
        ...business,
        creatorObservations: records.map(({ref, observation, source}) => ({ref, publishable: isPublishable(observation), observation, source})),
      }
    }),
  }
}

/** El artefacto tal como lo recibe Generation: sin evidencia de creadores. */
export function withoutCreatorObservations(artifact: EnrichedComparisonArtifact): EnrichedComparisonArtifact {
  if (!artifact.businesses.some((business) => business.creatorObservations !== undefined)) return artifact
  return {...artifact, businesses: artifact.businesses.map(({creatorObservations: _omitted, ...business}) => business)}
}

export function creatorObservationSummary(data: CreatorObservationData, artifact: EnrichedComparisonArtifact) {
  const attached = artifact.businesses.flatMap((business) => business.creatorObservations ?? [])
  return {
    loaded: data.records.length,
    attached: attached.length,
    publishable: attached.filter((item) => item.publishable).length,
    businesses: artifact.businesses.filter((business) => (business.creatorObservations?.length ?? 0) > 0).map((business) => business.businessId),
  }
}
