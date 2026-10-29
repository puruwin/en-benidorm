import {constants} from 'node:fs'
import {access, readFile, readdir, stat} from 'node:fs/promises'
import {resolve} from 'node:path'
import type {DeploymentStatus} from '../../shared/system-types'
import type {RuntimeConfig} from './runtime-config'
import {BusinessCatalog} from './business-catalog'

export async function deploymentStatus(root: string, config: RuntimeConfig | null, options: {
  environment?: NodeJS.ProcessEnv
  contentPath?: string
  configurationError?: string | null
  businesses?: BusinessCatalog
} = {}): Promise<DeploymentStatus> {
  const environment = options.environment ?? process.env
  const contentPath = options.contentPath ? resolve(options.contentPath) : resolve(root, 'content')
  const issues: string[] = []
  let writable = false
  try {await access(contentPath, constants.R_OK | constants.W_OK); writable = true} catch {issues.push('El directorio content/ no está disponible para lectura y escritura.')}
  let manifest: DeploymentStatus['content']['manifest'] = 'missing'
  let manifestIds: string[] | null = null
  try {
    const data: unknown = JSON.parse(await readFile(resolve(contentPath, 'manifest.json'), 'utf8'))
    if (!data || typeof data !== 'object' || !('entries' in data) || !Array.isArray(data.entries)
      || data.entries.some(entry => !entry || typeof entry.id !== 'string')) throw Error('invalid')
    manifestIds = data.entries.map(entry => entry.id as string)
    manifest = new Set(manifestIds).size === manifestIds.length ? 'valid' : 'invalid'
  } catch (error) {manifest = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid'}
  if (manifest !== 'valid') issues.push('Falta un manifest.json válido; restaura el snapshot completo.')
  let discoveredIds: string[] = []
  try {discoveredIds = (await readdir(resolve(contentPath, 'discovered'), {withFileTypes: true})).filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name.slice(0, -5))} catch {issues.push('No hay directorio discovered/ legible.')}
  const names = new Set(discoveredIds)
  const matchesManifest = manifest === 'valid' && manifestIds !== null && manifestIds.length === names.size && manifestIds.every(id => names.has(id))
  if (!matchesManifest) issues.push('El manifiesto y los archivos de Discovery no corresponden al mismo snapshot.')
  let businesses = 0, catalogWarnings = 0
  try {
    // The hosting execution root maps content/ to the external directory. The CLI
    // uses a temporary root for this same check rather than altering the checkout.
    if (options.contentPath && resolve(options.contentPath) !== resolve(root, 'content')) throw Error('No execution root for external content')
    const list = await (options.businesses ?? new BusinessCatalog(root)).list({pageSize: '1'})
    businesses = list.catalogTotal
    catalogWarnings = list.warnings.filter(message => message.startsWith('content/discovered/')).length
  } catch {issues.push('No se ha podido leer el catálogo de negocios.')}
  if (!businesses) issues.push('No hay negocios disponibles en el catálogo.')
  if (catalogWarnings) issues.push('Hay registros de Discovery inválidos; revisa el snapshot.')
  let frontend: DeploymentStatus['frontend']['status'] = config?.private === false ? 'development' : 'missing'
  if (frontend !== 'development') {
    const indexPath = resolve(config?.staticDir ?? resolve(root, 'tools/content-lab/web/dist'), 'index.html')
    try {if (!(await stat(indexPath)).isFile()) throw Error('not a file'); frontend = 'built'}
    catch {issues.push('Falta el frontend compilado. Ejecuta npm run content-lab:build.')}
  }
  const configurationError = options.configurationError ?? (config ? null : 'Configuración de producción incompleta.')
  if (configurationError) issues.push(configurationError)
  const integrations = ([['OpenAI', ['OPENAI_API_KEY']], ['Sanity', ['SANITY_PROJECT_ID', 'SANITY_DATASET', 'SANITY_API_TOKEN']],
    ['Imágenes', ['SANITY_PROJECT_ID', 'SANITY_DATASET', 'SANITY_IMAGES_TOKEN', 'PIXABAY_API_KEY', 'PEXELS_API_KEY']]] as const).map(([name, variables]) => {
    const missingVariables = variables.filter(variable => !environment[variable]?.trim())
    return {name, configured: missingVariables.length === 0, missingVariables: [...missingVariables], connection: 'not-tested' as const}
  })
  return {checkedAt: new Date().toISOString(), mode: config?.private === false ? 'local' : 'private', ready: issues.length === 0,
    nodeVersion: process.version, configuration: {status: configurationError ? 'invalid' : 'ok', error: configurationError},
    frontend: {status: frontend}, content: {writable, manifest, manifestEntries: manifestIds?.length ?? null,
      discoveredRecords: discoveredIds.length, businesses, matchesManifest, catalogWarnings}, integrations, issues}
}
