// Plain Node entrypoint for a managed hosting panel; no Node CLI loader flags needed.
import {fileURLToPath} from 'node:url'
import {rmSync} from 'node:fs'
import {prepareManagedRuntime} from './tools/content-lab/ops/managed-runtime.mjs'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const runtime = await prepareManagedRuntime({projectRoot, contentPath: process.env.CONTENT_LAB_CONTENT_PATH})
process.once('exit', () => rmSync(runtime.root, {recursive: true, force: true}))
process.chdir(runtime.root)
process.env.CONTENT_LAB_HOST ||= '0.0.0.0'
const {register} = await import('tsx/esm/api')
register()
await import('./tools/content-lab/api/src/production.ts')
