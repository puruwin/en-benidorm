import {useEffect, useState} from 'react'
import type {BusinessDetail, BusinessList, ProspectingStatus, ProspectingView} from '../../shared/business-types'
import {api} from './api'
import {OpportunityCard, OpportunityReviewModal, VerificationEvidence} from './OpportunityViews'
import {Badge, message} from './ui'

const statusNames: Record<ProspectingStatus, string> = {unmanaged: 'Sin gestionar', following: 'En seguimiento', archived: 'Archivado'}
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString('es-ES') : 'Sin fecha registrada'
const safeUrl = (value: string | null | undefined) => {
  if (!value) return undefined
  try {const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined} catch {return undefined}
}
function Warning({text}: {text: string}) {return <div className="notice" role="status">{text}</div>}

export function BusinessListPage({search, navigate}: {search: string; navigate: (path: string) => void}) {
  const params = new URLSearchParams(search)
  const [result, setResult] = useState<BusinessList>()
  const [error, setError] = useState('')
  const [facets, setFacets] = useState<BusinessList['facets']>()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {setQuery(new URLSearchParams(search).get('q') ?? '')}, [search])
  useEffect(() => {
    let active = true
    setResult(undefined); setError('')
    const queryParams = new URLSearchParams(search)
    if (refresh) queryParams.set('refresh', '1')
    void api.businesses(queryParams.toString()).then(value => {if (active) {setResult(value); setFacets(value.facets)}}).catch(cause => {if (active) setError(message(cause))})
    return () => {active = false}
  }, [search, refresh])
  function change(key: string, value: string) {
    const next = new URLSearchParams(search)
    if (value) next.set(key, value); else next.delete(key)
    if (key !== 'page') next.delete('page')
    if (key === 'sector') next.delete('subsector')
    navigate(`/businesses${next.size ? `?${next}` : ''}`)
  }
  return <div className="stack">
    <header className="page-header"><div><span className="eyebrow">CATÁLOGO LOCAL</span><h1>Negocios</h1><p>Consulta los negocios disponibles y organiza tu seguimiento.</p></div><button className="secondary" onClick={() => setRefresh(value => value + 1)}>Actualizar catálogo</button></header>
    <section className="panel catalog-filters">
      <form className="business-search" onSubmit={event => {event.preventDefault(); change('q', query)}}><label className="field">Buscar por nombre o ID<input type="search" value={query} onChange={event => setQuery(event.target.value)} maxLength={200}/></label><button type="submit">Buscar</button></form>
      <div className="business-filter-grid">
        {(['municipality', 'sector', 'subsector'] as const).map((key, index) => <label className="field" key={key}>{['Municipio', 'Sector', 'Subsector'][index]}<select aria-label={['Municipio', 'Sector', 'Subsector'][index]} value={params.get(key) ?? ''} onChange={event => change(key, event.target.value)}><option value="">Todos</option>{(key === 'municipality' ? facets?.municipalities : key === 'sector' ? facets?.sectors : facets?.subsectors)?.map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}
        <label className="field">Análisis<select value={params.get('analysis') ?? 'all'} onChange={event => change('analysis', event.target.value)}><option value="all">Todos</option><option value="available">Con análisis</option><option value="missing">Sin análisis</option><option value="invalid">Análisis inválido</option></select></label>
        <label className="field">Muestra experimental<select value={params.get('sample') ?? 'all'} onChange={event => change('sample', event.target.value)}><option value="all">Todos</option><option value="yes">En la muestra de 20</option><option value="no">Fuera de la muestra</option></select></label>
      </div>
      <button className="secondary" onClick={() => navigate('/businesses')}>Limpiar filtros</button>
    </section>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {!result && !error && <p role="status">Cargando catálogo…</p>}
    {result && <>
      {result.warnings.map(warning => <Warning key={warning} text={warning}/>)}
      <section className="panel business-table"><div className="section-head"><h2>{result.total} resultados <small className="muted">de {result.catalogTotal} negocios</small></h2><span>Orden: nombre · ID</span></div>
        <div className="table-scroll"><table><thead><tr><th>Negocio</th><th>Municipio</th><th>Sector / subsector</th><th>Datos conocidos</th><th>Análisis</th></tr></thead><tbody>{result.items.map(item => <tr key={item.businessId}>
          <td><a href={`/businesses/${item.businessId}`} onClick={event => {if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {event.preventDefault(); navigate(`/businesses/${item.businessId}`)}}}>{item.name}</a><small className="block mono">{item.businessId}</small>{item.inExperimentSample && <Badge value="Muestra de 20"/>}</td>
          <td>{item.municipality}</td><td>{item.sector}<small className="block">{item.subsector}</small></td><td><span className="block">{item.knownWebsite ? 'Web registrada' : 'Web no registrada'}</span><span className="block">{item.knownPhone ? 'Teléfono registrado' : 'Teléfono no registrado'}</span></td><td>{item.analysisStatus === 'available' ? 'Con análisis' : item.analysisStatus === 'invalid' ? 'Análisis inválido' : 'Sin análisis'}</td>
        </tr>)}</tbody></table></div>
        {!result.items.length && <p>No hay negocios para estos filtros.{result.page > 1 && <button className="secondary" onClick={() => change('page', '1')}>Volver a la primera página</button>}</p>}
        <div className="pagination"><button className="secondary" disabled={result.page <= 1} onClick={() => change('page', String(result.page - 1))}>Anterior</button><span>Página {result.page} de {Math.max(1, result.pages)}</span><button className="secondary" disabled={result.page >= result.pages} onClick={() => change('page', String(result.page + 1))}>Siguiente</button></div>
      </section>
      <p className="footnote">Los indicadores del catálogo proceden de Discovery. La ficha reúne también los contactos de los demás artefactos disponibles. «No registrado» no significa que no exista.</p>
    </>}
  </div>
}

export function BusinessDetailPage({businessId, navigate}: {businessId: string; navigate: (path: string) => void}) {
  const [detail, setDetail] = useState<BusinessDetail>()
  const [error, setError] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    void api.business(businessId).then(value => {if (active) setDetail(value)}).catch(cause => {if (active) setError(message(cause))})
    return () => {active = false}
  }, [businessId, refresh])
  const analysis = detail?.context.analysis.data
  const review = detail?.context.review.data
  const analysisView = analysis ? {...analysis, reviewState: detail!.context.reviewEvaluation.workflowStatus} : undefined
  return <div className="stack">
    <header className="page-header"><div><span className="eyebrow">FICHA DE NEGOCIO</span><h1>{detail?.business.name ?? 'Negocio'}</h1><p className="mono">{businessId}</p></div><button className="secondary" onClick={() => navigate('/businesses')}>Volver al catálogo</button></header>
    {error && <div role="alert" className="error-banner">{error}</div>}
    {!detail && !error && <p role="status">Cargando ficha…</p>}
    {detail && <>
      {detail.warnings.map(warning => <Warning key={warning} text={warning}/>)}
      <section className="panel"><h2>Identidad y ubicación</h2><p>{detail.business.sector} · {detail.business.subsector} · {detail.business.municipality}</p><p>{detail.address ?? 'Dirección no registrada'}</p><p>{detail.coordinates ? `${detail.coordinates.latitude}, ${detail.coordinates.longitude}` : 'Coordenadas no registradas'}</p>{detail.business.inExperimentSample && <Badge value="Muestra de 20"/>}<small className="block">Fuente: Discovery; dirección y coordenadas de Enrichment cuando están disponibles.</small></section>
      <section className="panel"><h2>Presencia y contacto conocidos</h2>{(['website', 'phone', 'email'] as const).map((kind, index) => <div className="contact-group" key={kind}><h3>{['Web', 'Teléfono', 'Email'][index]}</h3>{detail.contacts.filter(contact => contact.kind === kind).length ? detail.contacts.filter(contact => contact.kind === kind).map((contact, i) => <div className="fact" key={`${contact.origin}-${contact.value}-${i}`}>
        {kind === 'website' && safeUrl(contact.value) ? <a href={safeUrl(contact.value)} target="_blank" rel="noreferrer">{contact.value}</a> : <span>{contact.value}</span>}
        <small className="block">{contact.origin} · {date(contact.observedAt)} · {contact.sourceKeys.join(', ') || 'Sin fuente registrada'}</small>
      </div>) : <p className="muted">{['Web no registrada', 'Teléfono no registrado', 'Email no registrado'][index]}</p>}</div>)}<p className="footnote">Son datos de las fuentes disponibles. No se ha comprobado su vigencia al abrir esta ficha.</p></section>
      <section className="panel"><h2>Evidencia de verificación</h2><VerificationEvidence verification={detail.context.verification.data}/></section>
      <section className="panel"><h2>Revisión humana</h2><p>Estado efectivo: <Badge value={detail.context.reviewEvaluation.workflowStatus}/></p>{review ? <><p>Identidad: {review.identityStatus} · Operación: {review.operationalStatus}</p><p>Revisado por {review.reviewedBy} · {date(review.reviewedAt)}</p><p>{review.notes || 'Sin notas de revisión.'}</p>{detail.context.reviewEvaluation.staleFields.length > 0 && <Warning text={`Revisión caducada: ${detail.context.reviewEvaluation.staleFields.join(', ')}`}/>}</> : <p>{detail.context.review.status === 'invalid' ? 'La revisión existente es inválida; se conserva.' : 'Sin revisión humana registrada.'}</p>}
        {analysisView && detail.context.review.status !== 'invalid' ? <button onClick={() => setReviewing(true)}>Abrir revisión humana</button> : <p className="muted">{!analysisView ? 'El formulario de revisión existente requiere un análisis disponible.' : 'Repara el artefacto inválido antes de editar la revisión.'}</p>}
      </section>
      <section className="business-analysis"><h2>Análisis comercial existente</h2>{analysisView ? <OpportunityCard canReview={detail.context.review.status !== 'invalid'} analysis={analysisView} onReview={() => setReviewing(true)}/> : <section className="panel"><p>{detail.context.analysis.status === 'invalid' ? 'Análisis inválido.' : 'Sin análisis.'} Consultar esta ficha no ejecuta ningún análisis.</p></section>}</section>
      <section className="panel"><h2>Fuentes disponibles</h2>{detail.sources.length ? detail.sources.map(source => <div className="fact" key={source.key}><strong>{source.provider}</strong><small className="block mono">{source.key}</small>{safeUrl(source.url) && <a href={safeUrl(source.url)} target="_blank" rel="noreferrer">Consultar fuente</a>}<small className="block">{date(source.retrievedAt)} · {source.attribution}</small></div>) : <p>Sin fuentes registradas.</p>}</section>
      {detail.tracking ? <ProspectingEditor businessId={businessId} initial={detail.tracking}/> : <section className="panel"><h2>Seguimiento</h2><p>No se puede editar el archivo de seguimiento. Consulta la advertencia de la ficha.</p></section>}
      {reviewing && analysisView && <OpportunityReviewModal analysis={analysisView} context={detail.context} close={() => setReviewing(false)} onSaved={() => {setReviewing(false); setRefresh(value => value + 1)}}/>}
    </>}
  </div>
}

