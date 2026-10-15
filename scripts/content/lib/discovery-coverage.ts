import {resolve} from 'node:path'
import {BUSINESS_SECTORS} from './business-taxonomy'
import {writeJsonAtomic} from './files'
import type {DiscoveredEntity, ProbableDuplicate} from './types'

export interface CoverageMetric {
  discovered: number
  unique: number
  withWebsite: number
  withPhone: number
  withEmail: number
  withAddress: number
  withCoordinates: number
  withOpeningHours: number
  withRecentCheckDate: number
  probableDuplicates: number
}

export interface DiscoveryCoverageReport {
  schemaVersion: 1
  generatedAt: string
  scope: string
  warning: string
  catalogBefore: number
  totalBusinesses: number
  businessesByMunicipality: Record<string, number>
  businessesByZone: Record<string, number>
  businessesBySector: Record<string, number>
  businessesBySubsector: Record<string, number>
  bothBySector: Record<string, number>
  sectorMunicipality: Record<string, Record<string, number>>
  websiteCoverage: {count: number; percentage: number}
  phoneCoverage: {count: number; percentage: number}
  emailCoverage: {count: number; percentage: number}
  operationalMetadataCoverage: {
    address: {count: number; percentage: number}
    coordinates: {count: number; percentage: number}
    openingHours: {count: number; percentage: number}
    recentCheckDate: {count: number; percentage: number}
  }
  providerDistribution: Record<string, number>
  sourceDatasets: Array<{kind: string; name: string; sourceUrl: string | null; downloadedAt?: string; attribution: string; licenseUrl: string | null}>
  duplicates: {total: number; byConfidence: Record<string, number>; candidates: ProbableDuplicate[]}
  unknownSector: number
  businessesByProvider: Record<string, number>
  qualityMetrics: {bySector: Record<string, CoverageMetric>; byMunicipality: Record<string, CoverageMetric>; byZone: Record<string, CoverageMetric>}
  coverageAssessment: {reasonable: string[]; insufficient: string[]}
}

