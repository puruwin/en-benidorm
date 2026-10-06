import {pathToFileURL} from 'node:url'
import {areas} from '../content/seed/areas'
import {authors} from '../content/seed/authors'
import {categories} from '../content/seed/categories'
import {homepage} from '../content/seed/homepage'
import {settings} from '../content/seed/settings'
import {
  type ContentDocument,
  type ContentInput,
  formatIssues,
  loadGeneratedContent,
  normalizeDocument,
  validateContent,
} from './content-validation'

export function seedInputs(): ContentInput[] {
  const documents = [settings, homepage, ...areas, ...categories, ...authors] as ContentDocument[]
  return documents.map((document) => ({document: normalizeDocument(document), source: `seed:${document._id}`}))
}

export async function validateAllContent(): Promise<{inputs: ContentInput[]; errorCount: number}> {
  const loaded = await loadGeneratedContent()
  const inputs = [...seedInputs(), ...loaded.inputs]
  const result = validateContent(inputs)
  const issues = [...loaded.issues, ...result.issues]

  if (issues.length) {
    console.error(`Validación fallida (${issues.length} errores):\n${formatIssues(issues)}`)
  } else {
    const generatedCount = loaded.inputs.length
    console.log('Contenido válido:')
    console.log(`- Seed: ${inputs.length - generatedCount} documentos`)
    console.log(`- Generated: ${generatedCount} documentos JSON`)
    console.log('- Errors: 0')
  }
  return {inputs, errorCount: issues.length}
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const {errorCount} = await validateAllContent()
  if (errorCount) process.exitCode = 1
}
