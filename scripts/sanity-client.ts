import {createClient, type SanityClient} from '@sanity/client'
import {loadEnvFile} from 'node:process'

let environmentLoaded = false

export function loadEnvironment(): void {
  if (environmentLoaded) return
  environmentLoaded = true
  // Content Lab lanza algunos runs con un entorno de lista cerrada: .env no debe rellenar lo que dejó fuera.
  if (process.env.CONTENT_LAB_CLOSED_ENV === '1') return
  try {
    loadEnvFile('.env')
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (code !== 'ENOENT') throw error
  }
}

/** `perspective: 'raw'` ve borradores: con esta apiVersion la perspectiva por defecto es `published`. */
export function getSanityClient(options: {requireToken: boolean; perspective?: 'raw'}): SanityClient {
  loadEnvironment()
  const projectId = process.env.SANITY_PROJECT_ID
  const dataset = process.env.SANITY_DATASET
  const token = process.env.SANITY_API_TOKEN

  const missing = [
    !projectId && 'SANITY_PROJECT_ID',
    !dataset && 'SANITY_DATASET',
    options.requireToken && !token && 'SANITY_API_TOKEN',
  ].filter(Boolean)
  if (missing.length) throw new Error(`Faltan variables de entorno: ${missing.join(', ')}.`)

  return createClient({
    projectId: projectId!,
    dataset: dataset!,
    apiVersion: '2025-02-19',
    useCdn: false,
    ...(options.perspective ? {perspective: options.perspective} : {}),
    ...(token ? {token} : {}),
  })
}
