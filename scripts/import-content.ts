import type {SanityClient} from '@sanity/client'
import {
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
import {prepareDraftDocument} from './content/lib/import-drafts'

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
  let remoteStates = new Map<string, RemoteDocumentState>()
  if (!dryRun) {
    try {
      client = getSanityClient({requireToken: true})
      remoteStates = await loadRemoteDocumentStates(client, generatedReferences.map(({ref}) => ref))
      const remoteIssues = validateRemoteReferences(generatedReferences, generatedIds, remoteStates)
      if (remoteIssues.length) return failValidation(remoteIssues)
    } catch (error) {
      console.error(`No se pudo preparar la importación: ${errorMessage(error)}`)
      process.exitCode = 1
      return
    }
  }

  if (!dryRun && client) {
    try {
      await importDrafts(client, loaded.inputs, generatedReferences, remoteStates)
      await markManifestImported(loaded.inputs.map(({document}) => document._id))
    } catch (error) {
      console.error(`La importación falló: ${errorMessage(error)}`)
      process.exitCode = 1
      return
    }
  }

  printSummary(loaded.inputs, dryRun)
}

interface RemoteDocumentState {
  type: string
  published: boolean
  draft: boolean
}

async function loadRemoteDocumentStates(
  client: SanityClient,
  referenceIds: readonly string[],
): Promise<Map<string, RemoteDocumentState>> {
  const ids = [...new Set(referenceIds)]
  const found = new Map<string, RemoteDocumentState>()
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500)
    const allIds = [...chunk, ...chunk.map((id) => `drafts.${id}`)]
    const documents = await client.fetch<Array<{_id: string; _type: string}>>(
      '*[_id in $ids]{_id, _type}',
      {ids: allIds},
    )
    for (const document of documents) {
      const draft = document._id.startsWith('drafts.')
      const id = document._id.replace(/^drafts\./, '')
      const previous = found.get(id)
      found.set(id, {
        type: document._type,
        published: previous?.published === true || !draft,
        draft: previous?.draft === true || draft,
      })
    }
  }
  return found
}

function validateRemoteReferences(
  references: readonly ContentReference[],
  generatedIds: ReadonlySet<string>,
  found: ReadonlyMap<string, RemoteDocumentState>,
): ValidationIssue[] {
  const externalReferences = references.filter(({ref}) => !generatedIds.has(ref))
  const issues: ValidationIssue[] = []
  for (const reference of externalReferences) {
    const target = found.get(reference.ref)
    if (!target) {
      issues.push({source: reference.source, path: reference.path, message: `La referencia "${reference.ref}" no existe en Sanity. Ejecuta primero npm run content:seed o importa su destino.`})
    } else if (reference.allowedTypes && !reference.allowedTypes.includes(target.type)) {
      issues.push({source: reference.source, path: reference.path, message: `La referencia remota es de tipo ${target.type}; se esperaba ${reference.allowedTypes.join(' o ')}.`})
    }
  }
  return issues
}

async function importDrafts(
  client: SanityClient,
  inputs: readonly ContentInput[],
  references: readonly ContentReference[],
  remoteStates: ReadonlyMap<string, RemoteDocumentState>,
): Promise<void> {
  const generatedTypes = new Map(inputs.map(({document}) => [document._id, document._type]))
  const unpublishedTargets = new Map<string, string>()
  for (const reference of references) {
    if (remoteStates.get(reference.ref)?.published) continue
    const targetType = generatedTypes.get(reference.ref) ?? remoteStates.get(reference.ref)?.type ?? reference.allowedTypes?.[0]
    if (targetType) unpublishedTargets.set(reference.ref, targetType)
  }
  for (let index = 0; index < inputs.length; index += 100) {
    let transaction = client.transaction()
    for (const {document} of inputs.slice(index, index + 100)) {
      const draft = prepareDraftDocument(document, unpublishedTargets)
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
    comparison: 'Comparisons',
  }
  const counts = new Map<string, number>()
  for (const {document} of inputs) counts.set(document._type, (counts.get(document._type) ?? 0) + 1)

  console.log(isDryRun ? 'Validated (dry-run; Sanity no se ha modificado):' : 'Imported as drafts:')
  for (const type of ['business', 'place', 'beach', 'event', 'article', 'comparison']) console.log(`${labels[type]}: ${counts.get(type) ?? 0}`)
  console.log('\nErrors: 0')
}
