import {readFile} from 'node:fs/promises'
import {relative, resolve, sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {loadJsonDirectory} from '../content/lib/files'
import {
  type CreatorObservation, type CreatorObservationIssue, collaborationNotice, formatObservationDate, isCreatorObservationPath,
  isPublishable, parseCreatorObservation, priceSeenText, videoPlatform,
} from '../../src/lib/creator-observations'
import type {EnrichedComparisonArtifact} from './lib/types'

/**
 * Valida una observación de creador y muestra dónde se conecta.
 *
 *   npm run creator:process -- content/manual/creator-observations/<archivo>.json
 *
 * No escribe nada. La conexión es el `businessId`: la ficha y las comparativas publicadas del local
 * muestran la observación en el siguiente build, y `comparison:enrich` la adjunta (aparte de
 * `evidence`) cuando se vuelva a ejecutar esa comparativa.
 */

export interface CreatorConnection {
  observation: CreatorObservation
  publishable: boolean
  ficha: {source: string; href: string} | null
  comparisons: Array<{source: string; href: string}>
  enrichedComparisons: Array<{source: string; attached: boolean}>
}

export async function processCreatorObservation(path: string, root = process.cwd(), today?: string): Promise<{connection: CreatorConnection | null; issues: CreatorObservationIssue[]}> {
  const manualRoot = resolve(root, 'content/manual')
  const ref = relative(manualRoot, resolve(root, path)).split(sep).join('/')
  if (!isCreatorObservationPath(ref)) throw new Error(`La observación debe estar en content/manual/creator-observations/ y no empezar por "_" (recibido: ${path}).`)
  const source = `content/manual/${ref}`

  let raw: unknown
  try {
    raw = JSON.parse(await readFile(resolve(manualRoot, ref), 'utf8'))
  } catch (error) {
    return {connection: null, issues: [{source, path: '', message: `No se puede leer el JSON: ${error instanceof Error ? error.message : String(error)}`}]}
  }
  const {observation, issues} = parseCreatorObservation(raw, source, today)
  if (!observation) return {connection: null, issues}

  const businesses = await loadJsonDirectory<{_id?: string; slug?: {current?: string}}>(resolve(root, 'content/generated/businesses'))
  const enrichedIds = new Set((await loadJsonDirectory<{id?: string}>(resolve(root, 'content/enriched'))).map(({value}) => value.id))
  const business = businesses.find(({value}) => value._id === observation.businessId)
  if (!business && !enrichedIds.has(observation.businessId)) {
    return {connection: null, issues: [{source, path: 'businessId', message: `No existe ${observation.businessId} en content/generated/businesses/ ni en content/enriched/.`}]}
  }

  const comparisons = (await loadJsonDirectory<{slug?: {current?: string}; entries?: Array<{business?: {_ref?: string}}>}>(resolve(root, 'content/generated/comparisons')))
    .filter(({value}) => value.entries?.some((entry) => entry.business?._ref === observation.businessId))
    .map(({path: file, value}) => ({source: relativeTo(root, file), href: `/donde-comer/${value.slug?.current}/`}))
  const enrichedComparisons = (await loadJsonDirectory<EnrichedComparisonArtifact>(resolve(root, 'content/comparisons/enriched')))
    .flatMap(({path: file, value}) => {
      const target = value.businesses?.find((item) => item.businessId === observation.businessId)
      return target ? [{source: relativeTo(root, file), attached: Boolean(target.creatorObservations?.some((item) => item.ref === ref))}] : []
    })

  return {
    connection: {
      observation,
      publishable: isPublishable(observation),
      ficha: business ? {source: relativeTo(root, business.path), href: `/restaurantes/${business.value.slug?.current}/`} : null,
      comparisons,
      enrichedComparisons,
    },
    issues: [],
  }
}

function printConnection(path: string, connection: CreatorConnection): void {
  const {observation} = connection
  console.log(`Observación de creador válida: ${path}`)
  console.log(`- ${observation.businessId} · vídeo de ${observation.creador} del ${formatObservationDate(observation.publicadoEl)} (${videoPlatform(observation.urlVideo)})`)
  console.log(`- Registrada por ${observation.registradoPor} el ${formatObservationDate(observation.registradoEl)}`)
  console.log(`- colaboracionPagada: ${observation.colaboracionPagada} · permisoCreador: ${observation.permisoCreador}`)

  console.log('\nBloque «Lo que han contado creadores locales»:')
  if (!connection.publishable) console.log('  NO SE MUESTRA: el creador no ha dado permiso (permisoCreador = "no").')
  else {
    console.log(`  En su vídeo del ${formatObservationDate(observation.publicadoEl)}, ${observation.creador}: ${observation.resumen}`)
    const shown = observation.loQueSeMuestra
    if (shown.platos) console.log(`  Platos que aparecen: ${shown.platos.join(', ')}`)
    for (const price of shown.precios ?? []) console.log(`  Precio visto: ${priceSeenText(price)}`)
    if (shown.ambiente) console.log(`  Ambiente: ${shown.ambiente}`)
    if (shown.espera) console.log(`  Espera: ${shown.espera}`)
    const notice = collaborationNotice(observation.colaboracionPagada)
    if (notice) console.log(`  ${notice}`)
    console.log(`  Enlace: ${observation.urlVideo}`)
  }

  console.log('\nConexión:')
  console.log(connection.ficha ? `- Ficha: ${connection.ficha.href} (${connection.ficha.source})` : '- Ficha: el local no tiene ficha en content/generated/businesses/; no se mostrará hasta que la tenga.')
  if (connection.comparisons.length) for (const item of connection.comparisons) console.log(`- Comparativa: ${item.href} (${item.source})`)
  else console.log('- Comparativa: ninguna comparativa publicada incluye este local.')
  for (const item of connection.enrichedComparisons) console.log(`- Comparison Enrichment: ${item.source} · ${item.attached ? 'ya adjunta' : 'se adjuntará en el próximo comparison:enrich --force'} (evidencia de tercero, fuera del gate)`)
  if (observation.permisoCreador === 'pendiente') console.log('\nAviso: permiso del creador pendiente. Se muestra atribuida y enlazada; si responde que no, cambia permisoCreador a "no".')
}

function relativeTo(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

function report(issues: CreatorObservationIssue[]): void {
  console.error(`Observación de creador no válida (${issues.length} errores):`)
  for (const issue of issues) console.error(`- ${issue.source}${issue.path ? ` · ${issue.path}` : ''}: ${issue.message}`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  try {
    const paths = process.argv.slice(2).filter((argument) => !argument.startsWith('--'))
    if (paths.length !== 1 || process.argv.slice(2).some((argument) => argument.startsWith('--'))) throw new Error('Uso: npm run creator:process -- content/manual/creator-observations/<archivo>.json')
    const {connection, issues} = await processCreatorObservation(paths[0]!)
    if (connection) printConnection(paths[0]!, connection)
    else {
      report(issues)
      process.exitCode = 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
