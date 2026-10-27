import {defineArrayMember, defineField, defineType} from 'sanity'
import {indexableSeoValidation} from '../objects/seo'

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
      name: 'choiceGuide', title: '¿Cuál elegir?', type: 'array', group: 'content', validation: (rule) => rule.required().min(4).max(8).unique(),
      of: [defineArrayMember({
        name: 'comparisonChoice', title: 'Recomendación condicional', type: 'object',
        fields: [
          defineField({name: 'business', title: 'Negocio', type: 'reference', to: [{type: 'business'}], validation: (rule) => rule.required()}),
          defineField({name: 'label', title: 'Caso de uso', type: 'string', validation: (rule) => rule.required()}),
          defineField({name: 'reason', title: 'Motivo respaldado', type: 'text', rows: 2, validation: (rule) => rule.required()}),
        ],
        preview: {select: {title: 'label', subtitle: 'business.name'}},
      })],
    }),
    defineField({
      name: 'entries', title: 'Negocios comparados', type: 'array', group: 'content', validation: (rule) => rule.required().min(4).max(8).unique(),
      of: [defineArrayMember({
        name: 'comparisonEntry', title: 'Entrada', type: 'object',
        fields: [
          defineField({name: 'business', title: 'Negocio', type: 'reference', to: [{type: 'business'}], validation: (rule) => rule.required()}),
          defineField({name: 'verdict', title: 'Veredicto', type: 'text', rows: 3, validation: (rule) => rule.required()}),
          defineField({name: 'strengths', title: 'Puntos fuertes', type: 'array', of: [{type: 'string'}], validation: (rule) => rule.required().min(1)}),
          defineField({name: 'conditions', title: 'Condiciones publicadas', type: 'array', of: [{type: 'string'}], description: 'Condiciones que la fuente sí publica: mínimo de comensales, encargo previo, menú de grupos…'}),
          defineField({name: 'limitations', title: 'Lo que no pudimos comprobar', type: 'array', of: [{type: 'string'}], description: 'Solo datos ausentes o en conflicto en las fuentes.'}),
          defineField({name: 'bestFor', title: 'Adecuado para', type: 'array', of: [{type: 'string'}], validation: (rule) => rule.required().min(1)}),
          defineField({
            name: 'featuredItem', title: 'Plato destacado', type: 'object',
            fields: [
              defineField({name: 'name', title: 'Nombre', type: 'string', validation: (rule) => rule.required()}),
              defineField({name: 'price', title: 'Precio', type: 'number', validation: (rule) => rule.min(0)}),
              defineField({name: 'currency', title: 'Moneda', type: 'string', options: {list: ['EUR']}}),
              defineField({name: 'priceQualifier', title: 'Contexto del precio', type: 'string', description: 'Por persona, por ración, mínimo de comensales u otra condición publicada.'}),
              defineField({name: 'priceUnit', title: 'Unidad del precio', type: 'string', options: {list: [
                {title: 'Por persona', value: 'per-person'},
                {title: 'Por ración', value: 'per-portion'},
                {title: 'Por unidad', value: 'per-unit'},
                {title: 'No indicada en la carta', value: 'ambiguous'},
              ]}}),
              defineField({name: 'source', title: 'Clave de fuente', type: 'string', readOnly: true, validation: (rule) => rule.required()}),
              defineField({name: 'retrievedAt', title: 'Comprobado el', type: 'date', validation: (rule) => rule.required()}),
            ],
          }),
          defineField({name: 'practicalNotes', title: 'Notas prácticas', type: 'array', of: [{type: 'string'}]}),
        ],
        preview: {select: {title: 'business.name', subtitle: 'verdict'}},
      })],
    }),
    defineField({name: 'methodology', title: 'Cómo hacemos esta comparativa', type: 'text', rows: 7, group: 'methodology', validation: (rule) => rule.required()}),
    defineField({name: 'criteria', title: 'Criterios', type: 'array', group: 'methodology', of: [{type: 'string'}], validation: (rule) => rule.required().min(3)}),
    defineField({name: 'author', title: 'Autor', type: 'reference', group: 'methodology', to: [{type: 'author'}], validation: (rule) => rule.required()}),
    defineField({name: 'sources', title: 'Fuentes', type: 'array', group: 'methodology', of: [{type: 'source'}], validation: (rule) => rule.required().min(1)}),
    // El nombre se conserva por compatibilidad; el pipeline guarda aquí la fecha de consulta de las fuentes.
    defineField({name: 'lastVerified', title: 'Fecha de consulta de las fuentes', type: 'date', group: 'methodology', description: 'Fecha más reciente de consulta de las fuentes u observaciones usadas. No es una revisión humana.', validation: (rule) => rule.required()}),
    defineField({name: 'seo', title: 'SEO', type: 'seo', group: 'seo', validation: indexableSeoValidation}),
  ],
  orderings: [{title: 'Tema', name: 'topicAsc', by: [{field: 'topic', direction: 'asc'}]}],
  preview: {select: {title: 'title', subtitle: 'topic'}},
})
