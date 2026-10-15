import {extractOfficialWebsiteFacts} from '../../content/lib/adapters'
import {normalizeText} from '../../content/lib/normalize'
import {
  crawlOfficialWebsite, htmlToEvidenceText, WEBSITE_CRAWLER_VERSION, WebsiteCrawlError, type CrawledWebsitePage, type WebsiteCrawlerOptions,
} from '../../content/lib/website-crawler'
import type {CommercialItem, EnrichedEntity, Fact} from '../../content/lib/types'
import {matchingTopicTerms, normalizedPhraseMatch} from './scoring'
import {topicConfig, type ComparisonTopicConfig} from './topic-config'
import {coverageAfterResearch, planBusinessResearch, type BusinessResearchPlan} from './research-planner'
import {researchFingerprint, type ResearchResultCache} from './research-cache'
import {COMMERCIAL_EXTRACTOR_VERSION, type CommercialExtractionSummary} from '../../content/lib/commercial-extractor'
import {
  EVIDENCE_CATEGORIES, type CandidateEvidence, type ComparisonCandidateArtifact,
  type ComparisonEvidence, type ComparisonFeaturedItem, type ComparisonResearch, type EvidenceCategory,
} from './types'

export const COMPARISON_RESEARCH_EXTRACTOR_VERSION = `3-commercial-${COMMERCIAL_EXTRACTOR_VERSION}`
export const DEFAULT_RESEARCH_DIMENSIONS = ['cuisine', 'specialties', 'services', 'location', 'practical'] as const satisfies readonly EvidenceCategory[]
export const MINIMUM_RESEARCH_COVERAGE = 3

export interface ComparisonResearchBundle {
  research: ComparisonResearch
  evidence: ComparisonEvidence
}

export interface ResearchExtraction {
  evidence: CandidateEvidence[]
  comparisonEvidence: ComparisonEvidence
  extraction?: CommercialExtractionSummary
}

export interface ResearchExtractor {
  readonly version?: string
  extract(
    businessId: string,
    pages: readonly CrawledWebsitePage[],
    config: ComparisonTopicConfig,
    dimensions?: readonly EvidenceCategory[],
    documents?: readonly import('../../content/lib/website-crawler').CrawledWebsiteDocument[],
    context?: {expectedName?: string | null},
  ): ResearchExtraction
}

export interface ComparisonResearchOptions {
  fetcher?: typeof fetch
  concurrency?: number
  cache?: WebsiteCrawlerOptions['cache']
  dnsLookup?: WebsiteCrawlerOptions['dnsLookup']
  extractor?: ResearchExtractor
  logger?: (message: string) => void
  resultCache?: ResearchResultCache
  force?: boolean
  requiredDimensions?: readonly EvidenceCategory[]
  existingEvidenceByBusiness?: ReadonlyMap<string, Partial<ComparisonEvidence>>
}

/** Legacy name retained for callers; P1 now plans research for direct and potential candidates. */
export type PotentialResearchOptions = ComparisonResearchOptions

export class DeterministicResearchExtractor implements ResearchExtractor {
  readonly version = COMPARISON_RESEARCH_EXTRACTOR_VERSION

