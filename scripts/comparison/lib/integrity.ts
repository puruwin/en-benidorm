import {normalizeText} from '../../content/lib/normalize'
import {sourceIntegrity} from '../../content/lib/source-integrity'
import type {EnrichedEntity, SourceProvenance} from '../../content/lib/types'
import type {EstablishmentIdentity, IdentityCheck, OperationalStatusAssessment, OperationalStatusSignal} from './types'

const STATUS_FRESHNESS_DAYS = 180

export function checkEstablishmentIdentity(identity: EstablishmentIdentity | undefined, entity: EnrichedEntity): IdentityCheck {
  if (!identity) return {outcome: 'ambiguous', matched: [], mismatched: [], reason: 'La fuente no declara atributos suficientes para vincularla al establecimiento.'}
  const matched: string[] = []
  const mismatched: string[] = []
  compare('businessId', identity.businessId, entity.id, exact, matched, mismatched)
  compare('name', identity.name, entity.facts.name.value, fuzzyText, matched, mismatched)
  compare('address', identity.address, addressText(entity), fuzzyText, matched, mismatched)
  compare('phone', identity.phone, entity.facts.phone.value, normalizedPhoneEqual, matched, mismatched)
  compare('domain', identity.domain, domain(entity.facts.website.value), domainEqual, matched, mismatched)
  if (identity.latitude !== undefined && identity.longitude !== undefined && entity.facts.location.value) {
    const distance = distanceMetres(identity.latitude, identity.longitude, entity.facts.location.value.lat, entity.facts.location.value.lng)
    ;(distance <= 150 ? matched : mismatched).push('coordinates')
  }
  const strong = matched.some((field) => ['businessId', 'phone', 'domain', 'coordinates'].includes(field))
  const weakPair = matched.includes('name') && matched.includes('address')
  const decisiveMismatch = mismatched.some((field) => ['businessId', 'phone', 'coordinates'].includes(field))
  if (decisiveMismatch) return {outcome: 'mismatch', matched, mismatched, reason: `Atributos incompatibles: ${mismatched.join(', ')}.`}
  if (strong || weakPair) return {outcome: 'confirmed', matched, mismatched, reason: `Identidad vinculada por ${matched.join(', ')}.`}
  return {outcome: 'ambiguous', matched, mismatched, reason: 'La coincidencia disponible no identifica inequívocamente el establecimiento.'}
}

export function assessOperationalStatus(
  entity: EnrichedEntity,
  signals: readonly OperationalStatusSignal[],
  sources: readonly SourceProvenance[],
  now: string,
): OperationalStatusAssessment {
  const sourceByKey = new Map(sources.map((source) => [source.key, source]))
  const assessedSignals = signals.map((signal) => {
    const identityCheck = checkEstablishmentIdentity(signal.identity, entity)
    const sourceChecks = signal.sourceKeys.map((key) => sourceByKey.get(key)).filter((source): source is SourceProvenance => Boolean(source))
    const accepted = identityCheck.outcome === 'confirmed'
      && sourceChecks.length === signal.sourceKeys.length
      && sourceChecks.every((source) => sourceIntegrity(source).claimScope === 'establishment')
    return {...signal, identityCheck, accepted}
  })
  const accepted = assessedSignals.filter((signal) => signal.accepted)
  const trustedCurrent = accepted.filter((signal) => signal.sourceKeys.some((key) => {
    const classification = sourceByKey.get(key) ? sourceIntegrity(sourceByKey.get(key)!).sourceClass : 'third-party'
    return (classification === 'official-location' || classification === 'manual-first-party') && isCurrent(signal.observedAt, now)
  }))
  const statuses = new Set(trustedCurrent.map((signal) => signal.status))
  const reasons: string[] = []
  let status: OperationalStatusAssessment['status'] = 'unknown'
  if (statuses.size === 1) status = trustedCurrent[0]!.status
  else if (statuses.size > 1) reasons.push('Hay señales fiables y vigentes contradictorias; no se resuelve por mayoría.')
  if (signals.length > 0 && accepted.length === 0) reasons.push('Ninguna señal externa supera la comprobación de identidad y alcance local.')
  if (accepted.length > 0 && trustedCurrent.length === 0) reasons.push('Sólo hay señales de terceros o no vigentes; no confirman el estado operativo.')
  if (new Set(accepted.map((signal) => signal.status)).size > 1) reasons.push('Las señales aceptadas son contradictorias y requieren verificación editorial.')
  const needsVerification = signals.length > 0 && (status === 'unknown' || reasons.length > 0)
  return {status, assessedAt: now, sourceKeys: [...new Set(accepted.flatMap((signal) => signal.sourceKeys))], needsVerification, reasons, signals: assessedSignals}
}

export function isConfirmedCurrentClosure(status: OperationalStatusAssessment | undefined): boolean {
  return Boolean(status && !status.needsVerification && (status.status === 'closed' || status.status === 'temporarily_closed'))
}

function compare(field: string, left: string | undefined, right: string | null | undefined, equals: (a: string, b: string) => boolean, matched: string[], mismatched: string[]): void {
  if (!left || !right) return
  ;(equals(left, right) ? matched : mismatched).push(field)
}
function exact(a: string, b: string): boolean { return a === b }
function fuzzyText(a: string, b: string): boolean {
  const left = normalizeText(a); const right = normalizeText(b)
  return left === right || (left.length >= 8 && right.length >= 8 && (left.includes(right) || right.includes(left)))
}
function normalizedPhoneEqual(a: string, b: string): boolean { return a.replace(/\D/g, '').slice(-9) === b.replace(/\D/g, '').slice(-9) }
function domainEqual(a: string, b: string): boolean { return a.replace(/^www\./, '').toLowerCase() === b.replace(/^www\./, '').toLowerCase() }
function domain(value: string | null): string | null { try { return value ? new URL(value).hostname : null } catch { return null } }
function addressText(entity: EnrichedEntity): string | null {
  const value = entity.facts.address.value
  return value ? [value.street, value.postalCode, value.locality, value.province, value.country].filter(Boolean).join(' ') : null
}
function isCurrent(observedAt: string, now: string): boolean {
  const age = new Date(now).getTime() - new Date(`${observedAt.slice(0, 10)}T00:00:00.000Z`).getTime()
  return Number.isFinite(age) && age >= 0 && age <= STATUS_FRESHNESS_DAYS * 86_400_000
}
function distanceMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
