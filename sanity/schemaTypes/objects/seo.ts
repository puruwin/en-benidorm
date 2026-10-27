import {defineField, defineType, type Rule} from 'sanity'
import {indexableSeoIssues, type SeoFields} from '../../lib/seo-rules'

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

/** Validación del campo `seo` en tipos con página pública: título y description (70–155) si es indexable. */
export const indexableSeoValidation = (rule: Rule) => rule.custom<SeoFields | undefined>((value) => {
  const issues = indexableSeoIssues(value)
  return issues.length === 0 ? true : issues.join(' ')
})
