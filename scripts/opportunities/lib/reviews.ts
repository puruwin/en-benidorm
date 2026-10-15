import {resolve} from 'node:path'
import {readJsonIfExists, writeJsonAtomic} from '../../content/lib/files'
import type {OpportunityReview, OpportunityReviewEvaluation, OpportunityReviewRevision, OpportunityReviewWorkflowStatus} from './types'

export const OPPORTUNITY_REVIEW_POLICY = {
  operationalStatusDays: 90,
  websiteDays: 180,
  contactChannelsDays: 180,
} as const

export function opportunityReviewPath(businessId: string): string {
  return `content/manual/opportunity-reviews/${businessId}.json`
}

export async function loadOpportunityReview(root: string, businessId: string): Promise<OpportunityReview | undefined> {
  return (await readJsonIfExists<OpportunityReview | null>(resolve(root, opportunityReviewPath(businessId)), null)) ?? undefined
}

export function evaluateOpportunityReview(review: OpportunityReview | undefined, now = new Date().toISOString()): OpportunityReviewEvaluation {
  if (!review) return {workflowStatus: 'unreviewed', staleFields: [], expires: {operationalStatus: '', website: ''}}
  const explicit = review.expiresAt
  const operationalStatus = earliest(addDays(review.reviewedAt, OPPORTUNITY_REVIEW_POLICY.operationalStatusDays), explicit)
  const website = earliest(addDays(review.reviewedAt, OPPORTUNITY_REVIEW_POLICY.websiteDays), explicit)
  const hasContacts = Object.keys(review.contactChannels).length > 0
  const contactChannels = hasContacts ? earliest(addDays(review.reviewedAt, OPPORTUNITY_REVIEW_POLICY.contactChannelsDays), explicit) : undefined
  const staleFields: OpportunityReviewEvaluation['staleFields'] = []
  const timestamp = Date.parse(now)
  if (Date.parse(operationalStatus) <= timestamp) staleFields.push('operationalStatus')
  if (Date.parse(website) <= timestamp) staleFields.push('website')
  if (contactChannels && Date.parse(contactChannels) <= timestamp) staleFields.push('contactChannels')
  return {
    workflowStatus: staleFields.length ? 'stale' : review.workflowStatus,
    staleFields,
    expires: {operationalStatus, website, ...(contactChannels ? {contactChannels} : {})},
  }
}

