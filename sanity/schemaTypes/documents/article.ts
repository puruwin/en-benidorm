import {defineField, defineType} from 'sanity'

export const article = defineType({
  name: 'article', title: 'Artículo o guía', type: 'document',
  fields: [
    defineField({name: 'title', title: 'Título', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'slug', title: 'Slug', type: 'slug', options: {source: 'title'}, validation: (rule) => rule.required()}),
    defineField({name: 'section', title: 'Sección de URL', type: 'string', options: {list: [
      {title: 'Guías', value: 'guides'}, {title: 'Qué hacer', value: 'thingsToDo'},
      {title: 'Información', value: 'information'},
    ]}, initialValue: 'guides', validation: (rule) => rule.required()}),
    defineField({name: 'excerpt', title: 'Extracto', type: 'text', rows: 3, validation: (rule) => rule.required().max(240)}),
    defineField({name: 'body', title: 'Contenido', type: 'portableText', validation: (rule) => rule.required()}),
    defineField({name: 'heroImage', title: 'Imagen principal', type: 'imageWithAlt'}),
    defineField({name: 'author', title: 'Autor', type: 'reference', to: [{type: 'author'}]}),
    defineField({name: 'categories', title: 'Categorías', type: 'array', of: [{type: 'reference', to: [{type: 'category'}]}]}),
    defineField({name: 'publishedAt', title: 'Publicado', type: 'datetime', validation: (rule) => rule.required()}),
    defineField({name: 'updatedAt', title: 'Actualizado', type: 'datetime'}),
    defineField({name: 'featured', title: 'Destacado', type: 'boolean', initialValue: false}),
    defineField({name: 'relatedContent', title: 'Contenido relacionado', type: 'array', of: [{type: 'reference', to: [
      {type: 'business'}, {type: 'place'}, {type: 'beach'}, {type: 'event'}, {type: 'article'},
    ]}]}),
    defineField({name: 'language', title: 'Idioma', type: 'string', initialValue: 'es', readOnly: true}),
    defineField({name: 'lastVerified', title: 'Última verificación', type: 'date'}),
    defineField({name: 'sources', title: 'Fuentes', type: 'array', of: [{type: 'source'}]}),
    defineField({name: 'seo', title: 'SEO', type: 'seo'}),
  ],
  preview: {select: {title: 'title', subtitle: 'section', media: 'heroImage'}},
})
