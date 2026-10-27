import type {BreadcrumbItem} from '../types/content'

export const routes = {
  home: () => '/',
  thingsToSee: () => '/que-ver/',
  dining: () => '/donde-comer/',
  diningCategory: (slug: string) => `/donde-comer/${slug}/`,
  restaurant: (slug: string) => `/restaurantes/${slug}/`,
  beaches: () => '/playas/',
  thingsToDo: () => '/que-hacer/',
  accommodation: () => '/donde-dormir/',
  informationPractical: () => '/informacion-practica/',
  author: () => '/sobre-david/',
  events: () => '/eventos/',
  information: () => '/informacion/',
  guides: () => '/guias/',
  guide: (slug: string) => `/guias/${slug}/`,
} as const

export const MIN_INDEXABLE_CATEGORY_ITEMS = 3

// Páginas sin parámetros de src/pages. Añade aquí cada página estática nueva.
const STATIC_ROUTES = [routes.home(), routes.dining(), routes.author()] as const

export interface NavLink { label: string; href: string }

// Hubs de docs/arquitectura-seo.md §2, en el orden del menú.
export const HUBS = {
  thingsToSee: {label: 'Qué ver', href: routes.thingsToSee()},
  dining: {label: 'Dónde comer', href: routes.dining()},
  beaches: {label: 'Playas', href: routes.beaches()},
  thingsToDo: {label: 'Qué hacer', href: routes.thingsToDo()},
  informationPractical: {label: 'Información práctica', href: routes.informationPractical()},
  accommodation: {label: 'Dónde dormir', href: routes.accommodation()},
} as const satisfies Record<string, NavLink>

export type HubKey = keyof typeof HUBS

const FOOTER_LINKS: readonly NavLink[] = [{label: 'Sobre David', href: routes.author()}]

/** Menú y pie: solo los hubs y páginas que genera el build. Un hub sin contenido no sale. */
export async function getNavigation(): Promise<{menu: NavLink[]; footer: NavLink[]}> {
  const existing = await getRouteRegistry()
  const menu = Object.values(HUBS).filter((hub) => existing.has(hub.href))
  return {menu, footer: [...menu, ...FOOTER_LINKS.filter((link) => existing.has(link.href))]}
}

/** Migas Inicio → hub → página actual. El hub solo se enlaza si existe en el registro. */
export function breadcrumbTrail(hub: HubKey | null, current: string, existing: ReadonlySet<string>): BreadcrumbItem[] {
  const parent = hub ? HUBS[hub] : null
  return [
    {label: 'Inicio', href: routes.home()},
    ...(parent ? [existing.has(parent.href) ? {label: parent.label, href: parent.href} : {label: parent.label}] : []),
    {label: current},
  ]
}

let registry: Promise<ReadonlySet<string>> | undefined

/** Rutas que genera el build: estáticas + las mismas que devuelven los getStaticPaths. */
export function getRouteRegistry(): Promise<ReadonlySet<string>> {
  registry ??= buildRegistry()
  return registry
}

async function buildRegistry(): Promise<ReadonlySet<string>> {
  // Import dinámico: content-source → data/demo/content → routes.
  const {getComparisonSlugs, getRestaurantSlugs} = await import('./content-source')
  const [restaurants, comparisons] = await Promise.all([getRestaurantSlugs(), getComparisonSlugs()])
  return new Set<string>([
    ...STATIC_ROUTES,
    ...restaurants.map(routes.restaurant),
    ...comparisons.map(routes.diningCategory),
  ])
}

const warned = new Set<string>()

/** Deja solo los enlaces internos cuya ruta existe; avisa una vez en el log por cada omitido. */
export function filterLinks<T extends {href: string}>(items: readonly T[], existing: ReadonlySet<string>, source: string): T[] {
  return items.filter((item) => {
    if (!item.href.startsWith('/') || item.href.startsWith('//') || existing.has(item.href)) return true
    const key = `${source}|${item.href}`
    if (!warned.has(key)) {
      warned.add(key)
      const label = 'label' in item ? item.label : 'title' in item ? item.title : 'name' in item ? item.name : undefined
      console.warn(`[routes] ${source}: enlace a ruta inexistente omitido: ${item.href}${typeof label === 'string' ? ` («${label}»)` : ''}`)
    }
    return false
  })
}
