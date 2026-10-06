import type {SanityClient} from '@sanity/client'
import {
  type ContentDocument,
  type ContentInput,
  type ContentReference,
  type ValidationIssue,
  errorMessage,
  formatIssues,
  loadGeneratedContent,
  validateContent,
} from './content-validation'
import {getSanityClient} from './sanity-client'
import {seedInputs} from './validate-content'
import {markManifestImported} from './content/lib/manifest'

const dryRun = process.argv.slice(2).includes('--dry-run')
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--dry-run')

if (unknownArguments.length) {
  console.error(`Argumentos no reconocidos: ${unknownArguments.join(', ')}`)
  process.exitCode = 1
} else {
  await runImport()
}

async function runImport(): Promise<void> {
  const loaded = await loadGeneratedContent()
  const seed = seedInputs()
  // La importación real puede referenciar documentos ya existentes en Sanity;
  // el dry-run, al no conectarse, exige que todos los destinos estén en seed/generated.
  const validation = validateContent([...seed, ...loaded.inputs], {allowUnresolvedReferences: !dryRun})
  const issues = [...loaded.issues, ...validation.issues]

  if (issues.length) return failValidation(issues)

  const generatedIds = new Set(loaded.inputs.map(({document}) => document._id))
  const generatedReferences = validation.references.filter((reference) => generatedIds.has(reference.sourceId))

  let client: SanityClient | undefined
  if (!dryRun) {
    try {
      client = getSanityClient({requireToken: true})
      const remoteIssues = await validateRemoteReferences(client, generatedReferences, generatedIds)
      if (remoteIssues.length) return failValidation(remoteIssues)
    } catch (error) {
      console.error(`No se pudo preparar la importación: ${errorMessage(error)}`)
      process.exitCode = 1
      return
    }
  }

  if (!dryRun && client) {
    try {
      await importDrafts(client, loaded.inputs)
      await markManifestImported(loaded.inputs.map(({document}) => document._id))
    } catch (error) {
      console.error(`La importación falló: ${errorMessage(error)}`)
      process.exitCode = 1
      return
    }
  }

  printSummary(loaded.inputs, dryRun)
}

async function validateRemoteReferences(
  client: SanityClient,
  references: readonly ContentReference[],
  generatedIds: ReadonlySet<string>,
): Promise<ValidationIssue[]> {
  const externalReferences = references.filter(({ref}) => !generatedIds.has(ref))
  const ids = [...new Set(externalReferences.map(({ref}) => ref))]
  const found = new Map<string, string>()

  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500)
    const draftIds = chunk.map((id) => `drafts.${id}`)
    const documents = await client.fetch<Array<{_id: string; _type: string}>>(
      '*[_id in $ids || _id in $draftIds]{_id, _type}',
      {ids: chunk, draftIds},
    )
    for (const document of documents) found.set(document._id.replace(/^drafts\./, ''), document._type)
  }

  const issues: ValidationIssue[] = []
  for (const reference of externalReferences) {
    const targetType = found.get(reference.ref)
    if (!targetType) {
      issues.push({source: reference.source, path: reference.path, message: `La referencia "${reference.ref}" no existe en Sanity. Ejecuta primero npm run content:seed o importa su destino.`})
    } else if (reference.allowedTypes && !reference.allowedTypes.includes(targetType)) {
      issues.push({source: reference.source, path: reference.path, message: `La referencia remota es de tipo ${targetType}; se esperaba ${reference.allowedTypes.join(' o ')}.`})
    }
  }
  return issues
}

async function importDrafts(client: SanityClient, inputs: readonly ContentInput[]): Promise<void> {
  for (let index = 0; index < inputs.length; index += 100) {
    let transaction = client.transaction()
    for (const {document} of inputs.slice(index, index + 100)) {
      const draft: ContentDocument = {...document, _id: `drafts.${document._id}`}
      transaction = transaction.createOrReplace(draft)
    }
    await transaction.commit({visibility: 'sync'})
  }
}

function failValidation(issues: readonly ValidationIssue[]): void {
  console.error(`Importación cancelada antes de escribir (${issues.length} errores):\n${formatIssues(issues)}`)
  process.exitCode = 1
}

function printSummary(inputs: readonly ContentInput[], isDryRun: boolean): void {
  const labels: Record<string, string> = {
    business: 'Businesses',
    place: 'Places',
    beach: 'Beaches',
    event: 'Events',
    article: 'Articles',
  }
  const counts = new Map<string, number>()
  for (const {document} of inputs) counts.set(document._type, (counts.get(document._type) ?? 0) + 1)

  console.log(isDryRun ? 'Validated (dry-run; Sanity no se ha modificado):' : 'Imported as drafts:')
  for (const type of ['business', 'place', 'beach', 'event', 'article']) console.log(`${labels[type]}: ${counts.get(type) ?? 0}`)
  console.log('\nErrors: 0')
}
