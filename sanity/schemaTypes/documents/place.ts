import {defineField, defineType} from 'sanity'
import {indexableSeoValidation} from '../objects/seo'
import {MUNICIPALITIES} from '../../../scripts/content/lib/practical-facts'

export const place = defineType({
  name: 'place', title: 'Lugar', type: 'document',
  fields: [
    defineField({name: 'name', title: 'Nombre', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'slug', title: 'Slug', type: 'slug', options: {source: 'name'}, validation: (rule) => rule.required()}),
    defineField({name: 'shortDescription', title: 'Descripción corta', type: 'text', rows: 3, validation: (rule) => rule.required()}),
    defineField({name: 'body', title: 'Descripción completa', type: 'portableText'}),
    defineField({name: 'placeType', title: 'Tipo de lugar', type: 'string', options: {list: ['Mirador', 'Parque', 'Monumento', 'Ruta', 'Punto de interés']}}),
    defineField({name: 'categories', title: 'Categorías', type: 'array', of: [{type: 'reference', to: [{type: 'category'}]}]}),
    defineField({name: 'address', title: 'Dirección', type: 'address'}),
    defineField({name: 'area', title: 'Zona', type: 'reference', to: [{type: 'area'}]}),
    defineField({name: 'location', title: 'Coordenadas', type: 'geopoint'}),
    defineField({name: 'openingHours', title: 'Horarios', type: 'array', of: [{type: 'openingHours'}]}),
    defineField({name: 'accessInfo', title: 'Acceso y precio', type: 'text', description: 'Campo heredado: en páginas con hechos prácticos, el dato va como hecho con procedencia y este campo queda vacío.'}),
    defineField({name: 'features', title: 'Características', type: 'array', of: [{type: 'reference', to: [{type: 'category'}]}]}),
    defineField({name: 'images', title: 'Imágenes', type: 'array', of: [{type: 'imageWithAlt'}]}),
    defineField({name: 'language', title: 'Idioma', type: 'string', initialValue: 'es', readOnly: true}),
    defineField({name: 'municipality', title: 'Municipio', type: 'string', options: {list: [...MUNICIPALITIES]}, description: 'Obligatorio si la página cita hechos prácticos. Fuera de Benidorm exige nota de traslado.'}),
    defineField({name: 'practicalFacts', title: 'Hechos prácticos', type: 'array', of: [{type: 'practicalFact'}], readOnly: true, description: 'Precios, horarios, accesos y tarifas con procedencia; vienen de content/facts/.'}),
    defineField({name: 'travelNotes', title: 'Traslado desde Benidorm', type: 'array', of: [{type: 'travelNote'}]}),
    defineField({name: 'lastVerified', title: 'Última verificación', type: 'date'}),
    defineField({name: 'sources', title: 'Fuentes', type: 'array', of: [{type: 'source'}]}),
    defineField({name: 'seo', title: 'SEO', type: 'seo', validation: indexableSeoValidation}),
  ],
})
