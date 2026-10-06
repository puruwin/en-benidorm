import {defineField, defineType} from 'sanity'

export const category = defineType({
  name: 'category', title: 'Categoría', type: 'document',
  fields: [
    defineField({name: 'title', title: 'Nombre', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'slug', title: 'Slug', type: 'slug', options: {source: 'title', maxLength: 96}, validation: (rule) => rule.required()}),
    defineField({name: 'group', title: 'Grupo', type: 'string', options: {list: [
      {title: 'Sección editorial', value: 'section'}, {title: 'Tipo de negocio', value: 'businessType'},
      {title: 'Tipo de cocina', value: 'cuisine'}, {title: 'Característica o servicio', value: 'feature'},
      {title: 'Tema', value: 'topic'}, {title: 'Tipo de lugar', value: 'placeType'},
    ]}, validation: (rule) => rule.required()}),
    defineField({name: 'description', title: 'Introducción editorial', type: 'text', rows: 5}),
    defineField({name: 'image', title: 'Imagen', type: 'imageWithAlt'}),
    defineField({name: 'indexable', title: 'Puede generar página', type: 'boolean', initialValue: false}),
    defineField({name: 'language', title: 'Idioma', type: 'string', options: {list: [{title: 'Español', value: 'es'}]}, initialValue: 'es', validation: (rule) => rule.required()}),
    defineField({name: 'seo', title: 'SEO', type: 'seo'}),
  ],
  preview: {select: {title: 'title', subtitle: 'group', media: 'image'}},
})
