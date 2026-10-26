import type {DeploymentStatus} from '../../shared/system-types'
import type {BusinessDetail, BusinessList} from '../../shared/business-types'
import type {CodexPromptRequest, ComparisonSummary, PipelineRun} from '../../shared/types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {...init, headers: {'Content-Type': 'application/json', ...init?.headers}})
  const body = await response.json().catch(() => ({}))
  if (response.status === 401 && !path.startsWith('/api/session')) dispatchEvent(new Event('content-lab-session-expired'))
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`)
  return body as T
}

export const api = {
  system: () => request<DeploymentStatus>('/api/system'),
  session: () => request<{authenticationRequired: boolean; authenticated: boolean}>('/api/session'),
  login: (username: string, password: string) => request<{authenticationRequired: boolean; authenticated: boolean}>('/api/session/login', {method: 'POST', body: JSON.stringify({username, password})}),
  logout: () => request<{authenticated: boolean}>('/api/session/logout', {method: 'POST', body: '{}'}),
  businesses: (query: string) => request<BusinessList>(`/api/businesses${query ? `?${query}` : ''}`),
  business: (id: string) => request<BusinessDetail>(`/api/businesses/${encodeURIComponent(id)}`),
  topics: () => request<ComparisonSummary[]>('/api/topics'),
  comparison: (topic: string) => request<any>(`/api/comparisons/${encodeURIComponent(topic)}`),
  runs: () => request<PipelineRun[]>('/api/runs'),
  run: (topic: string, phase: string, options: Record<string, unknown>) => request<PipelineRun>(`/api/comparisons/${encodeURIComponent(topic)}/run/${phase}`, {method: 'POST', body: JSON.stringify(options)}),
  cancel: (id: string) => request<PipelineRun>(`/api/runs/${id}/cancel`, {method: 'POST'}),
  prompt: (topic: string, body: CodexPromptRequest) => request<{prompt: string}>(`/api/comparisons/${encodeURIComponent(topic)}/codex-prompt`, {method: 'POST', body: JSON.stringify(body)}),
}
