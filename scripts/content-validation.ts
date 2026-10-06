import {createHash} from 'node:crypto'
import {readdir, readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

export type ContentDocument = Record<string, unknown> & {_id: string; _type: string}

export interface ContentInput {
  document: ContentDocument
  source: string
  expectedType?: string
}

export interface ValidationIssue {
  source: string
  path: string
  message: string
}

export interface ContentReference {
  sourceId: string
  source: string
  path: string
  ref: string
  allowedTypes?: readonly string[]
}

export interface ValidationResult {
  issues: ValidationIssue[]
  references: ContentReference[]
}

export const GENERATED_SOURCES = [
  {directory: 'content/generated/businesses', type: 'business'},
  {directory: 'content/generated/places', type: 'place'},
  {directory: 'content/generated/beaches', type: 'beach'},
  {directory: 'content/generated/events', type: 'event'},
  {directory: 'content/generated/articles', type: 'article'},
] as const

const DOCUMENT_TYPES = new Set([
  'siteSettings', 'homePage', 'area', 'category', 'author',
  'business', 'place', 'beach', 'event', 'article',
])
const SLUGGED_TYPES = new Set(['area', 'category', 'author', 'business', 'place', 'beach', 'event', 'article'])
const CATEGORY_GROUPS = new Set(['section', 'businessType', 'cuisine', 'feature', 'topic', 'placeType'])
const BUSINESS_KINDS = new Set(['restaurant', 'bar', 'pub', 'cafe', 'hotel', 'shop', 'service'])
const PRICE_RANGES = new Set(['€', '€€', '€€€', '€€€€'])
const PLACE_TYPES = new Set(['Mirador', 'Parque', 'Monumento', 'Ruta', 'Punto de interés'])
const EVENT_STATUSES = new Set(['scheduled', 'postponed', 'cancelled', 'rescheduled'])
const ARTICLE_SECTIONS = new Set(['guides', 'thingsToDo', 'information'])
const DAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
const CALLOUT_TONES = new Set(['Consejo', 'Información', 'Aviso'])
// Los documentos importados reciben el prefijo `drafts.` (7 caracteres), así
// que el ID base se limita a 121 para respetar el máximo de 128 de Sanity.
const DOCUMENT_ID_PATTERN = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/
const REFERENCE_ID_PATTERN = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const REFERENCE_RULES: Record<string, Record<string, readonly string[]>> = {
  homePage: {
    'featuredGuides[]': ['article'],
    'recommendedBusinesses[]': ['business'],
    'featuredPlaces[]': ['place', 'beach'],
  },
  business: {'categories[]': ['category'], 'features[]': ['category'], area: ['area']},
  place: {'categories[]': ['category'], 'features[]': ['category'], area: ['area']},
  beach: {'services[]': ['category'], area: ['area']},
  event: {venue: ['place', 'business'], 'categories[]': ['category']},
  article: {author: ['author'], 'categories[]': ['category'], 'relatedContent[]': ['business', 'place', 'beach', 'event', 'article']},
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function keyFor(documentId: string, path: string, index: number): string {
  return createHash('sha1').update(`${documentId}:${path}:${index}`).digest('hex').slice(0, 12)
}

function addArrayKeys(value: unknown, documentId: string, path = ''): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const nextPath = `${path}[${index}]`
      const normalized = addArrayKeys(item, documentId, nextPath)
      if (isRecord(normalized) && typeof normalized._key !== 'string') {
        return {...normalized, _key: keyFor(documentId, path, index)}
      }
      return normalized
    })
  }
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, addArrayKeys(child, documentId, path ? `${path}.${key}` : key)]),
  )
}

export function normalizeDocument(document: ContentDocument): ContentDocument {
  return addArrayKeys(structuredClone(document), document._id) as ContentDocument
}

