import assert from 'node:assert/strict'
import test from 'node:test'
import {buildCommand} from './command-builder'
import {parseRunOptions, validateTopic} from './validation'

test('command builder usa argv separados y mapea las cuatro fases', () => {
  assert.deepEqual(buildCommand('arroces', 'selection', {limit: 7, force: true}), {
    command: 'npm',
    args: ['run', 'comparison:select', '--', '--topic', 'arroces', '--limit', '7', '--force'],
    display: 'npm run comparison:select -- --topic arroces --limit 7 --force',
  })
  assert.equal(buildCommand('italiano', 'enrichment').args[1], 'comparison:enrich')
  assert.equal(buildCommand('italiano', 'generation').args[1], 'comparison:generate')
  assert.equal(buildCommand('italiano', 'qa').args[1], 'comparison:qa')
})

test('topic validation bloquea shell injection y path traversal', () => {
  for (const unsafe of ['../../etc/passwd', 'arroces; rm -rf x', '$(whoami)', 'Arroces', '', '--force', 'a b']) {
    assert.throws(() => validateTopic(unsafe), /Topic inválido/)
  }
  assert.equal(validateTopic('arroz-a-banda-2'), 'arroz-a-banda-2')
})

test('run options rechaza claves arbitrarias y límites inválidos', () => {
  assert.deepEqual(parseRunOptions({limit: 8, force: true, dryRun: false}), {limit: 8, force: true, dryRun: false})
  assert.throws(() => parseRunOptions({args: '--foo'}), /no permitida/)
  assert.throws(() => parseRunOptions({limit: 0}), /entero/)
})

