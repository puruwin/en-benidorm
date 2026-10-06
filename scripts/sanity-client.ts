import {createClient, type SanityClient} from '@sanity/client'
import {loadEnvFile} from 'node:process'

let environmentLoaded = false

function loadEnvironment(): void {
  if (environmentLoaded) return
  environmentLoaded = true
  try {
    loadEnvFile('.env')
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (code !== 'ENOENT') throw error
  }
}

export function getSanityClient(options: {requireToken: boolean}): SanityClient {
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
    ...(token ? {token} : {}),
  })
}
