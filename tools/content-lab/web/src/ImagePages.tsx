import {useEffect, useState} from 'react'
import type {PipelineRun} from '../../shared/types'
import type {ImageCandidatesSummary} from '../../api/src/image-candidates'
import {STOCK_DOCUMENT_TYPES, type CandidatesFile, type CandidateTarget, type ImageCandidate} from '../../../../scripts/images/lib/candidates'
import {api, thumbnailUrl, type ImageDetail, type ImageSearchRequest} from './api'
import {Badge, Empty, Header, Logs, date, message, safeUrl, useRunStream} from './ui'

const targetLabel = (target: CandidateTarget | undefined) => !target ? '—' : target.kind === 'document' ? `${target.type}:${target.slug}` : `término: «${target.term}»`
const link = (navigate: (path: string) => void, path: string) => (event: React.MouseEvent) => {if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {event.preventDefault(); navigate(path)}}

export function ImagesListPage({search, activeRun, navigate, onRefresh}: {search: string; activeRun: PipelineRun | undefined; navigate: (path: string) => void; onRefresh: () => void}) {
  const [files, setFiles] = useState<ImageCandidatesSummary[]>()
  const [error, setError] = useState('')
  const load = () => api.images().then(value => {setFiles(value); setError('')}).catch(cause => setError(message(cause)))
  useEffect(() => {void load()}, [])
  return <div className="stack">
    <Header eyebrow="IMÁGENES DE STOCK" title="Imágenes" subtitle="Candidatas de Commons, Pixabay y Pexels por documento o término." actions={<button className="secondary" onClick={() => void load()}>Actualizar</button>}/>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <section className="panel">
      <h2>Ficheros de candidatas</h2>
      {!files && !error && <p role="status">Cargando candidatas…</p>}
      {files && !files.length && <Empty title="No hay ficheros de candidatas" detail="Lanza una búsqueda para crear content/images/candidates/<slug>.json."/>}
      {files && files.length > 0 && <div className="table-scroll"><table><thead><tr><th>Destino</th><th>Búsqueda</th><th>Candidatas</th><th>Con base de lugar</th><th>Rechazadas (licencia/formato)</th><th>Descartadas por David</th><th>Aprobadas</th><th>Importadas</th></tr></thead><tbody>{files.map(file => <tr key={file.slug}>
        <td><a href={`/images/${file.slug}`} onClick={link(navigate, `/images/${file.slug}`)}>{file.target?.kind === 'document' ? file.target.name : targetLabel(file.target)}</a><small className="block mono">{targetLabel(file.target)}</small>{file.status !== 'available' && <small className="block error-text">{file.status === 'invalid' ? 'JSON inválido' : 'No disponible'}{file.error ? `: ${file.error}` : ''}</small>}</td>
        <td>{date(file.generatedAt)}</td>
        <td>{file.counts?.candidates ?? '—'}</td><td>{file.counts?.withPlaceBasis ?? '—'}</td><td>{file.counts?.rejected ?? '—'}</td><td>{file.counts?.dismissed ?? '—'}</td>
        <td>{file.counts?.approved ?? '—'}{(file.counts?.pendingImport ?? 0) > 0 && <> <Badge value={`${file.counts!.pendingImport} sin importar`}/></>}</td><td>{file.counts?.imported ?? '—'}</td>
      </tr>)}</tbody></table></div>}
    </section>
    <SearchForm search={search} activeRun={activeRun} navigate={navigate} onFinish={() => {void load(); onRefresh()}}/>
  </div>
}

