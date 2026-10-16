import {createHash} from 'node:crypto'
import {OSM_BUSINESS_RULES} from '../../content/lib/business-taxonomy'
import {classifyGeography} from '../../content/lib/discovery-geography'
import {findProbableDuplicates} from '../../content/lib/discovery-identity'
import type {DiscoveredEntity, ProbableDuplicate} from '../../content/lib/types'
import type {OpportunityReview} from './types'
import type {VerificationArtifact} from './verification-types'

export const SAMPLE_SEED = 'frappe-pilot-01'
export const STRATA = [
  {name: 'hospitality', sectors: ['hospitality'], size: 3},
  {name: 'beauty-wellness', sectors: ['beauty-wellness'], size: 3},
  {name: 'professional-services', sectors: ['professional-services'], size: 3},
  {name: 'real-estate / home-services', sectors: ['real-estate', 'home-services'], size: 3},
  {name: 'healthcare', sectors: ['healthcare'], size: 2},
  {name: 'automotive', sectors: ['automotive'], size: 2},
  {name: 'education', sectors: ['education'], size: 2},
  {name: 'retail / b2b-services', sectors: ['retail', 'b2b-services'], size: 2},
] as const
export const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
// Version is content-addressed: a taxonomy rule/order change invalidates it automatically.
export const TAXONOMY_VERSION = `osm-business-p3a5a-${hash(OSM_BUSINESS_RULES)}`
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
export interface SampleInput {
  catalog: DiscoveredEntity[]
  reviews?: OpportunityReview[]
  verifications?: VerificationArtifact[]
  duplicates?: ProbableDuplicate[]
}
export type ExclusionReason = 'closed' | 'identity-conflict' | 'duplicate' | 'invalid-location' | 'non-commercial' | 'unknown-sector'
export type MetadataLevel = 'sparse' | 'moderate' | 'rich'
export interface Candidate {
  businessId: string; name: string; municipality: string; sector: string; subsector: string
  coordinates: {latitude: number | null; longitude: number | null}
  sourceProviders: string[]; knownWebsite: boolean; knownPhone: boolean; knownEmail: boolean
  operationalStatus: string; identityStatus: string; metadataLevel: MetadataLevel; metadataFields: string[]
  exclusionReasons: ExclusionReason[]
}
const has = (tags: Record<string, string>, keys: string[]) => keys.some(key => Boolean(tags[key]?.trim()))
export function describeCandidate(entity: DiscoveredEntity, reviews: OpportunityReview[] = [], verifications: VerificationArtifact[] = []): Candidate {
  const review = reviews.find(item => item.businessId === entity.id)
  const verification = verifications.find(item => item.businessId === entity.id)
  const tags = entity.raw.tags
  const knownWebsite = has(tags, ['website', 'contact:website']) || Boolean(verification?.digitalPresence.website || verification?.digitalPresence.officialLocationPage)
  const knownPhone = has(tags, ['phone', 'contact:phone', 'mobile', 'contact:mobile']) || Boolean(verification?.digitalPresence.phones.length)
  const knownEmail = has(tags, ['email', 'contact:email']) || Boolean(verification?.digitalPresence.emails.length)
  const metadataFields = [
    [knownWebsite, 'website'], [knownPhone, 'phone'], [knownEmail, 'email'],
    [has(tags, ['addr:street', 'addr:place', 'addr:full']), 'address'],
    [has(tags, ['opening_hours']), 'opening-hours'], [has(tags, ['description', 'description:es']), 'description'],
    [has(tags, ['check_date', 'survey:date']), 'survey-date'],
    [has(tags, ['wheelchair', 'internet_access', 'payment:cash', 'cuisine', 'service']), 'service-details'],
  ].filter(([present]) => present).map(([, field]) => String(field))
  const operationalStatus = review?.operationalStatus ?? verification?.operationalEvidence.status ?? 'unknown'
  const identityStatus = review?.identityStatus ?? verification?.identityEvidence.status ?? 'unassessed'
  const reasons: ExclusionReason[] = []
  // Conflicting safety evidence is conservatively retained, even if another artifact claims open/matching.
  if (review?.operationalStatus === 'confirmed-closed' || verification?.operationalEvidence.status === 'supported-closed'
    || tags.disused === 'yes' || tags.abandoned === 'yes' || tags.operational_status === 'closed' || tags['disused:amenity'] || tags['abandoned:shop']) reasons.push('closed')
  if (review?.identityStatus === 'conflict' || verification?.identityEvidence.status === 'conflict') reasons.push('identity-conflict')
  const {latitude, longitude} = entity.raw
  const coordinatesValid = typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    && !(latitude === 0 && longitude === 0)
  const addressValid = has(tags, ['addr:full']) || (has(tags, ['addr:street', 'addr:place']) && has(tags, ['addr:city', 'addr:municipality']))
  if (!entity.raw.name.trim() || (!coordinatesValid && !addressValid)) reasons.push('invalid-location')
  if (entity.targetDocumentType !== 'business' || ['government', 'public', 'non_profit'].includes(tags['operator:type'] ?? '')
    || tags.commercial === 'no') reasons.push('non-commercial')
  const sector = entity.businessClassification?.sector ?? 'other'
  if (sector === 'other' || entity.businessClassification?.subsector === 'unknown') reasons.push('unknown-sector')
  return {
    businessId: entity.id, name: entity.raw.name,
    municipality: entity.geography?.municipality ?? classifyGeography(tags, latitude, longitude).municipality,
    sector, subsector: entity.businessClassification?.subsector ?? 'unknown',
    coordinates: {latitude: coordinatesValid ? latitude : null, longitude: coordinatesValid ? longitude : null},
    sourceProviders: [...new Set(entity.sources.map(source => source.provider))].sort(compare),
    knownWebsite, knownPhone, knownEmail, operationalStatus, identityStatus, metadataFields,
    metadataLevel: metadataFields.length <= 1 ? 'sparse' : metadataFields.length <= 4 ? 'moderate' : 'rich',
    exclusionReasons: reasons,
  }
}

