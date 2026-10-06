import {defineField, defineType} from 'sanity'

export const place = defineType({
  name: 'place', title: 'Lugar', type: 'document',
  fields: [
    defineField({name: 'name', title: 'Nombre', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'slug', title: 'Slug', type: 'slug', options: {source: 'name'}, validation: (rule) => rule.required()}),
    defineField({name: 'shortDescription', title: 'Descripción corta', type: 'text', rows: 3, validation: (rule) => rule.required()}),
    defineField({name: 'body', title: 'Descripción completa', type: 'portableText'}),
    defineField({name: 'placeType', title: 'Tipo de lugar', type: 'string', options: {list: ['Mirador', 'Parque', 'Monumento', 'Ruta', 'Punto de interés']}}),
    defineField({name: 'categories', title: 'Categorías', type: 'array', of: [{type: 'reference', to: [{type: 'category'}]}]}),
    defineField({name: 'address', title: 'Dirección', type: 'address'}),
    defineField({name: 'area', title: 'Zona', type: 'reference', to: [{type: 'area'}]}),
    defineField({name: 'location', title: 'Coordenadas', type: 'geopoint'}),
    defineField({name: 'openingHours', title: 'Horarios', type: 'array', of: [{type: 'openingHours'}]}),
    defineField({name: 'accessInfo', title: 'Acceso y precio', type: 'text'}),
    defineField({name: 'features', title: 'Características', type: 'array', of: [{type: 'reference', to: [{type: 'category'}]}]}),
    defineField({name: 'images', title: 'Imágenes', type: 'array', of: [{type: 'imageWithAlt'}]}),
    defineField({name: 'language', title: 'Idioma', type: 'string', initialValue: 'es', readOnly: true}),
    defineField({name: 'lastVerified', title: 'Última verificación', type: 'date'}),
    defineField({name: 'sources', title: 'Fuentes', type: 'array', of: [{type: 'source'}]}),
    defineField({name: 'seo', title: 'SEO', type: 'seo'}),
  ],
})
