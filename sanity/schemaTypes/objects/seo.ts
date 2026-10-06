import {defineField, defineType} from 'sanity'

export const seo = defineType({
  name: 'seo',
  title: 'SEO',
  type: 'object',
  options: {collapsible: true, collapsed: true},
  fields: [
    defineField({name: 'metaTitle', title: 'Título SEO', type: 'string', validation: (rule) => rule.max(60)}),
    defineField({name: 'metaDescription', title: 'Meta description', type: 'text', rows: 3, validation: (rule) => rule.max(160)}),
    defineField({name: 'socialImage', title: 'Imagen social', type: 'imageWithAlt'}),
    defineField({name: 'noIndex', title: 'No indexar', type: 'boolean', initialValue: false}),
  ],
})
