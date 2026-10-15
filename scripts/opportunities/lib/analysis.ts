import {createHash} from 'node:crypto'
import type {DiscoveredEntity, DiscoveryCategory, EnrichedEntity, ManifestEntry, SourceProvenance} from '../../content/lib/types'
import {evaluateOpportunityReview, reviewAllowsHypotheses} from './reviews'
import type {CommercialHypothesis, EvidenceStrength, OpportunityAnalysis, OpportunityReview, OpportunitySignal, OpportunitySignalType, SuggestedAction} from './types'
import type {VerificationArtifact} from './verification-types'

export const OPPORTUNITY_ANALYZER_VERSION = 'p3a4-v1'

export interface OpportunityEvidence {
  entry: ManifestEntry
  discovered?: DiscoveredEntity
  enriched?: EnrichedEntity
  comparison?: {
    integrityIssues: Array<{code: string; sourceKeys: string[]; message: string}>
    operationalStatus?: {status?: string; assessedAt?: string; sourceKeys?: string[]; needsVerification?: boolean; reasons?: string[]}
  }
  probableDuplicateSourceKeys?: string[]
  review?: OpportunityReview
  verification?: VerificationArtifact
}

export function analyzeOpportunity(input: OpportunityEvidence, now = new Date().toISOString()): OpportunityAnalysis {
  const sources = uniqueSources([...(input.entry.sources ?? []), ...(input.discovered?.sources ?? []), ...(input.enriched?.sources ?? []), ...(input.verification?.sources ?? [])])
  const sourceMap = new Map(sources.map((source) => [source.key, source]))
  const signals: OpportunitySignal[] = []
  const add = (type: OpportunitySignalType, observation: string, sourceKeys: string[], confidence: EvidenceStrength = 'moderate', observedAt?: string) => {
    const keys = [...new Set(sourceKeys.filter(Boolean))]
    signals.push({id: `signal:${type}`, type, observation, sourceKeys: keys, observedAt: observedAt ?? latestDate(keys.map((key) => sourceMap.get(key)?.retrievedAt), now), confidence})
  }
  const facts = input.enriched?.facts
  const tags = input.discovered?.raw.tags ?? {}
  const website = input.verification?.digitalPresence.website?.value ?? facts?.website.value ?? tags.website ?? tags['contact:website'] ?? null
  const websiteKeys = input.verification?.digitalPresence.website?.sourceKeys ?? facts?.website.sources ?? sourceKeysForTag(input, website)
  const websiteSources = websiteKeys.map((key) => sourceMap.get(key)).filter((source): source is SourceProvenance => Boolean(source))
  const isBrand = input.verification?.digitalPresence.website?.scope === 'brand' || websiteSources.some((source) => source.sourceClass === 'official-brand' || source.claimScope === 'brand') || Boolean(tags.brand && tags.brand !== tags.name)
  const isOfficial = websiteSources.some(isOfficialSource)
  if (!website) {
    add('no_official_website_found', 'Content Lab no encontró una web oficial en las fuentes consultadas; esto no demuestra que el negocio necesite una web.', sources.map((source) => source.key), sources.length > 0 ? 'moderate' : 'weak')
  } else if (isBrand) {
    add('brand_website_only', `La única web verificada corresponde a la marca y no acredita por sí sola información específica del establecimiento: ${website}`, websiteKeys, 'moderate')
  } else if (isOfficial) {
    add('official_website_found', `Se verificó una web oficial atribuible al establecimiento: ${website}`, websiteKeys, 'strong')
  } else {
    add('website_source_ambiguous', `Existe una URL asociada (${website}), pero su carácter oficial para este establecimiento no está suficientemente acreditado.`, websiteKeys, 'weak')
  }

  const visibleDimensions: string[] = []
  if (nonEmpty(facts?.services.value)) { add('services_visible_online', 'Las fuentes verificadas muestran servicios del negocio.', facts!.services.sources, 'strong'); visibleDimensions.push('services') }
  const items = facts?.commercialItems?.value ?? []
  if (items.length) { add('commercial_items_visible_online', `Se verificaron ${items.length} productos o servicios comerciales publicados.`, facts?.commercialItems?.sources ?? items.map((item) => item.sourceKey), 'strong'); visibleDimensions.push('commercial-items') }
  const priced = items.filter((item) => item.price)
  if (priced.length) { add('prices_visible_online', `Se verificaron precios explícitos para ${priced.length} elementos comerciales.`, priced.map((item) => item.sourceKey), 'strong'); visibleDimensions.push('prices') }
  const openingKeys = [...(facts?.openingInformation.sources ?? []), ...(facts?.openingHoursRaw.sources ?? [])]
  if (nonEmpty(facts?.openingInformation.value) || Boolean(facts?.openingHoursRaw.value)) { add('opening_hours_visible_online', 'Las fuentes consultadas publican horarios del negocio.', openingKeys, 'moderate'); visibleDimensions.push('opening-hours') }
  if (visibleDimensions.length < 2) add('limited_structured_information', `Content Lab sólo pudo verificar ${visibleDimensions.length ? visibleDimensions.join(', ') : 'ninguna'} de estas dimensiones estructuradas: servicios, oferta comercial, precios y horarios.`, sources.map((source) => source.key), sources.length ? 'moderate' : 'weak')

  const issues = input.comparison?.integrityIssues ?? []
  const identityIssues = issues.filter((issue) => ['IDENTITY_MISMATCH', 'AMBIGUOUS_EXTERNAL_IDENTITY', 'BRAND_SCOPE_NOT_LOCAL'].includes(issue.code))
  if (identityIssues.length) add('identity_conflict', identityIssues.map((issue) => issue.message).join(' '), identityIssues.flatMap((issue) => issue.sourceKeys), 'strong')
  if (input.probableDuplicateSourceKeys?.length) add('probable_duplicate', 'Discovery registró una coincidencia probable con otra identidad; no se ha fusionado automáticamente.', input.probableDuplicateSourceKeys, 'moderate')
  const operational = input.comparison?.operationalStatus
  if (operational?.needsVerification || issues.some((issue) => issue.code === 'OPERATIONAL_STATUS_REVIEW')) {
    const issue = issues.filter((item) => item.code === 'OPERATIONAL_STATUS_REVIEW')
    add('operational_status_conflict', operational?.reasons?.join(' ') || issue.map((item) => item.message).join(' ') || 'Las fuentes presentan señales operativas que requieren verificación.', [...(operational?.sourceKeys ?? []), ...issue.flatMap((item) => item.sourceKeys)], 'strong', operational?.assessedAt)
  } else if (!operational || !operational.status || operational.status === 'unknown') {
    add('operational_status_unknown', 'Content Lab no dispone de un estado operativo actual confirmado para este negocio.', operational?.sourceKeys ?? sources.map((source) => source.key), operational?.sourceKeys?.length ? 'moderate' : 'weak', operational?.assessedAt)
  }

  const phoneKeys = facts?.phone.sources ?? sourceKeysForTag(input, tags.phone ?? tags['contact:phone'])
  if (facts?.phone.value || tags.phone || tags['contact:phone']) add('phone_available', 'Hay un teléfono publicado en las fuentes disponibles.', phoneKeys, 'moderate')
  const email = tags.email ?? tags['contact:email']
  const verifiedEmail = input.verification?.digitalPresence.emails[0]
  if (email || verifiedEmail) add('email_available', 'Hay una dirección de email publicada explícitamente en los datos de origen.', verifiedEmail?.sourceKeys ?? sourceKeysForTag(input, email), 'moderate')
  const contactForm = input.verification?.digitalPresence.forms[0] ?? (tags['contact:form'] ? {sourceKeys: sourceKeysForTag(input, tags['contact:form'])} : undefined)
  if (contactForm) add('contact_form_available', 'La fuente publica explícitamente un formulario de contacto.', contactForm.sourceKeys, 'moderate')
  const verifiedBooking = input.verification?.digitalPresence.bookingUrls[0]
  const booking = Boolean(verifiedBooking) || facts?.bookingAvailability.value === true || ['yes', 'required', 'recommended'].includes(tags.reservation ?? '') || Boolean(tags.booking)
  const bookingKeys = verifiedBooking?.sourceKeys ?? (facts?.bookingAvailability.value === true ? facts.bookingAvailability.sources : sourceKeysForTag(input, tags.reservation ?? tags.booking))
  if (booking) {
    add('booking_channel_available', 'Se verificó públicamente un canal o disponibilidad de reserva.', bookingKeys, 'strong')
    add('booking_process_visible', 'El proceso de reserva es visible en las fuentes públicas verificadas.', bookingKeys, 'strong')
  }
  const verifiedQuote = input.verification?.digitalPresence.quoteRequestUrls[0]
  if (verifiedQuote || tags['contact:quote'] || tags['request:quote']) add('quote_request_process_visible', 'La fuente declara explícitamente un proceso público de solicitud de presupuesto.', verifiedQuote?.sourceKeys ?? sourceKeysForTag(input, tags['contact:quote'] ?? tags['request:quote']), 'moderate')
  const hasManualContact = signals.some((signal) => signal.type === 'phone_available' || signal.type === 'email_available')
  const hasProcess = signals.some((signal) => ['contact_form_available', 'booking_process_visible', 'quote_request_process_visible'].includes(signal.type))
  if (hasManualContact && !hasProcess) add('manual_contact_only_visible', 'Entre los canales que Content Lab pudo verificar sólo aparecen teléfono o email; no se afirma que sean los únicos canales reales.', signals.filter((signal) => signal.type === 'phone_available' || signal.type === 'email_available').flatMap((signal) => signal.sourceKeys), 'weak')

  const evidenceStrength = calculateEvidenceStrength(signals, sourceMap)
  const reviewTypes = new Set<OpportunitySignalType>(['identity_conflict', 'probable_duplicate', 'operational_status_unknown', 'operational_status_conflict', 'website_source_ambiguous'])
  const reviewSignals = signals.filter((signal) => reviewTypes.has(signal.type))
  const reviewEvaluation = evaluateOpportunityReview(input.review, now)
  const conflictSignalIds = signals.filter((signal) => ['identity_conflict', 'probable_duplicate', 'operational_status_conflict'].includes(signal.type)).map((signal) => signal.id)
  const reviewEligible = reviewAllowsHypotheses(input.review, reviewEvaluation, new Set(sourceMap.keys()), conflictSignalIds)
  const rejected = Boolean(input.review && (
    reviewEvaluation.workflowStatus === 'rejected' || input.review.operationalStatus === 'confirmed-closed' || input.review.identityStatus === 'conflict'
  ))
  const signalSupported = (id: string) => {
    const signal = signals.find((candidate) => candidate.id === id)
    return Boolean(signal?.sourceKeys.length && signal.sourceKeys.every((key) => sourceMap.has(key)))
  }
  const reviewBasis = input.review ? {
    reviewedAt: input.review.reviewedAt, reviewedBy: input.review.reviewedBy,
    reviewedSourceKeys: input.review.reviewedSourceKeys,
  } : undefined
  const hypotheses: CommercialHypothesis[] = []
  if (reviewEligible && input.review && reviewBasis) {
    const websiteSignal = signals.find((signal) => ['no_official_website_found', 'website_source_ambiguous', 'brand_website_only'].includes(signal.type))
    if (input.review.officialPresence.website === 'not-found' && websiteSignal && signalSupported(websiteSignal.id)) hypotheses.push(hypothesis(
      'web-presence', 'No se ha identificado una web oficial propia para un negocio confirmado como operativo.', [websiteSignal.id], evidenceStrength,
      ['No implica que el negocio quiera o necesite desarrollar una web.', 'La verificación caduca y se limita a las fuentes revisadas.'],
      {...reviewBasis, fields: ['operationalStatus', 'identityStatus', 'officialPresence.website']},
    ))
    const limitedId = 'signal:limited_structured_information'
    if (signalSupported(limitedId)) hypotheses.push(hypothesis(
      'content', 'Puede existir margen para hacer más verificable y accesible la información comercial pública.', [limitedId], evidenceStrength,
      ['La observación se limita a las fuentes y dimensiones que Content Lab pudo consultar.', 'No implica una mala presencia digital ni una prioridad para el negocio.'],
      {...reviewBasis, fields: ['operationalStatus', 'identityStatus']},
    ))
    const phoneId = 'signal:phone_available'
    const manualId = 'signal:manual_contact_only_visible'
    if (input.review.officialPresence.website === 'confirmed' && input.review.contactChannels.phone === 'confirmed' && input.review.contactChannels.booking === 'not-found' && signalSupported(phoneId) && signalSupported(manualId)) hypotheses.push(hypothesis(
      'booking', 'No se ha identificado un canal de reserva online; el contacto visible se realiza mediante teléfono.', [phoneId, manualId], evidenceStrength,
      ['No se afirma que el proceso interno sea manual.', 'No encontrar booking en las fuentes revisadas no demuestra que no exista otro canal.'],
      {...reviewBasis, fields: ['operationalStatus', 'identityStatus', 'officialPresence.website', 'contactChannels.phone', 'contactChannels.booking']},
    ))
  }
  const manualReviewRequired = !rejected && !reviewEligible && (reviewSignals.length > 0 || evidenceStrength === 'weak' || reviewEvaluation.workflowStatus !== 'verified')
  const suggestedActions = rejected
    ? [{type: 'do-not-contact' as const, reason: 'La revisión humana registra cierre, rechazo o conflicto de identidad.'}]
    : actionsFor(signals, hypotheses, evidenceStrength, !reviewEligible && reviewSignals.length > 0)
  const status = rejected ? 'not-actionable' : reviewEligible ? (hypotheses.length ? 'analyzed' : 'not-actionable') : 'needs-review'
  const coveredSignals = signals.filter((signal) => signal.sourceKeys.length > 0 && signal.sourceKeys.every((key) => sourceMap.has(key))).length
  const name = input.enriched?.facts.name.value ?? input.discovered?.raw.name ?? input.entry.slug
  const fingerprint = opportunityFingerprint(input)
  return {
    schemaVersion: 1, businessId: input.entry.id, businessName: name, category: categoryFor(input.entry), generatedAt: now,
    status, signals, hypotheses, suggestedActions,
    summary: {evidenceStrength, opportunityAreas: [...new Set(hypotheses.map((item) => item.area))], manualReviewRequired},
    provenance: {sources, coveredSignals, totalSignals: signals.length, coverage: signals.length ? coveredSignals / signals.length : 0},
    ...(input.verification ? {verification: {artifact: `content/verification/${input.entry.id}.json`, generatedAt: input.verification.generatedAt, fingerprint: input.verification.fingerprint, identityEvidence: input.verification.identityEvidence.status, operationalEvidence: input.verification.operationalEvidence.status}} : {}),
    inputFingerprint: fingerprint,
  }
}