  extract(
    businessId: string,
    pages: readonly CrawledWebsitePage[],
    config: ComparisonTopicConfig,
    dimensions: readonly EvidenceCategory[] = DEFAULT_RESEARCH_DIMENSIONS,
    documents: readonly import('../../content/lib/website-crawler').CrawledWebsiteDocument[] = [],
    context: {expectedName?: string | null} = {},
  ): ResearchExtraction {
    const comparisonEvidence = emptyResearchEvidence()
    const evidence: CandidateEvidence[] = []
    const allowed = new Set(dimensions)
    let sequence = 0
    const push = (category: EvidenceCategory, value: string, sourceKeys: string[], strength: CandidateEvidence['strength'], excerpt?: string) => {
      if (!allowed.has(category) || !value.trim() || sourceKeys.length === 0) return
      const item: CandidateEvidence = {
        field: category, value, strength, ...(strength === 'direct' ? {matchedTerm: value} : {}),
        ...(excerpt ? {excerpt} : {}), sourceStage: 'comparison-research', sourceKeys,
      }
      evidence.push(item)
      comparisonEvidence[category].push({
        id: `${businessId}:${category}:comparison-research-${sequence++}`,
        value, nature: 'self_claim', sourceStage: 'comparison-research', sourceKeys,
        ...(excerpt ? {excerpt} : {}),
      })
    }

    for (const page of pages) {
      const factualText = htmlToEvidenceText(page.html)
      const direct = matchingTopicTerms(factualText, config.directEvidence)
      const supporting = matchingTopicTerms(factualText, config.supportingEvidence)
      for (const [strength, terms, category] of [
        ['direct', direct, config.researchEvidenceCategory],
        ['supporting', supporting, config.supportingEvidenceCategory],
      ] as const) for (const term of terms) push(category, term, [page.source.key], strength, matchingExcerpt(factualText, term))
    }

    const officialResult = extractOfficialWebsiteFacts(pages, documents, context)
    const official = officialResult.facts
    addFactValues(official.cuisine, 'cuisine', 'direct', push)
    addFactValues(official.specialties, 'specialties', 'direct', push)
    addFactValues(official.services, 'services', 'supporting', push)
    addFactValues(official.accessibility, 'services', 'supporting', push)
    addTrueFact(official.bookingAvailability, 'Acepta reservas', push)
    addTrueFact(official.takeaway, 'Servicio para llevar', push)
    addTrueFact(official.delivery, 'Entrega a domicilio', push)
    addTrueFact(official.terrace, 'Terraza', push)
    addFactValues(official.openingInformation, 'practical', 'supporting', push)
    addFactValues(official.locationContext, 'location', 'supporting', push)
    addFactValues(official.distinctiveFeatures, 'location', 'supporting', push)
    addCommercialItems(official.commercialItems, businessId, allowed, config, comparisonEvidence, evidence)
    return {
      evidence: deduplicateResearchEvidence(evidence),
      comparisonEvidence: deduplicateComparisonEvidence(comparisonEvidence),
      ...(officialResult.extraction ? {extraction: officialResult.extraction} : {}),
    }
  }
}

