import {useEffect, useRef, useState} from 'react'
import type {ComparisonPhaseState, ComparisonSummary, PipelineLog, PipelinePhase, PipelineRun, QaIssue} from '../../shared/types'
import {PIPELINE_PHASES, canRunComparisonPhase, isCurrentPhase, nextComparisonPhase} from '../../shared/workflow'
import {api} from './api'
import {Badge, List, message} from './ui'
import {BusinessListPage, BusinessDetailPage} from './BusinessPages'
import {SystemPage} from './SystemPage'

const previewOrigin = import.meta.env.VITE_CONTENT_PREVIEW_ORIGIN || (import.meta.env.DEV ? 'http://localhost:4321' : undefined)

const tabs = ['Overview', 'Selection', 'Evidence', 'Generated', 'QA', 'Sources', 'Logs', 'Codex'] as const
type Tab = typeof tabs[number]

export function App() {
  const [path, setPath] = useState(location.pathname + location.search)
  const [topics, setTopics] = useState<ComparisonSummary[]>([])
  const [runs, setRuns] = useState<PipelineRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newOpen, setNewOpen] = useState(false)

  const refreshGlobal = async () => {
    try { const [nextTopics, nextRuns] = await Promise.all([api.topics(), api.runs()]); setTopics(nextTopics); setRuns(nextRuns); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void refreshGlobal(); const onPop = () => setPath(location.pathname + location.search); addEventListener('popstate', onPop); return () => removeEventListener('popstate', onPop) }, [])
  const navigate = (next: string) => { if (!dispatchEvent(new Event('business-before-navigate', {cancelable: true}))) return; history.pushState({}, '', next); setPath(next) }
  const activeRun = runs.find((run) => run.status === 'running')
  const pagePath = path.split('?')[0]!
  const businessMatch = pagePath.match(/^\/businesses\/(business-[a-z0-9][a-z0-9-]*)$/)
  const topicMatch = pagePath.match(/^\/comparisons\/([a-z0-9-]+)$/)

  return <div className="shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('/')}>enBenidorm <span>Content Lab</span></button>
      <nav>
        <button className={path === '/' ? 'active' : ''} onClick={() => navigate('/')}>Comparisons <small>{topics.length}</small></button>
        <button className={path === '/runs' ? 'active' : ''} onClick={() => navigate('/runs')}>Runs <small>{runs.length}</small></button>
        <button className={pagePath.startsWith('/businesses') ? 'active' : ''} onClick={() => navigate('/businesses')}>Negocios</button>
        <button className={path === '/system' ? 'active' : ''} onClick={() => navigate('/system')}>Estado de instalación</button>
      </nav>
      <div className="sidebar-topics">
        {topics.map((topic) => <button key={topic.topic} onClick={() => navigate(`/comparisons/${topic.topic}`)}>{topic.displayName}<Badge value={topic.qaOutcome ?? topic.status} /></button>)}
      </div>
      <div className="connection"><span className="dot" /> Content Lab<br/><span>Catálogo · editorial · prospección</span></div>
    </aside>
    <main>
      {error && <div className="error-banner">{error}</div>}
      {loading ? <Empty title="Cargando Content Lab…"/> : topicMatch ?
        <ComparisonPage topic={topicMatch[1]!} activeRun={activeRun?.kind === 'images' ? undefined : activeRun} navigate={navigate} onRefresh={refreshGlobal}/> :
        businessMatch ? <BusinessDetailPage key={businessMatch[1]} businessId={businessMatch[1]!} navigate={navigate}/> :
        pagePath === '/businesses' ? <BusinessListPage search={path.includes('?') ? path.slice(path.indexOf('?')) : ''} navigate={navigate}/> :
        pagePath === '/system' ? <SystemPage/> :
        path === '/runs' ? <RunsPage runs={runs} onRefresh={refreshGlobal}/> :
        <Dashboard topics={topics} navigate={navigate} onNew={() => setNewOpen(true)} onRefresh={refreshGlobal}/>
      }
    </main>
    {newOpen && <NewComparison topics={topics} close={() => setNewOpen(false)} navigate={navigate}/>} 
  </div>
}

function Dashboard({topics, navigate, onNew, onRefresh}: {topics: ComparisonSummary[]; navigate: (path: string) => void; onNew: () => void; onRefresh: () => void}) {
  return <>
    <Header eyebrow="LOCAL DEVELOPMENT TOOL" title="Comparisons" subtitle="Inspecciona artefactos y ejecuta la pipeline existente sin editar contenido." actions={<><button className="secondary" onClick={onRefresh}>Refresh</button><button onClick={onNew}>Nueva Comparison</button></>}/>
    <section className="panel">
      <table><thead><tr><th>Topic</th><th>Selection</th><th>Enrichment</th><th>Generation</th><th>QA</th><th>Updated</th></tr></thead>
      <tbody>{topics.map((topic) => <tr key={topic.topic} className="clickable" onClick={() => navigate(`/comparisons/${topic.topic}`)}>
        <td><strong>{topic.displayName}</strong><small className="block">{topic.searchIntent ?? 'Sin search intent registrado'}</small></td>
        {PIPELINE_PHASES.map((phase) => <td key={phase}><PhaseBadge state={topic.phases[phase]}/></td>)}
        <td>{date(topic.updatedAt)}</td>
      </tr>)}</tbody></table>
      {!topics.length && <Empty title="No hay Comparisons" detail="Los topics aparecerán al existir configuración o artefactos."/>}
    </section>
    <p className="footnote">Los estados inferidos proceden de artefactos antiguos. STALE indica que una fase upstream se volvió a ejecutar.</p>
  </>
}

