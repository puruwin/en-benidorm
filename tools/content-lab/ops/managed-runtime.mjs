import {access, mkdtemp, readFile, realpath, rm, symlink} from 'node:fs/promises'
import {constants} from 'node:fs'
import {isAbsolute, join, resolve, sep} from 'node:path'
import {tmpdir} from 'node:os'

/** Create a disposable execution root without moving or rewriting the checkout. */
export async function prepareManagedRuntime({projectRoot, contentPath, runtimeParent = tmpdir()}) {
  if (!contentPath || !isAbsolute(contentPath)) throw Error('CONTENT_LAB_CONTENT_PATH debe indicar una ruta absoluta persistente, fuera del directorio del release.')
  const source = await realpath(projectRoot)
  let content
  try {content = await realpath(contentPath)} catch {throw Error('No existe CONTENT_LAB_CONTENT_PATH. Restaura primero el snapshot en el almacenamiento persistente.')}
  if (content === source || content.startsWith(`${source}${sep}`) || source.startsWith(`${content}${sep}`)) throw Error('El contenido persistente debe estar fuera del directorio del release y no puede contenerlo.')
  try {
    await access(content, constants.R_OK | constants.W_OK)
    const manifest = JSON.parse(await readFile(join(content, 'manifest.json'), 'utf8'))
    if (!Array.isArray(manifest.entries)) throw Error('manifest')
  } catch {throw Error('El contenido persistente no es escribible o no tiene un manifest.json válido.')}
  const entries = ['package.json', 'package-lock.json', 'node_modules', 'scripts', 'tools']
  for (const entry of entries) {
    try {await access(join(source, entry))} catch {throw Error('Faltan código o dependencias: ejecuta npm ci --include=dev y construye Content Lab antes de arrancar.')}
  }
  const root = await mkdtemp(join(resolve(runtimeParent), 'content-lab-runtime-'))
  try {
    for (const entry of entries) await symlink(join(source, entry), join(root, entry), ['scripts', 'tools', 'node_modules'].includes(entry) ? 'junction' : 'file')
    await symlink(content, join(root, 'content'), 'junction')
  } catch (error) {await rm(root, {recursive: true, force: true}); throw error}
  return {root, cleanup: () => rm(root, {recursive: true, force: true})}
}