export function prepareSample(input: SampleInput, seed = SAMPLE_SEED, generatedAt = new Date().toISOString()) {
  if (!seed.trim()) throw new Error('La seed no puede estar vacía.')
  const catalog = [...input.catalog].sort((a, b) => compare(a.id, b.id))
  if (!catalog.length) throw new Error('Catálogo ausente: restaura los registros P3A.5a en content/discovered/. No se ejecutará Discovery ni se inventará una muestra.')
  if (new Set(catalog.map(item => item.id)).size !== catalog.length) throw new Error('businessId duplicado en el catálogo; resolver la identidad antes del sorteo.')
  const ordered = <T>(items: T[]) => [...items].sort((a, b) => compare(hash(a), hash(b)))
  const duplicates = ordered(input.duplicates ?? [])
  const reviews = ordered(input.reviews ?? [])
  const verifications = ordered(input.verifications ?? [])
  const catalogFingerprint = hash({catalog, reviews, verifications, duplicates})
  const candidates = catalog.map(entity => describeCandidate(entity, reviews, verifications))
  const byId = new Map(candidates.map(item => [item.businessId, item]))
  const sourceIds = new Map<string, string[]>()
  for (const entity of catalog) for (const source of entity.sources) sourceIds.set(source.key, [...(sourceIds.get(source.key) ?? []), entity.id])
  const edges = new Map<string, Map<string, string>>()
  function connect(a: string, b: string, confidence: string) {
    if (a === b || !byId.has(a) || !byId.has(b)) return
    for (const [left, right] of [[a, b], [b, a]] as const) {
      if (!edges.has(left)) edges.set(left, new Map())
      const previous = edges.get(left)!.get(right)
      const rank = ['probable', 'strong-probable', 'exact']
      if (!previous || rank.indexOf(confidence) > rank.indexOf(previous)) edges.get(left)!.set(right, confidence)
    }
  }
  // Recompute locally from the whole catalog; report hints alone may be stale/incomplete.
  for (let index = 0; index < catalog.length; index++) {
    const entity = catalog[index]!
    for (const match of findProbableDuplicates([entity], catalog.slice(0, index))) {
      if (match.confidence !== 'unresolved') connect(entity.id, match.existingBusinessId, match.confidence)
    }
  }
  for (const ids of sourceIds.values()) for (const left of ids) for (const right of ids) connect(left, right, 'exact')
  for (const hint of duplicates) if (hint.confidence !== 'unresolved') {
    for (const key of hint.incomingSourceKeys) for (const id of sourceIds.get(key) ?? []) connect(hint.existingBusinessId, id, hint.confidence)
  }
  // No canonical resolution contract exists in Discovery: do not silently choose one of an unresolved exact/strong pair.
  for (const candidate of candidates) if ([...(edges.get(candidate.businessId)?.values() ?? [])].some(value => value !== 'probable')) candidate.exclusionReasons.push('duplicate')
  const rank = (candidate: Candidate) => hash([seed, candidate.businessId])
  candidates.sort((a, b) => compare(rank(a), rank(b)) || compare(a.businessId, b.businessId))
  const eligible = candidates.filter(item => !item.exclusionReasons.length)
  const slots: string[][] = []
  const shortages: string[] = []
  for (const stratum of STRATA) {
    const pool = eligible.filter(item => (stratum.sectors as readonly string[]).includes(item.sector))
    const count = Math.min(stratum.size, pool.length)
    if (count < stratum.size) shortages.push(`${stratum.name}: ${count}/${stratum.size}; no se sustituye por otro estrato.`)
    // Reserve one slot per constituent sector when possible; remaining slots use the shared pool.
    for (const sector of stratum.sectors) if (pool.some(item => item.sector === sector) && slots.length < 20) slots.push([sector])
    const reserved = stratum.sectors.filter(sector => pool.some(item => item.sector === sector)).length
    for (let index = reserved; index < count; index++) slots.push([...stratum.sectors])
  }
  const pools = slots.map(sectors => eligible.filter(item => sectors.includes(item.sector)))
  const slotOrder = pools.map((pool, index) => ({index, pool})).sort((a, b) => a.pool.length - b.pool.length || a.index - b.index)
  // Integral max-flow: slot -> business -> municipality. This preserves all
  // sector quotas whenever a geographically balanced matching exists.
  function match(target: Record<string, number> | null, banned = new Set<string>()): Candidate[] {
    type Edge = {to: number; capacity: number; reverse: number}
    const graph: Edge[][] = []
    const node = () => {graph.push([]); return graph.length - 1}
    const source = node(), sink = node()
    function edge(from: number, to: number, capacity: number): Edge {
      const forward = {to, capacity, reverse: graph[to]!.length}
      graph[from]!.push(forward)
      graph[to]!.push({to: from, capacity: 0, reverse: graph[from]!.length - 1})
      return forward
    }
    const cities = [...new Set(eligible.map(item => item.municipality))].sort(compare)
    const cityNodes = new Map(cities.map(city => [city, node()]))
    for (const [city, id] of cityNodes) edge(id, sink, target ? target[city] ?? 0 : 20)
    const candidateNodes = new Map<string, number>()
    const exits = new Map<string, Edge>()
    for (const item of eligible) if (!banned.has(item.businessId)) {
      const id = node()
      candidateNodes.set(item.businessId, id)
      exits.set(item.businessId, edge(id, cityNodes.get(item.municipality)!, 1))
    }
    for (const {pool} of slotOrder) {
      const slot = node()
      edge(source, slot, 1)
      for (const item of pool) {
        const id = candidateNodes.get(item.businessId)
        if (id !== undefined) edge(slot, id, 1)
      }
    }
    function augment(current: number, visited: Set<number>): boolean {
      if (current === sink) return true
      visited.add(current)
      for (const arc of graph[current]!) if (arc.capacity > 0 && !visited.has(arc.to) && augment(arc.to, visited)) {
        arc.capacity--; graph[arc.to]![arc.reverse]!.capacity++; return true
      }
      return false
    }
    while (augment(source, new Set())) { /* at most twenty augmentations */ }
    return eligible.filter(item => exits.get(item.businessId)?.capacity === 0)
  }
  const duplicateReplacements: Array<{discardedBusinessId: string; conflictingBusinessId: string}> = []
  function uniqueMatch(target: Record<string, number> | null): Candidate[] {
    const banned = new Set<string>()
    let result = match(target, banned)
    while (true) {
      const pair = result.flatMap((left, i) => result.slice(i + 1).filter(right => edges.get(left.businessId)?.has(right.businessId)).map(right => [left, right] as const))[0]
      if (!pair) return result
      const withoutFirst = match(target, new Set([...banned, pair[0].businessId]))
      const withoutSecond = match(target, new Set([...banned, pair[1].businessId]))
      const discardFirst = withoutFirst.length > withoutSecond.length
        || (withoutFirst.length === withoutSecond.length && compare(rank(pair[0]), rank(pair[1])) > 0)
      const discarded = discardFirst ? pair[0] : pair[1]
      const retained = discardFirst ? pair[1] : pair[0]
      duplicateReplacements.push({discardedBusinessId: discarded.businessId, conflictingBusinessId: retained.businessId})
      banned.add(discarded.businessId)
      result = discardFirst ? withoutFirst : withoutSecond
    }
  }
  let selected: Candidate[] = []
  if (slots.length === 20) for (const [benidorm, alfas, nucia] of [[13, 4, 3], [14, 4, 2], [14, 3, 3]]) {
    selected = uniqueMatch({'Benidorm': benidorm!, "l'Alfàs del Pi": alfas!, 'La Nucía': nucia!})
    if (selected.length === 20) break
  }
  const geographicTargetMet = selected.length === 20
  if (!geographicTargetMet) selected = uniqueMatch(null)
  if (selected.length < slots.length) shortages.push(`Identidades compatibles: ${selected.length}/${slots.length}; no se sustituye por otros estratos.`)
  // A categorical diversity repair only when an entire stratum is homogeneous.
  // No information score, enrichment threshold or commercial signal is used.
  const diversityRepairs: Array<{discardedBusinessId: string; replacementBusinessId: string; field: string}> = []
  for (const stratum of STRATA) for (const field of ['knownWebsite', 'knownPhone', 'metadataLevel'] as const) {
    const members = selected.filter(item => (stratum.sectors as readonly string[]).includes(item.sector))
    if (members.length < 2 || new Set(members.map(item => item[field])).size > 1) continue
    let repaired = false
    for (const old of [...members].reverse()) {
      const replacement = eligible.find(item => item.sector === old.sector && item.municipality === old.municipality
        && item[field] !== old[field] && !selected.some(other => other.businessId === item.businessId)
        && !selected.some(other => other !== old && edges.get(item.businessId)?.has(other.businessId))
        // Do not undo diversity already achieved in another descriptive dimension.
        && (['knownWebsite', 'knownPhone', 'metadataLevel'] as const).every(dimension =>
          new Set(members.map(member => member[dimension])).size < 2
          || new Set(members.map(member => member === old ? item[dimension] : member[dimension])).size >= 2))
      if (!replacement) continue
      selected[selected.indexOf(old)] = replacement
      diversityRepairs.push({discardedBusinessId: old.businessId, replacementBusinessId: replacement.businessId, field})
      repaired = true
      break
    }
    if (repaired) continue
  }
  selected.sort((a, b) => compare(a.sector, b.sector) || compare(rank(a), rank(b)))
  const selectedIds = new Set(selected.map(item => item.businessId))
  const exclusions: Array<{businessId: string; name: string; reasons: ExclusionReason[]; relatedBusinessIds: string[]}> = []
  const substitutions: Array<{discardedBusinessId: string; replacementBusinessId: string; reasons: ExclusionReason[]}> = []
  // Only rejected candidates encountered before the final draw in the same sector/location pool.
  for (const chosen of selected) for (const item of candidates) {
    if (selectedIds.has(item.businessId) || item.sector !== chosen.sector || item.municipality !== chosen.municipality || compare(rank(item), rank(chosen)) >= 0) continue
    const reasons = [...item.exclusionReasons]
    if (!reasons.includes('duplicate') && selected.some(other => edges.get(item.businessId)?.has(other.businessId))) reasons.push('duplicate')
    if (!reasons.length || exclusions.some(previous => previous.businessId === item.businessId)) continue
    exclusions.push({businessId: item.businessId, name: item.name, reasons, relatedBusinessIds: [...(edges.get(item.businessId)?.keys() ?? [])].sort(compare)})
    substitutions.push({discardedBusinessId: item.businessId, replacementBusinessId: chosen.businessId, reasons})
  }
  const counts = (items: string[]) => Object.fromEntries([...new Set(items)].sort(compare).map(value => [value, items.filter(item => item === value).length]))
  const metricsFor = (items: Candidate[]) => ({
    sectors: counts(items.map(item => item.sector)), municipalities: counts(items.map(item => item.municipality)),
    withWebsite: items.filter(item => item.knownWebsite).length, withoutWebsite: items.filter(item => !item.knownWebsite).length,
    withPhone: items.filter(item => item.knownPhone).length, withoutPhone: items.filter(item => !item.knownPhone).length,
    withEmail: items.filter(item => item.knownEmail).length, withoutEmail: items.filter(item => !item.knownEmail).length,
    metadata: counts(items.map(item => item.metadataLevel)),
  })
  const diversityWarnings: string[] = []
  for (const stratum of STRATA) {
    const values = selected.filter(item => (stratum.sectors as readonly string[]).includes(item.sector))
    const available = eligible.filter(item => (stratum.sectors as readonly string[]).includes(item.sector))
    for (const field of ['knownWebsite', 'knownPhone', 'metadataLevel'] as const) {
      if (new Set(available.map(item => item[field])).size > 1 && values.length > 1 && new Set(values.map(item => item[field])).size === 1) diversityWarnings.push(`${stratum.name}: muestra homogénea en ${field}; se conserva el sorteo neutral, sin score informativo.`)
    }
  }
  return {
    schemaVersion: 1, selectorVersion: 'p3a5b-v1', seed, catalogFingerprint, taxonomyVersion: TAXONOMY_VERSION, generatedAt,
    catalogSize: catalog.length, eligibleCandidates: eligible.length, requestedSize: 20, selectedSize: selected.length,
    ready: selected.length === 20, geographicTargetMet,
    methodology: 'Sorteo por SHA-256(seed,businessId), cuotas sectoriales y representación de ambos sectores agrupados; objetivo geográfico 13/4/3 con alternativas 14/4/2 y 14/3/3. Sin score comercial ni informativo. Duplicados exact/strong sin resolución canónica excluidos; probable incompatible dentro de la muestra.',
    metadataDefinition: 'Número de familias presentes: web, teléfono, email, dirección, horarios, descripción, fecha de revisión y detalles de servicio. sparse=0–1; moderate=2–4; rich=5–8. Descriptivo, no criterio de elegibilidad ni ranking.',
    strata: STRATA.map(stratum => ({...stratum, selected: selected.filter(item => (stratum.sectors as readonly string[]).includes(item.sector)).length})),
    metrics: metricsFor(selected), metricsByStratum: Object.fromEntries(STRATA.map(stratum => [stratum.name, metricsFor(selected.filter(item => (stratum.sectors as readonly string[]).includes(item.sector)))])),
    deviations: [...shortages, ...(!geographicTargetMet ? ['No se alcanza el objetivo municipal orientativo con las cuotas/identidades disponibles; se prioriza identidad y sector.'] : [])],
    diversityWarnings, diversityRepairs, exclusions, substitutions, duplicateReplacements,
    duplicateAudit: {checked: ['exact', 'strong-probable', 'probable'], conflictingSelectedPairs: selected.reduce((sum, item, index) => sum + selected.slice(index + 1).filter(other => edges.get(item.businessId)?.has(other.businessId)).length, 0)},
    editorialObservation: 'P3A.5a: desayunos pasa de 31 a 33 candidatos. No se corrige ni se reejecuta el pipeline editorial.',
    businesses: selected.map(({exclusionReasons: _, ...item}) => ({...item,
      selectionReason: `Sorteo reproducible dentro de ${STRATA.find(stratum => (stratum.sectors as readonly string[]).includes(item.sector))!.name}; control municipal; sin señales comerciales.`,
      exclusionChecks: {closed: 'pass', identityConflict: 'pass', unresolvedExactOrStrongDuplicate: 'pass', duplicateWithinSample: 'pass', location: 'pass', commercialEntity: 'pass', knownSector: 'pass'},
    })),
  }
}
export type SampleReport = ReturnType<typeof prepareSample>
export function emptyHumanReview(report: SampleReport) {
  return report.businesses.map(({businessId}) => ({businessId, wouldContact: null, commercialAngle: '', usefulWithoutExtraResearch: null, estimatedManualMinutesSaved: null, comments: ''}))
}
export function sampleMarkdown(report: SampleReport): string {
  const escape = (value: unknown) => String(value).replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ')
  return `# Opportunity Experiment — muestra ${report.selectedSize}\n\nSeed: ${report.seed}\n\nFingerprint: ${report.catalogFingerprint}\n\nTaxonomía: ${report.taxonomyVersion}\n\nGenerado: ${report.generatedAt}\n\n${report.methodology}\n\n${report.metadataDefinition}\n\n| businessId | Negocio | Sector | Subsector | Municipio | Web | Teléfono | Email | Metadata |\n|---|---|---|---|---|---|---|---|---|\n${report.businesses.map(item => `| ${[item.businessId, item.name, item.sector, item.subsector, item.municipality, item.knownWebsite ? 'sí' : 'no', item.knownPhone ? 'sí' : 'no', item.knownEmail ? 'sí' : 'no', item.metadataLevel].map(escape).join(' | ')} |`).join('\n')}\n\n## Métricas\n\n\`\`\`json\n${JSON.stringify(report.metrics, null, 2)}\n\`\`\`\n\n## Sustituciones y exclusiones\n\n\`\`\`json\n${JSON.stringify({exclusions: report.exclusions, substitutions: report.substitutions, duplicateReplacements: report.duplicateReplacements, diversityRepairs: report.diversityRepairs}, null, 2)}\n\`\`\`\n\n## Desviaciones y controles de diversidad\n\n${[...report.deviations, ...report.diversityWarnings].map(value => `- ${value}`).join('\n') || 'Sin desviaciones.'}\n\n${report.editorialObservation}\n\nNo se ha ejecutado análisis comercial, investigación web, verificación adicional, propuestas ni contacto.\n`
}
