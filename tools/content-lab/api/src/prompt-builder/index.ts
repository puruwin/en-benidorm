import type {CodexPromptRequest, PipelinePhase, QaIssue} from '../../../shared/types'

type Context = {
  topic: string
  request: CodexPromptRequest
  issue?: QaIssue
  selection?: Record<string, any>
  enrichment?: Record<string, any>
  generation?: Record<string, any>
  qa?: Record<string, any>
}

const ISSUE_GUIDANCE: Record<string, string> = {
  REPETITIVE_COMPARISON_CONTENT: 'Reduce la repetición entre quick verdict, choice guide y entries sin perder información factual ni contraste útil.',
  PRICE_CONTEXT_LOST: 'Conserva junto al precio su moneda, unidad, qualifier, mínimos, condiciones y fecha de recuperación.',
  SOURCE_CONFLICT: 'Explica y resuelve el conflicto mediante las reglas genéricas de prioridad y actualidad de fuentes; conserva la decisión y su provenance.',
  SEARCH_INTENT_NOT_SATISFIED: 'Haz que la Comparison responda explícitamente a la intención mediante contrastes y recomendaciones condicionales, no una simple enumeración.',
  LOW_COMPARATIVE_VALUE: 'Aumenta el valor comparativo usando sólo diferencias respaldadas por evidence; no inventes rankings ni ganadores.',
  UNSUPPORTED_COMPARISON_CLAIM: 'Elimina o reformula claims sin soporte y mantén la validación estricta de supportedBy.',
  INSUFFICIENT_EVIDENCE_COVERAGE: 'Primero determina si el problema es falta real de datos o una limitación del enrichment. No reduzcas los thresholds para conseguir PASS. Si las fuentes realmente no contienen información suficiente, mantén la Comparison no indexable.',
  PUBLIC_INFORMATION_REPETITION: 'Evita repetir información pública ya presentada cuando no añade contexto comparativo nuevo.',
  TECHNICAL_LANGUAGE_EXPOSED: 'Sustituye lenguaje interno o técnico expuesto al lector por redacción editorial clara, sin alterar los datos.',
  RAW_SOURCE_IDENTIFIER_EXPOSED: 'Evita mostrar identificadores internos de fuente en contenido público conservando la provenance interna.',
  OVERLONG_TABLE_CELL: 'Reduce la longitud de la celda preservando los hechos que ayudan a elegir y sus matices necesarios.',
  DUPLICATE_SECTION_HEADING: 'Garantiza encabezados de sección únicos y descriptivos mediante una regla general de generación o normalización.',
  EMPTY_PUBLIC_SECTION: 'Evita secciones públicas vacías: complétalas sólo con evidence válida o no las publiques cuando sean opcionales.',
}

const LIKELY_FILES: Record<string, string[]> = {
  REPETITIVE_COMPARISON_CONTENT: ['scripts/comparison/lib/generation.ts', 'scripts/content/lib/ai.ts', 'scripts/comparison/lib/qa.ts'],
  PRICE_CONTEXT_LOST: ['scripts/comparison/lib/generation.ts', 'scripts/content/lib/ai.ts', 'scripts/comparison/lib/qa.ts'],
  SOURCE_CONFLICT: ['scripts/comparison/lib/enrichment.ts', 'scripts/comparison/lib/manual-adapter.ts', 'scripts/comparison/lib/qa.ts'],
  SEARCH_INTENT_NOT_SATISFIED: ['scripts/content/lib/ai.ts', 'scripts/comparison/lib/generation.ts', 'scripts/comparison/lib/qa.ts'],
  LOW_COMPARATIVE_VALUE: ['scripts/comparison/lib/gate.ts', 'scripts/content/lib/ai.ts', 'scripts/comparison/lib/qa.ts'],
  UNSUPPORTED_COMPARISON_CLAIM: ['scripts/comparison/lib/generation.ts', 'scripts/comparison/lib/qa.ts'],
  INSUFFICIENT_EVIDENCE_COVERAGE: ['scripts/comparison/lib/enrichment.ts', 'scripts/comparison/lib/gate.ts', 'scripts/comparison/lib/manual-adapter.ts'],
  PUBLIC_INFORMATION_REPETITION: ['scripts/content/lib/ai.ts', 'scripts/comparison/lib/generation.ts', 'scripts/comparison/lib/qa.ts'],
  TECHNICAL_LANGUAGE_EXPOSED: ['scripts/content/lib/ai.ts', 'scripts/comparison/lib/qa.ts'],
  RAW_SOURCE_IDENTIFIER_EXPOSED: ['scripts/comparison/lib/generation.ts', 'scripts/comparison/lib/qa.ts'],
  OVERLONG_TABLE_CELL: ['scripts/content/lib/ai.ts', 'scripts/comparison/lib/qa.ts'],
  DUPLICATE_SECTION_HEADING: ['scripts/content/lib/ai.ts', 'scripts/comparison/lib/qa.ts'],
  EMPTY_PUBLIC_SECTION: ['scripts/comparison/lib/generation.ts', 'scripts/comparison/lib/qa.ts'],
}