export function calculateDiscoveryCoverage(
  entities: readonly DiscoveredEntity[],
  duplicates: readonly ProbableDuplicate[],
  generatedAt: string,
  scope: string,
  catalogBefore = entities.length,
): DiscoveryCoverageReport {
  const businesses = entities.filter((entity) => entity.targetDocumentType === 'business')
  const sectorGroups = groupBy(businesses, (entity) => entity.businessClassification?.sector ?? 'other')
  const municipalityGroups = groupBy(businesses, (entity) => entity.geography?.municipality ?? 'unknown')
  const zoneGroups = groupBy(businesses, (entity) => entity.geography?.zone ?? 'unknown')
  const businessesBySector = Object.fromEntries(BUSINESS_SECTORS.map((sector) => [sector, sectorGroups.get(sector)?.length ?? 0]))
  const businessesByMunicipality = counts(municipalityGroups)
  const businessesByZone = counts(zoneGroups)
  const businessesBySubsector = countValues(businesses.map((entity) => entity.businessClassification?.subsector ?? 'unknown'))
  const bothBySector = Object.fromEntries(BUSINESS_SECTORS.map((sector) => [sector,
    (sectorGroups.get(sector) ?? []).filter((entity) => has(entity, ['contact:website', 'website']) && has(entity, ['contact:phone', 'phone', 'contact:mobile', 'mobile'])).length,
  ]))
  const sectorMunicipality = Object.fromEntries([...municipalityGroups].map(([municipality, values]) => [municipality,
    countValues(values.map((entity) => entity.businessClassification?.sector ?? 'other')),
  ]))
  const providerDistribution = countValues(businesses.flatMap((entity) => [...new Set(entity.sources.map((source) => source.provider))]))
  const sourceDatasets = [...new Map(businesses.flatMap((entity) => entity.sources.flatMap((source) => source.dataset ? [[
    JSON.stringify(source.dataset), {kind: source.dataset.kind, name: source.dataset.name, sourceUrl: source.dataset.sourceUrl,
      ...(source.dataset.downloadedAt ? {downloadedAt: source.dataset.downloadedAt} : {}), attribution: source.attribution, licenseUrl: source.licenseUrl},
  ] as const] : [])).map((entry) => entry)).values()]
  const total = businesses.length
  const metric = coverageMetric(businesses, duplicates, generatedAt)
  const bySector = Object.fromEntries(BUSINESS_SECTORS.map((sector) => [sector, coverageMetric(sectorGroups.get(sector) ?? [], duplicates, generatedAt)]))
  const byMunicipality = Object.fromEntries([...municipalityGroups].map(([municipality, values]) => [municipality, coverageMetric(values, duplicates, generatedAt)]))
  const byZone = Object.fromEntries([...zoneGroups].map(([zone, values]) => [zone, coverageMetric(values, duplicates, generatedAt)]))
  const reasonable = BUSINESS_SECTORS.filter((sector) => sector !== 'other' && (businessesBySector[sector] ?? 0) >= Math.max(10, total * 0.02))
  const insufficient = BUSINESS_SECTORS.filter((sector) => sector !== 'other' && !reasonable.includes(sector))
  return {
    schemaVersion: 1, generatedAt, scope,
    warning: 'La cobertura OSM mide representación en la fuente; la falta de resultados no implica ausencia real de empresas.',
    catalogBefore, totalBusinesses: total, businessesByMunicipality, businessesByZone, businessesBySector, businessesBySubsector, bothBySector, sectorMunicipality,
    websiteCoverage: ratio(metric.withWebsite, total), phoneCoverage: ratio(metric.withPhone, total), emailCoverage: ratio(metric.withEmail, total),
    operationalMetadataCoverage: {
      address: ratio(metric.withAddress, total), coordinates: ratio(metric.withCoordinates, total),
      openingHours: ratio(metric.withOpeningHours, total), recentCheckDate: ratio(metric.withRecentCheckDate, total),
    },
    providerDistribution, sourceDatasets, businessesByProvider: providerDistribution,
    duplicates: {total: duplicates.length, byConfidence: countValues(duplicates.map((item) => item.confidence)), candidates: [...duplicates]},
    unknownSector: businessesBySector.other ?? 0,
    qualityMetrics: {bySector, byMunicipality, byZone}, coverageAssessment: {reasonable, insufficient},
  }
}

export async function writeDiscoveryCoverage(report: DiscoveryCoverageReport, root: string): Promise<void> {
  const directory = resolve(root, 'content/reports/discovery-coverage')
  await writeJsonAtomic(resolve(directory, 'latest.json'), report)
  const total = report.totalBusinesses || 1
  const sectorRows = Object.entries(report.businessesBySector).map(([sector, count]) => {
    const metric = report.qualityMetrics.bySector[sector]!
    return `| ${sector} | ${count} | ${percent(count, total)}% | ${metric.withWebsite} | ${metric.withPhone} | ${intersectionCount(metric, report, sector)} |`
  })
  const municipalityRows = Object.entries(report.businessesByMunicipality).sort((a, b) => b[1] - a[1]).map(([municipality, count]) => {
    const leaders = Object.entries(sectorMunicipalityCounts(report, municipality)).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([sector, value]) => `${sector} (${value})`).join(', ') || '—'
    return `| ${municipality} | ${count} | ${leaders} |`
  })
  const markdown = `# Discovery coverage\n\nGenerado: ${report.generatedAt}\n\n> ${report.warning}\n\nCatálogo antes/después: **${report.catalogBefore} / ${report.totalBusinesses}** negocios.\n\n## Cobertura por sector\n\n| sector | negocios | % catálogo | web | teléfono | ambos |\n|---|---:|---:|---:|---:|---:|\n${sectorRows.join('\n')}\n\n## Cobertura por municipio\n\n| municipio | negocios | principales sectores |\n|---|---:|---|\n${municipalityRows.join('\n')}\n\n## Resumen\n\n- Web: ${report.websiteCoverage.count} (${report.websiteCoverage.percentage}%)\n- Teléfono: ${report.phoneCoverage.count} (${report.phoneCoverage.percentage}%)\n- Email: ${report.emailCoverage.count} (${report.emailCoverage.percentage}%)\n- Sector desconocido: ${report.unknownSector}\n- Duplicados candidatos sin fusión automática: ${report.duplicates.total}\n- Cobertura razonable en OSM: ${report.coverageAssessment.reasonable.join(', ') || 'ningún sector'}\n- Cobertura insuficiente en OSM: ${report.coverageAssessment.insufficient.join(', ') || 'ningún sector'}\n`
  const {mkdir, writeFile} = await import('node:fs/promises')
  await mkdir(directory, {recursive: true})
  await writeFile(resolve(directory, 'latest.md'), markdown, 'utf8')
}

