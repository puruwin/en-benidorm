import {createHash, randomUUID} from 'node:crypto'
import {lstat, mkdir, readFile, rename, rm, open} from 'node:fs/promises'
import {dirname, join} from 'node:path'
export const digest = data => createHash('sha256').update(data).digest('hex')
export const managedPath = path => /^(verification|opportunities|discovered|enriched)\/[a-zA-Z0-9_-]+\.json$/.test(path) || /^(reports|comparisons\/(candidates|enriched)|generated)\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_-]+\.json$/.test(path) && !path.split('/').some(part => part === '..' || /manual|review/i.test(part))
async function bytes(path) {try {return await readFile(path)} catch (e) {if (e.code === 'ENOENT') return null; throw e}}
async function safePath(root, relative) {
  let current = root
  for (const part of relative.split('/')) {
    current = join(current, part)
    try {const info = await lstat(current); if (info.isSymbolicLink() || (!info.isDirectory() && current !== join(root, relative))) throw Error(`Ruta insegura: ${current}`)} catch (e) {if (e.code !== 'ENOENT') throw e}
  }
  return current
}
async function atomic(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temp, 'wx', 0o600)
    try {await file.writeFile(data); await file.sync()} finally {await file.close()}
    await rename(temp, path)
    const directory = await open(dirname(path), 'r')
    try {await directory.sync()} finally {await directory.close()}
  } finally {await rm(temp, {force: true})}
}
/** Atomic per file; ownership journal supports interrupted deployments. Never deletes data. */
export async function syncArtifacts({projectRoot, contentPath}) {
  const inventory = JSON.parse(await readFile(join(projectRoot, 'tools/content-lab/ops/artifacts.json'), 'utf8'))
  if (inventory.version !== 1 || !inventory.files || Array.isArray(inventory.files)) throw Error('Inventario inválido')
  const sources = []
  for (const [path, hash] of Object.entries(inventory.files)) {
    if (!managedPath(path) || !/^[a-f0-9]{64}$/.test(hash)) throw Error(`Artefacto no permitido: ${path}`)
    const data = await readFile(await safePath(projectRoot, `content/${path}`))
    JSON.parse(data.toString())
    if (digest(data) !== hash) throw Error(`Integridad del release incorrecta: ${path}`)
    sources.push({path, hash, data})
  }
  const stateDir = await safePath(contentPath, '.release-artifacts')
  await mkdir(stateDir, {recursive: true})
  const lock = join(stateDir, 'sync.lock')
  const handle = await open(lock, 'wx').catch(e => {throw Error(`Sincronización bloqueada: ${lock} (${e.code})`)})
  try {
    const statePath = await safePath(contentPath, '.release-artifacts/state.json')
    const raw = await bytes(statePath)
    const state = raw ? JSON.parse(raw.toString()) : {version: 1, files: {}}
    if (state.version !== 1 || !state.files || Array.isArray(state.files)) throw Error('Estado inválido')
    const plan = []
    for (const source of sources) {
      const target = await safePath(contentPath, source.path)
      const current = await bytes(target)
      const hash = current === null ? null : digest(current)
      const owned = state.files[source.path]
      if (hash !== null && hash !== source.hash && (!owned || (hash !== owned.hash && hash !== owned.pending))) throw Error(`Conflicto persistente: ${source.path}. Conservado; requiere revisión explícita.`)
      plan.push({...source, target, currentHash: hash})
    }
    let updated = 0
    for (const item of plan) {
      if (item.currentHash !== item.hash) {
        state.files[item.path] = {hash: item.currentHash, pending: item.hash}
        await atomic(statePath, JSON.stringify(state, null, 2))
        await mkdir(dirname(item.target), {recursive: true})
        const current = await bytes(item.target)
        if ((current === null ? null : digest(current)) !== item.currentHash) throw Error(`Cambio concurrente: ${item.path}`)
        await atomic(item.target, item.data)
        updated++
      }
      if (digest(await readFile(item.target)) !== item.hash) throw Error(`Verificación fallida: ${item.path}`)
      if (state.files[item.path]?.hash !== item.hash || state.files[item.path]?.pending) {
        state.files[item.path] = {hash: item.hash}
        await atomic(statePath, JSON.stringify(state, null, 2))
      }
    }
    return {verified: plan.length, updated}
  } finally {await handle.close(); await rm(lock)}
}
