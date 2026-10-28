import type {EditorialImage, ImageProvider} from '../types/content'

// Fuente única de licencias y proveedores: la usan el esquema de Sanity, el crédito y los scripts de imágenes.
// Fuera de la lista (#23): NC (la web tiene uso comercial) y ND (Sanity recorta con el hotspot).
export const IMAGE_LICENSES: Record<string, {label: string; url: string}> = {
  'cc0': {label: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/deed.es'},
  'public-domain': {label: 'Dominio público', url: 'https://creativecommons.org/publicdomain/mark/1.0/deed.es'},
  'cc-by-2.0': {label: 'CC BY 2.0', url: 'https://creativecommons.org/licenses/by/2.0/deed.es'},
  'cc-by-2.5': {label: 'CC BY 2.5', url: 'https://creativecommons.org/licenses/by/2.5/deed.es'},
  'cc-by-3.0': {label: 'CC BY 3.0', url: 'https://creativecommons.org/licenses/by/3.0/deed.es'},
  'cc-by-4.0': {label: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/deed.es'},
  'cc-by-sa-2.0': {label: 'CC BY-SA 2.0', url: 'https://creativecommons.org/licenses/by-sa/2.0/deed.es'},
  'cc-by-sa-2.5': {label: 'CC BY-SA 2.5', url: 'https://creativecommons.org/licenses/by-sa/2.5/deed.es'},
  'cc-by-sa-3.0': {label: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/deed.es'},
  'cc-by-sa-4.0': {label: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.es'},
  'pixabay': {label: 'Pixabay Content License', url: 'https://pixabay.com/service/license-summary/'},
  'pexels': {label: 'Pexels License', url: 'https://www.pexels.com/license/'},
}

export const IMAGE_PROVIDERS: Record<ImageProvider, string> = {
  commons: 'Wikimedia Commons',
  pixabay: 'Pixabay',
  pexels: 'Pexels',
}

export interface CreditPart {
  label: string
  href?: string
  /** El enlace apunta a la licencia (`rel="license"`). */
  license?: true
}

export interface ImageCredit {
  text: string
  parts: CreditPart[]
}

const DATE = new Intl.DateTimeFormat('es-ES', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'})

/**
 * Crédito calculado a partir de la procedencia; nunca se escribe a mano.
 * Propia: «Foto: enBenidorm, <fecha>». Stock: «<autor> / <proveedor> · <licencia>», con enlaces.
 * `null` si falta lo necesario para acreditar: la imagen no debería publicarse (lo marca seo:audit).
 */
export function imageCredit(image: EditorialImage | null | undefined): ImageCredit | null {
  if (image?.origin === 'propia') {
    const date = image.takenAt && !Number.isNaN(Date.parse(image.takenAt)) ? DATE.format(new Date(image.takenAt)) : null
    if (!date) return null
    return credit([{label: 'Foto: enBenidorm, '}, {label: date}])
  }
  if (image?.origin === 'stock') {
    if (!image.author || !image.provider || !image.sourceUrl || !image.license?.id) return null
    const license = IMAGE_LICENSES[image.license.id]
    if (!license) return null
    return credit([
      optionalLink(image.author, image.authorUrl),
      {label: ' / '},
      {label: IMAGE_PROVIDERS[image.provider], href: image.sourceUrl},
      {label: ' · '},
      {label: license.label, href: image.license.url ?? license.url, license: true},
    ])
  }
  return null
}

function optionalLink(label: string, href: string | undefined): CreditPart {
  return href ? {label, href} : {label}
}

function credit(parts: CreditPart[]): ImageCredit {
  return {text: parts.map((part) => part.label).join(''), parts}
}