function coverageMetric(entities: readonly DiscoveredEntity[], duplicates: readonly ProbableDuplicate[], now: string): CoverageMetric {
  const ids = new Set(entities.map((entity) => entity.id))
  return {
    discovered: entities.reduce((sum, entity) => sum + entity.sources.length, 0), unique: entities.length,
    withWebsite: entities.filter((entity) => has(entity, ['contact:website', 'website'])).length,
    withPhone: entities.filter((entity) => has(entity, ['contact:phone', 'phone', 'contact:mobile', 'mobile'])).length,
    withEmail: entities.filter((entity) => has(entity, ['contact:email', 'email'])).length,
    withAddress: entities.filter((entity) => Object.keys(entity.raw.tags).some((key) => key.startsWith('addr:'))).length,
    withCoordinates: entities.filter((entity) => entity.raw.latitude !== null && entity.raw.longitude !== null).length,
    withOpeningHours: entities.filter((entity) => has(entity, ['opening_hours'])).length,
    withRecentCheckDate: entities.filter((entity) => recent(entity, now)).length,
    probableDuplicates: duplicates.filter((duplicate) => ids.has(duplicate.existingBusinessId)).length,
  }
}

function has(entity: DiscoveredEntity, keys: string[]): boolean { return keys.some((key) => Boolean(entity.raw.tags[key]?.trim())) }

function recent(entity: DiscoveredEntity, now: string): boolean {
  const cutoff = Date.parse(now) - 366 * 24 * 60 * 60 * 1_000
  // Dataset retrieval is not evidence that the establishment was recently checked.
  const dates = [entity.raw.tags.check_date, entity.raw.tags['check_date:opening_hours'], entity.raw.tags['survey:date']]
  return dates.some((value) => value && !Number.isNaN(Date.parse(value)) && Date.parse(value) >= cutoff)
}

function ratio(count: number, total: number) { return {count, percentage: percent(count, total)} }
function percent(count: number, total: number): number { return total ? Number((count * 100 / total).toFixed(1)) : 0 }
function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const item of items) result.set(key(item), [...(result.get(key(item)) ?? []), item])
  return result
}
function counts<T>(groups: Map<string, T[]>): Record<string, number> { return Object.fromEntries([...groups].map(([key, values]) => [key, values.length])) }
function countValues(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const value of values) result[value] = (result[value] ?? 0) + 1
  return result
}

// The JSON metrics retain exact field counts; this helper is only for the compact requested markdown table.
function intersectionCount(_metric: CoverageMetric, report: DiscoveryCoverageReport, sector: string): number {
  return report.bothBySector[sector] ?? 0
}

function sectorMunicipalityCounts(report: DiscoveryCoverageReport, municipality: string): Record<string, number> {
  return report.sectorMunicipality[municipality] ?? {}
}
