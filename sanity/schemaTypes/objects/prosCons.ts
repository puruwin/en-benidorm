import {defineField, defineType} from 'sanity'

export const prosCons = defineType({
  name: 'prosCons', title: 'Pros y contras', type: 'object',
  fields: [
    defineField({name: 'pros', title: 'A favor', type: 'array', of: [{type: 'string'}]}),
    defineField({name: 'cons', title: 'A tener en cuenta', type: 'array', of: [{type: 'string'}]}),
  ],
})
