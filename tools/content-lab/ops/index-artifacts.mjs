import {execFileSync} from 'node:child_process'
import {readFile, writeFile} from 'node:fs/promises'
import {digest, managedPath} from './sync-artifacts.mjs'
const files = {}
for (const path of execFileSync('git', ['ls-files', '-z', 'content']).toString().split('\0').filter(Boolean).sort()) {
  const relative = path.slice('content/'.length)
  if (!managedPath(relative)) continue
  const data = await readFile(path)
  JSON.parse(data.toString())
  files[relative] = digest(data)
}
await writeFile('tools/content-lab/ops/artifacts.json', JSON.stringify({version: 1, files}, null, 2) + '\n')
console.log(`Inventario: ${Object.keys(files).length} artefactos versionados`)
