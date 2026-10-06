import {defineField, defineType} from 'sanity'

export const homePage = defineType({
  name: 'homePage', title: 'Portada', type: 'document',
  fields: [
    defineField({name: 'eyebrow', title: 'Antetítulo', type: 'string'}),
    defineField({name: 'title', title: 'Título', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'intro', title: 'Introducción', type: 'text', rows: 4, validation: (rule) => rule.required()}),
    defineField({name: 'heroImage', title: 'Imagen principal', type: 'imageWithAlt'}),
    defineField({name: 'primaryLinks', title: 'Accesos principales', type: 'array', validation: (rule) => rule.max(6), of: [{type: 'object', fields: [
      defineField({name: 'label', title: 'Etiqueta', type: 'string', validation: (rule) => rule.required()}),
      defineField({name: 'description', title: 'Descripción', type: 'string', validation: (rule) => rule.required()}),
      defineField({name: 'href', title: 'Ruta', type: 'string', validation: (rule) => rule.required()}),
      defineField({name: 'accent', title: 'Número', type: 'string', validation: (rule) => rule.required()}),
    ]}]}),
    defineField({name: 'featuredGuides', title: 'Guías destacadas', type: 'array', of: [{type: 'reference', to: [{type: 'article'}]}]}),
    defineField({name: 'recommendedBusinesses', title: 'Negocios recomendados', type: 'array', of: [{type: 'reference', to: [{type: 'business'}]}]}),
    defineField({name: 'featuredPlaces', title: 'Lugares destacados', type: 'array', of: [{type: 'reference', to: [{type: 'place'}, {type: 'beach'}]}]}),
    defineField({name: 'seo', title: 'SEO', type: 'seo'}),
  ],
})
