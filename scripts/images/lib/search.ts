import type {CandidatesFile, CandidateTarget, ImageCandidate, RejectedCandidate} from './candidates'
import {commonsCandidate, commonsPages, commonsQueries, pexelsCandidates, pexelsSearchUrl, pixabayCandidates, pixabaySearchUrl, splitResults, type CommonsResponse, type JsonGetter, type PexelsResponse, type PixabayResponse} from './providers'

export interface SearchOptions {
  /** Categoría de Commons confirmada por David (`Category:…`). Sin ella se propone una y se avisa. */
  category?: string
  radiusMeters?: number
}

export interface SearchDeps {
  getJson: JsonGetter
  keys: {pixabay?: string | undefined; pexels?: string | undefined}
  now: () => Date
}

const DEFAULT_RADIUS = 500

/**
 * Busca candidatas para un documento o un término. Commons primero (geosearch y categoría); Pixabay y
 * Pexels solo si Commons no deja ninguna válida, y siempre como ambientales. Nunca elige ni aprueba.
 */
export async function searchCandidates(target: CandidateTarget, options: SearchOptions, deps: SearchDeps): Promise<CandidatesFile> {
  const retrievedAt = deps.now().toISOString()
  const radius = options.radiusMeters ?? DEFAULT_RADIUS
  const warnings: string[] = []
  const found: Array<ImageCandidate | RejectedCandidate> = []
  const query: CandidatesFile['query'] = {}

  if (target.kind === 'document') {
    if (target.coordinates) {
      query.radiusMeters = radius
      const geo = await deps.getJson<CommonsResponse>(commonsQueries.geosearch(target.coordinates, radius))
      const titles = (geo.query?.geosearch ?? []).map((item) => item.title)
      for (let index = 0; index < titles.length; index += 50) {
        const files = await deps.getJson<CommonsResponse>(commonsQueries.files(titles.slice(index, index + 50)))
        for (const page of commonsPages(files)) found.push(commonsCandidate(page, {retrievedAt, center: target.coordinates, radius, basis: 'coordinates'}))
      }
    } else {
      warnings.push('El documento no tiene coordenadas: no hay geosearch ni distancia al lugar.')
    }

    let category = options.category
    let suggested = false
    if (!category) {
      const search = await deps.getJson<CommonsResponse>(commonsQueries.searchCategory(target.name))
      category = search.query?.search?.[0]?.title
      suggested = Boolean(category)
    }
    if (category) {
      query.category = category
      query.categorySuggested = suggested
      const categoryWarnings = suggested ? [`Categoría propuesta automáticamente («${category}»): confirma que es este lugar antes de marcar placeVerified.`] : []
      const members = await deps.getJson<CommonsResponse>(commonsQueries.category(category))
      for (const page of commonsPages(members)) {
        found.push(commonsCandidate(page, {retrievedAt, ...(target.coordinates ? {center: target.coordinates} : {}), radius, basis: suggested ? null : 'commons-category', warnings: categoryWarnings}))
      }
    }
  } else {
    query.term = target.term
    const files = await deps.getJson<CommonsResponse>(commonsQueries.searchFiles(target.term))
    for (const page of commonsPages(files)) found.push(commonsCandidate(page, {retrievedAt, basis: null}))
  }

  const commons = splitResults(found)
  const candidates = dedupe(commons.candidates)
  if (candidates.length === 0) {
    const term = target.kind === 'document' ? target.name : target.term
    warnings.push('Commons no dio candidatas válidas: se buscan imágenes ambientales en Pixabay y Pexels.')
    if (deps.keys.pixabay) candidates.push(...pixabayCandidates(await deps.getJson<PixabayResponse>(pixabaySearchUrl(term, deps.keys.pixabay)), retrievedAt))
    else warnings.push('Falta PIXABAY_API_KEY: no se consulta Pixabay.')
    if (deps.keys.pexels) candidates.push(...pexelsCandidates(await deps.getJson<PexelsResponse>(pexelsSearchUrl(term), {authorization: deps.keys.pexels}), retrievedAt))
    else warnings.push('Falta PEXELS_API_KEY: no se consulta Pexels.')
  }

  return {
    version: 1,
    target,
    generatedAt: retrievedAt,
    query,
    warnings,
    candidates: candidates.sort((a, b) => rank(a) - rank(b) || (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity) || a.id.localeCompare(b.id)),
    rejected: dedupeRejected(commons.rejected),
    approvals: [],
    imports: [],
  }
}

// Orden de revisión, no de calidad: primero las que pueden ser del lugar.
function rank(candidate: ImageCandidate): number {
  return candidate.placeBasis === 'commons-category' ? 0 : candidate.placeBasis === 'coordinates' ? 1 : 2
}

/** Si un fichero sale por geosearch y por categoría, se queda la versión con base de lugar. */
function dedupe(candidates: ImageCandidate[]): ImageCandidate[] {
  const byId = new Map<string, ImageCandidate>()
  for (const candidate of candidates) {
    const existing = byId.get(candidate.id)
    if (!existing || (existing.placeBasis === null && candidate.placeBasis !== null)) byId.set(candidate.id, candidate)
  }
  return [...byId.values()]
}

function dedupeRejected(rejected: RejectedCandidate[]): RejectedCandidate[] {
  return [...new Map(rejected.map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id))
}