function ProspectingEditor({businessId, initial}: {businessId: string; initial: ProspectingView}) {
  const [saved, setSaved] = useState(initial)
  const [status, setStatus] = useState(initial.record.status)
  const [notes, setNotes] = useState(initial.record.notes)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [remote, setRemote] = useState<ProspectingView>()
  const dirty = status !== saved.record.status || notes !== saved.record.notes
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {if (dirty) {event.preventDefault()}}
    const navigateHandler = (event: Event) => {if (dirty && !confirm('Hay notas de prospección sin guardar. ¿Salir sin guardarlas?')) event.preventDefault()}
    addEventListener('beforeunload', handler)
    addEventListener('business-before-navigate', navigateHandler)
    return () => {removeEventListener('beforeunload', handler); removeEventListener('business-before-navigate', navigateHandler)}
  }, [dirty])
  const save = async () => {
    setBusy(true); setError(''); setNotice('')
    try {const next = await api.saveProspecting(businessId, {status, notes, expectedRevision: saved.revision}); setSaved(next); setNotice('Seguimiento guardado.'); setRemote(undefined)}
    catch (cause) {setError(message(cause))}
    finally {setBusy(false)}
  }
  const loadRemote = async () => {
    setBusy(true)
    try {const detail = await api.business(businessId); if (detail.tracking) setRemote(detail.tracking); else setError('No se puede leer el seguimiento actual.')}
    catch (cause) {setError(message(cause))}
    finally {setBusy(false)}
  }
  return <section className="panel"><h2>Seguimiento de prospección</h2><p className="muted">Organización manual. Este estado no confirma identidad, apertura ni una oportunidad comercial.</p>
    <label className="field">Estado de seguimiento<select value={status} disabled={busy} onChange={event => {setStatus(event.target.value as ProspectingStatus); setNotice('')}}>{Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="field">Notas de prospección<textarea rows={5} maxLength={10000} disabled={busy} value={notes} onChange={event => {setNotes(event.target.value); setNotice('')}}/></label>
    <small className="block">Última modificación: {date(saved.record.updatedAt)}</small>
    {error && <div role="alert" className="error-banner">{error}<button className="secondary" disabled={busy} onClick={() => void loadRemote()}>Consultar versión actual</button></div>}
    {remote && <div className="notice tracking-conflict"><strong>Versión guardada: {statusNames[remote.record.status]}</strong><p className="tracking-notes">{remote.record.notes || 'Sin notas.'}</p><p>Tus cambios siguen en el formulario. Puedes copiarlos antes de cargar la versión guardada.</p><button className="secondary" onClick={() => {setSaved(remote); setStatus(remote.record.status); setNotes(remote.record.notes); setError(''); setRemote(undefined)}}>Cargar versión guardada en el formulario</button></div>}
    <div className="actions"><button disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar seguimiento'}</button>{dirty && <span className="muted">Cambios sin guardar</span>}</div>
    {notice && <p role="status">{notice}</p>}
  </section>
}
