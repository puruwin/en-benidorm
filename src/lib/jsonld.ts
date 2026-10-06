import type {BreadcrumbItem, BusinessDetail} from '../types/content'

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

export function restaurantJsonLd(business: BusinessDetail, site: URL) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: business.name,
    description: business.shortDescription,
    url: absoluteUrl(business.href, site),
    ...(business.phone ? {telephone: business.phone} : {}),
    ...(business.website ? {sameAs: business.website} : {}),
    ...(business.priceRange ? {priceRange: business.priceRange} : {}),
    address: {
      '@type': 'PostalAddress',
      streetAddress: business.address.street,
      postalCode: business.address.postalCode,
      addressLocality: business.address.locality,
      addressRegion: business.address.province,
      addressCountry: business.address.country,
    },
    ...(business.location ? {geo: {'@type': 'GeoCoordinates', latitude: business.location.lat, longitude: business.location.lng}} : {}),
    ...(business.images[0]?.url ? {image: business.images[0].url} : {}),
  }
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
