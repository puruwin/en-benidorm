import {defineField, defineType} from 'sanity'

export const callout = defineType({
  name: 'callout', title: 'Destacado', type: 'object',
  fields: [
    defineField({name: 'tone', title: 'Tipo', type: 'string', options: {list: ['Consejo', 'Información', 'Aviso']}, initialValue: 'Consejo'}),
    defineField({name: 'title', title: 'Título', type: 'string'}),
    defineField({name: 'text', title: 'Texto', type: 'text', validation: (rule) => rule.required()}),
  ],
})
