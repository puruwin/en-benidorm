import {defineField, defineType} from 'sanity'

export const author = defineType({
  name: 'author', title: 'Autor', type: 'document',
  fields: [
    defineField({name: 'name', title: 'Nombre', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'slug', title: 'Slug', type: 'slug', options: {source: 'name'}, validation: (rule) => rule.required()}),
    defineField({name: 'role', title: 'Rol', type: 'string'}),
    defineField({name: 'bio', title: 'Biografía', type: 'text', rows: 5}),
    defineField({name: 'image', title: 'Foto', type: 'imageWithAlt'}),
    defineField({name: 'website', title: 'Web', type: 'url'}),
    defineField({name: 'socialLinks', title: 'Perfiles', type: 'array', of: [{type: 'url'}]}),
    defineField({name: 'language', title: 'Idioma', type: 'string', initialValue: 'es', readOnly: true}),
    defineField({name: 'seo', title: 'SEO', type: 'seo'}),
  ],
})
