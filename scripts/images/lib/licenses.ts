import {IMAGE_LICENSES} from '../../../src/lib/image-credit'

export interface NormalizedLicense {
  id: string
  url: string
}

export type LicenseDecision = {ok: true; license: NormalizedLicense} | {ok: false; reason: string}

/**
 * Licencia de un fichero de Commons a partir de `extmetadata.License`, `LicenseShortName` y `LicenseUrl`.
 * Solo pasan las de `IMAGE_LICENSES`; las adaptaciones nacionales (cc-by-sa-3.0-es) cuentan como su
 * versión base pero conservan su URL. NC, ND, GFDL sin CC y ficheros sin licencia se descartan.
 */
export function commonsLicense(metadata: {license?: string; shortName?: string; url?: string}): LicenseDecision {
  const code = (metadata.license ?? '').trim().toLowerCase()
  const short = (metadata.shortName ?? '').trim().toLowerCase()
  if (!code && !short) return {ok: false, reason: 'sin licencia'}
  if (/\b(?:nc|nd)\b|-nc\b|-nd\b|noncommercial|noderivs/.test(`${code} ${short}`)) return {ok: false, reason: `licencia no admitida (NC/ND): ${metadata.shortName ?? code}`}
  if (code === 'cc0' || short === 'cc0') return accept('cc0', metadata.url)
  if (code === 'pd' || code.startsWith('pd-') || short.startsWith('public domain') || short === 'dominio público') return accept('public-domain', metadata.url)
  const cc = /^cc-(by(?:-sa)?)-(\d\.\d)(?:-[a-z]{2,})?$/.exec(code) ?? /^cc (by(?:-sa)?) (\d\.\d)(?: [a-z]{2,})?$/.exec(short)
  if (cc) {
    const id = `cc-${cc[1]}-${cc[2]}`
    if (IMAGE_LICENSES[id]) return accept(id, metadata.url)
  }
  return {ok: false, reason: `licencia no admitida: ${metadata.shortName ?? code}`}
}

function accept(id: string, url: string | undefined): LicenseDecision {
  const known = IMAGE_LICENSES[id]
  if (!known) return {ok: false, reason: `licencia desconocida: ${id}`}
  return {ok: true, license: {id, url: url && /^https?:\/\//.test(url) ? url : known.url}}
}

export const PIXABAY_LICENSE: NormalizedLicense = {id: 'pixabay', url: IMAGE_LICENSES.pixabay!.url}
export const PEXELS_LICENSE: NormalizedLicense = {id: 'pexels', url: IMAGE_LICENSES.pexels!.url}
