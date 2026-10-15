import {access} from 'node:fs/promises'
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

