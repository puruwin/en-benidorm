export const settings = {
  _id: 'site-settings',
  _type: 'siteSettings',
  siteName: 'enBenidorm',
  tagline: 'Guía local y turística de Benidorm',
  navigation: [
    {_key: 'que-ver', label: 'Qué ver', href: '/que-ver/'},
    {_key: 'donde-comer', label: 'Dónde comer', href: '/donde-comer/'},
    {_key: 'playas', label: 'Playas', href: '/playas/'},
    {_key: 'que-hacer', label: 'Qué hacer', href: '/que-hacer/'},
    {_key: 'informacion', label: 'Información', href: '/informacion-practica/'},
  ],
  footerText: 'Guía local y turística de Benidorm.',
  diningPage: {
    title: 'Dónde comer en Benidorm',
    intro: 'Restaurantes, bares, cafeterías, tapas y arroces para elegir por zona y tipo de cocina.',
    seo: {
      metaTitle: 'Dónde comer en Benidorm · enBenidorm',
      metaDescription: 'Guía de restaurantes, bares y cafeterías en Benidorm por zona, cocina y presupuesto.',
      noIndex: false,
    },
  },
  beachesPage: {
    title: 'Playas de Benidorm: cuál elegir según lo que necesitas',
    intro: 'Levante, Poniente y Mal Pas comparadas con datos del Ayuntamiento de Benidorm y de Turismo de Benidorm: tamaño, socorrismo, aseos, puntos accesibles, perros y aparcamiento. Cada dato enlaza a su fuente; todos se consultaron en la misma fecha.',
    seo: {
      metaTitle: 'Playas de Benidorm: Levante, Poniente y Mal Pas',
      metaDescription: 'Compara las playas de Levante, Poniente y Mal Pas con datos municipales: socorrismo, aseos, puntos accesibles, perros y aparcamiento.',
      noIndex: false,
    },
  },
  informationPage: {
    title: 'Información práctica de Benidorm: aparcar y moverse',
    intro: 'Zona azul, aparcamientos gratuitos y zona de bajas emisiones, con datos del Ayuntamiento de Benidorm. Cada dato enlaza a su fuente; lo que solo dan webs de terceros, como la tarifa de la zona azul, queda pendiente de verificar y sin cifra.',
    seo: {
      metaTitle: 'Información práctica de Benidorm: aparcar y moverse',
      metaDescription: 'Zona azul, aparcamientos gratuitos, zona de bajas emisiones y autobús en Benidorm, con datos municipales enlazados y lo que falta por confirmar.',
      noIndex: false,
    },
  },
  defaultSeo: {
    metaTitle: 'enBenidorm · Guía local y turística de Benidorm',
    metaDescription: 'Guía de Benidorm con playas, restaurantes, lugares, actividades e información práctica.',
    noIndex: false,
  },
}
