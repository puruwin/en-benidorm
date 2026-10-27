export const routes = {
  home: () => '/',
  thingsToSee: () => '/que-ver/',
  dining: () => '/donde-comer/',
  diningCategory: (slug: string) => `/donde-comer/${slug}/`,
  restaurant: (slug: string) => `/restaurantes/${slug}/`,
  beaches: () => '/playas/',
  thingsToDo: () => '/que-hacer/',
  accommodation: () => '/donde-dormir/',
  events: () => '/eventos/',
  information: () => '/informacion/',
  guides: () => '/guias/',
  guide: (slug: string) => `/guias/${slug}/`,
} as const

export const MIN_INDEXABLE_CATEGORY_ITEMS = 3

// Páginas sin parámetros de src/pages. Añade aquí cada página estática nueva.
const STATIC_ROUTES = [routes.home(), routes.dining(), '/sobre-david/'] as const

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