function ComparisonPage({topic, activeRun, navigate, onRefresh}: {topic: string; activeRun: PipelineRun | undefined; navigate: (path: string) => void; onRefresh: () => void}) {
  const eventSources = useRef<EventSource[]>([])
  useEffect(() => () => {for (const source of eventSources.current) source.close()}, [])
  const [detail, setDetail] = useState<any>()
  const [tab, setTab] = useState<Tab>('Overview')
  const [error, setError] = useState('')
  const [options, setOptions] = useState({limit: 8, force: false, dryRun: false})
  const [localRun, setLocalRun] = useState<PipelineRun | undefined>(activeRun)
  const refresh = async () => { try { setDetail(await api.comparison(topic)); setError('') } catch (cause) { setError(message(cause)) } }
  useEffect(() => { setDetail(undefined); setTab('Overview'); void refresh() }, [topic])
  useEffect(() => { setLocalRun(activeRun) }, [activeRun?.id, activeRun?.status])

  const start = async (phase: PipelinePhase) => {
    if (phase === 'generation' && !confirm('Esta fase puede consumir cuota de OpenAI.\n\n¿Quieres generar la Comparison?')) return
    try {
      const body = {...(phase === 'selection' ? {limit: options.limit} : {}), force: options.force || detail?.summary?.phases?.[phase]?.stale === true, dryRun: options.dryRun}
      const run = await api.run(topic, phase, body); setLocalRun(run); setTab('Logs'); streamRun(run)
    } catch (cause) { setError(message(cause)) }
  }
  const streamRun = (run: PipelineRun) => {
    const source = new EventSource(`/api/runs/${run.id}/events`)
    eventSources.current.push(source)
    source.addEventListener('snapshot', (event) => setLocalRun(JSON.parse((event as MessageEvent).data)))
    source.addEventListener('log', (event) => setLocalRun((current) => current ? {...current, logs: appendLog(current.logs, JSON.parse((event as MessageEvent).data))} : current))
    source.addEventListener('status', (event) => {
      const status = JSON.parse((event as MessageEvent).data)
      setLocalRun((current) => current ? {...current, ...status} : current)
      if (status.finishedAt) { source.close(); void refresh(); void onRefresh() }
    })
  }
  const cancel = async () => { if (localRun) setLocalRun(await api.cancel(localRun.id)) }
  if (!detail) return <><Header eyebrow="COMPARISON" title={title(topic)} actions={<button className="secondary" onClick={() => navigate('/')}>Volver</button>}/>{error ? <div className="error-banner">{error}</div> : <Empty title="Cargando artefactos…"/>}</>

  const {summary, artifacts, reports} = detail
  const selection = artifacts.selection.data
  const enrichment = artifacts.enrichment.data
  const generation = artifacts.generation.data
  const qa = reports.qa.data
  const dataGate = reports.enrichment.data?.dataGate
  const names = new Map((enrichment?.businesses ?? []).map((business: any) => [business.businessId, business.name]))
  const phases = summary.phases as Record<PipelinePhase, ComparisonPhaseState>
  const next = nextComparisonPhase(phases)
  const canRun = (phase: PipelinePhase) => canRunComparisonPhase(phases, phase, {running: localRun?.status === 'running', dataGatePass: dataGate?.pass})
  const stalePhases = PIPELINE_PHASES.filter((phase) => phases[phase].stale)

  return <>
    <Header eyebrow="COMPARISON" title={summary.displayName} subtitle={summary.searchIntent ?? 'Topic sin artefactos todavía'} actions={<><button className="secondary" onClick={() => { void refresh(); void onRefresh() }}>Refresh</button><button disabled={!canRun(next)} onClick={() => void start(next)}>Run {next}</button></>}/>
    {error && <div className="error-banner">{error}</div>}
    {!summary.configured && <div className="notice"><strong>Topic no configurado</strong><span>No existe `content/manual/comparisons/{topic}.json`. Usa Codex para preparar la configuración declarativa.</span><button onClick={() => setTab('Codex')}>Generar prompt</button></div>}
    {dataGate?.pass === false && isCurrentPhase(phases.enrichment) && <div className="error-banner"><strong>Data gate FAIL.</strong> {dataGate.issues?.map((issue: any) => `${issue.code}: ${issue.message}`).join(' ') || 'No hay evidence suficiente para generar una Comparison indexable.'} Generation está deshabilitada; los thresholds pertenecen a la pipeline.</div>}
    {dataGate?.warnings?.length > 0 && isCurrentPhase(phases.enrichment) && <div className="notice"><strong>Revisión editorial.</strong><span>{dataGate.warnings.map((warning: any) => `${warning.code}: ${warning.message}`).join(' ')}</span></div>}
    {stalePhases.length > 0 && <div className="notice"><strong>Resultados desactualizados</strong><span>{stalePhases.join(', ')} deben volver a ejecutarse en orden. Sus datos siguen disponibles sólo como referencia histórica.</span></div>}
    <div className="phase-strip">{PIPELINE_PHASES.map((phase) => <div key={phase} className={phases[phase].stale ? 'stale' : isCurrentPhase(phases[phase]) ? 'done' : ''}><span>{phases[phase].stale ? '!' : isCurrentPhase(phases[phase]) ? '✓' : '○'}</span>{phase} <PhaseBadge state={phases[phase]}/></div>)}<div><Badge value={phases.qa.stale ? 'STALE' : (qa?.indexability ?? summary.indexability ?? '—').toUpperCase()}/></div></div>
    <div className="runbar">
      {PIPELINE_PHASES.map((phase) => <button className="secondary" key={phase} disabled={!canRun(phase)} onClick={() => void start(phase)}>Run {phase}</button>)}
      <label>Limit <input type="number" min="1" max="100" value={options.limit} onChange={(event) => setOptions({...options, limit: Number(event.target.value)})}/></label>
      <label><input type="checkbox" checked={options.force} onChange={(event) => setOptions({...options, force: event.target.checked})}/> Force</label>
      <label><input type="checkbox" checked={options.dryRun} onChange={(event) => setOptions({...options, dryRun: event.target.checked})}/> Dry run</label>
      {localRun?.status === 'running' && <button className="danger" onClick={() => void cancel()}>Cancelar ejecución</button>}
    </div>
    <div className="tabs">{tabs.map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
    {tab === 'Overview' && <Overview summary={summary} selection={selection} enrichment={enrichment} generation={generation} qa={qa}/>} 
    {tab === 'Selection' && <Selection artifact={artifacts.selection} names={names}/>} 
    {tab === 'Evidence' && <Evidence artifact={artifacts.enrichment}/>} 
    {tab === 'Generated' && <Generated artifact={artifacts.generation} published={artifacts.published} topic={topic}/>} 
    {tab === 'QA' && <QA report={reports.qa} summary={summary}/>} 
    {tab === 'Sources' && <Sources artifact={artifacts.enrichment}/>} 
    {tab === 'Logs' && <Logs run={localRun}/>} 
    {tab === 'Codex' && <Codex topic={topic} qa={qa} configured={summary.configured}/>} 
  </>
}

function Overview({summary, selection, enrichment, generation, qa}: any) {
  const issues: QaIssue[] = qa?.issues ?? []
  const dimensionCount = enrichment?.businesses?.length ? new Set(enrichment.businesses.flatMap((business: any) => Object.entries(business.evidence ?? {}).filter(([, facts]) => (facts as any[]).length).map(([key]) => key))).size : 0
  const direct = selection?.summary?.direct ?? selection?.candidates?.filter((candidate: any) => (candidate.matchType ?? 'direct') === 'direct').length ?? 0
  const potential = selection?.summary?.potential ?? selection?.candidates?.filter((candidate: any) => candidate.matchType === 'potential').length ?? 0
  return <div className="grid">
    <section className="metric"><span>Selection</span><strong>{direct} direct · {potential} potential</strong><small>{selection?.summary?.excluded ?? selection?.excluded?.length ?? 0} excluded</small></section>
    <section className="metric"><span>Evidence dimensions</span><strong>{dimensionCount}</strong><small>{enrichment?.businesses?.length ?? 0} businesses</small></section>
    <section className="metric"><span>Claims</span><strong>{qa?.claimsGenerated ?? generation?.editorial?.claims?.length ?? '—'}</strong><small>{qa?.claimsRejected ?? 0} rejected</small></section>
    <section className="metric"><span>QA / Indexability</span><strong><Badge value={summary.phases.qa.stale ? 'STALE' : summary.qaOutcome ?? (summary.phases.qa.inferred ? 'INFERRED' : '—')}/></strong><small>{summary.phases.qa.stale ? 'Resultado no actual' : (qa?.indexability ?? summary.indexability ?? '—').toUpperCase()}</small></section>
    <section className="panel phase-overview"><h2>Fases</h2><div className="phase-cards">{PIPELINE_PHASES.map((phase) => <div key={phase}><span>{title(phase)}</span><PhaseBadge state={summary.phases[phase]}/><small>{date(summary.phases[phase].finishedAt)}</small></div>)}</div></section>
    <section className="panel wide"><h2>Estado</h2><dl className="details"><dt>Search intent</dt><dd>{summary.searchIntent ?? 'No disponible'}</dd><dt>Last verified</dt><dd>{generation?.document?.lastVerified ?? date(summary.updatedAt)}</dd><dt>AI usage</dt><dd>Usage no disponible</dd></dl></section>
    <section className="panel wide"><h2>Issues importantes</h2>{issues.length ? issues.map((issue) => <Issue key={`${issue.code}-${issue.path}`} issue={issue}/>) : <Empty title="Sin issues registrados" detail={summary.qaInferred ? 'El estado mostrado procede de un fallback y se indica como inferido.' : 'QA no ha señalado incidencias.'}/>}</section>
  </div>
}

function Selection({artifact, names}: {artifact: any; names: Map<unknown, unknown>}) {
  const [filter, setFilter] = useState('all'); const [search, setSearch] = useState('')
  if (artifact.status !== 'available') return <ArtifactEmpty artifact={artifact} label="Not selected yet"/>
  const data = artifact.data
  const rows = [
    ...(data.candidates ?? []).map((item: any) => ({...item, state: item.matchType ?? 'direct'})),
    ...(data.excluded ?? []).map((item: any) => ({...item, state: 'excluded'})),
  ].filter((item: any) => {
    const filterMatch = filter === 'all' || item.state === filter || (filter === 'insufficient' && (item.qualityTier === 'insufficient' || item.reason === 'insufficient'))
    return filterMatch && businessName(item.businessId, names).toLowerCase().includes(search.toLowerCase())
  })
  return <section className="panel"><div className="selection-summary"><Badge value="DIRECT"/> {data.summary?.direct ?? 0}<Badge value="POTENTIAL"/> {data.summary?.potential ?? 0}<Badge value="EXCLUDED"/> {data.summary?.excluded ?? data.excluded?.length ?? 0}</div><div className="toolbar"><input placeholder="Buscar negocio…" value={search} onChange={(event) => setSearch(event.target.value)}/>{['all', 'direct', 'potential', 'excluded', 'insufficient'].map((item) => <button className={filter === item ? '' : 'secondary'} onClick={() => setFilter(item)} key={item}>{title(item)}</button>)}</div>
    <table><thead><tr><th>Business</th><th>Match / Tier</th><th>Priority score</th><th>Signals / Details</th></tr></thead><tbody>{rows.map((item: any) => <tr key={`${item.businessId}-${item.state}`}><td><strong>{businessName(item.businessId, names)}</strong><small className="block mono">{item.businessId}</small></td><td><Badge value={item.state}/><small className="block">{item.qualityTier ?? item.reason}</small></td><td>{item.potentialScore?.total ?? item.scores?.total ?? '—'}</td><td>{candidateReasons(item)}</td></tr>)}</tbody></table>
  </section>
}

function Evidence({artifact}: {artifact: any}) {
  const [json, setJson] = useState(false)
  if (artifact.status !== 'available') return <ArtifactEmpty artifact={artifact} label="Not enriched yet"/>
  const businesses = artifact.data.businesses ?? []; const dimensions = ['cuisine', 'specialties', 'featuredItems', 'prices', 'services', 'location', 'practical', 'limitations', 'distinctiveFeatures']
  const investigations = artifact.data.investigations ?? businesses.map((business: any) => ({businessId: business.businessId, name: business.name, origin: 'direct', outcome: 'confirmed'}))
  return <div className="stack">
    <section className="panel"><h2>Enrichment outcomes</h2><table><thead><tr><th>Business</th><th>Origin</th><th>Research</th><th>Outcome</th><th>Operational</th><th>New evidence / reason</th></tr></thead><tbody>{investigations.map((item: any) => { const operational = businesses.find((business: any) => business.businessId === item.businessId)?.operationalStatus; return <tr key={item.businessId}><td><strong>{item.name ?? item.businessId}</strong><small className="block mono">{item.businessId}</small></td><td><Badge value={item.origin}/></td><td><ResearchSummary research={item.research}/></td><td><Badge value={item.outcome}/></td><td>{operational ? <><Badge value={operational.status}/>{operational.needsVerification && <Badge value="NEEDS VERIFICATION"/>}<small className="block">{operational.reasons?.join(' ')}</small></> : '—'}</td><td>{item.research?.newEvidence?.length ? <ResearchEvidence evidence={item.research.newEvidence}/> : (item.reasons ?? []).join(' · ') || 'Legacy artifact'}</td></tr>})}</tbody></table></section>
    <section className="panel"><div className="section-head"><div><h2>Coverage matrix</h2><p>Huecos de evidence por negocio y dimensión.</p></div><button className="secondary" onClick={() => setJson(!json)}>{json ? 'Ocultar JSON' : 'Ver JSON'}</button></div>
      <div className="table-scroll"><table className="matrix"><thead><tr><th>Business</th>{dimensions.map((item) => <th key={item}>{item}</th>)}</tr></thead><tbody>{businesses.map((business: any) => <tr key={business.businessId}><td><strong>{business.name}</strong></td>{dimensions.map((dimension) => <td key={dimension} className={business.evidence?.[dimension]?.length ? 'covered' : 'empty'}>{business.evidence?.[dimension]?.length || '—'}</td>)}</tr>)}</tbody></table></div>
      {json && <Json value={artifact.data}/>}</section>
    {businesses.map((business: any) => <EvidenceBusiness key={business.businessId} business={business}/>)}</div>
}

function ResearchSummary({research}: {research: any}) {
  if (!research) return <>Legacy: no plan</>
  const before = research.plan?.coveredBefore?.length ?? 0; const after = research.plan?.coveredAfter?.length ?? before
  const formats = Object.entries(research.extraction?.byFormat ?? {}).filter(([, count]) => Number(count) > 0).map(([key, count]) => `${key}:${count}`).join(', ')
  const dimensions = Object.entries(research.extraction?.byDimension ?? {}).filter(([, count]) => Number(count) > 0).map(([key, count]) => `${key}:${count}`).join(', ')
  return <><Badge value={research.status}/>{research.limitation && research.limitation !== 'none' && <Badge value={research.limitation}/>}<small className="block">Coverage {before} → {after} · planned {(research.plan?.plannedDimensions ?? research.plan?.attemptedDimensions ?? []).join(', ') || '—'} · tried {(research.plan?.attemptedDimensions ?? []).join(', ') || '—'}</small><small className="block">{research.website ? <a href={research.website} target="_blank" rel="noreferrer">Official website ↗</a> : 'No local official source'} · {research.metrics?.requests ?? 0} requests · {research.metrics?.pages ?? research.pagesVisited?.length ?? 0} HTML · {research.metrics?.documents ?? 0} PDF/{research.metrics?.documentPages ?? 0} pages · {research.metrics?.durationMs ?? 0} ms{research.metrics?.cacheHit ? ' · cache hit' : ''}</small>{(formats || dimensions) && <small className="block">Formats {formats || '—'} · dimensions {dimensions || '—'}</small>}{research.extraction?.discarded?.length > 0 && <details><summary>{research.extraction.discarded.length} extraction discards</summary>{research.extraction.discarded.map((item: any, index: number) => <small className="block" key={`${item.sourceKey}-${index}`}>{item.sourceKey} · {item.reason}</small>)}</details>}{research.urlsAttempted?.length > 0 && <details><summary>{research.urlsAttempted.length} attempted URLs</summary>{research.urlsAttempted.map((url: string) => <small className="block mono" key={url}>{url}</small>)}</details>}{research.urlsDiscarded?.length > 0 && <details><summary>{research.urlsDiscarded.length} discarded URLs</summary>{research.urlsDiscarded.map((item: any, index: number) => <small className="block" key={`${item.url}-${index}`}>{item.url} · {item.reason}</small>)}</details>}</>
}

function ResearchEvidence({evidence}: {evidence: any[]}) {
  return <>{evidence.map((item, index) => <span className="block" key={`${item.field}-${item.value}-${index}`}>{item.field}={item.value}<small className="block mono">{item.sourceStage ?? 'comparison-research'} · {(item.sourceKeys ?? []).join(', ') || 'sin source key'}</small></span>)}</>
}

function EvidenceBusiness({business}: {business: any}) {
  const sources = new Map((business.sources ?? []).map((source: any) => [source.key, source]))
  return <details className="panel evidence-business"><summary><span><strong>{business.name}</strong><small>{business.qualityTier} · origin {business.origin ?? 'direct'} · {business.enrichmentOutcome ?? 'confirmed'} · score {business.scores?.total}</small>{business.operationalStatus && <small>Operational: {business.operationalStatus.status}{business.operationalStatus.needsVerification ? ' · NEEDS VERIFICATION' : ''}</small>}</span><span className="coverage-row">{Object.entries(business.evidence ?? {}).map(([key, facts]) => <span key={key}>{key} <b>{(facts as any[]).length}</b></span>)}</span></summary>
    {business.operationalStatus && <div className="dimension"><h3>operationalStatus</h3><p><Badge value={business.operationalStatus.status}/>{business.operationalStatus.needsVerification && <Badge value="NEEDS VERIFICATION"/>} {(business.operationalStatus.reasons ?? []).join(' ')}</p>{business.operationalStatus.signals?.map((signal: any, index: number) => <div className="fact" key={`${signal.sourceKeys?.join('-')}-${index}`}><span>{signal.status} · {signal.observedAt} · identity {signal.identityCheck?.outcome} · {signal.accepted ? 'accepted for review' : 'rejected'}</span><small className="block">{signal.identityCheck?.reason}</small></div>)}</div>}
    {Object.entries(business.evidence ?? {}).map(([dimension, facts]) => (facts as any[]).length > 0 && <div className="dimension" key={dimension}><h3>{dimension}</h3>{(facts as any[]).map((fact) => <div className="fact" key={fact.id}><FactValue value={fact.value}/><FactProvenance fact={fact} sources={sources}/></div>)}</div>)}</details>
}

function FactProvenance({fact, sources}: {fact: any; sources: Map<unknown, unknown>}) {
  const manual = (fact.provenance ?? []).filter((item: any) => item.sourceStage === 'manual-observation')
  return <div className="provenance"><Badge value={fact.nature}/><Badge value={fact.sourceStage ?? 'existing'}/>
    {manual.map((item: any) => <span className="manual-observation" key={`${item.sourceKey}-${item.observedAt}`}><Badge value="Manual observation"/> Observer: <strong>{item.observer}</strong> · Observed at: <strong>{dateOnly(item.observedAt)}</strong></span>)}
    {fact.sourceKeys?.map((key: string) => { const source: any = sources.get(key); return <span key={key}>Source: {source?.provider ?? key} {source?.retrievedAt && `· ${date(source.retrievedAt)}`} {source?.url && <a href={source.url} target="_blank" rel="noreferrer">Abrir fuente ↗</a>}</span>})}
  </div>
}

function FactValue({value}: {value: any}) {
  if (typeof value !== 'object' || value === null) return <strong>{String(value)}</strong>
  if ('name' in value) return <div><strong>{value.name}</strong>{value.price != null && <span className="price">{value.price.toLocaleString('es-ES', {minimumFractionDigits: 2})} {value.currency === 'EUR' ? '€' : value.currency}</span>}<small className="block">{value.priceQualifier}</small></div>
  return <div><strong>{value.item}</strong><span className="price">{value.value} {value.currency}</span><small className="block">{value.priceQualifier}</small></div>
}

function Generated({artifact, published, topic}: {artifact: any; published: any; topic: string}) {
  const [json, setJson] = useState(false)
  const data = artifact.data; const editorial = data?.editorial ?? published.data
  if (!editorial) return <ArtifactEmpty artifact={artifact} label="Not generated yet"/>
  return <article className="panel document"><div className="section-head"><div><h2>{editorial.title}</h2><p>{editorial.seo?.metaDescription}</p></div><div className="actions">{previewOrigin && <a className="button secondary" href={`${previewOrigin}/donde-comer/${topic}/`} target="_blank" rel="noreferrer">Abrir preview ↗</a>}<button className="secondary" onClick={() => setJson(!json)}>Ver JSON</button></div></div>
    {json ? <Json value={data ?? published.data}/> : <><h3>Intro</h3><p>{editorial.intro}</p><h3>Quick verdict</h3><p>{editorial.quickVerdict}</p><h3>Choice guide</h3><div className="cards">{editorial.choiceGuide?.map((item: any, index: number) => <div className="card" key={item.businessId ?? item.business?._ref ?? index}><strong>{item.label}</strong><p>{item.reason}</p></div>)}</div><h3>Entries</h3>{editorial.entries?.map((entry: any, index: number) => <div className="entry" key={entry.businessId ?? entry.business?._ref ?? index}><h4>{entry.businessId ?? entry.business?._ref}</h4><p>{entry.verdict}</p><Columns left={['Strengths', entry.strengths]} right={['Limitations', entry.limitations]}/></div>)}<h3>Criteria</h3><List items={editorial.criteria}/><h3>Methodology</h3><p>{editorial.methodology}</p><h3>SEO</h3><dl className="details"><dt>Title</dt><dd>{editorial.seo?.metaTitle}</dd><dt>Description</dt><dd>{editorial.seo?.metaDescription}</dd></dl></>}
  </article>
}

function QA({report, summary}: {report: any; summary: ComparisonSummary}) {
  const [filter, setFilter] = useState('All'); const [json, setJson] = useState(false)
  if (report.status !== 'available') return <section className="panel"><div className="section-head"><h2>QA <Badge value={summary.qaOutcome ?? 'NOT RUN'}/></h2><button className="secondary" disabled>Ver JSON</button></div><Empty title={summary.qaInferred ? 'Resultado histórico inferido' : 'Not validated yet'} detail={summary.qaInferred ? 'El artefacto público confirma que QA permitió publicarlo, pero el report agregado actual pertenece a otro topic. Vuelve a ejecutar QA para ver checks e issues completos.' : report.error}/></section>
  const qa = report.data; const issues = (qa.issues ?? []).filter((issue: QaIssue) => filter === 'All' || issue.severity === filter).sort((a: QaIssue, b: QaIssue) => ['FAIL', 'WARNING', 'INFO'].indexOf(a.severity) - ['FAIL', 'WARNING', 'INFO'].indexOf(b.severity))
  const stale = summary.phases.qa.stale
  return <div className="stack">{stale && <div className="notice"><strong>QA STALE</strong><span>Este resultado existía, pero una fase anterior cambió. Se muestra sólo como referencia.</span></div>}<section className="panel"><div className="section-head"><h2>Outcome <Badge value={stale ? 'STALE' : qa.qaOutcome}/></h2><button className="secondary" onClick={() => setJson(!json)}>{json ? 'Ocultar JSON' : 'Ver JSON'}</button></div><div className="check-grid">{Object.entries(qa.checks ?? {}).map(([key, value]) => <div key={key}><span>{key.replaceAll('_', ' ')}</span><Badge value={String(value)}/></div>)}</div><p>Indexability: <Badge value={stale ? 'STALE' : qa.indexability?.toUpperCase()}/></p><p>Claims generated: <strong>{qa.claimsGenerated}</strong> · Rejected: <strong>{qa.claimsRejected}</strong></p>{json && <Json value={qa}/>}</section>
    <section className="panel"><div className="section-head"><h2>Issues</h2><div className="actions">{['All', 'FAIL', 'WARNING', 'INFO'].map((item) => <button className={filter === item ? '' : 'secondary'} onClick={() => setFilter(item)} key={item}>{item}</button>)}</div></div>{issues.length ? issues.map((issue: QaIssue) => <Issue issue={issue} key={`${issue.code}-${issue.path}`}/>) : <Empty title="Sin issues para este filtro"/>}</section></div>
}

function Sources({artifact}: {artifact: any}) {
  if (artifact.status !== 'available') return <ArtifactEmpty artifact={artifact} label="No sources yet"/>
  const seen = new Map<string, number>(); for (const business of artifact.data.businesses ?? []) for (const source of business.sources ?? []) seen.set(source.key, (seen.get(source.key) ?? 0) + 1)
  const sourceByKey = new Map((artifact.data.sources ?? []).map((source: any) => [source.key, source]))
  return <div className="stack">{artifact.data.integrityIssues?.length > 0 && <section className="panel"><h2>Integrity review</h2><table><thead><tr><th>Business</th><th>Issue</th><th>Sources</th><th>Detail</th></tr></thead><tbody>{artifact.data.integrityIssues.map((issue: any, index: number) => <tr key={`${issue.businessId}-${issue.code}-${index}`}><td>{issue.businessId}</td><td><Badge value={issue.code}/></td><td>{issue.sourceKeys?.map((key: string) => { const source: any = sourceByKey.get(key); return <small className="block" key={key}>{source?.provider ?? key} · {source?.sourceClass ?? 'legacy'} / {source?.claimScope ?? 'unknown'}</small>})}</td><td>{issue.message}</td></tr>)}</tbody></table></section>}{artifact.data.businesses?.map((business: any) => <section className="panel" key={business.businessId}><h2>{business.name}</h2><table><thead><tr><th>Source</th><th>Class / scope</th><th>URL</th><th>Retrieved</th><th>Attribution</th></tr></thead><tbody>{business.sources?.map((source: any) => <tr key={source.key}><td><strong>{source.provider}</strong>{(seen.get(source.key) ?? 0) > 1 && <Badge value="DUPLICATE"/>}<small className="block mono">{source.key}</small></td><td><Badge value={source.sourceClass ?? 'legacy'}/><small className="block">{source.claimScope ?? 'unknown'}</small></td><td>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.url} ↗</a> : '—'}</td><td>{date(source.retrievedAt)}</td><td>{source.attribution ?? '—'}</td></tr>)}</tbody></table></section>)}</div>
}