export async function loadGeneratedContent(root = process.cwd()): Promise<{inputs: ContentInput[]; issues: ValidationIssue[]}> {
  const inputs: ContentInput[] = []
  const issues: ValidationIssue[] = []

  for (const {directory, type} of GENERATED_SOURCES) {
    const absoluteDirectory = resolve(root, directory)
    let entries
    try {
      entries = await readdir(absoluteDirectory, {withFileTypes: true})
    } catch (error) {
      issues.push({source: directory, path: '', message: `No se puede leer el directorio: ${errorMessage(error)}`})
      continue
    }

    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name))) {
      const source = `${directory}/${entry.name}`
      try {
        const parsed: unknown = JSON.parse(await readFile(resolve(absoluteDirectory, entry.name), 'utf8'))
        if (!isRecord(parsed)) {
          issues.push({source, path: '', message: 'El archivo debe contener un único objeto JSON.'})
          continue
        }
        if (typeof parsed._id !== 'string' || typeof parsed._type !== 'string') {
          issues.push({source, path: '', message: 'El documento debe declarar _id y _type como cadenas.'})
          continue
        }
        inputs.push({document: normalizeDocument(parsed as ContentDocument), source, expectedType: type})
      } catch (error) {
        issues.push({source, path: '', message: `JSON no válido: ${errorMessage(error)}`})
      }
    }
  }

  return {inputs, issues}
}

export function validateContent(
  inputs: readonly ContentInput[],
  options: {allowUnresolvedReferences?: boolean} = {},
): ValidationResult {
  const issues: ValidationIssue[] = []
  const references: ContentReference[] = []
  const byId = new Map<string, ContentInput>()
  const slugs = new Map<string, ContentInput>()

  const issue = (input: ContentInput, path: string, message: string) => issues.push({source: input.source, path, message})

  for (const input of inputs) {
    const document = input.document
    if (!DOCUMENT_ID_PATTERN.test(document._id) || document._id.startsWith('drafts.')) {
      issue(input, '_id', 'Debe ser un ID base determinista válido y no puede empezar por "drafts.".')
    }
    if (!DOCUMENT_TYPES.has(document._type)) issue(input, '_type', `Tipo de documento no admitido: ${document._type}.`)
    if (input.expectedType && input.expectedType !== document._type) {
      issue(input, '_type', `La carpeta requiere documentos de tipo ${input.expectedType}.`)
    }
    const previous = byId.get(document._id)
    if (previous) issue(input, '_id', `ID duplicado; también aparece en ${previous.source}.`)
    else byId.set(document._id, input)
    for (const systemField of ['_rev', '_createdAt', '_updatedAt']) {
      if (systemField in document) issue(input, systemField, 'No incluyas campos de sistema gestionados por Sanity.')
    }

    validateDocument(input, issue)
    collectReferences(input, references, issue)

    if (SLUGGED_TYPES.has(document._type)) {
      const slug = slugValue(document.slug)
      if (slug) {
        const slugKey = `${document._type}:${slug}`
        const duplicate = slugs.get(slugKey)
        if (duplicate) issue(input, 'slug.current', `Slug duplicado; también aparece en ${duplicate.source}.`)
        else slugs.set(slugKey, input)
        const expectedId = `${document._type}-${slug}`
        if (document._id !== expectedId) issue(input, '_id', `Para este slug el ID determinista debe ser "${expectedId}".`)
      }
    }
  }

  for (const reference of references) {
    if (reference.ref.startsWith('image-') || reference.ref.startsWith('file-')) continue
    const target = byId.get(reference.ref)
    if (!target) {
      if (!options.allowUnresolvedReferences) {
        issues.push({source: reference.source, path: reference.path, message: `La referencia "${reference.ref}" no existe en el contenido local.`})
      }
      continue
    }
    if (reference.allowedTypes && !reference.allowedTypes.includes(target.document._type)) {
      issues.push({
        source: reference.source,
        path: reference.path,
        message: `La referencia apunta a ${target.document._type}; se esperaba ${reference.allowedTypes.join(' o ')}.`,
      })
    }
  }

  return {issues, references}
}

