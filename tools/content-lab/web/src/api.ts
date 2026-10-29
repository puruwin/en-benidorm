import type {DeploymentStatus} from '../../shared/system-types'
import type {BusinessDetail, BusinessList} from '../../shared/business-types'
import type {ArtifactResponse, CodexPromptRequest, ComparisonSummary, PipelineRun} from '../../shared/types'
import type {CandidatesFile} from '../../../../scripts/images/lib/candidates'
import type {ImageCandidatesSummary} from '../../api/src/image-candidates'

export interface ImageDetail {slug: string; file: ArtifactResponse<CandidatesFile>; plan: ArtifactResponse}
export interface ImageSearchRequest {doc?: string; term?: string; category?: string; radius?: number}

export interface Session {authenticationRequired: boolean; authenticated: boolean; actor: string | null}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {...init, headers: {'Content-Type': 'application/json', ...init?.headers}})
  const body = await response.json().catch(() => ({}))
  if (response.status === 401 && !path.startsWith('/api/session')) dispatchEvent(new Event('content-lab-session-expired'))
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`)
  return body as T
}

export const api = {
  system: () => request<DeploymentStatus>('/api/system'),
  session: () => request<Session>('/api/session'),
  login: (username: string, password: string) => request<Session>('/api/session/login', {method: 'POST', body: JSON.stringify({username, password})}),
  logout: () => request<{authenticated: boolean}>('/api/session/logout', {method: 'POST', body: '{}'}),
  businesses: (query: string) => request<BusinessList>(`/api/businesses${query ? `?${query}` : ''}`),
  business: (id: string) => request<BusinessDetail>(`/api/businesses/${encodeURIComponent(id)}`),
  topics: () => request<ComparisonSummary[]>('/api/topics'),
  comparison: (topic: string) => request<any>(`/api/comparisons/${encodeURIComponent(topic)}`),
  runs: () => request<PipelineRun[]>('/api/runs'),
  run: (topic: string, phase: string, options: Record<string, unknown>) => request<PipelineRun>(`/api/comparisons/${encodeURIComponent(topic)}/run/${phase}`, {method: 'POST', body: JSON.stringify(options)}),
  cancel: (id: string) => request<PipelineRun>(`/api/runs/${id}/cancel`, {method: 'POST'}),
  images: () => request<ImageCandidatesSummary[]>('/api/images'),
  imageDetail: (slug: string) => request<ImageDetail>(`/api/images/${encodeURIComponent(slug)}`),
  imageSearch: (body: ImageSearchRequest) => request<PipelineRun>('/api/images/search', {method: 'POST', body: JSON.stringify(body)}),
  prompt: (topic: string, body: CodexPromptRequest) => request<{prompt: string}>(`/api/comparisons/${encodeURIComponent(topic)}/codex-prompt`, {method: 'POST', body: JSON.stringify(body)}),
}

/** Miniatura por el proxy de la API: mismo origen, la CSP privada no se relaja. */
export const thumbnailUrl = (slug: string, candidateId: string) => `/api/images/${encodeURIComponent(slug)}/thumbnail/${encodeURIComponent(candidateId)}`
