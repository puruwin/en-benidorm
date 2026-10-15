import type {GeographicScope} from './types'

export const DISCOVERY_AREAS = {
  benidorm: {name: 'Benidorm', bbox: [38.5011769, -0.1869109, 38.6101333, -0.0667580], boundaryRelationId: 341148},
  'la-nucia': {name: 'La Nucía', bbox: [38.575, -0.19, 38.67, -0.075], boundaryRelationId: 344745},
  'alfas-del-pi': {name: "l'Alfàs del Pi", bbox: [38.545, -0.145, 38.625, -0.045], boundaryRelationId: 344746},
  albir: {name: 'Albir', bbox: [38.555, -0.09, 38.59, -0.045]},
  target: {name: 'Benidorm · La Nucía · l’Alfàs del Pi / Albir', bbox: [38.5011769, -0.19, 38.67, -0.045]},
} as const satisfies Record<string, GeographicScope>

export type DiscoveryMunicipality = 'Benidorm' | 'La Nucía' | "l'Alfàs del Pi" | 'unknown'
export type DiscoveryZone = 'Benidorm' | 'La Nucía' | "l'Alfàs del Pi" | 'Albir' | 'unknown'

export interface GeographicClassification {municipality: DiscoveryMunicipality; zone: DiscoveryZone; confidence: 'tag' | 'coordinates' | 'unknown'}

const NORMALIZED_PLACES = new Map<string, GeographicClassification>([
  ['benidorm', {municipality: 'Benidorm', zone: 'Benidorm', confidence: 'tag'}],
  ['la nucia', {municipality: 'La Nucía', zone: 'La Nucía', confidence: 'tag'}],
  ["l alfas del pi", {municipality: "l'Alfàs del Pi", zone: "l'Alfàs del Pi", confidence: 'tag'}],
  ['alfas del pi', {municipality: "l'Alfàs del Pi", zone: "l'Alfàs del Pi", confidence: 'tag'}],
  ['albir', {municipality: "l'Alfàs del Pi", zone: 'Albir', confidence: 'tag'}],
  ['el albir', {municipality: "l'Alfàs del Pi", zone: 'Albir', confidence: 'tag'}],
])

export function resolveDiscoveryArea(value: string): GeographicScope | undefined {
  const key = normalize(value)
  if (key === 'benidorm') return DISCOVERY_AREAS.benidorm
  if (key === 'la nucia' || key === 'lanucia') return DISCOVERY_AREAS['la-nucia']
  if (key === 'l alfas del pi' || key === 'alfas del pi') return DISCOVERY_AREAS['alfas-del-pi']
  if (key === 'albir' || key === 'el albir') return DISCOVERY_AREAS.albir
  if (key === 'target' || key === 'zona objetivo') return DISCOVERY_AREAS.target
  return undefined
}

export function classifyGeography(tags: Readonly<Record<string, string>>, latitude: number | null, longitude: number | null): GeographicClassification {
  for (const key of ['addr:city', 'addr:municipality', 'addr:place', 'is_in:city', 'is_in']) {
    const value = tags[key]
    if (!value) continue
    for (const part of value.split(/[;,]/)) {
      const match = NORMALIZED_PLACES.get(normalize(part))
      if (match) return match
    }
  }
  if (latitude === null || longitude === null) return {municipality: 'unknown', zone: 'unknown', confidence: 'unknown'}
  // Conservative coordinate zones: ambiguous border strips deliberately remain unknown.
  if (latitude <= 38.565 && longitude <= -0.075) return {municipality: 'Benidorm', zone: 'Benidorm', confidence: 'coordinates'}
  if (longitude >= -0.09 && latitude >= 38.555 && latitude <= 38.595) return {municipality: "l'Alfàs del Pi", zone: 'Albir', confidence: 'coordinates'}
  if (latitude >= 38.602 && longitude <= -0.09) return {municipality: 'La Nucía', zone: 'La Nucía', confidence: 'coordinates'}
  if (latitude >= 38.57 && latitude <= 38.602 && longitude >= -0.135) return {municipality: "l'Alfàs del Pi", zone: "l'Alfàs del Pi", confidence: 'coordinates'}
  return {municipality: 'unknown', zone: 'unknown', confidence: 'unknown'}
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