function validateDocument(input: ContentInput, issue: (input: ContentInput, path: string, message: string) => void): void {
  const doc = input.document
  const requiredString = (field: string) => {
    if (typeof doc[field] !== 'string' || !(doc[field] as string).trim()) issue(input, field, 'Campo obligatorio; debe ser una cadena no vacía.')
  }
  const optionalString = (field: string, max?: number) => {
    const value = doc[field]
    if (value !== undefined && typeof value !== 'string') issue(input, field, 'Debe ser una cadena.')
    if (typeof value === 'string' && max && value.length > max) issue(input, field, `No puede superar ${max} caracteres.`)
  }
  const enumValue = (field: string, values: ReadonlySet<string>, required = false) => {
    const value = doc[field]
    if (required && (typeof value !== 'string' || !value)) issue(input, field, 'Campo obligatorio.')
    else if (value !== undefined && (typeof value !== 'string' || !values.has(value))) issue(input, field, `Valor no admitido: ${String(value)}.`)
  }
  const language = () => {
    if (doc.language !== 'es') issue(input, 'language', 'El idioma inicial admitido es "es".')
  }

  if (doc._type === 'siteSettings') {
    if (doc._id !== 'site-settings') issue(input, '_id', 'El singleton debe usar el ID "site-settings".')
    requiredString('siteName')
    requiredString('footerText')
    validateLinkArray(input, doc.navigation, 'navigation', issue)
    if (!isRecord(doc.diningPage)) issue(input, 'diningPage', 'La configuración de Dónde comer es obligatoria.')
    else {
      validateNestedString(input, doc.diningPage, 'title', 'diningPage.title', issue)
      validateNestedString(input, doc.diningPage, 'intro', 'diningPage.intro', issue)
      validateSeo(input, doc.diningPage.seo, 'diningPage.seo', issue)
    }
    validateSeo(input, doc.defaultSeo, 'defaultSeo', issue)
  } else if (doc._type === 'homePage') {
    if (doc._id !== 'homepage') issue(input, '_id', 'El singleton debe usar el ID "homepage".')
    requiredString('title')
    requiredString('intro')
    validateLinkArray(input, doc.primaryLinks, 'primaryLinks', issue, true)
    if (!Array.isArray(doc.primaryLinks) || doc.primaryLinks.length !== 6) issue(input, 'primaryLinks', 'La portada debe tener exactamente seis accesos principales.')
    validateSeo(input, doc.seo, 'seo', issue)
  } else if (doc._type === 'area') {
    requiredString('name')
    validateSlug(input, issue)
    language()
  } else if (doc._type === 'category') {
    requiredString('title')
    validateSlug(input, issue)
    enumValue('group', CATEGORY_GROUPS, true)
    language()
    optionalBoolean(input, 'indexable', issue)
  } else if (doc._type === 'author') {
    requiredString('name')
    validateSlug(input, issue)
    language()
  } else if (doc._type === 'business') {
    requiredString('name')
    validateSlug(input, issue)
    enumValue('businessKind', BUSINESS_KINDS, true)
    requiredString('shortDescription')
    optionalString('shortDescription', 240)
    enumValue('contentQuality', new Set(['sufficient', 'insufficient']), true)
    enumValue('priceRange', PRICE_RANGES)
    language()
  } else if (doc._type === 'place') {
    requiredString('name')
    validateSlug(input, issue)
    requiredString('shortDescription')
    enumValue('placeType', PLACE_TYPES)
    language()
  } else if (doc._type === 'beach') {
    requiredString('name')
    validateSlug(input, issue)
    requiredString('shortDescription')
    if (doc.lengthMeters !== undefined && (typeof doc.lengthMeters !== 'number' || doc.lengthMeters <= 0)) issue(input, 'lengthMeters', 'Debe ser un número positivo.')
    language()
  } else if (doc._type === 'event') {
    requiredString('name')
    validateSlug(input, issue)
    requiredString('shortDescription')
    validateDate(input, 'startDate', true, false, issue)
    validateDate(input, 'endDate', false, false, issue)
    enumValue('eventStatus', EVENT_STATUSES, true)
    language()
  } else if (doc._type === 'article') {
    requiredString('title')
    validateSlug(input, issue)
    enumValue('section', ARTICLE_SECTIONS, true)
    requiredString('excerpt')
    optionalString('excerpt', 240)
    if (!Array.isArray(doc.body) || doc.body.length === 0) issue(input, 'body', 'El contenido Portable Text es obligatorio y no puede estar vacío.')
    validateDate(input, 'publishedAt', true, false, issue)
    validateDate(input, 'updatedAt', false, false, issue)
    language()
  }

  validateReferenceFields(input, issue)
  if (doc.seo !== undefined) validateSeo(input, doc.seo, 'seo', issue)
  validateCommonNestedValues(input, issue)
}