function Logs({run}: {run: PipelineRun | undefined}) {
  if (!run) return <Empty title="Sin ejecuciones en esta sesión" detail="Ejecuta una fase para ver stdout, stderr, exit code y duración."/>
  return <section className="panel"><div className="section-head"><div><h2>{run.topic && run.phase ? `${run.topic} · ${run.phase}` : run.label} <Badge value={run.status}/></h2><p className="mono">{run.command} {run.args.join(' ')}</p></div>{run.durationMs != null && <strong>{(run.durationMs / 1000).toFixed(1)}s · exit {run.exitCode ?? '—'}</strong>}</div><div className="terminal">{run.logs.map((log) => <div className={log.stream} key={log.id}><time>[{new Date(log.timestamp).toLocaleTimeString()}]</time> {log.message}</div>)}</div></section>
}

function Codex({topic, qa, configured}: {topic: string; qa: any; configured: boolean}) {
  const issues: QaIssue[] = qa?.issues ?? []; const [code, setCode] = useState(issues[0]?.code ?? 'GENERAL_IMPROVEMENT'); const [note, setNote] = useState(''); const [prompt, setPrompt] = useState(''); const [copied, setCopied] = useState(false); const [error, setError] = useState('')
  const generate = async (mode: 'issue' | 'general' | 'configure-topic' = 'issue') => { try { const result = await api.prompt(topic, {mode, phase: 'qa', ...(mode === 'issue' ? {issueCode: code} : {}), ...(note ? {note} : {})}); setPrompt(result.prompt); setError('') } catch (cause) { setError(message(cause)) } }
  const copy = async () => { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1600) }
  return <section className="panel"><div className="section-head"><div><h2>Codex Prompt Builder</h2><p>Determinista: no llama a IA ni ejecuta Codex.</p></div>{!configured && <button className="secondary" onClick={() => void generate('configure-topic')}>Prompt de configuración</button>}</div>{error && <div className="error-banner">{error}</div>}<label className="field">Issue<select value={code} onChange={(event) => setCode(event.target.value)}>{issues.map((issue) => <option key={issue.code}>{issue.code}</option>)}<option>GENERAL_IMPROVEMENT</option></select></label><label className="field">Nota manual<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="El quick verdict sólo compara dos de siete negocios."/></label><div className="actions"><button onClick={() => void generate(code === 'GENERAL_IMPROVEMENT' ? 'general' : 'issue')}>Generar prompt para Codex</button><button className="secondary" onClick={() => void generate('general')}>General improvement prompt</button></div>{prompt && <><textarea className="prompt" readOnly value={prompt}/><button onClick={() => void copy()}>{copied ? 'Copiado.' : 'Copiar prompt'}</button></>}</section>
}

