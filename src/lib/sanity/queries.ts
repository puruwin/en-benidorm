import {defineQuery} from 'groq'

const imageProjection = `{
  alt,
  caption,
  credit,
  "url": asset->url,
  "sanity": {asset, crop, hotspot},
  "width": asset->metadata.dimensions.width,
  "height": asset->metadata.dimensions.height
}`

const businessCardProjection = `{
  "name": name,
  "slug": slug.current,
  shortDescription,
  "href": "/restaurantes/" + slug.current + "/",
  "kind": businessKind,
  "area": area->name,
  priceRange,
  "categories": categories[]->title,
  recommended,
  sponsored,
  "image": images[0]${imageProjection}
}`

export const HOME_QUERY = defineQuery(`{
  "page": *[_id == "homepage" && _type == "homePage"][0]{
    eyebrow,
    title,
    intro,
    primaryLinks[]{label, description, href, accent},
    "heroImage": heroImage${imageProjection},
    "guides": featuredGuides[]->{
      title,
      "slug": slug.current,
      excerpt,
      "href": "/guias/" + slug.current + "/",
      "kicker": categories[0]->title,
      "image": heroImage${imageProjection}
    },
    "recommendations": recommendedBusinesses[]->${businessCardProjection},
    "seo": {
      "title": coalesce(seo.metaTitle, title + " · enBenidorm"),
      "description": coalesce(seo.metaDescription, intro),
      "noIndex": seo.noIndex,
      "image": seo.socialImage${imageProjection}
    }
  },
  "recent": *[_type == "article" && language == "es"] | order(publishedAt desc)[0...3]{
    title,
    "slug": slug.current,
    excerpt,
    "href": "/guias/" + slug.current + "/",
    "kicker": categories[0]->title,
    "image": heroImage${imageProjection}
  }
}`)

export const DINING_QUERY = defineQuery(`{
  "page": *[_id == "site-settings" && _type == "siteSettings"][0].diningPage{
    title,
    intro,
    "seo": {
      "title": coalesce(seo.metaTitle, title + " · enBenidorm"),
      "description": coalesce(seo.metaDescription, intro),
      "noIndex": seo.noIndex,
      "image": seo.socialImage${imageProjection}
    }
  },
  "businesses": *[_type == "business" && language == "es" && businessKind in ["restaurant", "bar", "pub", "cafe"]] | order(recommended desc, name asc) ${businessCardProjection},
  "categories": *[_type == "category" && language == "es" && indexable == true && group in ["businessType", "cuisine"]]{
    title,
    "slug": slug.current,
    description,
    "href": "/donde-comer/#restaurantes",
    "count": count(*[_type == "business" && references(^._id)])
  }[count >= 3] | order(title asc),
  "comparisons": *[_type == "comparison" && language == "es" && category == "donde-comer" && seo.noIndex != true] | order(title asc){
    title, "slug": slug.current, "href": "/donde-comer/" + slug.current + "/"
  }
}`)

export const SETTINGS_QUERY = defineQuery(`*[_id == "site-settings" && _type == "siteSettings"][0]{
  siteName,
  tagline,
  navigation[]{label, href},
  footerText
}`)

export const RESTAURANT_SLUGS_QUERY = defineQuery(`*[_type == "business" && language == "es" && businessKind == "restaurant" && defined(slug.current)].slug.current`)

export const RESTAURANT_QUERY = defineQuery(`*[_type == "business" && language == "es" && businessKind == "restaurant" && slug.current == $slug][0]{
  "name": name,
  "slug": slug.current,
  shortDescription,
  "href": "/restaurantes/" + slug.current + "/",
  "kind": businessKind,
  "area": area->name,
  priceRange,
  "categories": categories[]->title,
  recommended,
  sponsored,
  "description": body[_type == "block"].children[].text,
  address,
  phone,
  website,
  googleMapsUrl,
  "location": {"lat": location.lat, "lng": location.lng},
  "hours": openingHours[]{"day": day, "value": select(closed == true => "Cerrado", opens + "–" + closes)},
  "features": features[]->title,
  "images": images[]${imageProjection},
  lastVerified,
  sources[]{title, url, publisher, accessedAt},
  "comparisons": *[_type == "comparison" && references(^._id)]{title, "slug": slug.current, "href": "/donde-comer/" + slug.current + "/"},
  "seo": {
    "title": coalesce(seo.metaTitle, name + " en Benidorm"),
    "description": coalesce(seo.metaDescription, shortDescription),
    "noIndex": seo.noIndex,
    "image": seo.socialImage${imageProjection}
  }
}`)

export const COMPARISON_SLUGS_QUERY = defineQuery(`*[_type == "comparison" && language == "es" && category == "donde-comer" && defined(slug.current)].slug.current`)

export const COMPARISON_QUERY = defineQuery(`*[_type == "comparison" && language == "es" && category == "donde-comer" && slug.current == $slug][0]{
  title,
  "slug": slug.current,
  "href": "/donde-comer/" + slug.current + "/",
  topic,
  intro,
  quickVerdict,
  choiceGuide[]{label, reason, "business": business->{name, "slug": slug.current, "href": "/restaurantes/" + slug.current + "/"}},
  entries[]{
    verdict, strengths, limitations, bestFor, featuredItem, practicalNotes,
    "business": business->{name, "slug": slug.current, "href": "/restaurantes/" + slug.current + "/", "kind": businessKind, phone, website}
  },
  methodology,
  criteria,
  "author": author->{name, "slug": slug.current, role},
  sources[]{title, url, publisher, accessedAt},
  lastVerified,
  "seo": {
    "title": coalesce(seo.metaTitle, title + " · enBenidorm"),
    "description": coalesce(seo.metaDescription, intro),
    "noIndex": seo.noIndex,
    "image": seo.socialImage${imageProjection}
  }
}`)

export const AUTHOR_QUERY = defineQuery(`*[_type == "author" && language == "es" && slug.current == $slug][0]{
  name, "slug": slug.current, role, bio, methodology, personalVisitDisclosure,
  "seo": {"title": coalesce(seo.metaTitle, name + " · enBenidorm"), "description": coalesce(seo.metaDescription, bio), "noIndex": seo.noIndex, "image": seo.socialImage${imageProjection}}
}`)
