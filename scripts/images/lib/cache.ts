import {createHash} from 'node:crypto'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Caché en disco de las respuestas de las API (24 h, lo que pide Pixabay). El nombre es el hash de la
 * petición: la clave de API no se guarda en claro.
 */
export function createJsonCache(directory: string, now: () => number = Date.now) {
  const path = (key: string) => join(directory, `${createHash('sha256').update(key).digest('hex')}.json`)
  return {
    async get<T>(key: string): Promise<T | undefined> {
      try {
        const entry = JSON.parse(await readFile(path(key), 'utf8')) as {storedAt: number; value: T}
        return now() - entry.storedAt < CACHE_TTL_MS ? entry.value : undefined
      } catch {
        return undefined
      }
    },
    async set(key: string, value: unknown): Promise<void> {
      await mkdir(directory, {recursive: true})
      await writeFile(path(key), JSON.stringify({storedAt: now(), value}))
    },
  }
}

export type JsonCache = ReturnType<typeof createJsonCache>