export const SUPPORTED_ISSUES = Object.keys(ISSUE_GUIDANCE)

export function buildCodexPrompt(context: Context): string {
  if (context.request.mode === 'configure-topic') return buildConfigureTopicPrompt(context)
  const code = context.issue?.code ?? context.request.issueCode ?? 'GENERAL_IMPROVEMENT'
  const phase = context.request.phase ?? 'qa'
  const guidance = ISSUE_GUIDANCE[code] ?? genericGuidance(context.request.note)
  const files = LIKELY_FILES[code] ?? ['scripts/comparison/lib/generation.ts', 'scripts/comparison/lib/enrichment.ts', 'scripts/comparison/lib/qa.ts']
  const current = buildCurrentResult(context, code)
  return sections([
    ['PROJECT', 'enBenidorm'],
    ['TOPIC', context.topic],
    ['PHASE', phaseLabel(phase)],
    ['ISSUE', issueDescription(context, code)],
    ['CURRENT RESULT', current],
    ['EXPECTED BEHAVIOUR', guidance],
    ['RELEVANT DATA', relevantData(context, code)],
    ['LIKELY FILES', files.map((file) => `- ${file}`).join('\n')],
    ['CONSTRAINTS', constraints(context.topic)],
    ['VALIDATION', validationCommands(context.topic, phase)],
  ])
}

function buildConfigureTopicPrompt({topic, request}: Context): string {
  const aliases = request.aliases?.filter(Boolean) ?? []
  return sections([
    ['PROJECT', 'enBenidorm'],
    ['TOPIC', topic],
    ['PHASE', 'comparison topic configuration'],
    ['ISSUE', 'El topic todavía no tiene configuración declarativa/manual suficiente para ejecutar toda la pipeline.'],
    ['CURRENT RESULT', `Display name: ${request.displayName || '(no indicado)'}\nSearch intent: ${request.searchIntent || `(definir para ${topic})`}\nAliases: ${aliases.length ? aliases.join(', ') : topic}`],
    ['EXPECTED BEHAVIOUR', 'Añade la configuración mínima data-driven para que Selection use la intención y trate los aliases indicados como directEvidence legacy. Separa directEvidence, supportingEvidence y compatibleBusinessKinds cuando haya señales distintas, y permite que Enrichment cargue evidence manual cuando corresponda. Reutiliza las estructuras existentes.'],
    ['RELEVANT DATA', `Topic slug validado: ${topic}\nSearch intent solicitado: ${request.searchIntent || '(no indicado)'}\nAliases solicitados: ${aliases.join(', ') || '(ninguno)'}`],
    ['LIKELY FILES', '- scripts/comparison/lib/topic-config.ts\n- scripts/comparison/lib/selection.ts\n- scripts/comparison/lib/scoring.ts\n- content/manual/comparisons/<topic>.json'],
    ['CONSTRAINTS', constraints(topic)],
    ['VALIDATION', `npm test\nnpm run comparison:select -- --topic ${topic} --dry-run\nnpm run check\nnpm run build`],
  ])
}

function issueDescription(context: Context, code: string): string {
  const issue = context.issue
  const note = context.request.note?.trim()
  return [code, issue?.severity && `Severity: ${issue.severity}`, issue?.path && `Path: ${issue.path}`, issue?.message, note && `Nota del usuario: ${note}`].filter(Boolean).join('\n')
}

