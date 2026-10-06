import {areas} from '../content/seed/areas'
import {authors} from '../content/seed/authors'
import {categories} from '../content/seed/categories'
import {homepage} from '../content/seed/homepage'
import {settings} from '../content/seed/settings'
import {type ContentDocument, formatIssues, normalizeDocument, validateContent} from './content-validation'
import {getSanityClient} from './sanity-client'

const replaceDocuments = [settings, homepage].map((document) => normalizeDocument(document as ContentDocument))
const createOnceDocuments = [...areas, ...categories, ...authors].map((document) => normalizeDocument(document as ContentDocument))
const allDocuments = [...replaceDocuments, ...createOnceDocuments]
const inputs = allDocuments.map((document) => ({document, source: `seed:${document._id}`}))
const {issues} = validateContent(inputs)

if (issues.length) {
  console.error(`Seed no válido (${issues.length} errores):\n${formatIssues(issues)}`)
  process.exitCode = 1
} else {
  try {
    const client = getSanityClient({requireToken: true})
    let transaction = client.transaction()
    for (const document of replaceDocuments) transaction = transaction.createOrReplace(document)
    for (const document of createOnceDocuments) transaction = transaction.createIfNotExists(document)
    await transaction.commit({visibility: 'sync'})

    console.log('Seed completado:')
    console.log(`- Sincronizados con createOrReplace: ${replaceDocuments.length} (site-settings, homepage)`)
    console.log(`- Creados si no existían: ${createOnceDocuments.length} (${areas.length} zonas, ${categories.length} categorías, ${authors.length} autor)`)
    console.log('- Errors: 0')
  } catch (error) {
    console.error(`No se pudo completar el seed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
