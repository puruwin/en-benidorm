export const BUSINESS_SECTORS = [
  'hospitality', 'beauty-wellness', 'healthcare', 'professional-services', 'real-estate',
  'home-services', 'automotive', 'education', 'retail', 'tourism', 'b2b-services', 'other',
] as const

export type BusinessSector = (typeof BUSINESS_SECTORS)[number]

export interface BusinessClassification {
  sector: BusinessSector
  subsector: string
  /** All deterministic matches are retained; sector/subsector are the canonical first match. */
  matches: Array<{sector: BusinessSector; subsector: string; osmTag: string}>
}

type Rule = {sector: BusinessSector; subsector: string; tags: Record<string, readonly string[]>}

/**
 * Ordered, commercial taxonomy independent from OSM. Order is the canonical tie breaker.
 * More specific commercial activities deliberately precede generic shop/office fallbacks.
 */
export const OSM_BUSINESS_RULES: readonly Rule[] = [
  {sector: 'healthcare', subsector: 'dentist', tags: {amenity: ['dentist'], healthcare: ['dentist']}},
  {sector: 'healthcare', subsector: 'physiotherapy', tags: {healthcare: ['physiotherapist'], amenity: ['physiotherapist']}},
  {sector: 'healthcare', subsector: 'podiatry', tags: {healthcare: ['podiatrist']}},
  {sector: 'healthcare', subsector: 'optician', tags: {shop: ['optician']}},
  {sector: 'healthcare', subsector: 'veterinary', tags: {amenity: ['veterinary'], healthcare: ['veterinary']}},
  {sector: 'healthcare', subsector: 'medical-clinic', tags: {amenity: ['clinic', 'doctors'], healthcare: ['clinic', 'doctor']}},
  {sector: 'healthcare', subsector: 'pharmacy', tags: {amenity: ['pharmacy'], healthcare: ['pharmacy']}},

  {sector: 'beauty-wellness', subsector: 'barber', tags: {shop: ['barber'], hairdresser: ['barber']}},
  {sector: 'beauty-wellness', subsector: 'hairdresser', tags: {shop: ['hairdresser']}},
  {sector: 'beauty-wellness', subsector: 'nails', tags: {shop: ['nail_salon'], beauty: ['nails']}},
  {sector: 'beauty-wellness', subsector: 'beauty-salon', tags: {shop: ['beauty', 'cosmetics'], beauty: ['salon']}},
  {sector: 'beauty-wellness', subsector: 'spa', tags: {leisure: ['spa'], tourism: ['spa']}},
  {sector: 'beauty-wellness', subsector: 'massage', tags: {shop: ['massage'], healthcare: ['alternative']}},
  {sector: 'beauty-wellness', subsector: 'fitness', tags: {leisure: ['fitness_centre', 'sports_centre'], sport: ['fitness']}},

  {sector: 'real-estate', subsector: 'estate-agent', tags: {office: ['estate_agent'], shop: ['estate_agent']}},
  {sector: 'real-estate', subsector: 'property-management', tags: {office: ['property_management']}},
  {sector: 'real-estate', subsector: 'holiday-rental-management', tags: {office: ['holiday_rental'], rental: ['holiday_apartment']}},

  {sector: 'professional-services', subsector: 'lawyer', tags: {office: ['lawyer']}},
  {sector: 'professional-services', subsector: 'accountant', tags: {office: ['accountant', 'tax_advisor']}},
  {sector: 'professional-services', subsector: 'insurance', tags: {office: ['insurance'], shop: ['insurance']}},
  {sector: 'professional-services', subsector: 'consultancy', tags: {office: ['consulting']}},
  {sector: 'professional-services', subsector: 'architecture', tags: {office: ['architect']}},
  {sector: 'professional-services', subsector: 'engineering', tags: {office: ['engineer']}},
  {sector: 'professional-services', subsector: 'translation', tags: {office: ['translator']}},
  {sector: 'professional-services', subsector: 'travel-agency', tags: {shop: ['travel_agency'], office: ['travel_agent']}},

  {sector: 'home-services', subsector: 'construction', tags: {office: ['construction_company'], craft: ['builder']}},
  {sector: 'home-services', subsector: 'renovation', tags: {craft: ['renovation']}},
  {sector: 'home-services', subsector: 'electrician', tags: {craft: ['electrician'], shop: ['electrical']}},
  {sector: 'home-services', subsector: 'plumber', tags: {craft: ['plumber']}},
  {sector: 'home-services', subsector: 'hvac', tags: {craft: ['hvac']}},
  {sector: 'home-services', subsector: 'carpenter', tags: {craft: ['carpenter']}},
  {sector: 'home-services', subsector: 'painter', tags: {craft: ['painter']}},
  {sector: 'home-services', subsector: 'gardener', tags: {craft: ['gardener'], shop: ['garden_centre']}},
  {sector: 'home-services', subsector: 'pool-service', tags: {craft: ['swimming_pool'], service: ['pool']}},
  {sector: 'home-services', subsector: 'locksmith', tags: {craft: ['locksmith'], shop: ['locksmith']}},
  {sector: 'home-services', subsector: 'cleaning', tags: {office: ['cleaning'], shop: ['dry_cleaning', 'laundry']}},
  {sector: 'home-services', subsector: 'maintenance', tags: {office: ['maintenance'], craft: ['handyman']}},

  {sector: 'automotive', subsector: 'workshop', tags: {shop: ['car_repair'], craft: ['car_repair']}},
  {sector: 'automotive', subsector: 'tyres', tags: {shop: ['tyres']}},
  {sector: 'automotive', subsector: 'detailing', tags: {shop: ['car_detailing']}},
  {sector: 'automotive', subsector: 'car-wash', tags: {amenity: ['car_wash']}},
  {sector: 'automotive', subsector: 'vehicle-sales', tags: {shop: ['car']}},
  {sector: 'automotive', subsector: 'rental', tags: {amenity: ['car_rental'], shop: ['car_rental']}},
  {sector: 'automotive', subsector: 'motorcycle', tags: {shop: ['motorcycle', 'motorcycle_repair']}},
  {sector: 'automotive', subsector: 'parts', tags: {shop: ['car_parts']}},

  {sector: 'education', subsector: 'academy', tags: {amenity: ['college'], office: ['educational_institution']}},
  {sector: 'education', subsector: 'languages', tags: {amenity: ['language_school']}},
  {sector: 'education', subsector: 'driving-school', tags: {amenity: ['driving_school']}},
  {sector: 'education', subsector: 'music', tags: {amenity: ['music_school']}},
  {sector: 'education', subsector: 'tutoring', tags: {office: ['tutoring']}},
  {sector: 'education', subsector: 'childcare-activities', tags: {amenity: ['childcare', 'kindergarten']}},

  {sector: 'tourism', subsector: 'hotel', tags: {tourism: ['hotel', 'hostel', 'guest_house', 'motel']}},
  {sector: 'tourism', subsector: 'apartment', tags: {tourism: ['apartment']}},
  {sector: 'tourism', subsector: 'camping', tags: {tourism: ['camp_site', 'caravan_site']}},
  {sector: 'tourism', subsector: 'attraction', tags: {tourism: ['attraction', 'museum', 'theme_park'], leisure: ['water_park']}},
  {sector: 'tourism', subsector: 'tour-operator', tags: {office: ['tourism'], tourism: ['information']}},

  {sector: 'hospitality', subsector: 'restaurant', tags: {amenity: ['restaurant', 'fast_food', 'food_court']}},
  {sector: 'hospitality', subsector: 'cafe', tags: {amenity: ['cafe'], shop: ['coffee']}},
  {sector: 'hospitality', subsector: 'bar', tags: {amenity: ['bar', 'pub', 'biergarten']}},
  {sector: 'hospitality', subsector: 'ice-cream', tags: {amenity: ['ice_cream'], shop: ['ice_cream']}},
  {sector: 'hospitality', subsector: 'bakery', tags: {shop: ['bakery', 'pastry', 'confectionery']}},

  {sector: 'b2b-services', subsector: 'it-services', tags: {office: ['it']}},
  {sector: 'b2b-services', subsector: 'advertising', tags: {office: ['advertising_agency']}},
  {sector: 'b2b-services', subsector: 'company', tags: {office: ['company']}},

  {sector: 'retail', subsector: 'furniture', tags: {shop: ['furniture', 'bed', 'kitchen']}},
  {sector: 'retail', subsector: 'decoration', tags: {shop: ['interior_decoration', 'houseware', 'curtain']}},
  {sector: 'retail', subsector: 'lighting', tags: {shop: ['lighting']}},
  {sector: 'retail', subsector: 'computers', tags: {shop: ['computer']}},
  {sector: 'retail', subsector: 'phones', tags: {shop: ['mobile_phone', 'mobile_phone_accessories']}},
  {sector: 'retail', subsector: 'appliances', tags: {shop: ['appliance', 'electronics']}},
  {sector: 'retail', subsector: 'fashion', tags: {shop: ['clothes', 'shoes', 'fashion', 'bag', 'accessories', 'leather']}},
  {sector: 'retail', subsector: 'jewellery', tags: {shop: ['jewelry', 'jewellery', 'watches']}},
]

export function classifyBusiness(tags: Readonly<Record<string, string>>): BusinessClassification {
  const matches = OSM_BUSINESS_RULES.flatMap((rule) => {
    for (const [key, values] of Object.entries(rule.tags)) {
      const value = tags[key]?.toLowerCase()
      if (value && values.includes(value)) return [{sector: rule.sector, subsector: rule.subsector, osmTag: `${key}=${value}`}]
    }
    return []
  })
  if (matches.length) return {sector: matches[0]!.sector, subsector: matches[0]!.subsector, matches}
  if (tags.shop) return {sector: 'retail', subsector: 'specialty-shop', matches: [{sector: 'retail', subsector: 'specialty-shop', osmTag: `shop=${tags.shop}`}]}
  return {sector: 'other', subsector: 'unknown', matches: []}
}