export async function researchCandidates(
  candidates: ComparisonCandidateArtifact,
  entities: ReadonlyMap<string, EnrichedEntity>,
  now: string,
  options: ComparisonResearchOptions = {},
): Promise<Map<string, ComparisonResearchBundle>> {
  const config = topicConfig(candidates.topic)
  const crawlerCache = options.cache ?? new Map()
  const extractor = options.extractor ?? new DeterministicResearchExtractor()
  const pairs = await mapWithConcurrency<typeof candidates.candidates[number], readonly [string, ComparisonResearchBundle]>(
    candidates.candidates,
    options.concurrency ?? 4,
    async (candidate) => {
      const startedAt = Date.now()
      const entity = entities.get(candidate.businessId)
      if (!entity) return [candidate.businessId, emptyBundle('unreachable', null, `Falta Business enriquecido: ${candidate.businessId}.`, undefined, startedAt)] as const
      const plan = planBusinessResearch({
        entity,
        config,
        ...(options.existingEvidenceByBusiness?.get(candidate.businessId) ? {evidence: options.existingEvidenceByBusiness.get(candidate.businessId)!} : {}),
        requiredDimensions: options.requiredDimensions ?? config.researchDimensions,
        minimumCoveredDimensions: MINIMUM_RESEARCH_COVERAGE,
        forceResearch: candidate.matchType === 'potential',
      })
      const website = plan.sources.find((source) => source.usable)?.url ?? null
      const reportedWebsite = website ?? plan.sources[0]?.url ?? null
      if (!plan.shouldResearch) {
        const scopeBlocked = plan.sources.length > 0 && plan.sources.every((source) => !source.usable)
        const status = plan.coverageSufficient && candidate.matchType !== 'potential' ? 'not-required'
          : plan.actions.length === 0 ? 'not-required' : scopeBlocked ? 'no-verifiable-source' : 'no-official-website'
        options.logger?.(`[${entity.facts.name.value ?? candidate.businessId}] ${plan.reason}`)
        return [candidate.businessId, emptyBundle(status, reportedWebsite, undefined, plan, startedAt, scopeBlocked ? 'source-scope' : status === 'no-official-website' ? 'missing-source' : 'none')] as const
      }
      if (!website) return [candidate.businessId, emptyBundle('no-official-website', null, undefined, plan, startedAt, 'missing-source')] as const
      const fingerprint = researchFingerprint({
        businessId: candidate.businessId, website, topic: config.topic, hints: plan.hints, dimensions: plan.priorityDimensions,
        maxPages: config.maxResearchPages, maxDepth: config.maxResearchDepth, timeoutMs: config.researchTimeoutMs,
        crawlerVersion: WEBSITE_CRAWLER_VERSION, extractorVersion: extractor.version ?? 'custom-unversioned',
      })
      if (!options.force && options.resultCache) {
        const cached = await options.resultCache.load(fingerprint, now, config.researchCacheTtlDays)
        if (cached) {
          cached.research.metrics = {
            requests: 0, pages: cached.research.pagesVisited.length, durationMs: Date.now() - startedAt,
            cacheHit: true, crawlerCacheHits: 0,
            documents: cached.research.metrics?.documents ?? 0,
            documentPages: cached.research.metrics?.documentPages ?? 0,
            documentBytes: cached.research.metrics?.documentBytes ?? 0,
          }
          cached.research.plan = planSummary(plan, coverageAfterResearch(plan, cached.evidence), false)
          options.logger?.(`[${entity.facts.name.value ?? candidate.businessId}] reused versioned research cache`)
          return [candidate.businessId, cached] as const
        }
      }
      options.logger?.(`[${entity.facts.name.value ?? candidate.businessId}] research ${plan.priorityDimensions.join(', ')} at ${website}`)
      try {
        const crawl = await crawlOfficialWebsite(website, now, {
          ...(options.fetcher ? {fetcher: options.fetcher} : {}), cache: crawlerCache,
          ...(options.dnsLookup ? {dnsLookup: options.dnsLookup} : {}), linkHints: plan.hints,
          maxPages: config.maxResearchPages, maxDepth: config.maxResearchDepth,
          timeoutMs: config.researchTimeoutMs, maxRedirects: 5,
        })
        const usablePages = crawl.pages.filter((page) => normalizeText(page.text).length > 0)
        if (!usablePages.length && !crawl.documents.some((document) => document.pages.length > 0)) {
          const bundle = bundleFromCrawl('no-usable-content', plan, crawl, emptyResearchEvidence(), [], startedAt, 'non-html')
          if (options.resultCache) await options.resultCache.save(fingerprint, now, bundle)
          return [candidate.businessId, bundle] as const
        }
        const extracted = extractor.extract(
          candidate.businessId, usablePages, config, plan.priorityDimensions, crawl.documents,
          {expectedName: entity.facts.name.value},
        )
        const direct = extracted.evidence.filter((item) => item.strength === 'direct' && matchingTopicTerms(item.value, config.directEvidence).length > 0)
        const newFacts = Object.values(extracted.comparisonEvidence).flat().length
        const status: ComparisonResearch['status'] = candidate.matchType === 'potential'
          ? direct.length ? 'confirmed' : 'no-direct-evidence'
          : newFacts > 0 ? 'confirmed' : 'no-new-evidence'
        const bundle = bundleFromCrawl(
          status, plan, crawl, extracted.comparisonEvidence, extracted.evidence, startedAt,
          newFacts ? 'none' : 'extractor-no-match', extracted.extraction,
        )
        options.logger?.(`[${entity.facts.name.value ?? candidate.businessId}] checked ${crawl.pages.length} pages; ${status}; requests=${crawl.diagnostics.requests}`)
        if (options.resultCache && cacheable(status)) await options.resultCache.save(fingerprint, now, bundle)
        return [candidate.businessId, bundle] as const
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        options.logger?.(`[${entity.facts.name.value ?? candidate.businessId}] research unreachable: ${message}`)
        const bundle = emptyBundle('unreachable', website, message, plan, startedAt, 'network')
        bundle.research.plan = planSummary(plan, plan.coverage, true)
        if (error instanceof WebsiteCrawlError) {
          bundle.research.urlsAttempted = error.diagnostics.attemptedUrls
          bundle.research.urlsDiscarded = error.diagnostics.discardedUrls
          bundle.research.metrics = {
            requests: error.diagnostics.requests, pages: 0, durationMs: error.diagnostics.durationMs,
            cacheHit: false, crawlerCacheHits: error.diagnostics.cacheHits,
            documents: error.diagnostics.documentsProcessed, documentPages: error.diagnostics.documentPages,
            documentBytes: error.diagnostics.documentBytes,
          }
        }
        return [candidate.businessId, bundle] as const
      }
    },
  )
  return new Map(pairs)
}

