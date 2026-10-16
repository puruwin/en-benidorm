import {createApp} from './app'
import {validateProjectRoot, validatePersistentContent} from './project-root'
import {runtimeConfig} from './runtime-config'
import {installProductionWeb} from './production-web'

const root = await validateProjectRoot(process.cwd())
const config = runtimeConfig(process.env, root)
if (config.private) await validatePersistentContent(root)
const app = createApp(root, {config})
try {
  if (config.staticDir) await installProductionWeb(app, config.staticDir)
  await app.listen({host: config.host, port: config.port})
  console.log(`Content Lab: ${config.private ? 'private' : 'local'} mode; listening on ${config.host}:${config.port}`)
  let closing = false
  const shutdown = async () => {
    if (closing) return
    closing = true
    try {await app.close()} catch {process.exitCode = 1}
  }
  process.once('SIGTERM', () => {void shutdown()})
  process.once('SIGINT', () => {void shutdown()})
} catch (error) {
  app.log.error(error)
  await app.close()
  process.exitCode = 1
}
