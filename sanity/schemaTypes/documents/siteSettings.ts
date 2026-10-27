import {defineField, defineType} from 'sanity'
import {indexableSeoValidation} from '../objects/seo'

export const siteSettings = defineType({
  name: 'siteSettings', title: 'Ajustes del sitio', type: 'document',
  fields: [
    defineField({name: 'siteName', title: 'Nombre', type: 'string', initialValue: 'enBenidorm', validation: (rule) => rule.required()}),
    defineField({name: 'tagline', title: 'Descripción', type: 'string'}),
    // Obsoleto: el menú y el pie salen de src/lib/routes.ts. Se conserva por compatibilidad con los datos guardados.
    defineField({name: 'navigation', title: 'Navegación', type: 'array', deprecated: {reason: 'El menú y el pie salen de src/lib/routes.ts.'}, hidden: true, readOnly: true, of: [{type: 'object', fields: [
      defineField({name: 'label', title: 'Etiqueta', type: 'string', validation: (rule) => rule.required()}),
      defineField({name: 'href', title: 'Ruta', type: 'string', validation: (rule) => rule.required()}),
    ]}]}),
    defineField({name: 'footerText', title: 'Texto del pie', type: 'text'}),
    defineField({name: 'socialLinks', title: 'Redes', type: 'array', of: [{type: 'url'}]}),
    defineField({name: 'diningPage', title: 'Página Dónde comer', type: 'object', fields: [
      defineField({name: 'title', title: 'Título', type: 'string', validation: (rule) => rule.required()}),
      defineField({name: 'intro', title: 'Introducción', type: 'text', rows: 4, validation: (rule) => rule.required()}),
      defineField({name: 'seo', title: 'SEO', type: 'seo', validation: indexableSeoValidation}),
    ]}),
    defineField({name: 'beachesPage', title: 'Página Playas', type: 'object', fields: [
      defineField({name: 'title', title: 'Título', type: 'string', validation: (rule) => rule.required()}),
      defineField({name: 'intro', title: 'Introducción', type: 'text', rows: 4, validation: (rule) => rule.required()}),
      defineField({name: 'seo', title: 'SEO', type: 'seo', validation: indexableSeoValidation}),
    ]}),
    defineField({name: 'informationPage', title: 'Página Información práctica', type: 'object', fields: [
      defineField({name: 'title', title: 'Título', type: 'string', validation: (rule) => rule.required()}),
      defineField({name: 'intro', title: 'Introducción', type: 'text', rows: 4, validation: (rule) => rule.required()}),
      defineField({name: 'seo', title: 'SEO', type: 'seo', validation: indexableSeoValidation}),
    ]}),
    defineField({name: 'thingsToDoPage', title: 'Página Qué hacer', type: 'object', fields: [
      defineField({name: 'title', title: 'Título', type: 'string', validation: (rule) => rule.required()}),
      defineField({name: 'intro', title: 'Introducción', type: 'text', rows: 4, validation: (rule) => rule.required()}),
      defineField({name: 'seo', title: 'SEO', type: 'seo', validation: indexableSeoValidation}),
    ]}),
    defineField({name: 'defaultSeo', title: 'SEO por defecto', type: 'seo'}),
  ],
})
