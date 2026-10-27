import assert from 'node:assert/strict'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import type {ContentDocument} from '../../content-validation'
import {validateContent} from '../../content-validation'
import {writeJsonAtomic} from '../../content/lib/files'
import {evaluateBusinessQualityTier} from '../../content/lib/quality'
import type {BusinessFacts, EnrichedEntity, Fact} from '../../content/lib/types'
import {compactPracticalLines, hasDuplicateSectionHeadings} from '../../../src/lib/comparison-presentation'
import {enrichComparison, emptyEvidence} from './enrichment'
import {evaluateComparisonDataGate} from './gate'
import {ManualJsonAdapter} from './manual-adapter'
import type {ManualObservationData} from './manual-observations'
import {inspectComparison} from './qa'
import {selectComparisonCandidates} from './selection'
import {classifyTopicMatch, comparePotentialCandidates, compareScores, normalizedPhraseMatch, potentialCandidateScore, scoreBusiness, topicEvidence} from './scoring'
import {normalizeTopicConfig, topicConfig} from './topic-config'
import type {ComparisonCandidateArtifact, EnrichedComparisonArtifact, GeneratedComparisonArtifact} from './types'

test('candidate filtering separa relevancia temática de qualityTier insufficient', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-comparison-'))
  try {
    const eligible = entity('business-italiano', ['italiana'])
    const irrelevant = entity('business-indio', ['india'])
    const insufficient = entity('business-vacio', null)
    for (const item of [eligible, irrelevant, insufficient]) await writeJsonAtomic(resolve(root, `content/enriched/${item.id}.json`), item)
    await writeJsonAtomic(resolve(root, 'content/manifest.json'), {version: 1, updatedAt: null, entries: [
      manifest(eligible), manifest(irrelevant), {...manifest(insufficient), qualityTier: 'insufficient'},
    ]})
    const result = await selectComparisonCandidates({topic: 'italiano', id: 'comparison-italiano', dryRun: false, force: false}, root, '2026-10-06T00:00:00.000Z')
    assert.equal(result.searchIntent, 'elegir restaurante italiano en Benidorm')
    assert.deepEqual(result.candidates.map((candidate) => candidate.businessId), ['business-italiano'])
    assert.deepEqual(new Set(result.excluded.map((item) => item.reason)), new Set(['not-relevant']))
    assert.equal(result.excluded.find((item) => item.businessId === 'business-vacio')?.qualityTier, 'insufficient')
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('topic arroces usa configuración data-driven y exige evidencia explícita', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-comparison-arroces-'))
  try {
    const rice = entity('business-arroces', ['mediterránea'])
    rice.facts.specialties = sourced(['Arroz a banda'], 'source:business-arroces')
    const mediterranean = entity('business-mediterraneo', ['mediterránea'])
    await mkdir(resolve(root, 'content/enriched'), {recursive: true})
    await writeJsonAtomic(resolve(root, 'content/enriched/rice.json'), rice)
    await writeJsonAtomic(resolve(root, 'content/enriched/mediterranean.json'), mediterranean)
    await writeJsonAtomic(resolve(root, 'content/manifest.json'), {version: 1, updatedAt: null, entries: [manifest(rice), manifest(mediterranean)]})

    const result = await selectComparisonCandidates({topic: 'arroces', id: 'comparison-arroces', dryRun: false, force: false}, root, '2026-10-07T00:00:00.000Z')

    assert.equal(result.searchIntent, 'elegir dónde comer arroz en Benidorm')
    assert.deepEqual(result.candidates.map((candidate) => candidate.businessId), ['business-arroces'])
    assert.deepEqual(result.candidates[0]?.topicEvidence, ['specialties=Arroz a banda'])
    assert.ok(result.excluded.some((candidate) => candidate.businessId === 'business-mediterraneo' && candidate.reason === 'not-relevant'))
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('topic desayunos considera una cafetería sin evidencia como potential, no direct', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-comparison-desayunos-'))
  try {
    const breakfast = entity('business-desayunos', ['cafetería'])
    breakfast.facts.businessKind = sourced('cafe', 'source:business-desayunos')
    const irrelevant = entity('business-irrelevante', ['mediterránea'])
    await mkdir(resolve(root, 'content/enriched'), {recursive: true})
    await writeJsonAtomic(resolve(root, 'content/enriched/breakfast.json'), breakfast)
    await writeJsonAtomic(resolve(root, 'content/enriched/irrelevant.json'), irrelevant)
    await writeJsonAtomic(resolve(root, 'content/manifest.json'), {version: 1, updatedAt: null, entries: [manifest(breakfast), manifest(irrelevant)]})

    const result = await selectComparisonCandidates({topic: 'desayunos', id: 'comparison-desayunos', dryRun: false, force: false}, root, '2026-10-08T00:00:00.000Z')

    assert.equal(result.searchIntent, 'elegir dónde desayunar en Benidorm')
    assert.deepEqual(result.candidates.map((candidate) => candidate.businessId), ['business-desayunos'])
    assert.equal(result.candidates[0]?.matchType, 'potential')
    assert.deepEqual(result.candidates[0]?.topicEvidence, [])
    assert.ok(result.candidates[0]?.evidence?.some((item) => item.field === 'businessKind' && item.value === 'cafe'))
    assert.ok(result.excluded.some((candidate) => candidate.businessId === 'business-irrelevante' && candidate.reason === 'not-relevant'))
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('matching normaliza diacríticos y respeta palabras y frases completas', () => {
  assert.equal(normalizedPhraseMatch('Bollería artesanal', 'bolleria'), true)
  assert.equal(normalizedPhraseMatch('Full English breakfast todo el día', 'full english breakfast'), true)
  assert.equal(normalizedPhraseMatch('desayunos completos', 'desayuno'), false)
  assert.equal(normalizedPhraseMatch('breakfasting', 'breakfast'), false)
})

test('Tepuy no es direct por Café de París', () => {
  const tepuy = entity('business-tepuy', ['burger', 'española'])
  tepuy.facts.concept = sourced('Burgers, parrilla y sabores con alma caribeña. Entrecot Café de París, arepas y cachapas.', 'official:tepuy')

  const match = classifyTopicMatch(tepuy, 'desayunos')

  assert.equal(match.matchType, 'excluded')
  assert.equal(match.evidence.some((item) => item.strength === 'direct'), false)
})

test('The Brunch Box y Caffe Trieste son direct y conservan evidence', () => {
  const brunchBox = entity('business-the-brunch-box', ['Brunch', 'Breakfast'])
  brunchBox.facts.businessKind = sourced('cafe', 'source:business-the-brunch-box')
  brunchBox.facts.concept = sourced("The Brunch Box — Benidorm's favourite American brunch & full English breakfast.", 'official:brunch-box')
  const trieste = entity('business-caffe-trieste', ['breakfast'])
  trieste.facts.businessKind = sourced('cafe', 'source:business-caffe-trieste')

  const brunchMatch = classifyTopicMatch(brunchBox, 'desayunos')
  const triesteMatch = classifyTopicMatch(trieste, 'desayunos')

  assert.equal(brunchMatch.matchType, 'direct')
  assert.ok(brunchMatch.evidence.some((item) => item.field === 'cuisine' && item.value === 'Breakfast' && item.strength === 'direct'))
  assert.ok(brunchMatch.evidence.some((item) => item.field === 'concept' && item.matchedTerm === 'full english breakfast'))
  assert.equal(triesteMatch.matchType, 'direct')
  assert.ok(triesteMatch.evidence.some((item) => item.field === 'cuisine' && item.value === 'breakfast'))
})

test('restaurant genérico y openingHours aislado quedan excluded', () => {
  const generic = entity('business-generic', ['mediterránea'])
  const early = entity('business-early', null)
  early.facts.openingHoursRaw = sourced('Mo-Su 07:00-18:00', 'source:business-early')
  early.facts.openingInformation = sourced(['Abre a las 07:00'], 'source:business-early')

  assert.equal(classifyTopicMatch(generic, 'desayunos').matchType, 'excluded')
  assert.equal(classifyTopicMatch(early, 'desayunos').matchType, 'excluded')
})

test('ranking potential premia señales, quality, web y specificity sin popularidad', () => {
  const weak = entity('business-weak-cafe', null)
  weak.facts.businessKind = sourced('cafe', 'source:business-weak-cafe')
  weak.facts.website = {value: null, sources: []}
  const stronger = entity('business-strong-cafe', null)
  stronger.facts.businessKind = sourced('cafe', 'source:business-strong-cafe')
  stronger.facts.concept = sourced('Tostadas y croissant artesano', 'official:strong')
  const weakMatch = classifyTopicMatch(weak, 'desayunos')
  const strongMatch = classifyTopicMatch(stronger, 'desayunos')
  const weakCandidate = {businessId: weak.id, scores: scoreBusiness(weak, 'desayunos'), potentialScore: potentialCandidateScore(weak, 'insufficient', weakMatch.evidence)}
  const strongCandidate = {businessId: stronger.id, scores: scoreBusiness(stronger, 'desayunos'), potentialScore: potentialCandidateScore(stronger, 'basic', strongMatch.evidence)}

  assert.deepEqual([weakCandidate, strongCandidate].sort(comparePotentialCandidates).map((item) => item.businessId), ['business-strong-cafe', 'business-weak-cafe'])
  assert.ok(strongCandidate.potentialScore.total > weakCandidate.potentialScore.total)
})

test('maxPotentialCandidates limita la investigación a 25 y conserva el resto como excluded', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-comparison-potential-limit-'))
  try {
    const cafes = Array.from({length: 27}, (_, index) => {
      const item = entity(`business-cafe-${String(index).padStart(2, '0')}`, null)
      item.facts.businessKind = sourced('cafe', `source:${item.id}`)
      return item
    })
    for (const item of cafes) await writeJsonAtomic(resolve(root, `content/enriched/${item.id}.json`), item)

    const result = await selectComparisonCandidates({topic: 'desayunos', id: 'comparison-desayunos', dryRun: false, force: false}, root)

    assert.equal(result.summary?.direct, 0)
    assert.equal(result.summary?.potential, 25)
    assert.equal(result.excluded.filter((item) => item.reason === 'outside-potential-limit').length, 2)
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('aliases legacy migran a directEvidence y los topics estrictos no crean potential genéricos', () => {
  assert.deepEqual(normalizeTopicConfig({topic: 'legacy', aliases: ['Uno', 'Dos']}).directEvidence, ['Uno', 'Dos'])
  assert.deepEqual(topicConfig('sushi').directEvidence, ['sushi', 'japonesa', 'japonesas', 'japonés', 'japoneses', 'japanese'])
  assert.equal(classifyTopicMatch(entity('business-generic-one', ['mediterránea']), 'italiano').matchType, 'excluded')
  assert.equal(classifyTopicMatch(entity('business-generic-two', ['mediterránea']), 'arroces').matchType, 'excluded')
})

test('enrichment confirma potential sólo con evidence directa nueva y rechaza el resto', () => {
  const confirmed = entity('business-confirmed-cafe', null)
  confirmed.facts.businessKind = sourced('cafe', 'source:business-confirmed-cafe')
  const rejected = entity('business-rejected-cafe', null)
  rejected.facts.businessKind = sourced('cafe', 'source:business-rejected-cafe')
  const candidate = (item: EnrichedEntity): ComparisonCandidateArtifact['candidates'][number] => ({
    businessId: item.id,
    qualityTier: 'basic',
    matchType: 'potential',
    evidence: classifyTopicMatch(item, 'desayunos').evidence,
    topicEvidence: [],
    scores: scoreBusiness(item, 'desayunos'),
  })
  const artifact: ComparisonCandidateArtifact = {
    schemaVersion: 2, id: 'comparison-desayunos', topic: 'desayunos', searchIntent: 'elegir dónde desayunar en Benidorm', slug: 'desayunos', generatedAt: '2026-10-08T00:00:00.000Z', candidateCount: 2,
    candidates: [candidate(confirmed), candidate(rejected)], excluded: [],
  }
  const manualSource = source('official:confirmed', 'official-website')
  const result = enrichComparison(artifact, new Map([[confirmed.id, confirmed], [rejected.id, rejected]]), {
    topic: 'desayunos', sources: [manualSource], businesses: [{
      businessId: confirmed.id,
      evidence: {specialties: [{id: 'confirmed:breakfast', value: 'Full English breakfast', nature: 'factual', sourceKeys: [manualSource.key]}]},
    }],
  }, '2026-10-08T00:00:00.000Z')

  assert.deepEqual(result.businesses.map((item) => item.businessId), [confirmed.id])
  assert.equal(result.businesses[0]?.origin, 'potential')
  assert.ok(result.businesses[0]?.topicEvidence.includes('specialties=Full English breakfast'))
  assert.equal(result.investigations?.find((item) => item.businessId === confirmed.id)?.outcome, 'confirmed')
  assert.equal(result.investigations?.find((item) => item.businessId === rejected.id)?.outcome, 'rejected')
})

test('una observación manual directa confirma potential y una señal supporting no', () => {
  const direct = entity('business-manual-direct', null)
  direct.facts.businessKind = sourced('cafe', 'source:business-manual-direct')
  const supporting = entity('business-manual-supporting', null)
  supporting.facts.businessKind = sourced('cafe', 'source:business-manual-supporting')
  const candidate = (item: EnrichedEntity): ComparisonCandidateArtifact['candidates'][number] => ({
    businessId: item.id, qualityTier: 'basic', matchType: 'potential',
    evidence: classifyTopicMatch(item, 'desayunos').evidence, topicEvidence: [], scores: scoreBusiness(item, 'desayunos'),
  })
  const artifact: ComparisonCandidateArtifact = {
    schemaVersion: 2, id: 'comparison-desayunos', topic: 'desayunos', searchIntent: 'elegir dónde desayunar en Benidorm',
    slug: 'desayunos', generatedAt: '2026-10-08T00:00:00.000Z', candidateCount: 2,
    candidates: [candidate(direct), candidate(supporting)], excluded: [],
  }
  const observations: ManualObservationData = {
    records: [],
    sources: [manualObservationSource(direct.id), manualObservationSource(supporting.id)],
    businesses: [manualObservationBusiness(direct.id, 'desayunos'), manualObservationBusiness(supporting.id, 'café')],
  }

  const result = enrichComparison(artifact, new Map([[direct.id, direct], [supporting.id, supporting]]), {
    topic: 'desayunos', sources: [], businesses: [],
  }, '2026-10-08T00:00:00.000Z', new Map(), observations)

  assert.deepEqual(result.businesses.map((item) => item.businessId), [direct.id])
  assert.equal(result.businesses[0]?.confirmationEvidence?.[0]?.sourceStage, 'manual-observation')
  assert.equal(result.investigations?.find((item) => item.businessId === supporting.id)?.outcome, 'rejected')
})

test('deduplica evidence web y manual conservando ambas provenances', () => {
  const item = entity('business-duplicate-brunch', null)
  item.facts.businessKind = sourced('cafe', 'source:business-duplicate-brunch')
  item.facts.services = sourced(['brunch'], 'source:business-duplicate-brunch')
  const artifact: ComparisonCandidateArtifact = {
    schemaVersion: 2, id: 'comparison-desayunos', topic: 'desayunos', searchIntent: 'elegir dónde desayunar en Benidorm',
    slug: 'desayunos', generatedAt: '2026-10-08T00:00:00.000Z', candidateCount: 1,
    candidates: [{businessId: item.id, qualityTier: 'basic', matchType: 'potential', evidence: [], topicEvidence: [], scores: scoreBusiness(item, 'desayunos')}], excluded: [],
  }
  const observations: ManualObservationData = {
    records: [], sources: [manualObservationSource(item.id)], businesses: [manualObservationBusiness(item.id, 'brunch')],
  }

  const result = enrichComparison(artifact, new Map([[item.id, item]]), {topic: 'desayunos', sources: [], businesses: []},
    '2026-10-08T00:00:00.000Z', new Map(), observations)
  const brunch = result.businesses[0]?.evidence.services.filter((fact) => fact.value === 'brunch') ?? []

  assert.equal(brunch.length, 1)
  assert.deepEqual(new Set(brunch[0]?.provenance?.map((item) => item.sourceStage)), new Set(['existing', 'manual-observation']))
  assert.equal(brunch[0]?.sourceKeys.length, 2)
})

test('genera evidence IDs estables y únicos al expandir arrays y añadir facts', () => {
  const item = entity('business-evidence-ids', ['italiana'])
  item.facts.specialties = sourced(['Pasta', 'Pizza'], 'source:business-evidence-ids')
  item.facts.services = sourced(['Desayuno', 'Brunch'], 'source:business-evidence-ids')
  item.facts.accessibility = sourced(['Acceso', 'Baño adaptado'], 'source:business-evidence-ids')
  const artifact: ComparisonCandidateArtifact = {
    schemaVersion: 2, id: 'comparison-test', topic: 'italiano', searchIntent: 'test', slug: 'test', generatedAt: '2026-10-15T00:00:00.000Z', candidateCount: 1,
    candidates: [{businessId: item.id, qualityTier: 'basic', matchType: 'direct', evidence: [], topicEvidence: ['cuisine=italiana'], scores: scoreBusiness(item, 'italiano')}], excluded: [],
  }
  const result = enrichComparison(artifact, new Map([[item.id, item]]), {topic: 'italiano', sources: [], businesses: []}, '2026-10-15T00:00:00.000Z')
  const ids = Object.values(result.businesses[0]!.evidence).flat().map((fact) => fact.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(result.businesses[0]!.evidence.specialties.map((fact) => fact.id), [
    'business-evidence-ids:specialties:business-0', 'business-evidence-ids:specialties:business-1',
  ])
  assert.deepEqual(result.businesses[0]!.evidence.services.map((fact) => fact.id), [
    'business-evidence-ids:services:business-0', 'business-evidence-ids:services:business-1',
    'business-evidence-ids:services:business-2', 'business-evidence-ids:services:business-3',
  ])
})

test('un conflicto manual con una fuente publicada queda registrado sin resolución automática', () => {
  const item = entity('business-conflicting-brunch', null)
  item.facts.businessKind = sourced('cafe', 'source:business-conflicting-brunch')
  item.facts.services = sourced(['brunch ya no disponible'], 'source:business-conflicting-brunch')
  const artifact: ComparisonCandidateArtifact = {
    schemaVersion: 2, id: 'comparison-desayunos', topic: 'desayunos', searchIntent: 'elegir dónde desayunar en Benidorm',
    slug: 'desayunos', generatedAt: '2026-10-08T00:00:00.000Z', candidateCount: 1,
    candidates: [{businessId: item.id, qualityTier: 'basic', matchType: 'potential', evidence: [], topicEvidence: [], scores: scoreBusiness(item, 'desayunos')}], excluded: [],
  }
  const observations: ManualObservationData = {
    records: [], sources: [manualObservationSource(item.id)], businesses: [manualObservationBusiness(item.id, 'brunch')],
  }

  const result = enrichComparison(artifact, new Map([[item.id, item]]), {topic: 'desayunos', sources: [], businesses: []},
    '2026-10-08T00:00:00.000Z', new Map(), observations)

  assert.equal(result.sourceConflicts[0]?.dimension, 'services')
  assert.match(result.sourceConflicts[0]?.resolution ?? '', /no resuelto/i)
})

test('el adapter manual conserva el contexto genérico de un precio', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'enbenidorm-comparison-price-'))
  const path = resolve(root, 'comparison.json')
  try {
    await writeJsonAtomic(path, {
      topic: 'test',
      sources: [{key: 'official:test', provider: 'official-website', identifier: 'https://example.com/menu', url: 'https://example.com/menu', retrievedAt: '2026-10-07T00:00:00.000Z', attribution: 'Web oficial', licenseUrl: null}],
      businesses: [{businessId: 'business-test', evidence: {prices: [{id: 'price:test', value: {item: 'Menú de grupo', value: 34.75, currency: 'EUR', priceQualifier: 'por persona; mínimo 8 personas', retrievedAt: '2026-10-07'}, nature: 'factual', sourceKeys: ['official:test']}]}}],
    })

    const manual = await new ManualJsonAdapter(path).load()

    assert.deepEqual(manual.businesses[0]?.evidence.prices?.[0]?.value, {item: 'Menú de grupo', value: 34.75, currency: 'EUR', priceQualifier: 'por persona; mínimo 8 personas', retrievedAt: '2026-10-07'})
  } finally { await rm(root, {recursive: true, force: true}) }
})

test('selectionScore ordena candidatos pero no crea ranking público obligatorio', () => {
  const italian = entity('business-z', ['italiana'])
  assert.deepEqual(topicEvidence(italian, 'italiano'), ['cuisine=italiana'])
  const a = {businessId: 'business-a', scores: scoreBusiness(entity('business-a', ['italiana']), 'italiano')}
  const b = {businessId: 'business-b', scores: scoreBusiness(entity('business-b', ['italiana']), 'italiano')}
  assert.deepEqual([b, a].sort(compareScores).map((item) => item.businessId), ['business-a', 'business-b'])
  const fixture = comparisonFixture()
  assert.ok(fixture.generated.editorial.entries.every((entry) => !('rank' in entry)))
  assert.ok((fixture.generated.document.entries as Array<Record<string, unknown>>).every((entry) => !('rank' in entry)))
})

test('choiceGuide cubre cada Business y exige evidence', () => {
  const fixture = comparisonFixture()
  assert.equal(fixture.generated.editorial.choiceGuide.length, 4)
  assert.equal(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).indexability, 'index')
  fixture.generated.editorial.claims = fixture.generated.editorial.claims.filter((claim) => !claim.path.startsWith('choiceGuide.business-uno'))
  assert.ok(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues.some((issue) => issue.path === 'choiceGuide.business-uno.reason' && issue.code === 'MISSING_CLAIM_DECLARATION'))
})

test('quickVerdict usa comparación cruzada y searchIntent falla ante una enumeración', () => {
  const fixture = comparisonFixture()
  assert.equal(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).searchIntentSatisfied, true)
  fixture.generated.editorial.quickVerdict = 'Trattoria Uno sirve pasta fresca. Trattoria Dos sirve focaccia. Trattoria Tres sirve pinsa. Trattoria Cuatro sirve pizza.'
  fixture.generated.editorial.claims = fixture.generated.editorial.claims.filter((claim) => claim.path !== 'quickVerdict')
  fixture.generated.editorial.claims.push({path: 'quickVerdict', claim: fixture.generated.editorial.quickVerdict, supportedBy: fixture.enriched.businesses.flatMap((business) => business.evidence.specialties.map((fact) => fact.id))})
  assert.ok(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues.some((issue) => issue.code === 'SEARCH_INTENT_NOT_SATISFIED'))
})

test('QA detecta bajo valor comparativo y cobertura insuficiente', () => {
  const fixture = comparisonFixture()
  for (const business of fixture.enriched.businesses) for (const dimension of ['specialties', 'featuredItems', 'prices', 'services', 'practical', 'limitations'] as const) business.evidence[dimension] = []
  const issues = inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues
  assert.ok(issues.some((issue) => issue.code === 'LOW_COMPARATIVE_VALUE'))
  assert.ok(issues.some((issue) => issue.code === 'INSUFFICIENT_EVIDENCE_COVERAGE'))
})

test('el gate previo detiene datasets insuficientes y deja pasar cobertura comparativa', () => {
  const fixture = comparisonFixture()
  assert.equal(evaluateComparisonDataGate(fixture.enriched).pass, true)

  fixture.enriched.businesses = fixture.enriched.businesses.slice(0, 1)
  const stopped = evaluateComparisonDataGate(fixture.enriched)

  assert.equal(stopped.pass, false)
  assert.deepEqual(new Set(stopped.issues.map((issue) => issue.code)), new Set(['MINIMUM_BUSINESSES', 'LOW_COMPARATIVE_VALUE', 'INSUFFICIENT_EVIDENCE_COVERAGE']))
})

test('el gate bloquea un cierre confirmado pero sólo avisa ante estado contradictorio', () => {
  const fixture = comparisonFixture()
  fixture.enriched.businesses[0]!.operationalStatus = {status: 'closed', assessedAt: '2026-10-15T00:00:00.000Z', sourceKeys: ['source:business-uno'], needsVerification: false, reasons: [], signals: []}
  assert.ok(evaluateComparisonDataGate(fixture.enriched).issues.some((issue) => issue.code === 'INELIGIBLE_OPERATIONAL_STATUS'))
  fixture.enriched.businesses[0]!.operationalStatus = {status: 'unknown', assessedAt: '2026-10-15T00:00:00.000Z', sourceKeys: ['source:business-uno'], needsVerification: true, reasons: ['Conflicto'], signals: []}
  const review = evaluateComparisonDataGate(fixture.enriched)
  assert.equal(review.pass, true)
  assert.ok(review.warnings.some((warning) => warning.code === 'OPERATIONAL_STATUS_REVIEW'))
})

test('QA no permite afirmar apertura cuando operationalStatus no está confirmado', () => {
  const fixture = comparisonFixture()
  fixture.enriched.businesses[0]!.operationalStatus = {status: 'unknown', assessedAt: '2026-10-15T00:00:00.000Z', sourceKeys: [], needsVerification: true, reasons: ['Sin confirmación'], signals: []}
  fixture.generated.editorial.entries[0]!.practicalNotes[0] = 'Está abierto todos los días.'
  assert.ok(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues.some((issue) => issue.code === 'UNCONFIRMED_OPERATIONAL_STATUS'))
})

test('QA avisa cuando se repite una afirmación larga entre secciones', () => {
  const fixture = comparisonFixture()
  fixture.generated.editorial.choiceGuide[0]!.reason = fixture.generated.editorial.entries[0]!.verdict
  fixture.generated.editorial.claims.push({path: 'choiceGuide.business-uno.reason', claim: fixture.generated.editorial.choiceGuide[0]!.reason, supportedBy: ['business-uno:specialty:0', 'business-uno:service:0']})
  assert.ok(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues.some((issue) => issue.code === 'REPETITIVE_COMPARISON_CONTENT'))
})

test('QA editorial detecta lenguaje técnico, fuentes raw, secciones vacías, repetición pública y celdas largas', () => {
  const fixture = comparisonFixture()
  fixture.generated.editorial.entries[0]!.strengths[0] = 'Pasta fresca artesanal documentada en la evidencia pública'
  fixture.generated.editorial.entries[0]!.bestFor = ['Una etiqueta deliberadamente demasiado larga para una celda de comparación rápida en cualquier dispositivo']
  fixture.generated.editorial.criteria = []
  fixture.generated.editorial.quickVerdict += ' La referencia figuraba a 12 €.'
  fixture.generated.document.sources = [{_type: 'source', title: 'official-website: https://example.com', publisher: 'manual-json: source', url: 'https://example.com'}]
  const issues = inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues
  const codes = new Set(issues.map((issue) => issue.code))
  assert.ok(codes.has('TECHNICAL_LANGUAGE_EXPOSED'))
  assert.ok(codes.has('RAW_SOURCE_IDENTIFIER_EXPOSED'))
  assert.ok(codes.has('EMPTY_PUBLIC_SECTION'))
  assert.ok(codes.has('PUBLIC_INFORMATION_REPETITION'))
  assert.ok(codes.has('OVERLONG_TABLE_CELL'))
  assert.equal(issues.find((issue) => issue.code === 'RAW_SOURCE_IDENTIFIER_EXPOSED')?.severity, 'FAIL')
  assert.equal(issues.find((issue) => issue.code === 'EMPTY_PUBLIC_SECTION')?.severity, 'FAIL')
  assert.equal(issues.find((issue) => issue.code === 'TECHNICAL_LANGUAGE_EXPOSED')?.severity, 'WARNING')
})

test('QA detecta un precio publicado sin su contexto', () => {
  const fixture = comparisonFixture()
  const price = fixture.enriched.businesses[0]!.evidence.prices[0]!.value
  if (typeof price !== 'object' || !('item' in price)) throw new Error('Fixture de precio no válido')
  price.priceQualifier = 'por persona; mínimo 2 personas'
  fixture.generated.editorial.entries[0]!.strengths[0] += ' por 12 €'

  const issues = inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues

  assert.ok(issues.some((issue) => issue.code === 'PRICE_CONTEXT_LOST' && issue.severity === 'FAIL'))
})

test('helpers de presentación compactan horarios y detectan headings duplicados sin depender del topic', () => {
  assert.deepEqual(compactPracticalLines(['Horario publicado: miércoles a sábado de 13:30 a 16:30 y de 20:30 a 23:00; domingo de 13:00 a 16:30.']), ['Mi–Sá: 13:30–16:30 / 20:30–23:00', 'Do: 13:00–16:30'])
  assert.equal(hasDuplicateSectionHeadings(['Comparación rápida', 'Fuentes', 'Comparación rápida']), true)
  assert.equal(hasDuplicateSectionHeadings(), false)
})

test('enrichment separa cuisine de specialties y registra conflictos de fuentes', () => {
  const item = entity('business-italiano', ['italiana', 'Focaccia'])
  item.facts.distinctiveFeatures = sourced(['vistas al mar'], 'official:item')
  item.facts.openingInformation = sourced(['Mo-Su 10:00-22:00'], 'official:item')
  item.factsBySource.openStreetMap.openingInformation = sourced(['Mo-Su 09:00-21:00'], 'osm:item')
  item.factsBySource.officialWebsite.openingInformation = sourced(['Mo-Su 10:00-22:00'], 'official:item')
  item.sources = [source('source:business-italiano'), source('osm:item', 'openstreetmap'), source('official:item', 'official-website')]
  const candidate: ComparisonCandidateArtifact = {
    schemaVersion: 1, id: 'comparison-italiano', topic: 'italiano', searchIntent: 'elegir restaurante italiano en Benidorm', slug: 'italiano', generatedAt: '2026-10-06T00:00:00.000Z', candidateCount: 1,
    candidates: [{businessId: item.id, qualityTier: 'basic', topicEvidence: ['cuisine=italiana'], scores: scoreBusiness(item, 'italiano')}], excluded: [],
  }
  const enriched = enrichComparison(candidate, new Map([[item.id, item]]), {topic: 'italiano', sources: [], businesses: []}, '2026-10-06T00:00:00.000Z')
  assert.ok(enriched.businesses[0]!.evidence.cuisine.every((fact) => fact.value !== 'Focaccia'))
  assert.ok(enriched.businesses[0]!.evidence.specialties.some((fact) => fact.value === 'Focaccia'))
  assert.ok(enriched.businesses[0]!.evidence.location.some((fact) => fact.value === 'vistas al mar'))
  assert.ok(enriched.businesses[0]!.evidence.specialties.every((fact) => fact.value !== 'vistas al mar'))
  assert.equal(enriched.sourceConflicts.length, 1)
  assert.deepEqual(enriched.businesses[0]!.evidence.practical.map((fact) => fact.value), ['Mo-Su 10:00-22:00'])
})

test('enrichment no confirma un direct sostenido sólo por una fuente de marca', () => {
  const item = entity('business-corporate-only', ['sandwich'])
  const brandKey = 'official:brand'
  item.sources.push({...source(brandKey, 'official-website'), sourceClass: 'official-brand', claimScope: 'brand'})
  item.facts.services = sourced(['desayuno'], brandKey)
  item.factsBySource.officialWebsite.services = sourced(['desayuno'], brandKey)
  const candidate: ComparisonCandidateArtifact = {
    schemaVersion: 2, id: 'comparison-desayunos', topic: 'desayunos', searchIntent: 'elegir dónde desayunar en Benidorm', slug: 'desayunos', generatedAt: '2026-10-15T00:00:00.000Z', candidateCount: 1,
    candidates: [{businessId: item.id, qualityTier: 'basic', matchType: 'direct', evidence: [{field: 'services', value: 'desayuno', strength: 'direct', sourceKeys: [brandKey]}], topicEvidence: ['services=desayuno'], scores: scoreBusiness(item, 'desayunos')}], excluded: [],
  }
  const result = enrichComparison(candidate, new Map([[item.id, item]]), {topic: 'desayunos', sources: [], businesses: []}, '2026-10-15T00:00:00.000Z')
  assert.equal(result.businesses.length, 0)
  assert.equal(result.investigations?.[0]?.outcome, 'rejected')
  assert.ok(result.integrityIssues?.some((issue) => issue.code === 'BRAND_SCOPE_NOT_LOCAL'))
  assert.equal(result.sources.find((item) => item.key === brandKey)?.claimScope, 'brand')
})

test('QA emite SOURCE_CONFLICT como warning', () => {
  const fixture = comparisonFixture()
  fixture.enriched.sourceConflicts.push({businessId: 'business-uno', dimension: 'practical', preferredSourceKeys: ['source:business-uno'], conflictingSourceKeys: ['osm:uno'], resolution: 'Se prioriza la web oficial.'})
  const result = inspectComparison(fixture.generated, fixture.enriched, fixture.businesses)
  assert.ok(result.issues.some((issue) => issue.code === 'SOURCE_CONFLICT' && issue.severity === 'WARNING'))
  assert.equal(result.indexability, 'index')
})

test('QA acepta provenance manual válida sin URL como soporte de claims', () => {
  const fixture = comparisonFixture()
  const business = fixture.enriched.businesses[0]!
  const fact = business.evidence.services[0]!
  const manualSource = manualObservationSource(business.businessId)
  business.sources.push(manualSource)
  fixture.enriched.sources.push(manualSource)
  fact.nature = 'first_party_observation'
  fact.sourceStage = 'manual-observation'
  fact.sourceKeys = [manualSource.key]
  fact.provenance = [{
    sourceStage: 'manual-observation', nature: 'first_party_observation', sourceType: 'first-party-observation',
    sourceKey: manualSource.key, observer: 'David', observedAt: '2026-10-08',
  }]

  const issues = inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues

  assert.ok(!issues.some((issue) => issue.code === 'INVALID_EVIDENCE_PROVENANCE' && issue.path === `evidence.${fact.id}`))
  assert.ok(!issues.some((issue) => issue.code === 'UNSUPPORTED_COMPARISON_CLAIM' && issue.path.includes('business-uno')))
})

test('featured item conserva nombre, precio, fuente y fecha exactos', () => {
  const fixture = comparisonFixture()
  fixture.generated.editorial.entries[0]!.featuredItem!.source = 'source:inventada'
  assert.ok(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues.some((issue) => issue.code === 'FEATURED_ITEM_PROVENANCE'))
})

test('QA rechaza claims sin soporte y experiencia personal inventada', () => {
  const unsupported = comparisonFixture()
  unsupported.generated.editorial.claims[0]!.claim = 'Sirve chocolate belga'
  assert.ok(inspectComparison(unsupported.generated, unsupported.enriched, unsupported.businesses).issues.some((issue) => issue.code === 'UNSUPPORTED_COMPARISON_CLAIM'))
  const personal = comparisonFixture()
  personal.generated.editorial.intro = `He probado los cuatro restaurantes. ${personal.generated.editorial.intro}`
  assert.ok(inspectComparison(personal.generated, personal.enriched, personal.businesses).issues.some((issue) => issue.code === 'FAKE_FIRST_PERSON_EXPERIENCE'))
  const namedObserver = comparisonFixture()
  namedObserver.generated.editorial.intro = `David visitó este restaurante. ${namedObserver.generated.editorial.intro}`
  assert.ok(inspectComparison(namedObserver.generated, namedObserver.enriched, namedObserver.businesses).issues.some((issue) => issue.code === 'MANUAL_OBSERVATION_EXPOSED'))
})

test('indexability sólo es index con intención, valor, cobertura, claims y SEO válidos', () => {
  const fixture = comparisonFixture()
  assert.equal(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).indexability, 'index')
  fixture.generated.editorial.seo.metaTitle = 'Guía gastronómica genérica'
  assert.equal(inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).indexability, 'noindex')
})

test('SEO específico se valida con la configuración genérica del topic', () => {
  const fixture = comparisonFixture()
  fixture.enriched.topic = 'arroces'
  fixture.enriched.searchIntent = 'elegir dónde comer arroz en Benidorm'
  fixture.generated.topic = 'arroces'
  fixture.generated.searchIntent = fixture.enriched.searchIntent
  fixture.generated.editorial.seo.metaTitle = 'Dónde comer arroz en Benidorm: comparativa'
  fixture.generated.editorial.seo.metaDescription = 'Comparativa de restaurantes para elegir dónde comer arroz en Benidorm según platos, servicios y precios publicados.'

  assert.ok(!inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues.some((issue) => issue.code === 'GENERIC_SEO'))
})

test('claims comparativos toleran plurales sin reglas ligadas a una cocina', () => {
  const fixture = comparisonFixture()
  fixture.generated.editorial.quickVerdict = 'Mientras Trattoria Uno ofrece cocina italiana, Trattoria Dos presenta propuestas italianas.'
  fixture.generated.editorial.claims[0] = {
    path: 'quickVerdict',
    claim: fixture.generated.editorial.quickVerdict,
    supportedBy: ['business-uno:cuisine:0', 'business-dos:cuisine:0'],
  }

  const issues = inspectComparison(fixture.generated, fixture.enriched, fixture.businesses).issues
  assert.ok(!issues.some((issue) => issue.code === 'UNSUPPORTED_COMPARISON_CLAIM' && issue.path === 'claims[0]'))
})

test('el documento Comparison cumple schema local y referencias tipadas', () => {
  const fixture = comparisonFixture()
  const result = validateContent([{document: fixture.generated.document, source: 'test', expectedType: 'comparison'}], {allowUnresolvedReferences: true})
  assert.deepEqual(result.issues, [])
  assert.ok(result.references.some((reference) => reference.path === 'entries[0].business' && reference.allowedTypes?.includes('business')))
  assert.ok(result.references.some((reference) => reference.path === 'choiceGuide[0].business' && reference.allowedTypes?.includes('business')))
})

function comparisonFixture(): {generated: GeneratedComparisonArtifact; enriched: EnrichedComparisonArtifact; businesses: Map<string, ContentDocument>} {
  const ids = ['business-uno', 'business-dos', 'business-tres', 'business-cuatro']
  const names = ['Trattoria Uno', 'Trattoria Dos', 'Trattoria Tres', 'Trattoria Cuatro']
  const specialties = ['Pasta fresca', 'Focaccia', 'Pinsa', 'Pizza casera']
  const services = ['Servicio para llevar', 'Reservas online', 'Reservas por WhatsApp', 'Menú del día']
  const enrichedBusinesses = ids.map((businessId, index) => {
    const evidence = emptyEvidence()
    const key = `source:${businessId}`
    evidence.cuisine.push({id: `${businessId}:cuisine:0`, value: 'italiana', nature: 'factual', sourceKeys: [key]})
    evidence.specialties.push({id: `${businessId}:specialty:0`, value: specialties[index]!, nature: 'factual', sourceKeys: [key]})
    evidence.featuredItems.push({id: `${businessId}:item:0`, value: {name: specialties[index]!, price: 12 + index, currency: 'EUR', priceQualifier: 'por ración', source: key, retrievedAt: '2026-10-06'}, nature: 'factual', sourceKeys: [key]})
    evidence.prices.push({id: `${businessId}:price:0`, value: {item: specialties[index]!, value: 12 + index, currency: 'EUR', retrievedAt: '2026-10-06'}, nature: 'factual', sourceKeys: [key]})
    evidence.services.push({id: `${businessId}:service:0`, value: services[index]!, nature: 'factual', sourceKeys: [key]})
    evidence.practical.push({id: `${businessId}:practical:0`, value: `Horario ${12 + index}:00-22:00`, nature: 'factual', sourceKeys: [key]})
    return {businessId, name: names[index]!, qualityTier: 'basic' as const, topicEvidence: ['cuisine=italiana'], scores: {topicRelevance: 5, specificity: 3, comparisonCoverage: 5, distinctiveValue: 2, practicalUsefulness: 4, total: 19}, evidence, sources: [source(key)]}
  })
  const enriched: EnrichedComparisonArtifact = {schemaVersion: 1, id: 'comparison-italiano', topic: 'italiano', searchIntent: 'elegir restaurante italiano en Benidorm', slug: 'italiano', enrichedAt: '2026-10-06T00:00:00.000Z', businesses: enrichedBusinesses, sources: enrichedBusinesses.flatMap((item) => item.sources), sourceConflicts: []}
  const choiceGuide = ids.map((businessId, index) => ({businessId, label: `Para ${specialties[index]}`, reason: `${names[index]} documenta ${specialties[index]} en su propuesta publicada.`}))
  const entries = ids.map((businessId, index) => ({
    businessId, verdict: `${names[index]} se diferencia por ${specialties[index]} y por disponer de ${services[index]}.`,
    strengths: [`${specialties[index]} documentada`, `${services[index]} disponible`], limitations: [], bestFor: [specialties[index]!],
    featuredItem: {name: specialties[index]!, price: 12 + index, currency: 'EUR' as const, priceQualifier: 'por ración', source: `source:${businessId}`, retrievedAt: '2026-10-06'},
    practicalNotes: [`Horario ${12 + index}:00-22:00`],
  }))
  const claims = [
    {path: 'quickVerdict', claim: 'Trattoria Uno documenta pasta fresca, mientras Trattoria Dos publica focaccia.', supportedBy: ['business-uno:specialty:0', 'business-dos:specialty:0']},
    ...ids.flatMap((businessId, index) => [
      {path: `choiceGuide.${businessId}.reason`, claim: choiceGuide[index]!.reason, supportedBy: [`${businessId}:specialty:0`]},
      {path: `entries.${businessId}.verdict`, claim: entries[index]!.verdict, supportedBy: [`${businessId}:specialty:0`, `${businessId}:service:0`]},
      {path: `entries.${businessId}.strengths.0`, claim: entries[index]!.strengths[0]!, supportedBy: [`${businessId}:specialty:0`]},
      {path: `entries.${businessId}.strengths.1`, claim: entries[index]!.strengths[1]!, supportedBy: [`${businessId}:service:0`]},
      {path: `entries.${businessId}.bestFor.0`, claim: entries[index]!.bestFor[0]!, supportedBy: [`${businessId}:specialty:0`]},
      {path: `entries.${businessId}.featuredItem`, claim: `${specialties[index]} ${12 + index} EUR`, supportedBy: [`${businessId}:item:0`]},
      {path: `entries.${businessId}.practicalNotes.0`, claim: entries[index]!.practicalNotes[0]!, supportedBy: [`${businessId}:practical:0`]},
    ]),
  ]
  const editorial = {
    title: 'Restaurantes italianos en Benidorm: pasta, pizza y más',
    intro: 'Esta comparativa contrasta platos concretos, precios publicados, formas de reserva y horarios para ayudar a elegir un restaurante italiano en Benidorm según cada necesidad.',
    quickVerdict: 'Trattoria Uno documenta pasta fresca, mientras Trattoria Dos publica focaccia. Para pinsa está Trattoria Tres; Trattoria Cuatro se distingue por pizza casera y menú del día.',
    choiceGuide, entries,
    methodology: 'Se consultaron datos abiertos, webs oficiales y cartas públicas. No todos los establecimientos han sido visitados personalmente. Los precios pueden cambiar y conviene confirmarlos antes de reservar.',
    criteria: ['Propuesta y especialidades documentadas', 'Precios publicados y fechados', 'Reservas, horarios y servicios', 'Diferencias útiles sin posiciones'],
    seo: {metaTitle: 'Restaurantes italianos en Benidorm: opciones y precios', metaDescription: 'Comparación de restaurantes italianos en Benidorm con platos, precios publicados, reservas y horarios para elegir según lo que buscas.'}, claims,
  }
  const document: ContentDocument = {
    _id: 'comparison-italiano', _type: 'comparison', title: editorial.title, slug: {_type: 'slug', current: 'italiano'}, language: 'es', topic: 'italiano', category: 'donde-comer', intro: editorial.intro, quickVerdict: editorial.quickVerdict,
    choiceGuide: choiceGuide.map((choice) => ({_type: 'comparisonChoice', business: {_type: 'reference', _ref: choice.businessId}, label: choice.label, reason: choice.reason})),
    entries: entries.map((entry) => ({_type: 'comparisonEntry', business: {_type: 'reference', _ref: entry.businessId}, verdict: entry.verdict, strengths: entry.strengths, limitations: [], bestFor: entry.bestFor, featuredItem: {_type: 'comparisonFeaturedItem', ...entry.featuredItem, priceUnit: 'per-portion'}, practicalNotes: entry.practicalNotes})),
    methodology: editorial.methodology, criteria: editorial.criteria, author: {_type: 'reference', _ref: 'author-david'}, sources: [{_type: 'source', title: 'Fuente', url: 'https://example.com', accessedAt: '2026-10-06'}], lastVerified: '2026-10-06', seo: {...editorial.seo, noIndex: true},
  }
  const generated: GeneratedComparisonArtifact = {schemaVersion: 1, id: 'comparison-italiano', topic: 'italiano', searchIntent: enriched.searchIntent, indexability: 'noindex', generatedAt: '2026-10-06T00:00:00.000Z', editorial, document}
  return {generated, enriched, businesses: new Map(ids.map((id) => [id, {_id: id, _type: 'business'}]))}
}

function entity(id: string, cuisine: string[] | null): EnrichedEntity {
  const sourceKey = `source:${id}`
  const empty = <T>(): Fact<T> => ({value: null, sources: []})
  const facts: BusinessFacts = {
    name: sourced(id, sourceKey), businessKind: sourced('restaurant', sourceKey), address: sourced({locality: 'Benidorm'}, sourceKey), location: empty(), phone: sourced('+34 900 000 000', sourceKey), website: sourced('https://example.com', sourceKey), openingHoursRaw: empty(),
    cuisine: cuisine ? sourced(cuisine, sourceKey) : empty(), concept: empty(), specialties: empty(), services: empty(), bookingAvailability: empty(), takeaway: empty(), delivery: empty(), terrace: empty(), accessibility: empty(), openingInformation: empty(), locationContext: empty(), distinctiveFeatures: empty(),
  }
  return {schemaVersion: 2, id, type: 'restaurant', targetDocumentType: 'business', slug: id.replace('business-', ''), facts, factsBySource: {openStreetMap: facts, officialWebsite: {cuisine: empty(), concept: empty(), specialties: empty(), services: empty(), bookingAvailability: empty(), takeaway: empty(), delivery: empty(), terrace: empty(), accessibility: empty(), openingInformation: empty(), locationContext: empty(), distinctiveFeatures: empty()}}, editorial: {}, sources: [source(sourceKey)]}
}
function sourced<T>(value: T, key: string): Fact<T> { return {value, sources: [key]} }
function source(key: string, provider = 'manual-json') { return {key, provider, identifier: key, url: 'https://example.com', retrievedAt: '2026-10-06T00:00:00.000Z', attribution: 'Test', licenseUrl: null} }
function manualObservationSource(businessId: string) {
  const key = `manual-observation:${businessId}:2026-10-08:david`
  return {key, provider: 'manual-observation', identifier: `${businessId}:2026-10-08:David`, url: null, retrievedAt: '2026-10-08T00:00:00.000Z', attribution: 'Observación local de primera mano · David', licenseUrl: null}
}
function manualObservationBusiness(businessId: string, value: string): ManualObservationData['businesses'][number] {
  const sourceKey = manualObservationSource(businessId).key
  return {businessId, evidence: {services: [{
    id: `${businessId}:services:manual`, value, nature: 'first_party_observation', sourceStage: 'manual-observation', sourceKeys: [sourceKey],
    provenance: [{sourceStage: 'manual-observation', nature: 'first_party_observation', sourceType: 'first-party-observation', sourceKey, observer: 'David', observedAt: '2026-10-08'}],
  }]}}
}
function manifest(item: EnrichedEntity) { const assessment = evaluateBusinessQualityTier(item.facts); return {id: item.id, type: item.type, slug: item.slug, status: 'enriched', priority: 50, sources: item.sources, discoveredAt: '2026-10-06T00:00:00.000Z', enrichedAt: '2026-10-06T00:00:00.000Z', generatedAt: null, validatedAt: null, importedAt: null, reviewedAt: null, publishedAt: null, qualityTier: assessment.tier, qualityAssessedAt: '2026-10-06T00:00:00.000Z', qualityReasons: assessment.reasons, missingUsefulFacts: assessment.missingUsefulFacts, lastError: null} }
