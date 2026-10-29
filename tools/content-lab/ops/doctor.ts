import {resolve} from 'node:path'
import {runtimeConfig} from '../api/src/runtime-config'
import {deploymentStatus} from '../api/src/deployment-status'
import {imageScriptsStatus} from '../api/src/image-scripts-status'
import {prepareManagedRuntime} from './managed-runtime.mjs'

let root = process.cwd()
let runtime: Awaited<ReturnType<typeof prepareManagedRuntime>> | undefined
let configurationError: string | null = null
try {
  if (process.env.CONTENT_LAB_CONTENT_PATH) {
    try {runtime = await prepareManagedRuntime({projectRoot: root, contentPath: process.env.CONTENT_LAB_CONTENT_PATH, synchronize: false}); root = runtime.root}
    catch {configurationError = 'CONTENT_LAB_CONTENT_PATH no es un snapshot externo válido y escribible; revisa su ruta, permisos y manifiesto.'}
  }
  let config = null
  try {config = runtimeConfig({...process.env, NODE_ENV: 'production'}, root)}
  catch (error) {configurationError = error instanceof Error ? error.message : 'Configuración de producción inválida.'}
  const status = await deploymentStatus(resolve(root), config, {configurationError, ...(runtime ? {} : process.env.CONTENT_LAB_CONTENT_PATH ? {contentPath: process.env.CONTENT_LAB_CONTENT_PATH} : {})})
  const imageScripts = await imageScriptsStatus(resolve(root))
  const issues = imageScripts.ok ? status.issues : [...status.issues, `Los scripts de imágenes no cargan: ${imageScripts.failures.map(failure => failure.module).join(', ')}.`]
  const report = {...status, ready: status.ready && imageScripts.ok, imageScripts, issues}
  console.log(JSON.stringify(report, null, 2))
  if (!report.ready) process.exitCode = 1
} finally {if (runtime) await runtime.cleanup()}
