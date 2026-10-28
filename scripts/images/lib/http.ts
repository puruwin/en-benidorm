// Peticiones de los scripts de imágenes: solo a los hosts de los proveedores, sin seguir redirects fuera
// de la lista, con timeout y límite de tamaño. Unsplash no está: su API exige hotlinking (#23).
export const ALLOWED_HOSTS = new Set([
  'commons.wikimedia.org',
  'upload.wikimedia.org',
  'pixabay.com',
  'cdn.pixabay.com',
  'api.pexels.com',
  'images.pexels.com',
])

export interface FetchLimits {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  headers?: Record<string, string>
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

const USER_AGENT = 'enBenidorm-images/1.0 (https://enbenidorm.es/como-trabajamos/)'

export function assertAllowedUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error(`Solo https: ${value}`)
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error(`Host no permitido: ${url.hostname}`)
  return url
}

export async function fetchBytes(value: string, limits: FetchLimits = {}, fetcher: Fetcher = fetch): Promise<{bytes: Buffer; contentType: string}> {
  const maxBytes = limits.maxBytes ?? 30_000_000
  const maxRedirects = limits.maxRedirects ?? 3
  let url = assertAllowedUrl(value)
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await fetcher(url.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(limits.timeoutMs ?? 30_000),
      headers: {'user-agent': USER_AGENT, ...limits.headers},
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`Redirect sin destino desde ${url.hostname}`)
      url = assertAllowedUrl(new URL(location, url).toString())
      continue
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} en ${url.hostname}${url.pathname}`)
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`La respuesta supera ${maxBytes} bytes.`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new Error(`La respuesta supera ${maxBytes} bytes.`)
    return {bytes, contentType: response.headers.get('content-type') ?? ''}
  }
  throw new Error(`Más de ${maxRedirects} redirects.`)
}

export async function fetchJson<T>(value: string, limits: FetchLimits = {}, fetcher: Fetcher = fetch): Promise<T> {
  const {bytes} = await fetchBytes(value, {maxBytes: 5_000_000, ...limits}, fetcher)
  return JSON.parse(bytes.toString('utf8')) as T
}
