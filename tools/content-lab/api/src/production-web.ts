import {readFile, realpath, stat} from 'node:fs/promises'
import {resolve, sep, extname} from 'node:path'
import type {FastifyInstance} from 'fastify'

const types: Record<string, string> = {'.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2'}
export async function installProductionWeb(app: FastifyInstance, directory: string) {
  const root = await realpath(directory)
  const index = await readFile(resolve(root, 'index.html'))
  app.setNotFoundHandler(async (request, reply) => {
    const path = request.url.split('?')[0]!
    if (!['GET', 'HEAD'].includes(request.method) || path === '/api' || path.startsWith('/api/')) return reply.code(404).send({error: 'Ruta no encontrada.'})
    let decoded: string
    try {decoded = decodeURIComponent(path)} catch {return reply.code(400).send({error: 'Ruta inválida.'})}
    if (decoded.startsWith('/assets/')) {
      if (!types[extname(decoded)] || decoded.includes('..') || decoded.includes('\\') || decoded.includes('\0')) return reply.code(404).send({error: 'Recurso no encontrado.'})
      try {
        const file = await realpath(resolve(root, `.${decoded}`))
        if (!file.startsWith(`${root}${sep}`) || !(await stat(file)).isFile()) return reply.code(404).send({error: 'Recurso no encontrado.'})
        return reply.type(types[extname(file)]!).send(await readFile(file))
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return reply.code(404).send({error: 'Recurso no encontrado.'})
        throw error
      }
    }
    const spa = decoded === '/' || decoded === '/index.html' || decoded === '/businesses' || /^\/businesses\/business-[a-z0-9][a-z0-9-]*$/.test(decoded)
      || decoded === '/system' || decoded === '/runs' || /^\/comparisons\/[a-z0-9][a-z0-9-]*$/.test(decoded)
      || decoded === '/images' || /^\/images\/[a-z0-9][a-z0-9-]{0,100}$/.test(decoded)
    if (!spa) return reply.code(404).send({error: 'Ruta no encontrada.'})
    return reply.type('text/html; charset=utf-8').send(index)
  })
}
