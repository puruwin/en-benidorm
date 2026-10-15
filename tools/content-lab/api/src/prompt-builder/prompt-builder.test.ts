import assert from 'node:assert/strict'
import test from 'node:test'
import {buildCodexPrompt, SUPPORTED_ISSUES} from './index'

test('todos los issue templates requeridos están mapeados', () => {
  assert.deepEqual(new Set(SUPPORTED_ISSUES), new Set([
    'REPETITIVE_COMPARISON_CONTENT', 'PRICE_CONTEXT_LOST', 'SOURCE_CONFLICT', 'SEARCH_INTENT_NOT_SATISFIED',
    'LOW_COMPARATIVE_VALUE', 'UNSUPPORTED_COMPARISON_CLAIM', 'INSUFFICIENT_EVIDENCE_COVERAGE',
    'PUBLIC_INFORMATION_REPETITION', 'TECHNICAL_LANGUAGE_EXPOSED', 'RAW_SOURCE_IDENTIFIER_EXPOSED',
    'OVERLONG_TABLE_CELL', 'DUPLICATE_SECTION_HEADING', 'EMPTY_PUBLIC_SECTION',
  ]))
})

test('prompt de repetición es autocontenido y contiene la restricción genérica', () => {
  const prompt = buildCodexPrompt({
    topic: 'arroces', request: {phase: 'qa', issueCode: 'REPETITIVE_COMPARISON_CONTENT'},
    issue: {severity: 'WARNING', code: 'REPETITIVE_COMPARISON_CONTENT', path: 'editorial', message: 'Contenido repetido'},
    generation: {editorial: {quickVerdict: 'A frente a B', choiceGuide: [], entries: []}},
    qa: {qaOutcome: 'WARNING', indexability: 'index'},
  })
  for (const heading of ['PROJECT', 'TOPIC', 'PHASE', 'ISSUE', 'CURRENT RESULT', 'EXPECTED BEHAVIOUR', 'RELEVANT DATA', 'LIKELY FILES', 'CONSTRAINTS', 'VALIDATION']) assert.match(prompt, new RegExp(`(^|\\n)${heading}\\n`))
  assert.match(prompt, /NO añadas lógica específica para topic=arroces/)
  assert.match(prompt, /npm run comparison:qa -- --topic arroces --force/)
})

test('SOURCE_CONFLICT incluye ambas fuentes, fechas y resolución', () => {
  const prompt = buildCodexPrompt({topic: 'arroces', request: {issueCode: 'SOURCE_CONFLICT'}, issue: {code: 'SOURCE_CONFLICT', severity: 'FAIL', message: 'Conflicto'}, enrichment: {
    sourceConflicts: [{preferredSourceKeys: ['a'], conflictingSourceKeys: ['b'], resolution: 'prefer official'}],
    sources: [{key: 'a', value: 'sí', retrievedAt: '2026-01-01'}, {key: 'b', value: 'no', retrievedAt: '2025-01-01'}],
  }})
  assert.match(prompt, /"sourceA"/); assert.match(prompt, /"sourceB"/); assert.match(prompt, /prefer official/); assert.match(prompt, /2026-01-01/)
})

test('insufficient evidence no sugiere bajar thresholds', () => {
  const prompt = buildCodexPrompt({topic: 'sushi', request: {issueCode: 'INSUFFICIENT_EVIDENCE_COVERAGE'}})
  assert.match(prompt, /No reduzcas los thresholds para conseguir PASS/)
  assert.match(prompt, /mantén la Comparison no indexable/)
})

test('issue desconocido usa builder genérico y conserva nota manual', () => {
  const prompt = buildCodexPrompt({topic: 'sushi', request: {issueCode: 'NEW_ISSUE', note: 'Revisa el verdict'}})
  assert.match(prompt, /NEW_ISSUE/); assert.match(prompt, /Revisa el verdict/); assert.match(prompt, /Investiga la causa/)
})

