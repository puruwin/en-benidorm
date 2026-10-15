import type {PipelinePhase} from '../../shared/types'
import {validatePhase, validateTopic} from './validation'

const SCRIPTS: Record<PipelinePhase, string> = {
  selection: 'comparison:select',
  enrichment: 'comparison:enrich',
  generation: 'comparison:generate',
  qa: 'comparison:qa',
}

export interface CommandOptions {limit?: number; force?: boolean; dryRun?: boolean}

export function buildCommand(topicInput: unknown, phaseInput: unknown, options: CommandOptions = {}): {command: string; args: string[]; display: string} {
  const topic = validateTopic(topicInput)
  const phase = validatePhase(phaseInput)
  const args = ['run', SCRIPTS[phase], '--', '--topic', topic]
  if (options.limit !== undefined) args.push('--limit', String(options.limit))
  if (options.force) args.push('--force')
  if (options.dryRun) args.push('--dry-run')
  return {command: 'npm', args, display: ['npm', ...args].join(' ')}
}

