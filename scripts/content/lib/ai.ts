import {loadEnvFile} from 'node:process'
import type {BusinessQualityAssessment, EditorialSection, EnrichedEntity, GeneratedEditorial} from './types'
import type {EnrichedComparisonArtifact, GeneratedComparisonEditorial} from '../../comparison/lib/types'

export const EDITORIAL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['qualityTier', 'shortDescription', 'description', 'highlights', 'seo'],
  properties: {
    qualityTier: {type: 'string', enum: ['insufficient', 'basic', 'rich']},
    shortDescription: {type: ['string', 'null'], minLength: 30, maxLength: 240},
    description: {
      type: 'array', minItems: 0, maxItems: 6,
      items: {
        type: 'object', additionalProperties: false, required: ['section', 'text'],
        properties: {
          section: {type: 'string', enum: ['overview', 'food', 'experience', 'location', 'services', 'practical', 'goodFor', 'highlights']},
          text: {type: 'string', minLength: 30, maxLength: 700},
        },
      },
    },
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
  qualityAssessment: BusinessQualityAssessment & {tier: 'basic' | 'rich'}
  allowedSections: EditorialSection[]
  facts: EnrichedEntity['facts']
  factsBySource: EnrichedEntity['factsBySource']
  sources: EnrichedEntity['sources']
  taxonomy: Array<{id: string; title: string; group: string}>
  documentSchema: Record<string, unknown>
  editorialInstructions: string[]
}

export interface AIProvider {
  generateEditorial(context: GenerationContext): Promise<GeneratedEditorial>
  generateComparison(context: ComparisonGenerationContext): Promise<GeneratedComparisonEditorial>
}

const DEFAULT_OPENAI_MODEL = 'gpt-5-mini'
const DEFAULT_COMPARISON_MODEL = 'gpt-5.6-luna'
const RESPONSES_URL = 'https://api.openai.com/v1/responses'

export interface ComparisonGenerationContext {
  comparison: EnrichedComparisonArtifact
  ranking: Array<{businessId: string; rank: number; scores: EnrichedComparisonArtifact['businesses'][number]['scores']}>
  author: {id: 'author-david'; name: 'David'}
  editorialInstructions: string[]
}

export const COMPARISON_OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'intro', 'quickVerdict', 'entries', 'methodology', 'criteria', 'seo', 'claims'],
  properties: {
    title: {type: 'string', minLength: 20, maxLength: 90},
    intro: {type: 'string', minLength: 100, maxLength: 700},
    quickVerdict: {type: 'string', minLength: 80, maxLength: 700},
    entries: {
      type: 'array', minItems: 4, maxItems: 8,
      items: {
        type: 'object', additionalProperties: false,
        required: ['businessId', 'rank', 'verdict', 'strengths', 'weaknesses', 'bestFor', 'featuredItem', 'featuredPrice', 'practicalNotes'],
        properties: {
          businessId: {type: 'string'}, rank: {type: 'integer', minimum: 1, maximum: 8},
          verdict: {type: 'string', minLength: 30, maxLength: 300},
          strengths: {type: 'array', minItems: 1, maxItems: 4, items: {type: 'string', minLength: 8, maxLength: 160}},
          weaknesses: {type: 'array', minItems: 0, maxItems: 3, items: {type: 'string', minLength: 8, maxLength: 160}},
          bestFor: {type: 'array', minItems: 1, maxItems: 3, items: {type: 'string', minLength: 4, maxLength: 100}},
          featuredItem: {type: ['string', 'null'], minLength: 3, maxLength: 140},
          featuredPrice: {type: ['string', 'null'], minLength: 2, maxLength: 80},
          practicalNotes: {type: 'array', minItems: 0, maxItems: 4, items: {type: 'string', minLength: 6, maxLength: 180}},
        },
      },
    },
    methodology: {type: 'string', minLength: 100, maxLength: 900},
    criteria: {type: 'array', minItems: 3, maxItems: 5, items: {type: 'string', minLength: 10, maxLength: 180}},
    seo: {
      type: 'object', additionalProperties: false, required: ['metaTitle', 'metaDescription'],
      properties: {metaTitle: {type: 'string', minLength: 20, maxLength: 60}, metaDescription: {type: 'string', minLength: 70, maxLength: 160}},
    },
    claims: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false, required: ['path', 'claim', 'supportedBy'],
        properties: {
          path: {type: 'string'}, claim: {type: 'string', minLength: 3},
          supportedBy: {type: 'array', minItems: 1, items: {type: 'string'}},
        },
      },
    },
  },
} as const

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
            content: [{type: 'input_text', text: 'Eres editor de una guía local de Benidorm. El qualityTier ya ha sido decidido por código y debes devolverlo sin cambios. Usa sólo facts con provenance, parafrasea y no deduzcas desde el nombre comercial. Para basic escribe una ficha factual breve (una o dos secciones); para rich usa sólo las secciones permitidas que tengan información real. No conviertas dirección, teléfono o web en highlights. No rellenes para alcanzar longitud ni uses elogios o afirmaciones promocionales como hechos objetivos.'}],
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
    const errors = validateGeneratedEditorial(editorial, context.qualityAssessment.tier)
    if (errors.length) throw new Error(`Structured Output no válido: ${errors.join(' ')}`)
    return editorial as GeneratedEditorial
  }

  async generateComparison(context: ComparisonGenerationContext): Promise<GeneratedComparisonEditorial> {
    const response = await this.fetcher(RESPONSES_URL, {
      method: 'POST',
      headers: {'authorization': `Bearer ${this.apiKey}`, 'content-type': 'application/json'},
      body: JSON.stringify({
        model: process.env.OPENAI_COMPARISON_MODEL || DEFAULT_COMPARISON_MODEL,
        store: false,
        max_output_tokens: 5000,
        input: [
          {
            role: 'system',
            content: [{type: 'input_text', text: [
              'Eres editor de una guía local de Benidorm. Usa exclusivamente el artefacto de evidence recibido.',
              'Conserva exactamente los businessId y ranks deterministas. Compara diferencias verificables; no declares un ganador absoluto.',
              'No inventes visitas, reseñas, popularidad, calidad, velocidad, tranquilidad ni suitability. No uses primera persona.',
              'Un self_claim sólo puede atribuirse: «según su web» o «el negocio indica»; nunca lo conviertas en hecho objetivo.',
              'No inventes debilidades: usa weaknesses=[] si no existe evidence en limitations.',
              'Sólo incluye featuredItem o featuredPrice si hay evidence de la categoría correspondiente.',
              'Registra cada afirmación factual de intro, quickVerdict y entries en claims. path debe apuntar al campo y supportedBy debe contener IDs exactos del evidence.',
              'Para arrays usa paths como entries.<businessId>.strengths.0. No registres metodología, criterios ni textos puramente editoriales sin facts.',
            ].join(' ')}],
          },
          {role: 'user', content: [{type: 'input_text', text: JSON.stringify(context)}]},
        ],
        text: {format: {type: 'json_schema', name: 'comparison_editorial_content', strict: true, schema: COMPARISON_OUTPUT_SCHEMA}},
      }),
      signal: AbortSignal.timeout(180_000),
    })
    if (!response.ok) throw new Error(`OpenAI Responses API respondió ${response.status}: ${await response.text()}`)
    const payload = await response.json() as unknown
    const text = responseOutputText(payload)
    if (!text) throw new Error('OpenAI Responses API no devolvió output_text para Comparison.')
    return JSON.parse(text) as GeneratedComparisonEditorial
  }
}

