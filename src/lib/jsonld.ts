import type {BeachDetail, BreadcrumbItem, BusinessDetail, ComparisonDetail, GuideDetail} from '../types/content'

const absoluteUrl = (path: string, site: URL): string => new URL(path, site).toString()

export function breadcrumbJsonLd(items: BreadcrumbItem[], site: URL) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      ...(item.href ? {item: absoluteUrl(item.href, site)} : {}),
    })),
  }
}

export function websiteJsonLd(site: URL) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'enBenidorm',
    url: site.toString(),
    inLanguage: 'es',
    description: 'Guía local y turística de Benidorm.',
  }
}

const present = (value: string | undefined): value is string => typeof value === 'string' && value.trim().length > 0

/** Solo campos con valor y visibles en la ficha. Nunca valoraciones agregadas ni reseñas. */
export function restaurantJsonLd(business: BusinessDetail, site: URL) {
  const address = Object.fromEntries(([
    ['streetAddress', business.address.street],
    ['postalCode', business.address.postalCode],
    ['addressLocality', business.address.locality],
    ['addressRegion', business.address.province],
    ['addressCountry', business.address.country],
  ] as const).filter(([, value]) => present(value)))
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: business.name,
    ...(present(business.shortDescription) ? {description: business.shortDescription} : {}),
    url: absoluteUrl(business.href, site),
    ...(present(business.phone) ? {telephone: business.phone} : {}),
    ...(present(business.website) ? {sameAs: business.website} : {}),
    ...(present(business.priceRange) ? {priceRange: business.priceRange} : {}),
    ...(Object.keys(address).length > 0 ? {address: {'@type': 'PostalAddress', ...address}} : {}),
    ...(business.location ? {geo: {'@type': 'GeoCoordinates', latitude: business.location.lat, longitude: business.location.lng}} : {}),
    ...(present(business.images[0]?.url) ? {image: business.images[0].url} : {}),
  }
}

export function comparisonItemListJsonLd(comparison: ComparisonDetail, site: URL) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: comparison.title,
    url: absoluteUrl(comparison.href, site),
    numberOfItems: comparison.entries.length,
    itemListOrder: 'https://schema.org/ItemListUnordered',
    itemListElement: comparison.entries.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.business.name,
      url: absoluteUrl(entry.business.href, site),
    })),
  }
}

/** Playa: nombre, descripción y municipio, todo visible en la ficha. Sin geo: la ficha no muestra coordenadas. */
export function beachJsonLd(beach: BeachDetail, site: URL) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Beach',
    name: beach.name,
    ...(present(beach.shortDescription) ? {description: beach.shortDescription} : {}),
    url: absoluteUrl(beach.href, site),
    ...(present(beach.municipality) ? {address: {'@type': 'PostalAddress', addressLocality: beach.municipality}} : {}),
  }
}

/** Guía: titular, autor y fechas visibles en la página. */
export function guideJsonLd(guide: GuideDetail, site: URL) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.title,
    ...(present(guide.excerpt) ? {description: guide.excerpt} : {}),
    url: absoluteUrl(guide.href, site),
    author: {'@type': 'Person', name: guide.author.name, url: absoluteUrl(`/sobre-${guide.author.slug}/`, site)},
    datePublished: guide.publishedAt.slice(0, 10),
    ...(guide.updatedAt ? {dateModified: guide.updatedAt.slice(0, 10)} : {}),
  }
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
