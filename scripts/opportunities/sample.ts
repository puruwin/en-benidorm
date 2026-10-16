import {readFile, mkdir, writeFile} from 'node:fs/promises'
import {resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {loadJsonDirectory, readJsonIfExists, writeJsonAtomic} from '../content/lib/files'
import type {DiscoveredEntity, DiscoveryRun} from '../content/lib/types'
import type {DiscoveryCoverageReport} from '../content/lib/discovery-coverage'
import type {OpportunityReview} from './lib/types'
import type {VerificationArtifact} from './lib/verification-types'
import {emptyHumanReview, prepareSample, SAMPLE_SEED, sampleMarkdown} from './lib/sample'

export interface SampleOptions {root?: string; seed?: string; size?: number; now?: string}
export async function runOpportunitySample(options: SampleOptions = {}) {
  if (options.size !== undefined && options.size !== 20) throw new Error('P3A.5b define una muestra de 20; --size debe ser 20.')
  const root = options.root ?? process.cwd()
  const [catalog, reviews, verifications, runs, coverage] = await Promise.all([
    loadJsonDirectory<DiscoveredEntity>(resolve(root, 'content/discovered')),
    loadJsonDirectory<OpportunityReview>(resolve(root, 'content/manual/opportunity-reviews')),
    loadJsonDirectory<VerificationArtifact>(resolve(root, 'content/verification')),
    loadJsonDirectory<DiscoveryRun>(resolve(root, 'content/reports/discovery-runs')),
    readJsonIfExists<DiscoveryCoverageReport | null>(resolve(root, 'content/reports/discovery-coverage/latest.json'), null),
  ])
  if (coverage && coverage.totalBusinesses !== catalog.filter(item => item.value.targetDocumentType === 'business').length) {
    throw new Error(`Catálogo incompleto: cobertura=${coverage.totalBusinesses}, registros business=${catalog.filter(item => item.value.targetDocumentType === 'business').length}. Restaura los artefactos originales de P3A.5a; no se escriben muestra ni evaluación.`)
  }
  const report = prepareSample({catalog: catalog.map(item => item.value), reviews: reviews.map(item => item.value),
    verifications: verifications.map(item => item.value), duplicates: [...(coverage?.duplicates.candidates ?? []), ...runs.flatMap(item => item.value.probableDuplicates)]}, options.seed ?? SAMPLE_SEED, options.now)
  const review = emptyHumanReview(report)
  const reviewPath = resolve(root, 'content/manual/opportunity-experiment/sample-20-review.json')
  // Refuse to reassign or erase human answers, even with another seed. Repeat runs preserve the file byte-for-byte.
  let existing: unknown
  try { existing = JSON.parse(await readFile(reviewPath, 'utf8')) } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
  }
  if (existing !== undefined) {
    if (!Array.isArray(existing) || existing.length !== review.length || existing.some((item, index) => !item || item.businessId !== review[index]!.businessId)) {
      throw new Error('La evaluación existente pertenece a otra muestra. Archívala manualmente antes de cambiar la muestra; no se sobrescribe ningún artefacto.')
    }
  }
  await mkdir(dirname(reviewPath), {recursive: true})
  if (existing === undefined) await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, {flag: 'wx'})
  const reportPath = resolve(root, 'content/reports/opportunity-experiment/sample-20.json')
  await writeJsonAtomic(reportPath, report)
  await writeFile(resolve(dirname(reportPath), 'sample-20.md'), sampleMarkdown(report))
  return report
}
function parseArgs(args: string[]): SampleOptions {
  const options: SampleOptions = {}
  for (const arg of args) {
    if (arg.startsWith('--seed=')) options.seed = arg.slice(7)
    else if (arg === '--size=20') options.size = 20
    else throw new Error(`Opción no soportada: ${arg}. Usa --size=20 --seed=frappe-pilot-01.`)
  }
  return options
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const report = await runOpportunitySample(parseArgs(process.argv.slice(2)))
    console.log(JSON.stringify({selected: report.selectedSize, ready: report.ready, seed: report.seed, catalogFingerprint: report.catalogFingerprint, metrics: report.metrics, deviations: report.deviations}, null, 2))
    if (!report.ready) process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
