import {defineField, defineType} from 'sanity'
import {MUNICIPALITIES} from '../../../scripts/content/lib/practical-facts'

/** Obligatoria por cada municipio distinto de Benidorm que incluya la página. */
export const travelNote = defineType({
  name: 'travelNote',
  title: 'Traslado desde Benidorm',
  type: 'object',
  fields: [
    defineField({name: 'municipality', title: 'Municipio', type: 'string', options: {list: MUNICIPALITIES.filter((name) => name !== 'Benidorm')}, validation: (rule) => rule.required()}),
    defineField({name: 'text', title: 'Cómo llegar desde Benidorm', type: 'text', rows: 2, validation: (rule) => rule.required()}),
  ],
  preview: {select: {title: 'municipality', subtitle: 'text'}},
})
