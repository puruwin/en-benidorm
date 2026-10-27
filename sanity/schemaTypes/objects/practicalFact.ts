import {defineField, defineType} from 'sanity'
import {FACT_STATUSES, FACT_UNITS, MUNICIPALITIES} from '../../../scripts/content/lib/practical-facts'
import {SOURCE_CLASSES} from '../../../scripts/content/lib/types'

const generated = 'Lo copia la pipeline desde content/facts/; no se edita aquí. content:import rechaza copias que no coinciden.'

/** Copia de un hecho de content/facts/ que cita la página (scripts/content/lib/practical-facts.ts). */
export const practicalFact = defineType({
  name: 'practicalFact',
  title: 'Hecho práctico',
  type: 'object',
  readOnly: true,
  description: generated,
  fields: [
    defineField({name: 'factId', title: 'Id del hecho', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'value', title: 'Valor', type: 'string', description: 'Solo si el estado es confirmed; si no, vacío y no se muestra cifra.'}),
    defineField({name: 'unit', title: 'Unidad', type: 'string', options: {list: [...FACT_UNITS]}, validation: (rule) => rule.required()}),
    defineField({name: 'municipality', title: 'Municipio', type: 'string', options: {list: [...MUNICIPALITIES]}, validation: (rule) => rule.required()}),
    defineField({name: 'status', title: 'Estado', type: 'string', options: {list: [...FACT_STATUSES]}, validation: (rule) => rule.required()}),
    defineField({name: 'sourceTitle', title: 'Fuente', type: 'string'}),
    defineField({name: 'sourceUrl', title: 'URL de la fuente', type: 'url'}),
    defineField({name: 'sourceClass', title: 'Tipo de fuente', type: 'string', options: {list: [...SOURCE_CLASSES]}}),
    defineField({name: 'retrievedAt', title: 'Consultado u observado', type: 'datetime'}),
  ],
  preview: {select: {title: 'factId', value: 'value', unit: 'unit', status: 'status'}, prepare: ({title, value, unit, status}) => ({title, subtitle: value ? `${value} ${unit} · ${status}` : status})},
})