function SearchForm({search, activeRun, navigate, onFinish}: {search: string; activeRun: PipelineRun | undefined; navigate: (path: string) => void; onFinish: () => void}) {
  const params = new URLSearchParams(search)
  const [docType, docSlug] = (params.get('doc') ?? '').split(':')
  const [mode, setMode] = useState<'doc' | 'term'>(params.has('term') ? 'term' : 'doc')
  const [type, setType] = useState<string>(STOCK_DOCUMENT_TYPES.includes(docType as never) ? docType! : 'beach')
  const [slug, setSlug] = useState(docSlug ?? '')
  const [term, setTerm] = useState(params.get('term') ?? '')
  const [category, setCategory] = useState(params.get('category') ?? '')
  const [radius, setRadius] = useState(params.get('radius') ?? '500')
  const [error, setError] = useState('')
  const {run, stream} = useRunStream(finished => {
    onFinish()
    const slugFromRun = finished.files?.[0]?.match(/^content\/images\/candidates\/([a-z0-9][a-z0-9-]{0,100})\.json$/)?.[1]
    if (finished.status === 'completed' && slugFromRun) navigate(`/images/${slugFromRun}`)
  })
  const running = run?.status === 'running' || activeRun?.status === 'running'
  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault()
    const body: ImageSearchRequest = {...(mode === 'doc' ? {doc: `${type}:${slug.trim()}`} : {term: term.trim()}), ...(category.trim() ? {category: category.trim()} : {}), radius: Number(radius)}
    try {setError(''); stream(await api.imageSearch(body))} catch (cause) {setError(message(cause))}
  }
  return <>
    <section className="panel">
      <h2>Nueva búsqueda</h2>
      <form onSubmit={event => void submit(event)}>
        <div className="image-search-mode">
          <label><input type="radio" name="mode" checked={mode === 'doc'} onChange={() => setMode('doc')}/> Documento</label>
          <label><input type="radio" name="mode" checked={mode === 'term'} onChange={() => setMode('term')}/> Término</label>
        </div>
        <div className="image-search-grid">
          {mode === 'doc' ? <>
            <label className="field">Tipo<select value={type} onChange={event => setType(event.target.value)}>{STOCK_DOCUMENT_TYPES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="field">Slug<input value={slug} onChange={event => setSlug(event.target.value)} placeholder="playa-levante" maxLength={101} required/></label>
          </> : <label className="field wide">Término<input value={term} onChange={event => setTerm(event.target.value)} placeholder="paseo marítimo" maxLength={100} required/></label>}
          <label className="field">Radio (m)<input type="number" min={50} max={5000} step={1} value={radius} onChange={event => setRadius(event.target.value)} required/></label>
        </div>
        <label className="field">Categoría de Commons (opcional)<input value={category} onChange={event => setCategory(event.target.value)} placeholder="Category:…" maxLength={209}/><small>Una categoría escrita aquí cuenta como confirmada por ti (base de lugar).</small></label>
        <p className="footnote">Las fichas de negocio no admiten imágenes de stock: solo fotos propias.</p>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <button type="submit" disabled={running}>{running ? 'Hay una ejecución en curso…' : 'Buscar candidatas'}</button>
      </form>
    </section>
    {run && <Logs run={run}/>}
  </>
}

type Filter = 'pending' | 'approved' | 'imported' | 'dismissed' | 'rejected'
const FILTERS: [Filter, string][] = [['pending', 'Pendientes'], ['approved', 'Aprobadas'], ['imported', 'Importadas'], ['dismissed', 'Descartadas por David'], ['rejected', 'Rechazadas']]

/** Estado de cada candidata a partir de las decisiones del fichero. Campos opcionales ausentes = []. */
function classify(file: CandidatesFile) {
  const imported = new Set((file.imports ?? []).map(record => record.candidateId))
  const approved = new Set((file.approvals ?? []).map(approval => approval.candidateId))
  const dismissals = new Map((file.dismissals ?? []).filter(item => !item.undoneAt).map(item => [item.candidateId, item]))
  const state = (candidate: ImageCandidate): Exclude<Filter, 'rejected'> => imported.has(candidate.id) ? 'imported' : approved.has(candidate.id) ? 'approved' : dismissals.has(candidate.id) ? 'dismissed' : 'pending'
  return {state, dismissals}
}

