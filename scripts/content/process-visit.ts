import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {relative, resolve, sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {loadGeneratedContent, loadPracticalFactsContext} from '../content-validation'
import {writeJsonAtomic} from './lib/files'
import {type FactIssue, buildFactRegistry, factValueText, parseOfficialSources} from './lib/practical-facts'
import {type PlannedClaim, type SiteVisit, checkVisitAgainstFacts, isVisitPath, parseSiteVisit, planVisitClaims} from './lib/site-visits'

/**
 * Valida una visita de campo y la conecta con los hechos prácticos de `content/facts/`.
 *
 *   npm run visit:process -- content/manual/visits/<archivo>.json            # solo informa
 *   npm run visit:process -- content/manual/visits/<archivo>.json --write    # añade los claims
 *
 * Solo añade claims `manual-first-party` con el valor que David anotó en la visita y que está escrito
 * en su cita. No crea hechos, no toca `resolution` ni las páginas: si un claim abre un conflicto o deja
 * una copia de página desactualizada, `content:validate` lo dirá.
 */

interface Options {
  path: string
  write: boolean
  confirmed: boolean
}

function parseOptions(args: string[]): Options {
  const paths = args.filter((argument) => !argument.startsWith('--'))
  const unknown = args.filter((argument) => argument.startsWith('--') && !['--write', '--confirmed'].includes(argument))
  if (unknown.length) throw new Error(`Opción no admitida: ${unknown.join(', ')}.`)
  if (paths.length !== 1) throw new Error('Uso: npm run visit:process -- content/manual/visits/<archivo>.json [--write] [--confirmed]')
  return {path: paths[0]!, write: args.includes('--write'), confirmed: args.includes('--confirmed')}
}

export async function processVisit(options: Options, root = process.cwd()): Promise<number> {
  const manualRoot = resolve(root, 'content/manual')
  const ref = relative(manualRoot, resolve(root, options.path)).split(sep).join('/')
  if (!isVisitPath(ref)) throw new Error(`La visita debe estar en content/manual/visits/ y no empezar por "_" (recibido: ${options.path}).`)
  const source = `content/manual/${ref}`

  const parsed = parseSiteVisit(JSON.parse(await readFile(resolve(manualRoot, ref), 'utf8')), source, (photo) => existsSync(resolve(manualRoot, photo)))
  if (!parsed.visit) return report(parsed.issues)
  const visit = parsed.visit

  const {context} = await loadPracticalFactsContext(root)
  const official = parseOfficialSources(context.officialSources, 'content/facts/official-sources.json')
  const registry = buildFactRegistry(context.factFiles, official.sources, context.observations, context.visits)
  const issues = checkVisitAgainstFacts(visit, source, registry.facts)
  printVisit(visit, source)
  if (issues.length) return report(issues)

  const plans = planVisitClaims(visit, ref, registry.facts)
  printPlans(visit, plans)
  await printPageCitations(visit, plans, root)

  const pending = plans.filter((plan) => !plan.alreadyPresent)
  if (!options.write || pending.length === 0) {
    if (pending.length) console.log('\nSin --write no se escribe nada.')
    return 0
  }
  if (pending.some((plan) => plan.needsConfirmation) && !options.confirmed) {
    console.error('\nHay valores booleanos (lectura de la cita, no texto literal). Confírmalos con David y repite con --confirmed.')
    return 1
  }
  const written = await appendClaims(context.factFiles, pending, root)
  for (const file of written) console.log(`Escrito: ${file}`)
  console.log('Ejecuta npm run content:validate: un claim nuevo puede abrir un conflicto o dejar copias de página desactualizadas.')
  return 0
}

function printVisit(visit: SiteVisit, source: string): void {
  console.log(`Visita válida: ${source}`)
  console.log(`- ${visit.place.type} «${visit.place.name}» (${visit.place.municipality}) · ${visit.observedAt} · ${visit.observer}`)
  console.log(`- Página: ${visit.place.documentId ?? 'ninguna (documentId null)'}`)
  console.log(`- Fotos: ${visit.photos.length ? visit.photos.join(', ') : 'ninguna'}`)
}

function printPlans(visit: SiteVisit, plans: PlannedClaim[]): void {
  console.log('\nComprobaciones:')
  for (const [index, check] of visit.checks.entries()) {
    const plan = plans.find((candidate) => candidate.checkIndex === index)
    if (!plan) {
      console.log(`- [${index}] ${check.category}: sin hecho asociado. «${check.quote}»`)
      continue
    }
    const state = plan.alreadyPresent ? 'YA REGISTRADO' : plan.otherValues.length ? 'AÑADIR → CONFLICT' : 'AÑADIR'
    console.log(`- [${index}] ${check.category} → ${plan.factId} = ${factValueText(plan.claim.value)} · ${state}`)
    console.log(`    cita: «${check.quote}»`)
    if (plan.needsConfirmation) console.log('    CONFIRMAR: un booleano es la lectura de la cita, no un texto literal.')
    if (plan.otherValues.length) console.log(`    el hecho ya tiene otros valores: ${plan.otherValues.join('; ')}`)
  }
}

/** Informa de si la página de la visita cita los hechos; las copias las actualiza otro paso. */
async function printPageCitations(visit: SiteVisit, plans: PlannedClaim[], root: string): Promise<void> {
  if (!visit.place.documentId || plans.length === 0) return
  const {inputs} = await loadGeneratedContent(root)
  const page = inputs.find((input) => input.document._id === visit.place.documentId)
  if (!page) {
    console.log(`\nLa página ${visit.place.documentId} no está en content/generated/.`)
    return
  }
  const cited = new Set((Array.isArray(page.document.practicalFacts) ? page.document.practicalFacts : [])
    .map((snapshot: unknown) => (snapshot as {factId?: unknown})?.factId))
  const missing = [...new Set(plans.map((plan) => plan.factId))].filter((factId) => !cited.has(factId))
  if (missing.length) console.log(`\n${page.source} no cita: ${missing.join(', ')}.`)
}

async function appendClaims(files: ReadonlyArray<{source: string; value: unknown}>, plans: PlannedClaim[], root: string): Promise<string[]> {
  const written: string[] = []
  for (const file of files) {
    const value = structuredClone(file.value) as {facts: Array<{id: string; claims: unknown[]}>}
    let changed = false
    for (const plan of plans) {
      const fact = value.facts.find((candidate) => candidate.id === plan.factId)
      if (!fact) continue
      fact.claims.push(plan.claim)
      changed = true
    }
    if (!changed) continue
    await writeJsonAtomic(resolve(root, file.source), value)
    written.push(file.source)
  }
  return written
}

function report(issues: FactIssue[]): number {
  console.error(`Visita no válida (${issues.length} errores):`)
  for (const issue of issues) console.error(`- ${issue.source}${issue.path ? ` · ${issue.path}` : ''}: ${issue.message}`)
  return 1
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  try {
    process.exitCode = await processVisit(parseOptions(process.argv.slice(2)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
