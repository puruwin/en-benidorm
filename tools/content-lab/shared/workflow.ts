import type {ComparisonPhaseState, PipelinePhase} from './types'

export const PIPELINE_PHASES: PipelinePhase[] = ['selection', 'enrichment', 'generation', 'qa']

export function isCurrentPhase(state: ComparisonPhaseState): boolean {
  return state.status === 'completed' && !state.stale
}

export function nextComparisonPhase(phases: Record<PipelinePhase, ComparisonPhaseState>): PipelinePhase {
  return PIPELINE_PHASES.find((phase) => !isCurrentPhase(phases[phase])) ?? 'qa'
}

export function canRunComparisonPhase(
  phases: Record<PipelinePhase, ComparisonPhaseState>,
  phase: PipelinePhase,
  options: {running?: boolean; dataGatePass?: boolean} = {},
): boolean {
  if (options.running) return false
  if (phase === 'selection') return true
  if (phase === 'enrichment') return isCurrentPhase(phases.selection)
  if (phase === 'generation') return isCurrentPhase(phases.enrichment) && options.dataGatePass !== false
  return isCurrentPhase(phases.generation)
}
