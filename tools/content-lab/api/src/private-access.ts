import {createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual} from 'node:crypto'
import {promisify} from 'node:util'
import type {FastifyInstance} from 'fastify'
import type {RuntimeConfig} from './runtime-config'

const scrypt = promisify(scryptCallback)
const digest = (value: string) => createHash('sha256').update(value).digest()
const cookieName = '__Host-content_lab'
const sessionPath = '/api/session'
export async function passwordHash(password: string): Promise<string> {
  if (password.length < 12 || password.length > 1024) throw Error('La contraseña debe tener entre 12 y 1024 caracteres.')
  const salt = randomBytes(16).toString('base64url')
  const key = await scrypt(password, salt, 32) as Buffer
  return `scrypt$${salt}$${key.toString('base64url')}`
}
function cookieToken(value: string | undefined) {
  return value?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? ''
}
export function installPrivateAccess(app: FastifyInstance, config: RuntimeConfig) {
  const sessions = new Map<string, number>()
  const failures = new Map<string, {count: number; until: number}>()
  let verifying = 0
  const authenticated = (cookie: string | undefined) => {
    const token = cookieToken(cookie)
    const expires = sessions.get(token)
    if (expires && expires > Date.now()) return true
    if (expires) sessions.delete(token)
    return false
  }
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer')
    if (!config.private) return
    reply.header('Cache-Control', 'no-store').header('X-Frame-Options', 'DENY').header('Strict-Transport-Security', 'max-age=15552000')
      .header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
      .header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if (request.headers.host?.toLowerCase() !== new URL(config.origin!).host.toLowerCase()) return reply.code(403).send({error: 'Host no permitido.'})
    // Cookie-based actions, including login, require the exact configured origin.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (request.headers.origin !== config.origin) return reply.code(403).send({error: 'Origen no permitido.'})
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply.code(415).send({error: 'Se requiere application/json.'})
    }
    const path = request.url.split('?')[0]!
    const publicSession = (path === sessionPath && ['GET', 'HEAD'].includes(request.method)) || ([`${sessionPath}/login`, `${sessionPath}/logout`].includes(path) && request.method === 'POST')
    const shell = path === '/' || path === '/index.html' || path === '/businesses' || path === '/runs' || path === '/opportunities' || path === '/system'
      || /^\/businesses\/business-[a-z0-9][a-z0-9-]*$/.test(path) || /^\/comparisons\/[a-z0-9][a-z0-9-]*$/.test(path) || path.startsWith('/assets/')
    const publicFrontend = ['GET', 'HEAD'].includes(request.method) && shell
    if (!publicSession && !publicFrontend && !authenticated(request.headers.cookie)) return reply.code(401).send({error: 'Inicia sesión para continuar.'})
  })
  app.get(sessionPath, async request => ({authenticationRequired: config.private, authenticated: !config.private || authenticated(request.headers.cookie)}))
  app.post(`${sessionPath}/login`, {bodyLimit: 4096}, async (request, reply) => {
    if (!config.private) return {authenticationRequired: false, authenticated: true}
    const now = Date.now()
    for (const [ip, entry] of failures) if (entry.until <= now) failures.delete(ip)
    const limit = failures.get(request.ip)
    if ((limit?.count ?? 0) >= 10 || verifying >= 2 || (!limit && failures.size >= 1000)) return reply.code(429).header('Retry-After', '60').send({error: 'Demasiados intentos. Espera antes de volver a intentarlo.'})
    failures.set(request.ip, {count: (limit?.count ?? 0) + 1, until: limit?.until ?? now + 60_000})
    const input = request.body as {username?: unknown; password?: unknown} | null
    if (!input || typeof input.username !== 'string' || typeof input.password !== 'string' || input.username.length > 100 || input.password.length > 1024) return reply.code(401).send({error: 'Credenciales incorrectas.'})
    const [, salt, expected] = config.passwordHash!.split('$')
    verifying++
    let key: Buffer
    try {key = await scrypt(input.password, salt!, 32) as Buffer} finally {verifying--}
    if (!timingSafeEqual(digest(input.username), digest(config.username!)) || !timingSafeEqual(key, Buffer.from(expected!, 'base64url'))) return reply.code(401).send({error: 'Credenciales incorrectas.'})
    for (const [token, expires] of sessions) if (expires <= now) sessions.delete(token)
    if (sessions.size >= 100) sessions.delete(sessions.keys().next().value!)
    failures.delete(request.ip)
    const token = randomBytes(32).toString('base64url')
    sessions.set(token, now + config.sessionSeconds * 1000)
    return reply.header('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${config.sessionSeconds}`).send({authenticationRequired: true, authenticated: true})
  })
  app.post(`${sessionPath}/logout`, async (request, reply) => {
    sessions.delete(cookieToken(request.headers.cookie))
    return reply.header('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`).send({authenticated: false})
  })
  app.addHook('onClose', async () => {sessions.clear(); failures.clear()})
  return {authenticated}
}
