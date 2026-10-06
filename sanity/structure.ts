import type {StructureResolver} from 'sanity/structure'

const singletonTypes = new Set(['siteSettings', 'homePage'])

export const structure: StructureResolver = (S) =>
  S.list()
    .title('Contenido')
    .items([
      S.listItem().title('Portada').child(S.document().schemaType('homePage').documentId('homepage')),
      S.listItem().title('Ajustes del sitio').child(S.document().schemaType('siteSettings').documentId('site-settings')),
      S.divider(),
      ...S.documentTypeListItems().filter((item) => {
        const id = item.getId()
        return id ? !singletonTypes.has(id) : true
      }),
    ])