export function validateOpportunityReview(value: unknown, businessId: string, availableSourceKeys?: ReadonlySet<string>): OpportunityReview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Review inválida: se esperaba un objeto.')
  const input = value as Record<string, any>
  const reviewedAt = requiredDate(input.reviewedAt, 'reviewedAt')
  if (typeof input.reviewedBy !== 'string' || !input.reviewedBy.trim()) throw new Error('reviewedBy es obligatorio.')
  const workflowStatus = enumValue(input.workflowStatus, ['reviewing', 'verified', 'rejected'] as const, 'workflowStatus')
  const operationalStatus = enumValue(input.operationalStatus, ['confirmed-open', 'confirmed-closed', 'unknown'] as const, 'operationalStatus')
  const identityStatus = enumValue(input.identityStatus, ['confirmed', 'ambiguous', 'conflict'] as const, 'identityStatus')
  const presence = input.officialPresence
  if (!presence || typeof presence !== 'object' || Array.isArray(presence)) throw new Error('officialPresence es obligatorio.')
  const officialPresence = {
    website: enumValue(presence.website, ['confirmed', 'not-found', 'ambiguous'] as const, 'officialPresence.website'),
    googleProfile: enumValue(presence.googleProfile, ['confirmed', 'not-found', 'not-checked'] as const, 'officialPresence.googleProfile'),
    socialProfiles: enumValue(presence.socialProfiles, ['confirmed', 'not-found', 'not-checked'] as const, 'officialPresence.socialProfiles'),
  }
  const contacts = input.contactChannels ?? {}
  if (typeof contacts !== 'object' || Array.isArray(contacts)) throw new Error('contactChannels debe ser un objeto.')
  const contactChannels: OpportunityReview['contactChannels'] = {}
  if (contacts.phone !== undefined) contactChannels.phone = enumValue(contacts.phone, ['confirmed', 'unverified'] as const, 'contactChannels.phone')
  if (contacts.email !== undefined) contactChannels.email = enumValue(contacts.email, ['confirmed', 'unverified'] as const, 'contactChannels.email')
  if (contacts.contactForm !== undefined) contactChannels.contactForm = enumValue(contacts.contactForm, ['confirmed', 'not-found'] as const, 'contactChannels.contactForm')
  if (contacts.booking !== undefined) contactChannels.booking = enumValue(contacts.booking, ['confirmed', 'not-found'] as const, 'contactChannels.booking')
  if (!Array.isArray(input.reviewedSourceKeys) || input.reviewedSourceKeys.some((key: unknown) => typeof key !== 'string')) throw new Error('reviewedSourceKeys debe ser un array de strings.')
  const reviewedSourceKeys = [...new Set(input.reviewedSourceKeys as string[])]
  if (availableSourceKeys) for (const key of reviewedSourceKeys) if (!availableSourceKeys.has(key)) throw new Error(`La fuente revisada no pertenece al negocio: ${key}`)
  if (workflowStatus === 'verified' && (!reviewedSourceKeys.length || operationalStatus !== 'confirmed-open' || identityStatus !== 'confirmed' || officialPresence.website === 'ambiguous')) {
    throw new Error('Una review verified exige confirmed-open, identidad confirmed, web resuelta y reviewedSourceKeys.')
  }
  const resolvedSignalIds = input.resolvedSignalIds === undefined ? undefined : stringArray(input.resolvedSignalIds, 'resolvedSignalIds')
  const expiresAt = input.expiresAt === undefined || input.expiresAt === '' ? undefined : requiredDate(input.expiresAt, 'expiresAt')
  const history = Array.isArray(input.history) ? input.history as OpportunityReviewRevision[] : undefined
  return {
    schemaVersion: 1, businessId, reviewedAt, reviewedBy: input.reviewedBy.trim(), workflowStatus,
    operationalStatus, identityStatus, officialPresence, contactChannels, reviewedSourceKeys,
    ...(resolvedSignalIds?.length ? {resolvedSignalIds} : {}),
    ...(typeof input.notes === 'string' && input.notes.trim() ? {notes: input.notes.trim()} : {}),
    ...(expiresAt ? {expiresAt} : {}), ...(history?.length ? {history} : {}),
  }
}

export async function saveOpportunityReview(root: string, review: OpportunityReview): Promise<void> {
  const previous = await loadOpportunityReview(root, review.businessId)
  const history = [...(previous?.history ?? [])]
  if (previous) history.push(revisionOf(previous))
  await writeJsonAtomic(resolve(root, opportunityReviewPath(review.businessId)), {...review, ...(history.length ? {history} : {})})
}

function revisionOf(review: OpportunityReview): OpportunityReviewRevision {
  const {schemaVersion: _schemaVersion, businessId: _businessId, history: _history, ...revision} = review
  return revision
}
function requiredDate(value: unknown, field: string): string { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${field} debe ser una fecha ISO válida.`); return new Date(value).toISOString() }
function enumValue<const T extends readonly string[]>(value: unknown, values: T, field: string): T[number] { if (typeof value !== 'string' || !values.includes(value)) throw new Error(`${field} no es válido.`); return value as T[number] }
function stringArray(value: unknown, field: string): string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${field} debe ser un array de strings.`); return [...new Set(value)] }
function addDays(value: string, days: number): string { return new Date(Date.parse(value) + days * 86_400_000).toISOString() }
function earliest(calculated: string, explicit?: string): string { return explicit && Date.parse(explicit) < Date.parse(calculated) ? explicit : calculated }

export function reviewAllowsHypotheses(review: OpportunityReview | undefined, evaluation: OpportunityReviewEvaluation, sourceKeys: ReadonlySet<string>, unresolvedConflictSignalIds: readonly string[]): boolean {
  if (!review || evaluation.workflowStatus !== 'verified') return false
  if (review.operationalStatus !== 'confirmed-open' || review.identityStatus !== 'confirmed') return false
  if (!review.reviewedSourceKeys.length || review.reviewedSourceKeys.some((key) => !sourceKeys.has(key))) return false
  const resolved = new Set(review.resolvedSignalIds ?? [])
  return unresolvedConflictSignalIds.every((id) => resolved.has(id))
}

export function effectiveReviewState(review: OpportunityReview | undefined, now?: string): OpportunityReviewWorkflowStatus {
  return evaluateOpportunityReview(review, now).workflowStatus
}
