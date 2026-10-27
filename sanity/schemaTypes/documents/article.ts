import {defineField, defineType} from 'sanity'
import {indexableSeoValidation} from '../objects/seo'

export const article = defineType({
  name: 'article', title: 'Artículo o guía', type: 'document',
  fields: [
    defineField({name: 'title', title: 'Título', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'slug', title: 'Slug', type: 'slug', options: {source: 'title'}, validation: (rule) => rule.required()}),
    defineField({name: 'section', title: 'Sección de URL', type: 'string', options: {list: [
      {title: 'Guías', value: 'guides'}, {title: 'Qué hacer', value: 'thingsToDo'},
      {title: 'Información', value: 'information'}, {title: 'Información práctica', value: 'informationPractical'},
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
    defineField({name: 'contextLinks', title: 'Enlaces con motivo', type: 'array', description: 'Otras guías o fichas que el lector necesita después de esta, con la razón. La razón debe salir de sus hechos prácticos.', of: [{type: 'object', fields: [
      // Débil: las guías se enlazan entre sí en círculo y cada una debe poder publicarse sola.
      // Mientras el destino no esté publicado, la consulta omite el enlace.
      defineField({name: 'target', title: 'Destino', type: 'reference', to: [{type: 'article'}, {type: 'beach'}], weak: true, validation: (rule) => rule.required()}),
      defineField({name: 'note', title: 'Por qué ir ahí', type: 'text', rows: 2, validation: (rule) => rule.required()}),
    ], preview: {select: {title: 'target.title', subtitle: 'note'}}}]}),
    defineField({name: 'language', title: 'Idioma', type: 'string', initialValue: 'es', readOnly: true}),
    defineField({name: 'practicalFacts', title: 'Hechos prácticos', type: 'array', of: [{type: 'practicalFact'}], readOnly: true, description: 'Precios, horarios, accesos y tarifas con procedencia; vienen de content/facts/.'}),
    defineField({name: 'travelNotes', title: 'Traslado desde Benidorm', type: 'array', of: [{type: 'travelNote'}]}),
    defineField({name: 'lastVerified', title: 'Última verificación', type: 'date'}),
    defineField({name: 'sources', title: 'Fuentes', type: 'array', of: [{type: 'source'}]}),
    defineField({name: 'seo', title: 'SEO', type: 'seo', validation: indexableSeoValidation}),
  ],
  preview: {select: {title: 'title', subtitle: 'section', media: 'heroImage'}},
})