function buildCurrentResult(context: Context, code: string): string {
  const editorial = context.generation?.editorial ?? context.generation?.document ?? context.generation
  if (code === 'REPETITIVE_COMPARISON_CONTENT') {
    return stringify({quickVerdict: editorial?.quickVerdict, choiceGuide: editorial?.choiceGuide, entries: editorial?.entries?.map((entry: any) => ({businessId: entry.businessId ?? entry.business?._ref, verdict: entry.verdict, strengths: entry.strengths}))})
  }
  if (code === 'SOURCE_CONFLICT') {
    const conflicts = context.enrichment?.sourceConflicts ?? []
    const sources = context.enrichment?.sources ?? []
    return stringify({conflicts: conflicts.map((conflict: any) => ({...conflict, sourceA: sourceDetails(conflict.preferredSourceKeys?.[0], sources), sourceB: sourceDetails(conflict.conflictingSourceKeys?.[0], sources), currentResolution: conflict.resolution}))})
  }
  return stringify({issue: context.issue, qaOutcome: context.qa?.qaOutcome, indexability: context.qa?.indexability ?? context.generation?.indexability, quickVerdict: editorial?.quickVerdict, userNote: context.request.note})
}

function relevantData(context: Context, code: string): string {
  const selection = context.selection
  const enrichment = context.enrichment
  const generation = context.generation
  const qa = context.qa
  const data: Record<string, unknown> = {
    searchIntent: selection?.searchIntent ?? enrichment?.searchIntent ?? generation?.searchIntent,
    candidates: selection?.candidateCount ?? selection?.candidates?.length,
    businesses: enrichment?.businesses?.map((business: any) => ({businessId: business.businessId, name: business.name, coverage: Object.fromEntries(Object.entries(business.evidence ?? {}).map(([key, facts]) => [key, Array.isArray(facts) ? facts.length : 0]))})),
    coverage: qa?.coverage,
    claimsGenerated: qa?.claimsGenerated,
    claimsRejected: qa?.claimsRejected,
  }
  if (code === 'PRICE_CONTEXT_LOST') data.priceEvidence = enrichment?.businesses?.map((business: any) => ({businessId: business.businessId, prices: business.evidence?.prices, featuredItems: business.evidence?.featuredItems}))
  return stringify(data)
}

function sourceDetails(key: string | undefined, sources: any[]) {
  const source = sources.find((item) => item.key === key)
  return source ? {key: source.key, provider: source.provider, value: source.value, url: source.url, retrievedAt: source.retrievedAt} : {key, value: '(consultar fact asociado)', retrievedAt: '(no disponible)'}
}

function genericGuidance(note?: string): string {
  return note?.trim()
    ? `Investiga la causa y mejora el resultado editorial atendiendo esta observación: ${note.trim()} Conserva los hechos respaldados, la provenance y las decisiones de indexability.`
    : 'Investiga la causa y corrige el comportamiento de forma general conservando evidence, provenance, claim validation, search intent e indexability.'
}

function constraints(topic: string): string {
  return `Implementa una solución genérica.\n\nNO añadas lógica específica para topic=${topic}.\n\nNo introduzcas if(topic === ...), switches ni workarounds específicos.\n\nEl topic actual es sólo el caso de reproducción.\n\nNo rebajes gates ni validaciones para obtener PASS. No pierdas provenance ni inventes evidence. Mantén Content Lab fuera de la lógica de negocio de la pipeline.`
}

function validationCommands(topic: string, phase: PipelinePhase): string {
  const commands = ['npm test']
  if (phase === 'selection') commands.push(`npm run comparison:select -- --topic ${topic} --force`)
  else if (phase === 'enrichment') commands.push(`npm run comparison:enrich -- --topic ${topic} --force`)
  else {
    commands.push(`npm run comparison:generate -- --topic ${topic} --force`)
    commands.push(`npm run comparison:qa -- --topic ${topic} --force`)
  }
  commands.push('npm run check', 'npm run build')
  return commands.join('\n')
}

function phaseLabel(phase: PipelinePhase) { return `comparison ${phase}` }
function sections(items: Array<[string, string]>) { return items.map(([title, body]) => `${title}\n${body}`).join('\n\n') + '\n' }
function stringify(value: unknown): string {
  const text = JSON.stringify(value, null, 2)
  return text.length > 14000 ? `${text.slice(0, 14000)}\n... [truncado por Content Lab]` : text
}
