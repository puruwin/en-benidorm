import {defineField, defineType} from 'sanity'

export const source = defineType({
  name: 'source',
  title: 'Fuente',
  type: 'object',
  fields: [
    defineField({name: 'title', title: 'Título', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'publisher', title: 'Entidad o editor', type: 'string'}),
    defineField({name: 'url', title: 'URL', type: 'url', validation: (rule) => rule.required().uri({scheme: ['http', 'https']})}),
    defineField({name: 'accessedAt', title: 'Consultada el', type: 'date'}),
  ],
  preview: {select: {title: 'title', subtitle: 'publisher'}},
})
