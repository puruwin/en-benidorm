import type {BreadcrumbItem, SeoData} from '../types/content'

export interface SeoFallback {
  title: string
  description: string
}

export type ResolvedSeo = SeoData & {title: string; description: string}

const filled = (value: string | undefined): value is string => typeof value === 'string' && value.trim().length > 0

/**
 * Una página indexable debe traer su propio title, description y canonical: si falta alguno, el build falla.
 * Solo una página noindex puede usar el texto de respaldo.
 */
export function resolveSeo(seo: SeoData, fallback: SeoFallback | undefined, canonical: URL | string | undefined, route: string): ResolvedSeo {
  if (!seo.noIndex) {
    const missing = [!filled(seo.title) && 'title', !filled(seo.description) && 'description', !canonical && 'canonical'].filter(Boolean)
    if (missing.length > 0) throw new Error(`[seo] ${route}: página indexable sin ${missing.join(', ')}. Rellénalo en el documento o márcala como noIndex.`)
    return seo as ResolvedSeo
  }
  return {...seo, title: filled(seo.title) ? seo.title : fallback?.title ?? '', description: filled(seo.description) ? seo.description : fallback?.description ?? ''}
}

/** Toda página salvo la de inicio lleva migas que acaban en la página actual. */
export function assertBreadcrumbs(items: readonly BreadcrumbItem[], route: string): void {
  if (route === '/') return
  if (items.length < 2 || items.at(-1)?.href) throw new Error(`[seo] ${route}: las migas deben ir de Inicio a la página actual (sin enlace en el último elemento).`)
}
