import {defineField, defineType} from 'sanity'

const days = [
  {title: 'Lunes', value: 'monday'}, {title: 'Martes', value: 'tuesday'},
  {title: 'Miércoles', value: 'wednesday'}, {title: 'Jueves', value: 'thursday'},
  {title: 'Viernes', value: 'friday'}, {title: 'Sábado', value: 'saturday'},
  {title: 'Domingo', value: 'sunday'},
]

export const openingHours = defineType({
  name: 'openingHours',
  title: 'Horario',
  type: 'object',
  fields: [
    defineField({name: 'day', title: 'Día', type: 'string', options: {list: days}, validation: (rule) => rule.required()}),
    defineField({name: 'closed', title: 'Cerrado', type: 'boolean', initialValue: false}),
    defineField({name: 'opens', title: 'Abre', type: 'string', description: 'Formato 24 h, por ejemplo 09:30'}),
    defineField({name: 'closes', title: 'Cierra', type: 'string', description: 'Formato 24 h, por ejemplo 23:00'}),
    defineField({name: 'note', title: 'Nota', type: 'string'}),
  ],
  preview: {select: {title: 'day', opens: 'opens', closes: 'closes', closed: 'closed'}, prepare: ({title, opens, closes, closed}) => ({title, subtitle: closed ? 'Cerrado' : `${opens || '—'}–${closes || '—'}`})},
})
