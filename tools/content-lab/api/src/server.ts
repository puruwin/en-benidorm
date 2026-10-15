import {createApp} from './app'
import {validateProjectRoot} from './project-root'

const root = await validateProjectRoot(process.cwd())
const app = createApp(root)

try {
  await app.listen({host: '127.0.0.1', port: 4174})
  console.log('Content Lab API: http://127.0.0.1:4174')
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}

