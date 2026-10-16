import {resolve} from 'node:path'

export interface RuntimeConfig {
  private: boolean
  host: string
  port: number
  origin: string | null
  username: string | null
  passwordHash: string | null
  staticDir: string | null
  sessionSeconds: number
}
export function runtimeConfig(env: NodeJS.ProcessEnv, root: string): RuntimeConfig {
  if (env.CONTENT_LAB_MODE && !['local', 'private'].includes(env.CONTENT_LAB_MODE)) throw Error('CONTENT_LAB_MODE debe ser local o private.')
  const privateMode = env.NODE_ENV === 'production' || env.CONTENT_LAB_MODE === 'private'
  if (env.NODE_ENV === 'production' && env.CONTENT_LAB_MODE === 'local') throw Error('No se permite modo local en producción.')
  const host = env.CONTENT_LAB_HOST || '127.0.0.1'
  if (!privateMode && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw Error('El modo local sólo puede escuchar en loopback.')
  const port = Number(env.CONTENT_LAB_PORT || env.PORT || (privateMode ? '3000' : '4174'))
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Puerto de Content Lab inválido.')
  let origin: string | null = null
  if (privateMode) {
    try {
      const url = new URL(env.CONTENT_LAB_ORIGIN ?? '')
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error()
      origin = url.origin
    } catch {throw Error('CONTENT_LAB_ORIGIN debe ser el origen HTTPS público, sin path ni credenciales.')}
    if (!env.CONTENT_LAB_AUTH_USER?.trim() || env.CONTENT_LAB_AUTH_USER.length > 100) throw Error('Falta CONTENT_LAB_AUTH_USER válido.')
    if (!/^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/.test(env.CONTENT_LAB_PASSWORD_HASH ?? '')) throw Error('Falta CONTENT_LAB_PASSWORD_HASH válido; usa content-lab:password.')
  }
  return {private: privateMode, host, port, origin, username: privateMode ? env.CONTENT_LAB_AUTH_USER! : null,
    passwordHash: privateMode ? env.CONTENT_LAB_PASSWORD_HASH! : null,
    staticDir: privateMode ? resolve(root, 'tools/content-lab/web/dist') : null, sessionSeconds: 12 * 60 * 60}
}
