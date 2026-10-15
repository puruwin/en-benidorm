import assert from 'node:assert/strict'
import test from 'node:test'
import type {ComparisonPhaseState, PipelinePhase} from '../../shared/types'
import {canRunComparisonPhase, nextComparisonPhase} from '../../shared/workflow'

function phases(stale?: PipelinePhase): Record<PipelinePhase, ComparisonPhaseState> {
  return Object.fromEntries((['selection', 'enrichment', 'generation', 'qa'] as PipelinePhase[]).map((phase) => [phase, {
    phase, status: 'completed', stale: phase === stale, inferred: false, source: 'topic-report',
  }])) as Record<PipelinePhase, ComparisonPhaseState>
}

test('un enrichment stale convierte enrichment en acción principal y bloquea generation', () => {
  const state = phases('enrichment')
  assert.equal(nextComparisonPhase(state), 'enrichment')
  assert.equal(canRunComparisonPhase(state, 'generation'), false)
  assert.equal(canRunComparisonPhase(state, 'enrichment'), true)
})

test('generation o QA stale se reejecutan en orden sin bloquear fases upstream', () => {
  const generationStale = phases('generation')
  assert.equal(nextComparisonPhase(generationStale), 'generation')
  assert.equal(canRunComparisonPhase(generationStale, 'qa'), false)
  assert.equal(canRunComparisonPhase(generationStale, 'generation'), true)

  const qaStale = phases('qa')
  assert.equal(nextComparisonPhase(qaStale), 'qa')
  assert.equal(canRunComparisonPhase(qaStale, 'qa'), true)
})