export function ImageReviewPage({slug, navigate}: {slug: string; navigate: (path: string) => void}) {
  const [detail, setDetail] = useState<ImageDetail>()
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('pending')
  const load = () => api.imageDetail(slug).then(value => {setDetail(value); setError('')}).catch(cause => setError(message(cause)))
  useEffect(() => {void load()}, [slug])
  const file = detail?.file.status === 'available' ? detail.file.data : undefined
  const header = <Header eyebrow="IMÁGENES · REVISIÓN" title={file?.target.kind === 'document' ? file.target.name : file ? targetLabel(file.target) : slug} subtitle={`content/images/candidates/${slug}.json`} actions={<><button className="secondary" onClick={() => void load()}>Actualizar</button><button className="secondary" onClick={() => navigate('/images')}>Volver</button></>}/>
  if (!file) return <div className="stack">{header}{error ? <div className="error-banner" role="alert">{error}</div> : detail ? <div className="error-banner" role="alert">{detail.file.status === 'invalid' ? 'El fichero de candidatas no es JSON válido.' : 'Fichero de candidatas no encontrado.'}{detail.file.error ? ` ${detail.file.error}` : ''}</div> : <p role="status">Cargando candidatas…</p>}</div>

  const {state, dismissals} = classify(file)
  const candidates = file.candidates ?? []
  const rejected = file.rejected ?? []
  const counts = Object.fromEntries(FILTERS.map(([key]) => [key, key === 'rejected' ? rejected.length : candidates.filter(candidate => state(candidate) === key).length])) as Record<Filter, number>
  const target = file.target
  const repeat = new URLSearchParams({...(target.kind === 'document' ? {doc: `${target.type}:${target.slug}`} : {term: target.term}), ...(file.query.category ? {category: file.query.category} : {}), ...(file.query.radiusMeters ? {radius: String(file.query.radiusMeters)} : {})})
  return <div className="stack">
    {header}
    {error && <div className="error-banner" role="alert">{error}</div>}
    <section className="panel image-query">
      <dl className="details">
        <dt>Destino</dt><dd className="mono">{targetLabel(target)}</dd>
        <dt>Coordenadas</dt><dd>{target.kind === 'document' && target.coordinates ? `${target.coordinates.lat}, ${target.coordinates.lng}` : 'sin coordenadas'}</dd>
        <dt>Categoría</dt><dd>{file.query.category ? <><span className="mono">{file.query.category}</span> {file.query.categorySuggested ? <span className="badge badge-unconfirmed">propuesta automáticamente, sin confirmar</span> : <Badge value="confirmada"/>}</> : 'sin categoría'}</dd>
        <dt>Radio</dt><dd>{file.query.radiusMeters != null ? `${file.query.radiusMeters} m` : '—'}</dd>
        <dt>Búsqueda</dt><dd>{date(file.generatedAt)}</dd>
      </dl>
      {file.query.categorySuggested && <p className="footnote">La categoría propuesta solo da candidatas ambientales. Comprueba en las descripciones que es de este lugar antes de confirmarla.</p>}
      <div className="actions"><button className="secondary" onClick={() => navigate(`/images?${repeat}`)}>Repetir búsqueda con esta categoría</button></div>
    </section>
    {(file.warnings ?? []).map(warning => <div className="notice" role="status" key={warning}>{warning}</div>)}
    <div className="toolbar">{FILTERS.map(([key, label]) => <button key={key} className={filter === key ? '' : 'secondary'} onClick={() => setFilter(key)}>{label} <small>{counts[key]}</small></button>)}</div>
    {filter === 'rejected'
      ? rejected.length ? <section className="panel"><table><thead><tr><th>Candidata</th><th>Motivo</th></tr></thead><tbody>{rejected.map(item => <tr key={item.id}><td className="mono">{item.id}</td><td>{item.reason}</td></tr>)}</tbody></table><p className="footnote">Rechazadas automáticamente por licencia o formato. No admiten acciones.</p></section> : <Empty title="Sin candidatas rechazadas"/>
      : (() => {
        const visible = candidates.filter(candidate => state(candidate) === filter)
        return visible.length ? <div className="image-grid">{visible.map(candidate => <CandidateCard key={candidate.id} slug={slug} candidate={candidate} dismissal={dismissals.get(candidate.id)}/>)}</div> : <Empty title="Sin candidatas en este filtro"/>
      })()}
  </div>
}

function CandidateCard({slug, candidate, dismissal}: {slug: string; candidate: ImageCandidate; dismissal: {dismissedBy: string; dismissedAt: string; reason: string} | undefined}) {
  const [broken, setBroken] = useState(false)
  const author = safeUrl(candidate.authorUrl)
  const source = safeUrl(candidate.sourceUrl)
  return <article className="image-card">
    {broken ? <div className="image-thumb missing">Miniatura no disponible</div> : <img className="image-thumb" src={thumbnailUrl(slug, candidate.id)} alt="" loading="lazy" onError={() => setBroken(true)}/>}
    <div className="image-card-body">
      <strong>{candidate.title}</strong>
      <div className="image-badges"><Badge value={candidate.use}/><Badge value={candidate.placeBasis ?? 'sin base de lugar'}/></div>
      <dl className="image-meta">
        <dt>Proveedor</dt><dd>{candidate.provider}</dd>
        <dt>Autor</dt><dd>{author ? <a href={author} target="_blank" rel="noreferrer">{candidate.author}</a> : candidate.author}</dd>
        <dt>Licencia</dt><dd>{candidate.license.id}</dd>
        <dt>Tomada</dt><dd>{candidate.takenAt ?? '—'}</dd>
        <dt>Distancia</dt><dd>{candidate.distanceMeters != null ? `${candidate.distanceMeters} m` : '—'}</dd>
      </dl>
      <p className="image-description">{candidate.sourceDescription || <span className="muted">Sin descripción en la fuente.</span>}</p>
      {candidate.warnings.map(warning => <p className="image-warning" key={warning}>{warning}</p>)}
      {dismissal && <p className="image-warning">Descartada por {dismissal.dismissedBy} ({date(dismissal.dismissedAt)}): {dismissal.reason}</p>}
      {source && <a href={source} target="_blank" rel="noreferrer">Abrir fuente ↗</a>}
      <small className="block mono">{candidate.id}</small>
    </div>
  </article>
}
