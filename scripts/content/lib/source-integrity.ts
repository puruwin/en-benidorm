import type {ClaimScope, SourceClass, SourceProvenance} from './types'

export interface SourceIntegrity {
  sourceClass: SourceClass
  claimScope: ClaimScope
  inferred: boolean
}

/** Normalizes legacy provenance without requiring a data migration. */
export function sourceIntegrity(source: SourceProvenance): SourceIntegrity {
  const sourceClass = source.sourceClass ?? legacySourceClass(source.provider)
  const claimScope = source.claimScope ?? legacyClaimScope(sourceClass)
  return {sourceClass, claimScope, inferred: source.sourceClass === undefined || source.claimScope === undefined}
}

export function withSourceIntegrity(
  source: SourceProvenance,
  override: Partial<Pick<SourceProvenance, 'sourceClass' | 'claimScope'>> = {},
): SourceProvenance {
  const normalized = sourceIntegrity(source)
  return {...source, sourceClass: override.sourceClass ?? normalized.sourceClass, claimScope: override.claimScope ?? normalized.claimScope}
}

function legacySourceClass(provider: string): SourceClass {
  if (provider === 'openstreetmap') return 'open-data'
  if (provider === 'manual-observation') return 'manual-first-party'
  if (provider === 'official-website') return 'official-location'
  return 'third-party'
}

function legacyClaimScope(sourceClass: SourceClass): ClaimScope {
  if (sourceClass === 'official-brand') return 'brand'
  if (sourceClass === 'third-party') return 'unknown'
  return 'establishment'
}
