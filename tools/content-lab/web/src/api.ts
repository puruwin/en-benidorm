import type {ArtifactResponse, CodexPromptRequest, ComparisonSummary, OpportunityReportView, OpportunityReviewContext, OpportunityReviewView, PipelineRun} from '../../shared/types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {...init, headers: {'Content-Type': 'application/json', ...init?.headers}})
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`)
  return body as T
}

export const api = {
  topics: () => request<ComparisonSummary[]>('/api/topics'),
  comparison: (topic: string) => request<any>(`/api/comparisons/${encodeURIComponent(topic)}`),
  runs: () => request<PipelineRun[]>('/api/runs'),
  run: (topic: string, phase: string, options: Record<string, unknown>) => request<PipelineRun>(`/api/comparisons/${encodeURIComponent(topic)}/run/${phase}`, {method: 'POST', body: JSON.stringify(options)}),
  cancel: (id: string) => request<PipelineRun>(`/api/runs/${id}/cancel`, {method: 'POST'}),
  opportunities: () => request<ArtifactResponse<OpportunityReportView>>('/api/opportunities'),
  opportunityReview: (businessId: string) => request<OpportunityReviewContext>(`/api/opportunity-reviews/${encodeURIComponent(businessId)}`),
  saveOpportunityReview: (businessId: string, review: OpportunityReviewView) => request<{review: OpportunityReviewView; evaluation: any}>(`/api/opportunity-reviews/${encodeURIComponent(businessId)}`, {method: 'PUT', body: JSON.stringify(review)}),
  prompt: (topic: string, body: CodexPromptRequest) => request<{prompt: string}>(`/api/comparisons/${encodeURIComponent(topic)}/codex-prompt`, {method: 'POST', body: JSON.stringify(body)}),
}