export const researchPotentialCandidates = researchCandidates

function bundleFromCrawl(
  status: ComparisonResearch['status'], plan: BusinessResearchPlan,
  crawl: Awaited<ReturnType<typeof crawlOfficialWebsite>>, evidence: ComparisonEvidence,
  newEvidence: CandidateEvidence[], startedAt: number, limitation: NonNullable<ComparisonResearch['limitation']>,
  extraction?: CommercialExtractionSummary,
): ComparisonResearchBundle {
  return {
    research: {
      status, website: crawl.website, pagesVisited: crawl.pages.map((page) => page.url),
      urlsAttempted: crawl.diagnostics.attemptedUrls,
      urlsDiscarded: crawl.diagnostics.discardedUrls,
      sources: [
        ...crawl.pages.map((page) => page.source),
        ...crawl.documents.flatMap((document) => document.pages.map((page) => page.source)),
      ],
      newEvidence,
      ...(extraction ? {extraction} : {}),
      plan: planSummary(plan, coverageAfterResearch(plan, evidence), true),
      metrics: {
        requests: crawl.diagnostics.requests, pages: crawl.pages.length, durationMs: Date.now() - startedAt,
        cacheHit: false, crawlerCacheHits: crawl.diagnostics.cacheHits,
        documents: crawl.diagnostics.documentsProcessed, documentPages: crawl.diagnostics.documentPages,
        documentBytes: crawl.diagnostics.documentBytes,
      },
      limitation,
    }, evidence,
  }
}

function emptyBundle(
  status: ComparisonResearch['status'], website: string | null, error?: string,
  plan?: BusinessResearchPlan, startedAt = Date.now(), limitation: NonNullable<ComparisonResearch['limitation']> = 'none',
): ComparisonResearchBundle {
  const evidence = emptyResearchEvidence()
  return {
    research: {
      status, website, pagesVisited: [],
      urlsDiscarded: plan?.sources.filter((source) => !source.usable).map((source) => ({url: source.url, reason: source.reason})) ?? [],
      sources: [], newEvidence: [], ...(plan ? {plan: planSummary(plan, plan.coverage, false)} : {}),
      metrics: {requests: 0, pages: 0, durationMs: Date.now() - startedAt, cacheHit: false, crawlerCacheHits: 0, documents: 0, documentPages: 0, documentBytes: 0},
      limitation, ...(error ? {error} : {}),
    }, evidence,
  }
}

function planSummary(
  plan: BusinessResearchPlan,
  after: ReturnType<typeof coverageAfterResearch>,
  attempted: boolean,
): NonNullable<ComparisonResearch['plan']> {
  return {
    coveredBefore: plan.coverage.coveredDimensions, missingBefore: plan.coverage.missingDimensions,
    plannedDimensions: plan.priorityDimensions,
    attemptedDimensions: attempted ? plan.priorityDimensions : [], coveredAfter: after.coveredDimensions, missingAfter: after.missingDimensions,
    hints: plan.hints, justification: plan.reason,
  }
}

