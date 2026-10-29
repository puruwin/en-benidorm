export interface DeploymentStatus {
  checkedAt: string
  mode: 'private' | 'local'
  ready: boolean
  nodeVersion: string
  configuration: {status: 'ok' | 'invalid'; error: string | null}
  frontend: {status: 'built' | 'missing' | 'development'}
  content: {
    writable: boolean
    manifest: 'valid' | 'missing' | 'invalid'
    manifestEntries: number | null
    discoveredRecords: number
    businesses: number
    matchesManifest: boolean
    catalogWarnings: number
  }
  integrations: Array<{name: 'OpenAI' | 'Sanity' | 'Imágenes'; configured: boolean; missingVariables: string[]; connection: 'not-tested'}>
  issues: string[]
}
