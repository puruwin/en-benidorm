import {defineArrayMember, defineType} from 'sanity'

export const portableText = defineType({
  name: 'portableText', title: 'Contenido', type: 'array',
  of: [
    defineArrayMember({
      type: 'block',
      styles: [
        {title: 'Normal', value: 'normal'}, {title: 'H2', value: 'h2'},
        {title: 'H3', value: 'h3'}, {title: 'Cita', value: 'blockquote'},
      ],
      marks: {annotations: [defineArrayMember({name: 'link', type: 'object', fields: [{name: 'href', type: 'url', title: 'URL'}]})]},
    }),
    defineArrayMember({type: 'imageWithAlt'}),
    defineArrayMember({type: 'callout'}),
    defineArrayMember({type: 'prosCons'}),
    defineArrayMember({type: 'comparisonTable'}),
  ],
})
