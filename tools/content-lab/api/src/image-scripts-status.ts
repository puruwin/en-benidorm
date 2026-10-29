import {readdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

// images:find e images:import ejecutan Sanity y argumentos al cargarse, así que se comprueban sus
// dependencias: los lib de scripts/images (que importan de src/) y los módulos compartidos que usan.
const SHARED_MODULES = ['scripts/sanity-client.ts', 'scripts/content/lib/files.ts', 'scripts/content/lib/site-visits.ts']

export interface ImageScriptsStatus {
  ok: boolean
  failures: {module: string; error: string}[]
}

/** Carga los módulos de los scripts de imágenes sin red ni Sanity. */
export async function imageScriptsStatus(root: string): Promise<ImageScriptsStatus> {
  const failures: ImageScriptsStatus['failures'] = []
  let libraries: string[] = []
  try {
    libraries = (await readdir(resolve(root, 'scripts/images/lib'), {withFileTypes: true}))
      .filter(entry => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
      .map(entry => `scripts/images/lib/${entry.name}`).sort()
  } catch {failures.push({module: 'scripts/images/lib', error: 'No existe el directorio.'})}
  for (const module of [...libraries, ...SHARED_MODULES]) {
    try {await import(pathToFileURL(resolve(root, module)).href)}
    catch (error) {failures.push({module, error: error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error)})}
  }
  return {ok: failures.length === 0, failures}
}
