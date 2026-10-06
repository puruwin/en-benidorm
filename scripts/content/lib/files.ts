import {mkdir, readFile, readdir, rename, unlink, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

export async function readJsonIfExists<T>(path: string, fallback: T): Promise<T> {
  try {
    return await readJson<T>(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return fallback
    throw error
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), {recursive: true})
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

export async function loadJsonDirectory<T>(directory: string): Promise<Array<{path: string; value: T}>> {
  let names: string[]
  try {
    names = (await readdir(directory, {withFileTypes: true}))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    throw error
  }
  return Promise.all(names.map(async (name) => {
    const path = resolve(directory, name)
    return {path, value: await readJson<T>(path)}
  }))
}

export async function removeFileIfExists(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
}

function errorCode(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error ? error.code : undefined
}