export function opportunityFingerprint(input: OpportunityEvidence): string {
  return createHash('sha256').update(JSON.stringify({analyzerVersion: OPPORTUNITY_ANALYZER_VERSION, entry: input.entry, discovered: input.discovered, enriched: input.enriched, comparison: input.comparison, probableDuplicateSourceKeys: input.probableDuplicateSourceKeys, review: input.review, verificationFingerprint: input.verification?.fingerprint})).digest('hex')
}

export function categoryFor(entry: ManifestEntry): DiscoveryCategory {
  if (['restaurant', 'bar', 'cafe', 'hotel'].includes(entry.type)) return 'hospitality'
  if (entry.type === 'shop') return 'retail'
  if (entry.type === 'service') return 'professional-services'
  const declared = entry.discovery?.categories[0]
  if (declared) return declared
  return 'attractions'
}

function hypothesis(area: CommercialHypothesis['area'], text: string, basedOnSignalIds: string[], confidence: EvidenceStrength, limitations: string[], basedOnReview?: NonNullable<CommercialHypothesis['basedOnReview']>): CommercialHypothesis {
  return {id: `hypothesis:${area}:${basedOnSignalIds[0]?.replace('signal:', '')}`, area, hypothesis: text, basedOnSignalIds, ...(basedOnReview ? {basedOnReview} : {}), confidence, limitations}
}

