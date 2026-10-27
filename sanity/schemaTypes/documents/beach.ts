import {defineField, defineType} from 'sanity'
import {indexableSeoValidation} from '../objects/seo'
import {MUNICIPALITIES} from '../../../scripts/content/lib/practical-facts'

export const beach = defineType({
  name: 'beach', title: 'Playa', type: 'document',
  fields: [
    defineField({name: 'name', title: 'Nombre', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'slug', title: 'Slug', type: 'slug', options: {source: 'name'}, validation: (rule) => rule.required()}),
    defineField({name: 'shortDescription', title: 'Descripción corta', type: 'text', rows: 3, validation: (rule) => rule.required()}),
    defineField({name: 'body', title: 'Descripción completa', type: 'portableText'}),
    defineField({name: 'choiceNote', title: 'Para quién es', type: 'text', rows: 2, description: 'Una frase «Si buscas…» para el hub de Playas, apoyada en los hechos prácticos de la ficha.'}),
    defineField({name: 'sandType', title: 'Tipo de arena', type: 'string'}),
    defineField({name: 'lengthMeters', title: 'Longitud (m)', type: 'number', validation: (rule) => rule.positive()}),
    defineField({name: 'accessible', title: 'Accesible', type: 'boolean'}),
    defineField({name: 'services', title: 'Servicios', type: 'array', of: [{type: 'reference', to: [{type: 'category'}]}]}),
    defineField({name: 'lifeguard', title: 'Socorrismo', type: 'boolean'}),
    defineField({name: 'showers', title: 'Duchas', type: 'boolean'}),
    defineField({name: 'parking', title: 'Parking', type: 'string', description: 'Campo heredado: en páginas con hechos prácticos, el dato va como hecho con procedencia y este campo queda vacío.'}),
    defineField({name: 'area', title: 'Zona', type: 'reference', to: [{type: 'area'}]}),
    defineField({name: 'location', title: 'Coordenadas', type: 'geopoint'}),
    defineField({name: 'images', title: 'Imágenes', type: 'array', of: [{type: 'imageWithAlt'}]}),
    defineField({name: 'language', title: 'Idioma', type: 'string', initialValue: 'es', readOnly: true}),
    defineField({name: 'municipality', title: 'Municipio', type: 'string', options: {list: [...MUNICIPALITIES]}, description: 'Obligatorio si la página cita hechos prácticos. Fuera de Benidorm exige nota de traslado.'}),
    defineField({name: 'practicalFacts', title: 'Hechos prácticos', type: 'array', of: [{type: 'practicalFact'}], readOnly: true, description: 'Precios, horarios, accesos y tarifas con procedencia; vienen de content/facts/.'}),
    defineField({name: 'travelNotes', title: 'Traslado desde Benidorm', type: 'array', of: [{type: 'travelNote'}]}),
    defineField({name: 'profileContrasts', title: 'Otras playas con perfil distinto', type: 'array', description: 'Enlaces a otras fichas de playa. La diferencia debe salir de sus hechos prácticos.', of: [{type: 'object', fields: [
      // Débil: las fichas se enlazan entre sí en círculo y cada una debe poder publicarse sola.
      // Mientras la otra no esté publicada, la consulta omite el enlace.
      defineField({name: 'beach', title: 'Playa', type: 'reference', to: [{type: 'beach'}], weak: true, validation: (rule) => rule.required()}),
      defineField({name: 'reason', title: 'En qué se diferencia', type: 'text', rows: 2, validation: (rule) => rule.required()}),
    ], preview: {select: {title: 'beach.name', subtitle: 'reason'}}}]}),
    defineField({name: 'nearbyDining', title: 'Dónde comer cerca', type: 'array', description: 'Comparativas con locales registrados en la zona de la playa. Vacío si no hay ninguno.', of: [{type: 'object', fields: [
      defineField({name: 'comparison', title: 'Comparativa', type: 'reference', to: [{type: 'comparison'}], validation: (rule) => rule.required()}),
      defineField({name: 'note', title: 'Qué locales y por qué', type: 'text', rows: 2, validation: (rule) => rule.required()}),
    ], preview: {select: {title: 'comparison.title', subtitle: 'note'}}}]}),
    defineField({name: 'lastVerified', title: 'Última verificación', type: 'date'}),
    defineField({name: 'sources', title: 'Fuentes', type: 'array', of: [{type: 'source'}]}),
    defineField({name: 'seo', title: 'SEO', type: 'seo', validation: indexableSeoValidation}),
  ],
})
