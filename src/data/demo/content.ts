import heroImage from '../../assets/images/benidorm-hero-demo.png'
import {routes} from '../../lib/routes'
import type {BusinessDetail, DiningPageContent, HomeContent, SiteSettingsData} from '../../types/content'

const demoHero = {
  local: heroImage,
  alt: 'Vista panorámica DEMO del litoral y el skyline de Benidorm al atardecer',
  caption: 'Imagen generada para la demostración visual de enBenidorm.',
}

export const demoBusinesses: BusinessDetail[] = [
  {
    name: 'Arroz & Brisa · DEMO', slug: 'arroz-y-brisa-demo', href: routes.restaurant('arroz-y-brisa-demo'),
    kind: 'Restaurante mediterráneo', area: 'Casco Antiguo', priceRange: '€€',
    shortDescription: 'Arroces alicantinos y producto mediterráneo en una terraza tranquila cerca del centro histórico.',
    categories: ['Mediterránea', 'Arroces'], recommended: true, sponsored: false,
    description: ['Este establecimiento es ficticio y se incluye únicamente para probar el diseño y el modelo de contenido.', 'La ficha muestra cómo aparecerían la información práctica, los horarios, las fuentes y la fecha de verificación de un restaurante real.'],
    address: {street: 'Carrer de Mostra, 12', postalCode: '03501', locality: 'Benidorm', province: 'Alicante', country: 'ES'},
    phone: '+34 965 000 001', website: 'https://example.com', googleMapsUrl: 'https://maps.google.com/?q=Benidorm',
    location: {lat: 38.5369, lng: -0.1312},
    hours: [{day: 'Lunes a jueves', value: '13:00–23:00'}, {day: 'Viernes a domingo', value: '12:30–23:30'}],
    features: ['Terraza', 'Opciones vegetarianas', 'Acceso sin escalones'], images: [demoHero],
    lastVerified: '2026-10-06', sources: [{title: 'Fuente de ejemplo · DEMO', url: 'https://example.com', publisher: 'enBenidorm'}],
    seo: {title: 'Arroz & Brisa · Restaurante DEMO en Benidorm', description: 'Ficha de demostración de un restaurante mediterráneo ficticio en Benidorm.'},
  },
  {
    name: 'La Esquina Azul · DEMO', slug: 'la-esquina-azul-demo', href: routes.restaurant('la-esquina-azul-demo'),
    kind: 'Bar de tapas', area: 'Centro', priceRange: '€',
    shortDescription: 'Tapas sencillas, barra animada y una ubicación práctica para una parada informal en el centro.',
    categories: ['Tapas', 'Informal'], recommended: true, sponsored: false,
    description: ['Negocio ficticio creado para demostrar el portal. No representa un establecimiento real.'],
    address: {street: 'Plaça de Mostra, 4', postalCode: '03501', locality: 'Benidorm', province: 'Alicante', country: 'ES'},
    googleMapsUrl: 'https://maps.google.com/?q=Benidorm', hours: [{day: 'Todos los días', value: '11:00–00:00'}],
    features: ['Terraza', 'Tapas'], images: [demoHero], lastVerified: '2026-10-06', sources: [],
    seo: {title: 'La Esquina Azul · Bar DEMO', description: 'Ficha de demostración de un bar ficticio en Benidorm.'},
  },
  {
    name: 'Mercat de Ponent · DEMO', slug: 'mercat-de-ponent-demo', href: routes.restaurant('mercat-de-ponent-demo'),
    kind: 'Restaurante contemporáneo', area: 'Poniente', priceRange: '€€€',
    shortDescription: 'Cocina contemporánea inspirada en el mercado y una carta pensada para compartir frente al mar.',
    categories: ['Contemporánea', 'Vistas al mar'], recommended: false, sponsored: true,
    description: ['Negocio ficticio creado para demostrar el tratamiento transparente de contenido patrocinado.'],
    address: {street: 'Avinguda de Mostra, 30', postalCode: '03502', locality: 'Benidorm', province: 'Alicante', country: 'ES'},
    googleMapsUrl: 'https://maps.google.com/?q=Benidorm', hours: [{day: 'Martes a domingo', value: '13:00–23:30'}],
    features: ['Vistas al mar', 'Reservas'], images: [demoHero], lastVerified: '2026-10-06', sources: [],
    seo: {title: 'Mercat de Ponent · Restaurante DEMO', description: 'Ficha patrocinada de demostración para un restaurante ficticio.'},
  },
]

