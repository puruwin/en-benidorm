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
      "href": select(section == "informationPractical" => "/informacion-practica/", section == "thingsToDo" => "/que-hacer/", "/guias/") + slug.current + "/",
      "kicker": categories[0]->title,
      "image": heroImage${imageProjection}
    },
    "recommendations": recommendedBusinesses[]->${businessCardProjection},
    "seo": {
      "title": seo.metaTitle,
      "description": seo.metaDescription,
      "noIndex": seo.noIndex,
      "image": seo.socialImage${imageProjection}
    }
  },
  "recent": *[_type == "article" && language == "es"] | order(publishedAt desc)[0...3]{
    title,
    "slug": slug.current,
    excerpt,
    "href": select(section == "informationPractical" => "/informacion-practica/", section == "thingsToDo" => "/que-hacer/", "/guias/") + slug.current + "/",
    "kicker": categories[0]->title,
    "image": heroImage${imageProjection}
  }
}`)

export const DINING_QUERY = defineQuery(`{
  "page": *[_id == "site-settings" && _type == "siteSettings"][0].diningPage{
    title,
    intro,
    "seo": {
      "title": seo.metaTitle,
      "description": seo.metaDescription,
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
  footerText
}`)

export const RESTAURANT_SLUGS_QUERY = defineQuery(`*[_type == "business" && language == "es" && businessKind == "restaurant" && defined(slug.current)].slug.current`)

export const RESTAURANT_QUERY = defineQuery(`*[_type == "business" && language == "es" && businessKind == "restaurant" && slug.current == $slug][0]{
  "id": _id,
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
  commercialRelationship,
  "description": body[_type == "block"]{"text": array::join(children[].text, ""), style, listItem},
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
    "title": seo.metaTitle,
    "description": seo.metaDescription,
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
    verdict, strengths, conditions, limitations, bestFor, featuredItem, practicalNotes,
    "business": business->{"id": _id, name, "slug": slug.current, "href": "/restaurantes/" + slug.current + "/", "kind": businessKind, phone, website}
  },
  methodology,
  criteria,
  "author": author->{name, "slug": slug.current, role},
  sources[]{title, url, publisher, accessedAt},
  lastVerified,
  "seo": {
    "title": seo.metaTitle,
    "description": seo.metaDescription,
    "noIndex": seo.noIndex,
    "image": seo.socialImage${imageProjection}
  }
}`)

export const AUTHOR_QUERY = defineQuery(`*[_type == "author" && language == "es" && slug.current == $slug][0]{
  name, "slug": slug.current, role, bio, methodology, personalVisitDisclosure,
  "seo": {"title": seo.metaTitle, "description": seo.metaDescription, "noIndex": seo.noIndex, "image": seo.socialImage${imageProjection}}
}`)

const beachProjection = `{
  "id": _id,
  name,
  "slug": slug.current,
  "href": "/playas/" + slug.current + "/",
  shortDescription,
  choiceNote,
  "description": body[_type == "block"]{"text": array::join(children[].text, ""), style, listItem},
  "area": area->name,
  municipality,
  "facts": practicalFacts[]{factId, value, unit, status, sourceTitle, sourceUrl, sourceClass, retrievedAt},
  "contrasts": profileContrasts[defined(beach->slug.current)]{"name": beach->name, "href": "/playas/" + beach->slug.current + "/", reason},
  "nearbyDining": nearbyDining[defined(comparison->slug.current)]{"title": comparison->title, "href": "/donde-comer/" + comparison->slug.current + "/", note},
  sources[]{title, url, publisher, accessedAt},
  "seo": {
    "title": seo.metaTitle,
    "description": seo.metaDescription,
    "noIndex": seo.noIndex,
    "image": seo.socialImage${imageProjection}
  }
}`

export const BEACH_SLUGS_QUERY = defineQuery(`*[_type == "beach" && language == "es" && defined(slug.current)].slug.current`)

export const BEACH_QUERY = defineQuery(`*[_type == "beach" && language == "es" && slug.current == $slug][0]${beachProjection}`)

export const BEACHES_QUERY = defineQuery(`{
  "page": *[_id == "site-settings" && _type == "siteSettings"][0].beachesPage{
    title,
    intro,
    "seo": {
      "title": seo.metaTitle,
      "description": seo.metaDescription,
      "noIndex": seo.noIndex,
      "image": seo.socialImage${imageProjection}
    }
  },
  "beaches": *[_type == "beach" && language == "es" && defined(slug.current)] | order(name asc) ${beachProjection}
}`)

// Destinos de contextLinks: guía (Información práctica o Qué hacer) o ficha de playa. Un destino sin publicar se omite.
const guideProjection = `{
  "id": _id,
  title,
  "slug": slug.current,
  "href": select(section == "thingsToDo" => "/que-hacer/", "/informacion-practica/") + slug.current + "/",
  excerpt,
  "description": body[_type == "block"]{"text": array::join(children[].text, ""), style, listItem},
  "facts": practicalFacts[]{factId, value, unit, status, sourceTitle, sourceUrl, sourceClass, retrievedAt},
  "links": contextLinks[defined(target->slug.current)]{
    "title": coalesce(target->title, target->name),
    "href": select(target->_type == "beach" => "/playas/", target->section == "thingsToDo" => "/que-hacer/", "/informacion-practica/") + target->slug.current + "/",
    note
  },
  "author": {"name": coalesce(author->name, "David"), "slug": coalesce(author->slug.current, "david")},
  publishedAt,
  updatedAt,
  sources[]{title, url, publisher, accessedAt},
  "seo": {
    "title": seo.metaTitle,
    "description": seo.metaDescription,
    "noIndex": seo.noIndex,
    "image": seo.socialImage${imageProjection}
  }
}`

export const GUIDE_SLUGS_QUERY = defineQuery(`*[_type == "article" && section == $section && language == "es" && defined(slug.current)].slug.current`)

export const GUIDE_QUERY = defineQuery(`*[_type == "article" && section == $section && language == "es" && slug.current == $slug][0]${guideProjection}`)

export const INFORMATION_QUERY = defineQuery(`{
  "page": *[_id == "site-settings" && _type == "siteSettings"][0].informationPage{
    title,
    intro,
    "seo": {
      "title": seo.metaTitle,
      "description": seo.metaDescription,
      "noIndex": seo.noIndex,
      "image": seo.socialImage${imageProjection}
    }
  },
  "guides": *[_type == "article" && section == "informationPractical" && language == "es" && defined(slug.current)] | order(publishedAt asc, title asc) ${guideProjection}
}`)

export const THINGS_TO_DO_QUERY = defineQuery(`{
  "page": *[_id == "site-settings" && _type == "siteSettings"][0].thingsToDoPage{
    title,
    intro,
    "seo": {
      "title": seo.metaTitle,
      "description": seo.metaDescription,
      "noIndex": seo.noIndex,
      "image": seo.socialImage${imageProjection}
    }
  },
  "guides": *[_type == "article" && section == "thingsToDo" && language == "es" && defined(slug.current)] | order(publishedAt asc, title asc) ${guideProjection}
}`)