function RunsPage({runs, onRefresh}: {runs: PipelineRun[]; onRefresh: () => void}) { return <><Header eyebrow="SESSION" title="Runs" subtitle="Ejecuciones conservadas en memoria durante esta sesión." actions={<button className="secondary" onClick={onRefresh}>Refresh</button>}/><section className="panel"><table><thead><tr><th>Started</th><th>Topic</th><th>Phase</th><th>Status</th><th>Exit</th><th>Duration</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td>{date(run.startedAt)}</td>{run.topic && run.phase ? <><td>{run.topic}</td><td>{run.phase}</td></> : <td colSpan={2}>{run.label ?? '—'}</td>}<td><Badge value={run.status}/></td><td>{run.exitCode ?? '—'}</td><td>{run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}</td></tr>)}</tbody></table>{!runs.length && <Empty title="No hay runs en esta sesión"/>}</section></> }

function NewComparison({topics, close, navigate}: {topics: ComparisonSummary[]; close: () => void; navigate: (path: string) => void}) {
  const [topic, setTopic] = useState(''); const [searchIntent, setSearchIntent] = useState(''); const [aliases, setAliases] = useState(''); const [displayName, setDisplayName] = useState(''); const [prompt, setPrompt] = useState(''); const valid = /^[a-z0-9][a-z0-9-]*$/.test(topic); const existing = topics.some((item) => item.topic === topic)
  const create = async () => { if (existing) { close(); navigate(`/comparisons/${topic}`); return } const result = await api.prompt(topic, {mode: 'configure-topic', searchIntent, aliases: aliases.split(/[\n,]/).map((item) => item.trim()).filter(Boolean), displayName}); setPrompt(result.prompt) }
  return <div className="modal-backdrop"><div className="modal"><div className="section-head"><h2>Nueva Comparison</h2><button className="icon" onClick={close}>×</button></div><label className="field">Topic<input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="arroces"/></label><label className="field">Display name (opcional)<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Arroces"/></label><label className="field">Search intent<input value={searchIntent} onChange={(event) => setSearchIntent(event.target.value)} placeholder="elegir dónde comer arroz en Benidorm"/></label><label className="field">Aliases<textarea value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder={'arroz\narroces\npaella'}/></label>{topic && !valid && <p className="error-text">Usa sólo minúsculas, números y guiones.</p>}{valid && !existing && <p className="notice compact">Topic no configurado. Content Lab no editará TypeScript: generará un prompt autocontenido.</p>}<div className="actions"><button className="secondary" onClick={close}>Cancelar</button><button disabled={!valid} onClick={() => void create()}>{existing ? 'Abrir Comparison' : 'Generar prompt'}</button></div>{prompt && <textarea className="prompt short" readOnly value={prompt}/>}</div></div>
}

