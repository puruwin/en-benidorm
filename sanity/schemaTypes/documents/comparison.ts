import {defineArrayMember, defineField, defineType} from 'sanity'

export const comparison = defineType({
  name: 'comparison', title: 'Comparativa', type: 'document',
  groups: [
    {name: 'content', title: 'Contenido', default: true},
    {name: 'methodology', title: 'Metodología'},
    {name: 'seo', title: 'SEO'},
  ],
  fields: [
    defineField({name: 'title', title: 'Título', type: 'string', group: 'content', validation: (rule) => rule.required()}),
    defineField({name: 'slug', title: 'Slug', type: 'slug', group: 'content', options: {source: 'title'}, validation: (rule) => rule.required()}),
    defineField({name: 'language', title: 'Idioma', type: 'string', group: 'content', initialValue: 'es', readOnly: true, validation: (rule) => rule.required()}),
    defineField({name: 'topic', title: 'Tema', type: 'string', group: 'content', validation: (rule) => rule.required()}),
    defineField({name: 'category', title: 'Categoría de ruta', type: 'string', group: 'content', initialValue: 'donde-comer', readOnly: true, validation: (rule) => rule.required()}),
    defineField({name: 'area', title: 'Zona (opcional)', type: 'reference', group: 'content', to: [{type: 'area'}]}),
    defineField({name: 'intro', title: 'Introducción', type: 'text', rows: 5, group: 'content', validation: (rule) => rule.required()}),
    defineField({name: 'quickVerdict', title: 'Veredicto rápido', type: 'text', rows: 5, group: 'content', validation: (rule) => rule.required()}),
    defineField({
      name: 'entries', title: 'Negocios comparados', type: 'array', group: 'content', validation: (rule) => rule.required().min(4).max(8).unique(),
      of: [defineArrayMember({
        name: 'comparisonEntry', title: 'Entrada', type: 'object',
        fields: [
          defineField({name: 'business', title: 'Negocio', type: 'reference', to: [{type: 'business'}], validation: (rule) => rule.required()}),
          defineField({name: 'rank', title: 'Posición', type: 'number', validation: (rule) => rule.required().integer().min(1)}),
          defineField({name: 'verdict', title: 'Veredicto', type: 'text', rows: 3, validation: (rule) => rule.required()}),
          defineField({name: 'strengths', title: 'Puntos fuertes', type: 'array', of: [{type: 'string'}], validation: (rule) => rule.required().min(1)}),
          defineField({name: 'weaknesses', title: 'Inconvenientes verificados', type: 'array', of: [{type: 'string'}]}),
          defineField({name: 'bestFor', title: 'Adecuado para', type: 'array', of: [{type: 'string'}], validation: (rule) => rule.required().min(1)}),
          defineField({name: 'featuredItem', title: 'Plato destacado', type: 'string'}),
          defineField({name: 'featuredPrice', title: 'Precio de referencia', type: 'string'}),
          defineField({name: 'practicalNotes', title: 'Notas prácticas', type: 'array', of: [{type: 'string'}]}),
        ],
        preview: {select: {title: 'business.name', subtitle: 'verdict'}},
      })],
    }),
    defineField({name: 'methodology', title: 'Cómo hacemos esta comparativa', type: 'text', rows: 7, group: 'methodology', validation: (rule) => rule.required()}),
    defineField({name: 'criteria', title: 'Criterios', type: 'array', group: 'methodology', of: [{type: 'string'}], validation: (rule) => rule.required().min(3)}),
    defineField({name: 'author', title: 'Autor', type: 'reference', group: 'methodology', to: [{type: 'author'}], validation: (rule) => rule.required()}),
    defineField({name: 'sources', title: 'Fuentes', type: 'array', group: 'methodology', of: [{type: 'source'}], validation: (rule) => rule.required().min(1)}),
    defineField({name: 'lastVerified', title: 'Última comprobación', type: 'date', group: 'methodology', validation: (rule) => rule.required()}),
    defineField({name: 'seo', title: 'SEO', type: 'seo', group: 'seo', validation: (rule) => rule.required()}),
  ],
  orderings: [{title: 'Tema', name: 'topicAsc', by: [{field: 'topic', direction: 'asc'}]}],
  preview: {select: {title: 'title', subtitle: 'topic'}},
})
