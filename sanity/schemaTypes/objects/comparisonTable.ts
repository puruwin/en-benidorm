import {defineField, defineType} from 'sanity'

export const comparisonTable = defineType({
  name: 'comparisonTable', title: 'Tabla comparativa', type: 'object',
  fields: [
    defineField({name: 'caption', title: 'Título accesible', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'columns', title: 'Columnas', type: 'array', of: [{type: 'string'}], validation: (rule) => rule.min(2)}),
    defineField({name: 'rows', title: 'Filas', type: 'array', of: [{type: 'object', fields: [defineField({name: 'cells', title: 'Celdas', type: 'array', of: [{type: 'string'}]})]}]}),
  ],
})
