import {defineField, defineType} from 'sanity'

export const imageWithAlt = defineType({
  name: 'imageWithAlt',
  title: 'Imagen editorial',
  type: 'image',
  options: {hotspot: true, metadata: ['blurhash', 'lqip', 'palette']},
  fields: [
    defineField({name: 'alt', title: 'Texto alternativo', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'caption', title: 'Pie de foto', type: 'string'}),
    defineField({name: 'credit', title: 'Crédito', type: 'string'}),
  ],
})