const demoGuides = [
  {title: 'Benidorm en 48 horas · DEMO', slug: 'benidorm-en-48-horas-demo', href: routes.guide('benidorm-en-48-horas-demo'), excerpt: 'Un recorrido equilibrado entre playa, casco histórico, miradores y buenos sitios para comer.', kicker: 'Itinerarios', image: demoHero},
  {title: 'Los mejores miradores · DEMO', slug: 'miradores-de-benidorm-demo', href: routes.guide('miradores-de-benidorm-demo'), excerpt: 'Dónde encontrar panorámicas del skyline, la costa y la Serra Gelada.', kicker: 'Qué ver', image: demoHero},
  {title: 'Benidorm con niños · DEMO', slug: 'benidorm-con-ninos-demo', href: routes.guide('benidorm-con-ninos-demo'), excerpt: 'Ideas prácticas para organizar días de playa y actividades en familia.', kicker: 'Familias', image: demoHero},
]

export const demoHome: HomeContent = {
  eyebrow: 'La guía local que va al grano',
  title: 'Benidorm, bien contado.',
  intro: 'Playas, barrios, mesas, planes y respuestas útiles para descubrir la ciudad antes del viaje y mientras estás aquí.',
  heroImage: demoHero,
  primaryLinks: [
    {label: 'Qué ver', href: routes.thingsToSee(), description: 'Skyline, miradores y casco antiguo', accent: '01'},
    {label: 'Dónde comer', href: routes.dining(), description: 'Restaurantes, tapas y arroces', accent: '02'},
    {label: 'Playas', href: routes.beaches(), description: 'Levante, Poniente y calas', accent: '03'},
    {label: 'Qué hacer', href: routes.thingsToDo(), description: 'Planes, rutas y actividades', accent: '04'},
    {label: 'Dónde dormir', href: routes.accommodation(), description: 'Zonas y alojamientos', accent: '05'},
    {label: 'Información práctica', href: routes.information(), description: 'Moverse, aparcar y orientarse', accent: '06'},
  ],
  guides: demoGuides,
  recommendations: demoBusinesses,
  recent: [...demoGuides].reverse(),
  seo: {title: 'enBenidorm · Guía local y turística de Benidorm', description: 'Guía independiente de Benidorm con playas, restaurantes, lugares, actividades y consejos prácticos.'},
}

export const demoDining: DiningPageContent = {
  title: 'Dónde comer en Benidorm',
  intro: 'Una selección editorial para encontrar desde tapas y arroces hasta mesas especiales. Durante la fase DEMO todos los negocios mostrados son ficticios.',
  categories: [
    {title: 'Restaurantes mediterráneos', slug: 'mediterranea', href: '/donde-comer/#restaurantes', description: 'Producto local, arroces y cocina de costa.', count: 3},
    {title: 'Tapas y comida informal', slug: 'tapas', href: '/donde-comer/#restaurantes', description: 'Barras y mesas sencillas para compartir.', count: 3},
    {title: 'Con vistas al mar', slug: 'vistas-al-mar', href: '/donde-comer/#restaurantes', description: 'Sitios donde el entorno también cuenta.', count: 3},
  ],
  businesses: demoBusinesses,
  comparisons: [],
  seo: {title: 'Dónde comer en Benidorm · enBenidorm', description: 'Guía para elegir restaurantes, bares y cafeterías en Benidorm por zona, estilo y presupuesto.'},
}

export const demoSettings: SiteSettingsData = {
  siteName: 'enBenidorm',
  tagline: 'Guía local y turística de Benidorm',
  navigation: [
    {label: 'Qué ver', href: routes.thingsToSee()},
    {label: 'Dónde comer', href: routes.dining()},
    {label: 'Playas', href: routes.beaches()},
    {label: 'Qué hacer', href: routes.thingsToDo()},
    {label: 'Información', href: routes.information()},
  ],
  footerText: 'Una guía local independiente para entender, disfrutar y recorrer Benidorm.',
}