function Header({eyebrow, title: heading, subtitle, actions}: {eyebrow: string; title: string; subtitle?: string; actions?: any}) { return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{heading}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="actions">{actions}</div></header> }
function PhaseBadge({state}: {state: ComparisonPhaseState}) { const value = state.stale ? 'STALE' : state.phase === 'qa' && state.qaOutcome ? state.qaOutcome : state.status === 'not-run' ? 'NOT RUN' : state.status; return <><Badge value={value}/>{state.inferred && <small className="muted inferred"> inferred</small>}</> }
function Empty({title: heading, detail}: {title: string; detail?: string}) { return <div className="empty-state"><strong>{heading}</strong>{detail && <p>{detail}</p>}</div> }
function ArtifactEmpty({artifact, label}: {artifact: any; label: string}) { return <section className="panel"><Empty title={artifact.status === 'invalid' ? 'Invalid JSON' : label} detail={artifact.error ?? artifact.path}/></section> }
function Issue({issue}: {issue: QaIssue}) { return <div className="issue"><Badge value={issue.severity}/><div><strong>{issue.code}</strong><p>{issue.message}</p><small>{issue.path}{issue.context ? ` · ${JSON.stringify(issue.context)}` : ''}</small></div></div> }
function Json({value}: {value: any}) { return <pre className="json">{JSON.stringify(value, null, 2)}</pre> }
function Columns({left, right}: {left: [string, string[]]; right: [string, string[]]}) { return <div className="columns"><div><strong>{left[0]}</strong><List items={left[1]}/></div><div><strong>{right[0]}</strong><List items={right[1]}/></div></div> }
function title(value: string) { return value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') }
function date(value?: string) { return value ? new Date(value).toLocaleString('es-ES', {dateStyle: 'medium', timeStyle: 'short'}) : '—' }
function dateOnly(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date(value)
}
function businessName(id: string, names: Map<unknown, unknown>) { return String(names.get(id) ?? id.replace(/^business-/, '').split('-').map(title).join(' ')) }
function candidateReasons(item: any) {
  const signals = (item.evidence ?? []).map((evidence: any) => `${evidence.field}=${evidence.value}${evidence.strength ? ` (${evidence.strength})` : ''}`)
  return [...signals, ...(item.details ?? [])].join(' · ') || (item.topicEvidence ?? []).join(' · ') || '—'
}
function appendLog(logs: PipelineLog[], log: PipelineLog) { return logs.some((item) => item.id === log.id) ? logs : [...logs, log] }
