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
  guide: (slug: string) => `/guias/${slug}/`,
} as const

export const MIN_INDEXABLE_CATEGORY_ITEMS = 3
