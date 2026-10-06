import {defineField, defineType} from 'sanity'

export const address = defineType({
  name: 'address',
  title: 'Dirección',
  type: 'object',
  fields: [
    defineField({name: 'street', title: 'Calle y número', type: 'string'}),
    defineField({name: 'postalCode', title: 'Código postal', type: 'string'}),
    defineField({name: 'locality', title: 'Localidad', type: 'string', initialValue: 'Benidorm'}),
    defineField({name: 'province', title: 'Provincia', type: 'string', initialValue: 'Alicante'}),
    defineField({name: 'country', title: 'País', type: 'string', initialValue: 'ES'}),
  ],
})
