import type {BusinessFacts, BusinessQualityAssessment, Fact} from './types'

const DISTINCTIVE_FIELDS = [
  'cuisine', 'concept', 'specialties', 'distinctiveFeatures', 'services', 'terrace', 'takeaway',
  'delivery', 'bookingAvailability', 'accessibility', 'locationContext',
] as const satisfies readonly (keyof BusinessFacts)[]

const USEFUL_FIELDS = [
  'cuisine', 'concept', 'specialties', 'distinctiveFeatures', 'services', 'terrace', 'takeaway',
  'delivery', 'bookingAvailability', 'accessibility', 'locationContext', 'openingInformation',
] as const satisfies readonly (keyof BusinessFacts)[]

/** Decides editorial depth from normalized, sourced facts. It never derives meaning from the business name. */
export function evaluateBusinessQualityTier(facts: BusinessFacts): BusinessQualityAssessment {
  const valid = (field: keyof BusinessFacts) => hasUsefulSourcedValue(facts[field])
  const identityVerified = valid('name') && valid('businessKind')
  const locationVerified = valid('address') || valid('location') || valid('locationContext')
  const distinctiveFacts = DISTINCTIVE_FIELDS.filter(valid)
  const missingUsefulFacts = USEFUL_FIELDS.filter((field) => !valid(field))
  const reasons: string[] = []

  if (identityVerified) reasons.push('Identidad verificada')
  else reasons.push('Identidad incompleta o sin provenance válida')
  if (locationVerified) reasons.push('Ubicación verificable')
  else reasons.push('Ubicación insuficientemente verificada')

  if (!identityVerified || !locationVerified || distinctiveFacts.length === 0) {
    reasons.push('No hay facts editoriales distintivos con provenance válida')
    return {tier: 'insufficient', reasons, distinctiveFacts: [...distinctiveFacts], missingUsefulFacts: [...missingUsefulFacts], score: 0}
  }

  const dimensions = {
    whatIs: valid('cuisine') || valid('concept'),
    whatOffers: valid('specialties') || valid('services') || valid('takeaway') || valid('delivery'),
    experience: valid('terrace') || valid('distinctiveFeatures'),
    locationContext: valid('locationContext'),
    practical: valid('bookingAvailability') || valid('accessibility') || valid('openingInformation') || valid('openingHoursRaw'),
  }
  const answered = Object.entries(dimensions).filter(([, present]) => present).map(([name]) => name)

  for (const field of distinctiveFacts) reasons.push(reasonFor(field))
  const rich = dimensions.whatIs && answered.length >= 3
  if (rich) reasons.push(`Facts suficientes para ${answered.length} dimensiones editoriales`)
  else reasons.push('Información suficiente para una ficha breve y específica')

  return {
    tier: rich ? 'rich' : 'basic',
    reasons,
    distinctiveFacts: [...distinctiveFacts],
    missingUsefulFacts: [...missingUsefulFacts],
    score: answered.length,
  }
}

function hasUsefulSourcedValue(fact: Fact<unknown>): boolean {
  if (!fact || !Array.isArray(fact.sources) || fact.sources.length === 0) return false
  const value = fact.value
  if (value === null || value === false) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.some((item) => typeof item !== 'string' || item.trim().length > 0)
  if (typeof value === 'object') return Object.values(value).some((item) => item !== null && item !== '')
  return true
}

function reasonFor(field: typeof DISTINCTIVE_FIELDS[number]): string {
  const labels: Record<typeof DISTINCTIVE_FIELDS[number], string> = {
    cuisine: 'Tipo de cocina verificado',
    concept: 'Concepto del negocio verificado',
    specialties: 'Especialidades verificadas',
    distinctiveFeatures: 'Rasgos distintivos verificados',
    services: 'Servicios relevantes verificados',
    terrace: 'Terraza verificada',
    takeaway: 'Servicio para llevar verificado',
    delivery: 'Entrega a domicilio verificada',
    bookingAvailability: 'Disponibilidad de reservas verificada',
    accessibility: 'Información de accesibilidad verificada',
    locationContext: 'Contexto de ubicación verificado',
  }
  return labels[field]
}
