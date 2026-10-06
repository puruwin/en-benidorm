import {defineField, defineType} from 'sanity'

export const event = defineType({
  name: 'event', title: 'Evento', type: 'document',
  fields: [
    defineField({name: 'name', title: 'Nombre', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'slug', title: 'Slug', type: 'slug', options: {source: 'name'}, validation: (rule) => rule.required()}),
    defineField({name: 'shortDescription', title: 'Descripción corta', type: 'text', rows: 3, validation: (rule) => rule.required()}),
    defineField({name: 'body', title: 'Descripción completa', type: 'portableText'}),
    defineField({name: 'startDate', title: 'Inicio', type: 'datetime', validation: (rule) => rule.required()}),
    defineField({name: 'endDate', title: 'Fin', type: 'datetime'}),
    defineField({name: 'eventStatus', title: 'Estado', type: 'string', options: {list: [
      {title: 'Programado', value: 'scheduled'}, {title: 'Aplazado', value: 'postponed'},
      {title: 'Cancelado', value: 'cancelled'}, {title: 'Reprogramado', value: 'rescheduled'},
    ]}, initialValue: 'scheduled'}),
    defineField({name: 'venue', title: 'Lugar o negocio', type: 'reference', to: [{type: 'place'}, {type: 'business'}]}),
    defineField({name: 'address', title: 'Dirección alternativa', type: 'address'}),
    defineField({name: 'location', title: 'Coordenadas', type: 'geopoint'}),
    defineField({name: 'organizer', title: 'Organizador', type: 'string'}),
    defineField({name: 'price', title: 'Precio', type: 'string'}),
    defineField({name: 'ticketUrl', title: 'Entradas', type: 'url'}),
    defineField({name: 'categories', title: 'Categorías', type: 'array', of: [{type: 'reference', to: [{type: 'category'}]}]}),
    defineField({name: 'images', title: 'Imágenes', type: 'array', of: [{type: 'imageWithAlt'}]}),
    defineField({name: 'language', title: 'Idioma', type: 'string', initialValue: 'es', readOnly: true}),
    defineField({name: 'lastVerified', title: 'Última verificación', type: 'date'}),
    defineField({name: 'sources', title: 'Fuentes', type: 'array', of: [{type: 'source'}]}),
    defineField({name: 'seo', title: 'SEO', type: 'seo'}),
  ],
})
