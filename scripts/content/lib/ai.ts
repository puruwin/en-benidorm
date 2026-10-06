import {loadEnvFile} from 'node:process'
import type {EnrichedEntity, GeneratedEditorial} from './types'

export const EDITORIAL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['contentQuality', 'shortDescription', 'whatIsIt', 'whatToExpect', 'whyGo', 'goodFor', 'highlights', 'seo'],
  properties: {
    contentQuality: {type: 'string', enum: ['sufficient', 'insufficient']},
    shortDescription: {type: ['string', 'null'], minLength: 40, maxLength: 240},
    whatIsIt: {type: ['string', 'null'], minLength: 40, maxLength: 500},
    whatToExpect: {type: ['string', 'null'], minLength: 40, maxLength: 700},
    whyGo: {type: ['string', 'null'], minLength: 40, maxLength: 500},
    goodFor: {type: 'array', minItems: 0, maxItems: 5, items: {type: 'string', minLength: 5, maxLength: 100}},
    highlights: {type: 'array', minItems: 0, maxItems: 4, items: {type: 'string', minLength: 10, maxLength: 140}},
    seo: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['metaTitle', 'metaDescription'],
      properties: {
        metaTitle: {type: 'string', minLength: 10, maxLength: 60},
        metaDescription: {type: 'string', minLength: 50, maxLength: 160},
      },
    },
  },
} as const

export interface GenerationContext {
  facts: EnrichedEntity['facts']
  factsBySource: EnrichedEntity['factsBySource']
  sources: EnrichedEntity['sources']
  taxonomy: Array<{id: string; title: string; group: string}>
  documentSchema: Record<string, unknown>
  editorialInstructions: string[]
}

export interface AIProvider {
  generateEditorial(context: GenerationContext): Promise<GeneratedEditorial>
}

const DEFAULT_OPENAI_MODEL = 'gpt-5-mini'
const RESPONSES_URL = 'https://api.openai.com/v1/responses'

export class OpenAIResponsesProvider implements AIProvider {
  private readonly apiKey: string
  private readonly model: string

  constructor(private readonly fetcher: typeof fetch = fetch) {
    loadEnvironment()
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('Falta OPENAI_API_KEY (variable exclusivamente server-side).')
    this.apiKey = apiKey
    this.model = process.env.OPENAI_CONTENT_MODEL || DEFAULT_OPENAI_MODEL
  }

  async generateEditorial(context: GenerationContext): Promise<GeneratedEditorial> {
    const response = await this.fetcher(RESPONSES_URL, {
      method: 'POST',
      headers: {'authorization': `Bearer ${this.apiKey}`, 'content-type': 'application/json'},
      body: JSON.stringify({
        model: this.model,
        store: false,
        max_output_tokens: 1200,
        input: [
          {
            role: 'system',
            content: [{type: 'input_text', text: 'Eres editor de una guía local de Benidorm. Devuelve sólo contenido editorial específico respaldado por los facts y parafrasea la fuente: nunca copies su texto literalmente. No completes ni deduzcas datos ausentes. Si los facts no permiten explicar con utilidad qué es, qué esperar y por qué ir, devuelve contentQuality="insufficient", textos y seo null, y arrays vacíos; jamás rellenes con frases genéricas.'}],
          },
          {role: 'user', content: [{type: 'input_text', text: JSON.stringify(context)}]},
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'business_editorial_content',
            strict: true,
            schema: EDITORIAL_OUTPUT_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) throw new Error(`OpenAI Responses API respondió ${response.status}: ${await response.text()}`)
    const payload = await response.json() as unknown
    const text = responseOutputText(payload)
    if (!text) throw new Error('OpenAI Responses API no devolvió output_text.')
    const editorial = JSON.parse(text) as unknown
    const errors = validateGeneratedEditorial(editorial)
    if (errors.length) throw new Error(`Structured Output no válido: ${errors.join(' ')}`)
    return editorial as GeneratedEditorial
  }
}

export function validateGeneratedEditorial(value: unknown): string[] {
  if (!isRecord(value)) return ['La salida debe ser un objeto.']
  const errors: string[] = []
  if (value.contentQuality !== 'sufficient' && value.contentQuality !== 'insufficient') errors.push('contentQuality debe ser sufficient o insufficient.')
  if (value.contentQuality === 'sufficient') {
    stringLength(value.shortDescription, 'shortDescription', 40, 240, errors)
    stringLength(value.whatIsIt, 'whatIsIt', 40, 500, errors)
    stringLength(value.whatToExpect, 'whatToExpect', 40, 700, errors)
    stringLength(value.whyGo, 'whyGo', 40, 500, errors)
    if (!isRecord(value.seo)) errors.push('seo debe ser un objeto cuando contentQuality es sufficient.')
    else validateSeo(value.seo, errors)
  } else if ([value.shortDescription, value.whatIsIt, value.whatToExpect, value.whyGo, value.seo].some((item) => item !== null)) {
    errors.push('Una salida insufficient debe dejar textos y seo en null.')
  }
  for (const [field, maximum, minimum] of [['goodFor', 5, 5], ['highlights', 4, 10]] as const) {
    const items = value[field]
    if (!Array.isArray(items) || items.length > maximum || items.some((item) => typeof item !== 'string' || item.length < minimum || item.length > 140)) {
      errors.push(`${field} debe ser un array de hasta ${maximum} textos válidos.`)
    }
    if (value.contentQuality === 'insufficient' && Array.isArray(items) && items.length) errors.push(`${field} debe estar vacío cuando contentQuality es insufficient.`)
  }
  if (Object.keys(value).some((key) => !['contentQuality', 'shortDescription', 'whatIsIt', 'whatToExpect', 'whyGo', 'goodFor', 'highlights', 'seo'].includes(key))) errors.push('La salida contiene campos no editoriales.')
  return errors
}

function validateSeo(value: Record<string, unknown>, errors: string[]): void {
  stringLength(value.metaTitle, 'seo.metaTitle', 10, 60, errors)
  stringLength(value.metaDescription, 'seo.metaDescription', 50, 160, errors)
  if (Object.keys(value).some((key) => !['metaTitle', 'metaDescription'].includes(key))) errors.push('seo contiene campos no admitidos.')
}

function responseOutputText(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.output)) return undefined
  for (const output of value.output) {
    if (!isRecord(output) || !Array.isArray(output.content)) continue
    for (const content of output.content) {
      if (isRecord(content) && content.type === 'output_text' && typeof content.text === 'string') return content.text
      if (isRecord(content) && content.type === 'refusal' && typeof content.refusal === 'string') throw new Error(`OpenAI rechazó la generación: ${content.refusal}`)
    }
  }
  return undefined
}

function stringLength(value: unknown, field: string, min: number, max: number, errors: string[]): void {
  if (typeof value !== 'string' || value.length < min || value.length > max) errors.push(`${field} debe tener ${min}-${max} caracteres.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

let environmentLoaded = false
function loadEnvironment(): void {
  if (environmentLoaded) return
  environmentLoaded = true
  try {
    loadEnvFile('.env')
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (code !== 'ENOENT') throw error
  }
}
