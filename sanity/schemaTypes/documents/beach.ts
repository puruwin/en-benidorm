import {defineField, defineType} from 'sanity'

export const beach = defineType({
  name: 'beach', title: 'Playa', type: 'document',
  fields: [
    defineField({name: 'name', title: 'Nombre', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'slug', title: 'Slug', type: 'slug', options: {source: 'name'}, validation: (rule) => rule.required()}),
    defineField({name: 'shortDescription', title: 'Descripción corta', type: 'text', rows: 3, validation: (rule) => rule.required()}),
    defineField({name: 'body', title: 'Descripción completa', type: 'portableText'}),
    defineField({name: 'sandType', title: 'Tipo de arena', type: 'string'}),
    defineField({name: 'lengthMeters', title: 'Longitud (m)', type: 'number', validation: (rule) => rule.positive()}),
    defineField({name: 'accessible', title: 'Accesible', type: 'boolean'}),
    defineField({name: 'services', title: 'Servicios', type: 'array', of: [{type: 'reference', to: [{type: 'category'}]}]}),
    defineField({name: 'lifeguard', title: 'Socorrismo', type: 'boolean'}),
    defineField({name: 'showers', title: 'Duchas', type: 'boolean'}),
    defineField({name: 'parking', title: 'Parking', type: 'string'}),
    defineField({name: 'area', title: 'Zona', type: 'reference', to: [{type: 'area'}]}),
    defineField({name: 'location', title: 'Coordenadas', type: 'geopoint'}),
    defineField({name: 'images', title: 'Imágenes', type: 'array', of: [{type: 'imageWithAlt'}]}),
    defineField({name: 'language', title: 'Idioma', type: 'string', initialValue: 'es', readOnly: true}),
    defineField({name: 'lastVerified', title: 'Última verificación', type: 'date'}),
    defineField({name: 'sources', title: 'Fuentes', type: 'array', of: [{type: 'source'}]}),
    defineField({name: 'seo', title: 'SEO', type: 'seo'}),
  ],
})