function validateReferenceFields(
  input: ContentInput,
  issue: (input: ContentInput, path: string, message: string) => void,
): void {
  for (const path of Object.keys(REFERENCE_RULES[input.document._type] ?? {})) {
    const isArray = path.endsWith('[]')
    const field = isArray ? path.slice(0, -2) : path
    const value = input.document[field]
    if (value === undefined) continue
    if (isArray) {
      if (!Array.isArray(value)) {
        issue(input, field, 'Debe ser un array de referencias de Sanity.')
        continue
      }
      value.forEach((item, index) => {
        if (!isRecord(item) || item._type !== 'reference' || typeof item._ref !== 'string') {
          issue(input, `${field}[${index}]`, 'Debe tener la forma {_type: "reference", _ref: "id-determinista"}.')
        }
      })
    } else if (!isRecord(value) || value._type !== 'reference' || typeof value._ref !== 'string') {
      issue(input, field, 'Debe tener la forma {_type: "reference", _ref: "id-determinista"}.')
    }
  }
}

function validateSlug(input: ContentInput, issue: (input: ContentInput, path: string, message: string) => void): void {
  const value = slugValue(input.document.slug)
  if (!value) issue(input, 'slug.current', 'El slug es obligatorio y debe tener la forma {_type: "slug", current: "..."}.')
  else if (!SLUG_PATTERN.test(value)) issue(input, 'slug.current', 'Usa minúsculas, números y guiones simples.')
}

function slugValue(value: unknown): string | undefined {
  return isRecord(value) && value._type === 'slug' && typeof value.current === 'string' ? value.current : undefined
}

function validateLinkArray(
  input: ContentInput,
  value: unknown,
  path: string,
  issue: (input: ContentInput, path: string, message: string) => void,
  withDescription = false,
): void {
  if (!Array.isArray(value)) {
    issue(input, path, 'Debe ser un array.')
    return
  }
  value.forEach((item, index) => {
    if (!isRecord(item)) return issue(input, `${path}[${index}]`, 'Debe ser un objeto.')
    validateNestedString(input, item, 'label', `${path}[${index}].label`, issue)
    validateNestedString(input, item, 'href', `${path}[${index}].href`, issue)
    if (withDescription) {
      validateNestedString(input, item, 'description', `${path}[${index}].description`, issue)
      validateNestedString(input, item, 'accent', `${path}[${index}].accent`, issue)
    }
  })
}

function validateNestedString(
  input: ContentInput,
  object: Record<string, unknown>,
  field: string,
  path: string,
  issue: (input: ContentInput, path: string, message: string) => void,
): void {
  if (typeof object[field] !== 'string' || !(object[field] as string).trim()) issue(input, path, 'Campo obligatorio; debe ser una cadena no vacía.')
}

function optionalBoolean(input: ContentInput, field: string, issue: (input: ContentInput, path: string, message: string) => void): void {
  const value = input.document[field]
  if (value !== undefined && typeof value !== 'boolean') issue(input, field, 'Debe ser un booleano.')
}

function validateDate(
  input: ContentInput,
  field: string,
  required: boolean,
  dateOnly: boolean,
  issue: (input: ContentInput, path: string, message: string) => void,
): void {
  const value = input.document[field]
  if (value === undefined && !required) return
  if (typeof value !== 'string' || (dateOnly ? !isIsoDate(value) : !isIsoDateTime(value))) {
    issue(input, field, dateOnly ? 'Debe ser una fecha ISO YYYY-MM-DD.' : 'Debe ser una fecha y hora ISO válida.')
  }
}

function validateSeo(
  input: ContentInput,
  value: unknown,
  path: string,
  issue: (input: ContentInput, path: string, message: string) => void,
): void {
  if (!isRecord(value)) {
    issue(input, path, 'La configuración SEO es obligatoria y debe ser un objeto.')
    return
  }
  if (value.metaTitle !== undefined && (typeof value.metaTitle !== 'string' || value.metaTitle.length > 60)) issue(input, `${path}.metaTitle`, 'Debe ser una cadena de 60 caracteres como máximo.')
  if (value.metaDescription !== undefined && (typeof value.metaDescription !== 'string' || value.metaDescription.length > 160)) issue(input, `${path}.metaDescription`, 'Debe ser una cadena de 160 caracteres como máximo.')
  if (value.noIndex !== undefined && typeof value.noIndex !== 'boolean') issue(input, `${path}.noIndex`, 'Debe ser un booleano.')
}