export function validateGeneratedEditorial(value: unknown, expectedTier?: 'basic' | 'rich'): string[] {
  if (!isRecord(value)) return ['La salida debe ser un objeto.']
  const errors: string[] = []
  if (value.qualityTier !== 'insufficient' && value.qualityTier !== 'basic' && value.qualityTier !== 'rich') errors.push('qualityTier debe ser insufficient, basic o rich.')
  if (expectedTier && value.qualityTier !== expectedTier) errors.push(`qualityTier debe conservar el valor evaluado por código: ${expectedTier}.`)
  if (value.qualityTier === 'insufficient') {
    if (value.shortDescription !== null || value.seo !== null || !Array.isArray(value.description) || value.description.length > 0 || !Array.isArray(value.highlights) || value.highlights.length > 0) errors.push('Una salida insufficient debe dejar textos y seo en null y los arrays vacíos.')
  } else {
    stringLength(value.shortDescription, 'shortDescription', 30, 240, errors)
  }
  if (value.qualityTier !== 'insufficient' && (!Array.isArray(value.description) || value.description.length === 0 || value.description.length > 6)) {
    errors.push('description debe contener entre 1 y 6 secciones.')
  } else if (Array.isArray(value.description)) {
    if (value.qualityTier === 'basic' && value.description.length > 2) errors.push('basic admite como máximo 2 secciones breves.')
    for (const [index, section] of value.description.entries()) {
      if (!isRecord(section) || !EDITORIAL_SECTIONS.has(String(section.section) as EditorialSection)) errors.push(`description[${index}].section no es válida.`)
      else stringLength(section.text, `description[${index}].text`, 30, 700, errors)
    }
  }
  const highlights = value.highlights
  if (!Array.isArray(highlights) || highlights.length > 4 || highlights.some((item) => typeof item !== 'string' || item.length < 10 || item.length > 140)) errors.push('highlights debe ser un array de hasta 4 textos válidos.')
  if (value.qualityTier !== 'insufficient') {
    if (!isRecord(value.seo)) errors.push('seo debe ser un objeto.')
    else validateSeo(value.seo, errors)
  }
  if (Object.keys(value).some((key) => !['qualityTier', 'shortDescription', 'description', 'highlights', 'seo'].includes(key))) errors.push('La salida contiene campos no editoriales.')
  return errors
}

const EDITORIAL_SECTIONS = new Set<EditorialSection>(['overview', 'food', 'experience', 'location', 'services', 'practical', 'goodFor', 'highlights'])

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
