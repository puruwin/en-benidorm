import {loadEnvFile} from 'node:process'
import type {EnrichedEntity, GeneratedEditorial} from './types'

export const EDITORIAL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['shortDescription', 'description', 'highlights', 'seo'],
  properties: {
    shortDescription: {type: 'string', minLength: 40, maxLength: 240},
    description: {type: 'string', minLength: 80, maxLength: 1200},
    highlights: {type: 'array', minItems: 0, maxItems: 4, items: {type: 'string', minLength: 10, maxLength: 140}},
    seo: {
      type: 'object',
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
            content: [{type: 'input_text', text: 'Eres editor de una guía local de Benidorm. Devuelve sólo contenido editorial respaldado por los facts. No completes ni deduzcas datos factuales ausentes.'}],
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
  stringLength(value.shortDescription, 'shortDescription', 40, 240, errors)
  stringLength(value.description, 'description', 80, 1200, errors)
  if (!Array.isArray(value.highlights) || value.highlights.length > 4 || value.highlights.some((item) => typeof item !== 'string' || item.length < 10 || item.length > 140)) {
    errors.push('highlights debe ser un array de hasta 4 textos de 10-140 caracteres.')
  }
  if (!isRecord(value.seo)) errors.push('seo debe ser un objeto.')
  else {
    stringLength(value.seo.metaTitle, 'seo.metaTitle', 10, 60, errors)
    stringLength(value.seo.metaDescription, 'seo.metaDescription', 50, 160, errors)
    if (Object.keys(value.seo).some((key) => !['metaTitle', 'metaDescription'].includes(key))) errors.push('seo contiene campos no admitidos.')
  }
  if (Object.keys(value).some((key) => !['shortDescription', 'description', 'highlights', 'seo'].includes(key))) errors.push('La salida contiene campos no editoriales.')
  return errors
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