function actionsFor(signals: OpportunitySignal[], hypotheses: CommercialHypothesis[], strength: EvidenceStrength, blocked: boolean): SuggestedAction[] {
  if (blocked) return [
    {type: 'manual-review', reason: 'Resolver primero las dudas de identidad, web o estado operativo.'},
    {type: 'do-not-contact', reason: 'No iniciar contacto comercial mientras la identidad o el estado no estén verificados.'},
  ]
  const actions: SuggestedAction[] = []
  if (signals.some((signal) => ['no_official_website_found', 'brand_website_only'].includes(signal.type))) actions.push({type: 'verify-google-profile', reason: 'Contrastar manualmente si existe una presencia oficial no recogida por las fuentes actuales.'})
  if (signals.some((signal) => signal.type === 'official_website_found')) actions.push({type: 'visit-website', reason: 'Revisar manualmente la evidencia oficial antes de interpretar posibles carencias.'})
  if (signals.some((signal) => ['phone_available', 'email_available', 'contact_form_available', 'booking_channel_available'].includes(signal.type))) actions.push({type: 'verify-contact-channel', reason: 'Confirmar manualmente que el canal publicado sigue vigente; no implica contactar.'})
  if (hypotheses.length && strength !== 'weak') actions.push({type: 'prepare-audit', reason: 'Preparar una auditoría interna basada sólo en las señales trazables; no es una propuesta económica.'})
  if (!actions.length || strength === 'weak') actions.push({type: 'manual-review', reason: 'La evidencia disponible es insuficiente para avanzar sin revisión humana.'})
  return actions
}