function addFactValues(
  fact: Fact<unknown>, category: EvidenceCategory, strength: CandidateEvidence['strength'],
  push: (category: EvidenceCategory, value: string, sourceKeys: string[], strength: CandidateEvidence['strength'], excerpt?: string) => void,
): void {
  if (fact.value === null || fact.sources.length === 0) return
  for (const value of Array.isArray(fact.value) ? fact.value : [fact.value]) if (typeof value === 'string') push(category, value, fact.sources, strength)
}
function addTrueFact(
  fact: Fact<boolean>, label: string,
  push: (category: EvidenceCategory, value: string, sourceKeys: string[], strength: CandidateEvidence['strength']) => void,
): void { if (fact.value === true && fact.sources.length) push('services', label, fact.sources, 'supporting') }
function addCommercialItems(
  fact: Fact<CommercialItem[]> | undefined,
  businessId: string,
  allowed: ReadonlySet<EvidenceCategory>,
  config: ComparisonTopicConfig,
  comparisonEvidence: ComparisonEvidence,
  candidateEvidence: CandidateEvidence[],
): void {
  for (const item of fact?.value ?? []) {
    const category: EvidenceCategory = item.kind === 'service' ? 'services' : item.kind === 'specialty' ? 'specialties' : 'featuredItems'
    if (!allowed.has(category)) continue
    const value = category === 'featuredItems'
      ? {
          name: item.name,
          ...(item.price ? {
            price: item.price.amount, currency: item.price.currency,
            ...(item.price.priceQualifier === 'from' ? {priceQualifier: 'desde'} : {}),
          } : {}),
          source: item.sourceKey,
          retrievedAt: item.observedAt,
        } satisfies ComparisonFeaturedItem
      : item.name
    comparisonEvidence[category].push({
      id: `${businessId}:${category}:commercial-${comparisonEvidence[category].length}`,
      value, nature: 'self_claim', sourceStage: 'comparison-research', sourceKeys: [item.sourceKey],
      ...(item.description ? {excerpt: item.description} : {}),
    })
    const directTerm = matchingTopicTerms(item.name, config.directEvidence)[0]
    candidateEvidence.push({
      field: category, value: item.name, strength: directTerm ? 'direct' : 'supporting',
      ...(directTerm ? {matchedTerm: directTerm} : {}), sourceStage: 'comparison-research',
      sourceKeys: [item.sourceKey], ...(item.description ? {excerpt: item.description} : {}),
    })
  }
}
function emptyResearchEvidence(): ComparisonEvidence {
  return Object.fromEntries(EVIDENCE_CATEGORIES.map((category) => [category, []])) as unknown as ComparisonEvidence
}
function matchingExcerpt(text: string, term: string): string {
  const chunks = text.split(/(?<=[.!?])\s+|\s*[|•]\s*/).map((value) => value.trim()).filter(Boolean)
  return (chunks.find((chunk) => normalizedPhraseMatch(chunk, term)) ?? term).slice(0, 280)
}
function deduplicateResearchEvidence(evidence: CandidateEvidence[]): CandidateEvidence[] {
  return [...new Map(evidence.map((item) => [`${item.field}|${item.strength}|${normalizeText(item.value)}|${item.sourceKeys.join('|')}`, item])).values()]
}
function deduplicateComparisonEvidence(evidence: ComparisonEvidence): ComparisonEvidence {
  for (const dimension of EVIDENCE_CATEGORIES) evidence[dimension] = [...new Map(evidence[dimension].map((fact) => [
    `${normalizeText(typeof fact.value === 'object' ? JSON.stringify(fact.value) : String(fact.value))}|${fact.sourceKeys.join('|')}`, fact,
  ])).values()]
  return evidence
}
function cacheable(status: ComparisonResearch['status']): boolean {
  return status === 'confirmed' || status === 'no-direct-evidence' || status === 'no-new-evidence' || status === 'no-usable-content'
}
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({length: Math.min(Math.max(1, limit), items.length)}, async () => {
    while (next < items.length) { const index = next++; results[index] = await task(items[index]!) }
  })
  await Promise.all(workers)
  return results
}