function validateCommonNestedValues(input: ContentInput, issue: (input: ContentInput, path: string, message: string) => void): void {
  walk(input.document, '', (value, path) => {
    if (!isRecord(value)) return
    if (value._type === 'openingHours') {
      if (typeof value.day !== 'string' || !DAYS.has(value.day)) issue(input, `${path}.day`, 'Día de la semana no admitido.')
      for (const field of ['opens', 'closes']) {
        if (value[field] !== undefined && (typeof value[field] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value[field] as string))) {
          issue(input, `${path}.${field}`, 'Debe usar el formato HH:MM de 24 horas.')
        }
      }
    }
    if (value._type === 'callout') {
      if (value.tone !== undefined && (typeof value.tone !== 'string' || !CALLOUT_TONES.has(value.tone))) issue(input, `${path}.tone`, 'Tipo de destacado no admitido.')
      if (typeof value.text !== 'string' || !value.text.trim()) issue(input, `${path}.text`, 'El texto del destacado es obligatorio.')
    }
    if (value._type === 'comparisonTable') {
      if (typeof value.caption !== 'string' || !value.caption.trim()) issue(input, `${path}.caption`, 'El título accesible es obligatorio.')
      if (!Array.isArray(value.columns) || value.columns.length < 2 || value.columns.some((column) => typeof column !== 'string')) {
        issue(input, `${path}.columns`, 'Debe contener al menos dos columnas de texto.')
      }
    }
    if (value._type === 'source') {
      if (typeof value.title !== 'string' || !value.title) issue(input, `${path}.title`, 'El título de la fuente es obligatorio.')
      if (typeof value.url !== 'string' || !isHttpUrl(value.url)) issue(input, `${path}.url`, 'La fuente debe incluir una URL http(s) válida.')
      if (value.accessedAt !== undefined && (typeof value.accessedAt !== 'string' || !isIsoDate(value.accessedAt))) issue(input, `${path}.accessedAt`, 'Debe ser una fecha ISO YYYY-MM-DD.')
    }
    if (value._type === 'geopoint') {
      if (typeof value.lat !== 'number' || value.lat < -90 || value.lat > 90) issue(input, `${path}.lat`, 'Latitud no válida.')
      if (typeof value.lng !== 'number' || value.lng < -180 || value.lng > 180) issue(input, `${path}.lng`, 'Longitud no válida.')
    }
    if (value._type === 'image') {
      if (typeof value.alt !== 'string' || !value.alt.trim()) issue(input, `${path}.alt`, 'El texto alternativo es obligatorio.')
      if (!isRecord(value.asset) || value.asset._type !== 'reference' || typeof value.asset._ref !== 'string') issue(input, `${path}.asset`, 'La imagen debe referenciar un asset de Sanity.')
    }
  })
  for (const field of ['lastVerified']) validateDate(input, field, false, true, issue)
  for (const field of ['website', 'googleMapsUrl', 'ticketUrl']) {
    const value = input.document[field]
    if (value !== undefined && (typeof value !== 'string' || !isHttpUrl(value))) issue(input, field, 'Debe ser una URL http(s) válida.')
  }
}

function collectReferences(
  input: ContentInput,
  references: ContentReference[],
  issue: (input: ContentInput, path: string, message: string) => void,
): void {
  walk(input.document, '', (value, path) => {
    if (!isRecord(value) || value._type !== 'reference') return
    if (typeof value._ref !== 'string' || !REFERENCE_ID_PATTERN.test(value._ref) || value._ref.startsWith('drafts.')) {
      issue(input, `${path}._ref`, 'La referencia debe usar un ID base determinista válido.')
      return
    }
    if (value._weak !== undefined && typeof value._weak !== 'boolean') issue(input, `${path}._weak`, 'Debe ser un booleano.')
    const allowedTypes = allowedReferenceTypes(input.document._type, path)
    references.push({sourceId: input.document._id, source: input.source, path, ref: value._ref, ...(allowedTypes ? {allowedTypes} : {})})
  })
}

function allowedReferenceTypes(documentType: string, path: string): readonly string[] | undefined {
  const normalized = path.replace(/\[\d+\]/g, '[]')
  if (normalized.endsWith('.asset')) return normalized.includes('socialImage') || normalized.includes('heroImage') || normalized.includes('images') || normalized.includes('image')
    ? ['sanity.imageAsset']
    : undefined
  return REFERENCE_RULES[documentType]?.[normalized]
}

function walk(value: unknown, path: string, visitor: (value: unknown, path: string) => void): void {
  visitor(value, path)
  if (Array.isArray(value)) {
    value.forEach((child, index) => walk(child, `${path}[${index}]`, visitor))
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key, visitor)
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value))
}

export function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((item) => `- ${item.source}${item.path ? ` · ${item.path}` : ''}: ${item.message}`).join('\n')
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
