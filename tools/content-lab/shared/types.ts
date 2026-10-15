export type PipelinePhase = 'selection' | 'enrichment' | 'generation' | 'qa'
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export type QaSeverity = 'FAIL' | 'WARNING' | 'INFO'

export interface QaIssue {
  code: string
  severity: QaSeverity
  message: string
  path?: string
  context?: unknown
}

export interface PipelineLog {
  id: number
  timestamp: string
  stream: 'system' | 'stdout' | 'stderr'
  message: string
}

export interface PipelineRun {
  id: string
  topic: string
  phase: PipelinePhase
  status: RunStatus
  command: string
  args: string[]
  startedAt: string
  finishedAt?: string
  exitCode?: number | null
  durationMs?: number
  logs: PipelineLog[]
}

export interface ComparisonSummary {
  topic: string
  displayName: string
  searchIntent?: string
  configured: boolean
  status: 'not-started' | 'selected' | 'enriched' | 'generated' | 'validated' | 'warning' | 'failed'
  qaOutcome?: 'PASS' | 'WARNING' | 'FAIL'
  qaInferred?: boolean
  indexability?: 'index' | 'noindex'
  businesses: number
  updatedAt?: string
  phases: Record<PipelinePhase, ComparisonPhaseState>
}

export interface ComparisonPhaseState {
  phase: PipelinePhase
  status: 'not-run' | 'completed' | 'failed' | 'cancelled'
  stale: boolean
  inferred: boolean
  source: 'topic-report' | 'artifact' | 'global-report' | 'inference' | 'none'
  startedAt?: string
  finishedAt?: string
  qaOutcome?: 'PASS' | 'WARNING' | 'FAIL'
}

export interface ArtifactResponse<T = unknown> {
  status: 'available' | 'missing' | 'invalid'
  path: string
  data?: T
  error?: string
  source?: 'topic-report' | 'global-report'
}

export interface Coverage {
  businessId: string
  coveredDimensions: string[]
  counts: Record<string, number>
}

export interface SourceSummary {
  key: string
  provider?: string
  url?: string
  retrievedAt?: string
  attribution?: string
}

export interface CodexPromptRequest {
  phase?: PipelinePhase
  issueCode?: string
  note?: string
  searchIntent?: string
  aliases?: string[]
  displayName?: string
  mode?: 'issue' | 'general' | 'configure-topic'
}

export interface OpportunityAnalysisView {
  businessId: string
  businessName: string
  category: string
  status: string
  signals: Array<{id: string; type: string; observation: string; sourceKeys: string[]; observedAt: string; confidence: string}>
  hypotheses: Array<{id: string; area: string; hypothesis: string; basedOnSignalIds: string[]; basedOnReview?: {reviewedAt: string; reviewedBy: string; fields: string[]; reviewedSourceKeys: string[]}; confidence: string; limitations: string[]}>
  suggestedActions: Array<{type: string; reason: string}>
  summary: {evidenceStrength: string; opportunityAreas: string[]; manualReviewRequired: boolean}
  reviewState: 'unreviewed' | 'reviewing' | 'verified' | 'rejected' | 'stale'
}

export interface OpportunityReportView {
  generatedAt: string
  businessesAnalyzed: number
  actionableHypotheses: number
  needsReview: number
  notActionable: number
  reviewStateCounts: Record<string, number>
  provenanceCoverage: {signals: number; coveredSignals: number; ratio: number}
  selection: {description: string; businessIds: string[]}
  analyses: OpportunityAnalysisView[]
}

export interface OpportunityReviewView {
  schemaVersion?: 1
  businessId?: string
  reviewedAt: string
  reviewedBy: string
  workflowStatus: 'reviewing' | 'verified' | 'rejected'
  operationalStatus: 'confirmed-open' | 'confirmed-closed' | 'unknown'
  identityStatus: 'confirmed' | 'ambiguous' | 'conflict'
  officialPresence: {website: 'confirmed' | 'not-found' | 'ambiguous'; googleProfile: 'confirmed' | 'not-found' | 'not-checked'; socialProfiles: 'confirmed' | 'not-found' | 'not-checked'}
  contactChannels: {phone?: 'confirmed' | 'unverified'; email?: 'confirmed' | 'unverified'; contactForm?: 'confirmed' | 'not-found'; booking?: 'confirmed' | 'not-found'}
  reviewedSourceKeys: string[]
  resolvedSignalIds?: string[]
  notes?: string
  expiresAt?: string
}

export interface OpportunityReviewContext {
  analysis: ArtifactResponse<any>
  review: ArtifactResponse<OpportunityReviewView>
  verification: ArtifactResponse<any>
  reviewEvaluation: {workflowStatus: string; staleFields: string[]; expires: {operationalStatus: string; website: string; contactChannels?: string}}
  identity: {entry: any; discovered: any; enriched: any}
}
