import Fastify from 'fastify'
import type {RuntimeConfig} from './runtime-config'
import {installPrivateAccess} from './private-access'
import {deploymentStatus} from './deployment-status'
import type {BusinessQuery} from '../../shared/business-types'
import {BusinessCatalog} from './business-catalog'
import {BusinessError} from './prospecting-store'
import type {CodexPromptRequest, QaIssue} from '../../shared/types'
import {ArtifactLoader} from './artifact-loader'
import {buildCodexPrompt, SUPPORTED_ISSUES} from './prompt-builder/index'
import {RunManager} from './run-manager'
import {parseRunOptions, validateBusinessId, validatePhase, validateTopic} from './validation'
import {evaluateOpportunityReview, saveOpportunityReview, validateOpportunityReview} from '../../../../scripts/opportunities/lib/reviews'

export function createApp(root: string, dependencies: {loader?: ArtifactLoader; runs?: RunManager; config?: RuntimeConfig} = {}) {
  const app = Fastify({logger: {redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie']}})
  const config = dependencies.config ?? {private: false, host: '127.0.0.1', port: 4174, origin: null, username: null, passwordHash: null, staticDir: null, sessionSeconds: 43200}
  const access = installPrivateAccess(app, config)
  const loader = dependencies.loader ?? new ArtifactLoader(root)
  const businesses = new BusinessCatalog(root, loader)
  const runs = dependencies.runs ?? new RunManager(root)
  const streams = new Set<() => void>()
  app.addHook('preClose', async () => {for (const close of streams) close(); await runs.shutdown()})

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof BusinessError) return reply.status(error.statusCode).send({error: error.message})
    const errorMessage = error instanceof Error ? error.message : String(error)
    const httpStatus = Number((error as {statusCode?: number}).statusCode)
    const status = httpStatus >= 400 && httpStatus < 500 ? httpStatus : /inválid|no soportada|no permitida|entero|boolean|reviewedBy|reviewedSourceKeys|fuente revisada|confirmed-open/i.test(errorMessage) ? 400 : /ejecución activa/i.test(errorMessage) ? 409 : 500
    reply.status(status).send({error: errorMessage})
  })

  app.get<{Querystring: BusinessQuery}>('/api/businesses', async request => businesses.list(request.query))
  app.get<{Params: {businessId: string}}>('/api/businesses/:businessId', async request => businesses.detail(validateBusinessId(request.params.businessId)))
  app.put<{Params: {businessId: string}; Body: unknown}>('/api/businesses/:businessId/prospecting', async request => {
    const id = validateBusinessId(request.params.businessId)
    await businesses.requireBusiness(id)
    return businesses.tracking.save(id, request.body)
  })

  app.get('/api/system', async () => deploymentStatus(root, config, {businesses}))
  app.get('/api/health', async () => ({ok: true, service: 'enBenidorm Content Lab', ...(config.private ? {} : {projectRoot: root}), activeRun: runs.active()?.id ?? null}))
  app.get('/api/topics', async () => loader.topics())
  app.get('/api/comparisons', async () => loader.topics())
  app.get<{Params: {topic: string}}>('/api/comparisons/:topic', async (request) => loader.detail(validateTopic(request.params.topic)))
  app.get<{Params: {topic: string}}>('/api/comparisons/:topic/selection', async (request) => loader.selection(request.params.topic))
  app.get<{Params: {topic: string}}>('/api/comparisons/:topic/enrichment', async (request) => loader.enrichment(request.params.topic))
  app.get<{Params: {topic: string}}>('/api/comparisons/:topic/generation', async (request) => loader.generation(request.params.topic))
  app.get<{Params: {topic: string}}>('/api/comparisons/:topic/qa', async (request) => loader.topicReport(request.params.topic, 'qa'))
  app.get<{Params: {topic: string}}>('/api/comparisons/:topic/evidence', async (request) => loader.evidence(request.params.topic))
  app.get('/api/opportunities', async () => loader.opportunities())
  app.get<{Params: {businessId: string}}>('/api/opportunities/:businessId', async (request) => loader.opportunity(validateBusinessId(request.params.businessId)))
  app.get<{Params: {businessId: string}}>('/api/opportunity-reviews/:businessId', async (request) => loader.opportunityContext(validateBusinessId(request.params.businessId)))
  app.put<{Params: {businessId: string}; Body: unknown}>('/api/opportunity-reviews/:businessId', async (request, reply) => {
    const businessId = validateBusinessId(request.params.businessId)
    const analysisArtifact = await loader.opportunity(businessId)
    if (analysisArtifact.status !== 'available') return reply.status(404).send({error: 'Opportunity Analysis no encontrado para el negocio.'})
    const sourceKeyValues: string[] = ((analysisArtifact.data as any).provenance?.sources ?? []).map((source: any) => source.key).filter((key: unknown): key is string => typeof key === 'string')
    const sourceKeys = new Set<string>(sourceKeyValues)
    const review = validateOpportunityReview(request.body, businessId, sourceKeys)
    await saveOpportunityReview(root, review)
    return {review, evaluation: evaluateOpportunityReview(review)}
  })

  app.post<{Params: {topic: string; phase: string}; Body: unknown}>('/api/comparisons/:topic/run/:phase', async (request, reply) => {
    const topic = validateTopic(request.params.topic)
    const phase = validatePhase(request.params.phase)
    const options = parseRunOptions(request.body)
    const run = runs.start(topic, phase, options)
    return reply.status(202).send(run)
  })

  app.get('/api/runs', async () => runs.list())
  app.get<{Params: {runId: string}}>('/api/runs/:runId', async (request, reply) => {
    const run = runs.get(request.params.runId)
    return run ?? reply.status(404).send({error: 'Ejecución no encontrada.'})
  })
  app.post<{Params: {runId: string}}>('/api/runs/:runId/cancel', async (request, reply) => {
    try { return runs.cancel(request.params.runId) } catch (error) { return reply.status(404).send({error: error instanceof Error ? error.message : String(error)}) }
  })
  app.get<{Params: {runId: string}}>('/api/runs/:runId/events', async (request, reply) => {
    const run = runs.get(request.params.runId)
    if (!run) return reply.status(404).send({error: 'Ejecución no encontrada.'})
    reply.hijack()
    reply.raw.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'})
    let heartbeat: NodeJS.Timeout | undefined
    let unsubscribe = () => {}
    let closed = false
    const cleanup = () => {
      if (closed) return
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      unsubscribe()
      streams.delete(close)
    }
    const write = (event: string) => {
      if (closed || reply.raw.writableEnded || reply.raw.destroyed) {
        cleanup()
        return false
      }
      reply.raw.write(event)
      return true
    }
    const close = () => {
      cleanup()
      if (!reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.end()
    }

    streams.add(close)
    reply.raw.once('close', cleanup)
    reply.raw.once('error', cleanup)
    write(`event: snapshot\ndata: ${JSON.stringify(run)}\n\n`)
    if (run.finishedAt) {
      close()
      return
    }

    unsubscribe = runs.subscribe(run.id, (updated, log) => {
      if (log && !write(`event: log\ndata: ${JSON.stringify(log)}\n\n`)) return
      if (!write(`event: status\ndata: ${JSON.stringify({status: updated.status, exitCode: updated.exitCode, finishedAt: updated.finishedAt, durationMs: updated.durationMs})}\n\n`)) return
      if (updated.finishedAt) close()
    })
    heartbeat = setInterval(() => {if (config.private && !access.authenticated(request.headers.cookie)) close(); else write(': heartbeat\n\n')}, 15000)
  })

  app.post<{Params: {topic: string}; Body: CodexPromptRequest}>('/api/comparisons/:topic/codex-prompt', async (request) => {
    const topic = validateTopic(request.params.topic)
    const body = request.body && typeof request.body === 'object' ? request.body : {}
    const detail = await loader.detail(topic)
    const selection = detail.artifacts.selection.data as Record<string, any> | undefined
    const enrichment = detail.artifacts.enrichment.data as Record<string, any> | undefined
    const generation = detail.artifacts.generation.data as Record<string, any> | undefined
    const qa = detail.reports.qa.data as Record<string, any> | undefined
    const issues = (qa?.issues ?? []) as QaIssue[]
    const issue = body.issueCode ? issues.find((item) => item.code === body.issueCode) ?? {code: body.issueCode, severity: 'INFO', message: 'Issue solicitado desde Content Lab.'} as QaIssue : undefined
    const prompt = buildCodexPrompt({topic, request: body, ...(issue ? {issue} : {}), ...(selection ? {selection} : {}), ...(enrichment ? {enrichment} : {}), ...(generation ? {generation} : {}), ...(qa ? {qa} : {})})
    return {prompt, issueCode: issue?.code ?? null, supportedIssues: SUPPORTED_ISSUES}
  })

  return app
}