function calculateEvidenceStrength(signals: OpportunitySignal[], sources: Map<string, SourceProvenance>): EvidenceStrength {
  const supported = signals.filter((signal) => signal.sourceKeys.length > 0 && signal.sourceKeys.every((key) => sources.has(key)))
  const keys = new Set(supported.flatMap((signal) => signal.sourceKeys))
  const providers = new Set([...keys].map((key) => sources.get(key)?.provider).filter(Boolean))
  const hasFirstParty = [...keys].some((key) => {
    const source = sources.get(key)
    return source?.sourceClass === 'official-location' || source?.sourceClass === 'manual-first-party' || isOfficialSource(source)
  })
  if (supported.length >= 3 && providers.size >= 2 && hasFirstParty) return 'strong'
  if (supported.length >= 2 && keys.size >= 1) return 'moderate'
  return 'weak'
}

function isOfficialSource(source?: SourceProvenance): boolean {
  return Boolean(source && (source.sourceClass === 'official-location' || source.sourceClass === 'manual-first-party' || source.provider === 'official-website' || /oficial/i.test(source.attribution)))
}

function sourceKeysForTag(input: OpportunityEvidence, value: unknown): string[] {
  if (!value) return []
  return input.discovered?.sources.map((source) => source.key) ?? input.entry.sources.map((source) => source.key)
}

function nonEmpty(value: unknown): boolean { return Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined }
function uniqueSources(sources: SourceProvenance[]): SourceProvenance[] { return [...new Map(sources.map((source) => [source.key, source])).values()] }
function latestDate(values: Array<string | undefined>, fallback: string): string { return values.filter((value): value is string => Boolean(value)).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? fallback }
