import {defineField, defineType} from 'sanity'
import {IMAGE_LICENSES, IMAGE_PROVIDERS} from '../../../src/lib/image-credit'

const licenseOptions = Object.entries(IMAGE_LICENSES).map(([value, {label}]) => ({title: label, value}))
const providerOptions = Object.entries(IMAGE_PROVIDERS).map(([value, title]) => ({title, value}))

interface ImageValue {
  origin?: 'propia' | 'stock'
  provider?: string
  sourceUrl?: string
  author?: string
  license?: {id?: string; url?: string}
  takenAt?: string
}

/** Qué falta para que la procedencia de la imagen sea trazable; vacío si está completa. */
export function imageProvenanceIssues(value: ImageValue | undefined): string[] {
  if (!value) return []
  if (!value.origin) return ['Falta el origen (propia o stock).']
  if (value.origin === 'propia') {
    return [
      !value.takenAt && 'Una foto propia necesita la fecha en que se hizo.',
      value.provider && 'Una foto propia no tiene proveedor de stock.',
    ].filter((issue): issue is string => Boolean(issue))
  }
  return [
    !value.provider && 'proveedor',
    !value.sourceUrl && 'URL de origen',
    !value.author && 'autor',
    !value.license?.id && 'licencia',
  ].filter((field): field is string => Boolean(field)).map((field) => `Una imagen de stock necesita ${field}.`)
}

const notStock = ({parent}: {parent?: unknown}) => (parent as ImageValue | undefined)?.origin !== 'stock'

export const imageWithAlt = defineType({
  name: 'imageWithAlt',
  title: 'Imagen editorial',
  type: 'image',
  options: {hotspot: true, metadata: ['blurhash', 'lqip', 'palette']},
  validation: (rule) => rule.custom((value) => {
    const issues = imageProvenanceIssues(value as ImageValue | undefined)
    return issues.length ? issues.join(' ') : true
  }),
  fields: [
    defineField({name: 'alt', title: 'Texto alternativo', type: 'string', description: 'Describe lo que se ve. No copies la descripción de la fuente.', validation: (rule) => rule.required()}),
    defineField({name: 'caption', title: 'Pie de foto', type: 'string', description: 'Solo nombra un lugar si «Lugar verificado» está marcado.'}),
    defineField({
      name: 'origin', title: 'Origen', type: 'string',
      options: {list: [{title: 'Propia', value: 'propia'}, {title: 'Stock', value: 'stock'}], layout: 'radio'},
      validation: (rule) => rule.required(),
    }),
    defineField({name: 'provider', title: 'Proveedor', type: 'string', options: {list: providerOptions}, hidden: notStock}),
    defineField({name: 'sourceUrl', title: 'URL de origen', type: 'url', hidden: notStock}),
    defineField({name: 'author', title: 'Autor', type: 'string', hidden: notStock}),
    defineField({name: 'authorUrl', title: 'URL del autor', type: 'url', hidden: notStock}),
    defineField({
      name: 'license', title: 'Licencia', type: 'object', hidden: notStock,
      fields: [
        defineField({name: 'id', title: 'Licencia', type: 'string', options: {list: licenseOptions}}),
        defineField({name: 'url', title: 'URL de la licencia', type: 'url'}),
      ],
    }),
    defineField({name: 'takenAt', title: 'Fecha de la foto', type: 'date'}),
    defineField({name: 'retrievedAt', title: 'Fecha de descarga', type: 'datetime', hidden: notStock}),
    defineField({
      name: 'placeVerified', title: 'Lugar verificado', type: 'boolean', initialValue: false,
      description: 'Marcado solo si la imagen es del lugar que nombran el pie o el alt (categoría de Commons, coordenadas o comprobación de David).',
    }),
    defineField({name: 'approvedBy', title: 'Aprobada por', type: 'string', validation: (rule) => rule.required()}),
    // Obsoleto (#23): el crédito se calcula con src/lib/image-credit.ts. Se conserva para no perder datos antiguos.
    defineField({name: 'credit', title: 'Crédito (obsoleto)', type: 'string', readOnly: true, hidden: ({value}) => !value, description: 'Obsoleto: el crédito se calcula a partir del origen y la licencia.'}),
  ],
})
