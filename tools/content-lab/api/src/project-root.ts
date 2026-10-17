import {constants} from 'node:fs'
import {access, readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

export async function validateProjectRoot(root = process.cwd()): Promise<string> {
  const required = ['package.json', 'content', 'scripts']
  const missing: string[] = []
  for (const entry of required) {
    try { await access(resolve(root, entry)) } catch { missing.push(entry) }
  }
  if (missing.length) throw new Error(`Content Lab debe arrancar desde la raíz del proyecto. Faltan: ${missing.join(', ')}`)
  return root
}


export async function validatePersistentContent(root: string): Promise<void> {
  try {
    await access(resolve(root, 'content'), constants.R_OK | constants.W_OK)
    const manifest = JSON.parse(await readFile(resolve(root, 'content/manifest.json'), 'utf8')) as {entries?: unknown}
    if (!Array.isArray(manifest.entries)) throw Error('manifest')
  } catch {throw Error('Content Lab privado requiere content/ persistente y escribible con manifest.json válido. Restaura el snapshot antes de arrancar.')}
}
