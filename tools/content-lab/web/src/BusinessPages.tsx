import {useEffect, useState} from 'react'
import type {BusinessDetail, BusinessList} from '../../shared/business-types'
import {api} from './api'
import {message, safeUrl} from './ui'

const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString('es-ES') : 'Sin fecha registrada'
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
    <header className="page-header"><div><span className="eyebrow">CATÁLOGO LOCAL</span><h1>Negocios</h1><p>Consulta los negocios descubiertos y sus fuentes.</p></div><button className="secondary" onClick={() => setRefresh(value => value + 1)}>Actualizar catálogo</button></header>
    <section className="panel catalog-filters">
      <form className="business-search" onSubmit={event => {event.preventDefault(); change('q', query)}}><label className="field">Buscar por nombre o ID<input type="search" value={query} onChange={event => setQuery(event.target.value)} maxLength={200}/></label><button type="submit">Buscar</button></form>
      <div className="business-filter-grid">
        {(['municipality', 'sector', 'subsector'] as const).map((key, index) => <label className="field" key={key}>{['Municipio', 'Sector', 'Subsector'][index]}<select aria-label={['Municipio', 'Sector', 'Subsector'][index]} value={params.get(key) ?? ''} onChange={event => change(key, event.target.value)}><option value="">Todos</option>{(key === 'municipality' ? facets?.municipalities : key === 'sector' ? facets?.sectors : facets?.subsectors)?.map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}
      </div>
      <button className="secondary" onClick={() => navigate('/businesses')}>Limpiar filtros</button>
    </section>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {!result && !error && <p role="status">Cargando catálogo…</p>}
    {result && <>
      {result.warnings.map(warning => <Warning key={warning} text={warning}/>)}
      <section className="panel business-table"><div className="section-head"><h2>{result.total} resultados <small className="muted">de {result.catalogTotal} negocios</small></h2><span>Orden: nombre · ID</span></div>
        <div className="table-scroll"><table><thead><tr><th>Negocio</th><th>Municipio</th><th>Sector / subsector</th><th>Datos conocidos</th></tr></thead><tbody>{result.items.map(item => <tr key={item.businessId}>
          <td><a href={`/businesses/${item.businessId}`} onClick={event => {if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {event.preventDefault(); navigate(`/businesses/${item.businessId}`)}}}>{item.name}</a><small className="block mono">{item.businessId}</small></td>
          <td>{item.municipality}</td><td>{item.sector}<small className="block">{item.subsector}</small></td><td><span className="block">{item.knownWebsite ? 'Web registrada' : 'Web no registrada'}</span><span className="block">{item.knownPhone ? 'Teléfono registrado' : 'Teléfono no registrado'}</span></td>
        </tr>)}</tbody></table></div>
        {!result.items.length && <p>No hay negocios para estos filtros.{result.page > 1 && <button className="secondary" onClick={() => change('page', '1')}>Volver a la primera página</button>}</p>}
        <div className="pagination"><button className="secondary" disabled={result.page <= 1} onClick={() => change('page', String(result.page - 1))}>Anterior</button><span>Página {result.page} de {Math.max(1, result.pages)}</span><button className="secondary" disabled={result.page >= result.pages} onClick={() => change('page', String(result.page + 1))}>Siguiente</button></div>
      </section>
      <p className="footnote">Los indicadores del catálogo proceden de Discovery. La ficha reúne también los contactos de Enrichment. «No registrado» no significa que no exista.</p>
    </>}
  </div>
}

export function BusinessDetailPage({businessId, navigate}: {businessId: string; navigate: (path: string) => void}) {
  const [detail, setDetail] = useState<BusinessDetail>()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setError('')
    void api.business(businessId).then(value => {if (active) setDetail(value)}).catch(cause => {if (active) setError(message(cause))})
    return () => {active = false}
  }, [businessId])
  return <div className="stack">
    <header className="page-header"><div><span className="eyebrow">FICHA DE NEGOCIO</span><h1>{detail?.business.name ?? 'Negocio'}</h1><p className="mono">{businessId}</p></div><button className="secondary" onClick={() => navigate('/businesses')}>Volver al catálogo</button></header>
    {error && <div role="alert" className="error-banner">{error}</div>}
    {!detail && !error && <p role="status">Cargando ficha…</p>}
    {detail && <>
      {detail.warnings.map(warning => <Warning key={warning} text={warning}/>)}
      <section className="panel"><h2>Identidad y ubicación</h2><p>{detail.business.sector} · {detail.business.subsector} · {detail.business.municipality}</p><p>{detail.address ?? 'Dirección no registrada'}</p><p>{detail.coordinates ? `${detail.coordinates.latitude}, ${detail.coordinates.longitude}` : 'Coordenadas no registradas'}</p><small className="block">Fuente: Discovery; dirección y coordenadas de Enrichment cuando están disponibles.</small></section>
      <section className="panel"><h2>Presencia y contacto conocidos</h2>{(['website', 'phone', 'email'] as const).map((kind, index) => <div className="contact-group" key={kind}><h3>{['Web', 'Teléfono', 'Email'][index]}</h3>{detail.contacts.filter(contact => contact.kind === kind).length ? detail.contacts.filter(contact => contact.kind === kind).map((contact, i) => <div className="fact" key={`${contact.origin}-${contact.value}-${i}`}>
        {kind === 'website' && safeUrl(contact.value) ? <a href={safeUrl(contact.value)} target="_blank" rel="noreferrer">{contact.value}</a> : <span>{contact.value}</span>}
        <small className="block">{contact.origin} · {date(contact.observedAt)} · {contact.sourceKeys.join(', ') || 'Sin fuente registrada'}</small>
      </div>) : <p className="muted">{['Web no registrada', 'Teléfono no registrado', 'Email no registrado'][index]}</p>}</div>)}<p className="footnote">Son datos de las fuentes disponibles. No se ha comprobado su vigencia al abrir esta ficha.</p></section>
      <section className="panel"><h2>Fuentes disponibles</h2>{detail.sources.length ? detail.sources.map(source => <div className="fact" key={source.key}><strong>{source.provider}</strong><small className="block mono">{source.key}</small>{safeUrl(source.url) && <a href={safeUrl(source.url)} target="_blank" rel="noreferrer">Consultar fuente</a>}<small className="block">{date(source.retrievedAt)} · {source.attribution}</small></div>) : <p>Sin fuentes registradas.</p>}</section>
    </>}
  </div>
}
