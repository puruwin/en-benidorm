import {useState} from 'react'
import type {OpportunityAnalysisView, OpportunityReviewContext, OpportunityReviewView} from '../../shared/types'
import {api} from './api'
import {Badge, List, message, date} from './ui'

export function OpportunityCard({analysis, onReview, canReview = true}: {analysis: OpportunityAnalysisView; onReview: () => void; canReview?: boolean}) {
  return <details className="panel opportunity-card"><summary><span><strong>{analysis.businessName}</strong><small className="block mono">{analysis.businessId} · {analysis.category}</small></span><span><Badge value={analysis.reviewState}/><Badge value={analysis.status}/><Badge value={analysis.summary.evidenceStrength}/>{analysis.summary.manualReviewRequired && <Badge value="MANUAL REVIEW"/>}<button disabled={!canReview} onClick={(event) => { event.preventDefault(); onReview() }}>Revisar</button></span></summary>
    <div className="opportunity-columns">
      <section><h3>1. Evidencias</h3>{analysis.signals.map((signal) => <div className="opportunity-item" key={signal.id}><Badge value="AUTOMATIC"/><strong>{signal.type}</strong><p>{signal.observation}</p><small className="mono">{signal.confidence} · {signal.sourceKeys.join(', ') || 'sin provenance'}</small></div>)}</section>
      <section><h3>2. Hipótesis</h3>{analysis.hypotheses.length ? analysis.hypotheses.map((item) => <div className="opportunity-item hypothesis" key={item.id}><Badge value="INFERRED"/><strong>{item.area}</strong><p>{item.hypothesis}</p><small className="mono">Signals: {item.basedOnSignalIds.join(', ')}</small>{item.basedOnReview && <small className="block mono">Review: {item.basedOnReview.reviewedBy} · {item.basedOnReview.reviewedAt} · {item.basedOnReview.fields.join(', ')}</small>}</div>) : <p className="muted">No se formula ninguna hipótesis comercial.</p>}</section>
      <section><h3>3. Limitaciones</h3>{analysis.hypotheses.flatMap((item) => item.limitations).length ? <List items={[...new Set(analysis.hypotheses.flatMap((item) => item.limitations))]}/> : <p className="muted">Sin hipótesis que limitar; revisar provenance de las evidencias.</p>}</section>
      <section><h3>4. Estado de revisión</h3><p><Badge value={analysis.status}/>{analysis.summary.manualReviewRequired && <Badge value="MANUAL REVIEW REQUIRED"/>}</p><h3>5. Posible línea de actuación</h3>{analysis.suggestedActions.map((action) => <div className="opportunity-item" key={`${action.type}-${action.reason}`}><strong>{action.type}</strong><p>{action.reason}</p></div>)}</section>
    </div>
  </details>
}

export function OpportunityReviewModal({analysis, context, close, onSaved}: {analysis: OpportunityAnalysisView; context: OpportunityReviewContext; close: () => void; onSaved: () => void}) {
  const existing = context.review.data
  const [form, setForm] = useState<OpportunityReviewView>(existing ?? {
    reviewedAt: new Date().toISOString(), reviewedBy: '', workflowStatus: 'reviewing', operationalStatus: 'unknown', identityStatus: 'ambiguous',
    officialPresence: {website: 'ambiguous', googleProfile: 'not-checked', socialProfiles: 'not-checked'}, contactChannels: {}, reviewedSourceKeys: [], notes: '',
  })
  const [error, setError] = useState('')
  const discovered = context.identity.discovered
  const enriched = context.identity.enriched
  const entry = context.identity.entry
  const sources = context.analysis.data?.provenance?.sources ?? []
  const verification = context.verification.data
  const conflicts = analysis.signals.filter((signal) => ['identity_conflict', 'probable_duplicate', 'operational_status_conflict'].includes(signal.type))
  const save = async (workflowStatus: OpportunityReviewView['workflowStatus']) => {
    try { await api.saveOpportunityReview(analysis.businessId, {...form, reviewedAt: new Date().toISOString(), workflowStatus}); onSaved() }
    catch (cause) { setError(message(cause)) }
  }
  const setPresence = (key: keyof OpportunityReviewView['officialPresence'], value: string) => setForm({...form, officialPresence: {...form.officialPresence, [key]: value}} as OpportunityReviewView)
  const setContact = (key: keyof OpportunityReviewView['contactChannels'], value: string) => setForm({...form, contactChannels: {...form.contactChannels, [key]: value || undefined}} as OpportunityReviewView)
  const toggleSource = (key: string) => setForm({...form, reviewedSourceKeys: form.reviewedSourceKeys.includes(key) ? form.reviewedSourceKeys.filter((item) => item !== key) : [...form.reviewedSourceKeys, key]})
  const toggleResolution = (id: string) => { const current = form.resolvedSignalIds ?? []; setForm({...form, resolvedSignalIds: current.includes(id) ? current.filter((item) => item !== id) : [...current, id]}) }
  const address = enriched?.facts?.address?.value ?? discovered?.raw?.tags ?? {}
  const location = enriched?.facts?.location?.value ?? (discovered?.raw ? {lat: discovered.raw.latitude, lng: discovered.raw.longitude} : null)
  return <div className="modal-backdrop"><div className="modal review-modal"><div className="section-head"><div><Badge value="MANUAL"/><h2>Review · {analysis.businessName}</h2></div><button className="icon" onClick={close}>×</button></div>
    {error && <div className="error-banner">{error}</div>}
    {existing && <div className={context.reviewEvaluation.workflowStatus === 'stale' ? 'error-banner' : 'notice'}><strong>Review {context.reviewEvaluation.workflowStatus}</strong><span>Operación hasta {date(context.reviewEvaluation.expires.operationalStatus)} · web hasta {date(context.reviewEvaluation.expires.website)}{context.reviewEvaluation.staleFields.length ? ` · stale: ${context.reviewEvaluation.staleFields.join(', ')}` : ''}</span></div>}
    <section className="review-identity"><h3>Identidad</h3><dl className="details"><dt>Nombre / tipo</dt><dd>{discovered?.raw?.name ?? analysis.businessName} · {entry?.type ?? '—'}</dd><dt>Dirección</dt><dd>{JSON.stringify(address)}</dd><dt>Coordenadas</dt><dd>{location ? `${location.lat}, ${location.lng}` : '—'}</dd><dt>IDs externos</dt><dd className="mono">{(entry?.discovery?.sourceIdentifiers ?? sources.map((source: any) => ({provider: source.provider, identifier: source.identifier}))).map((item: any) => `${item.provider}:${item.identifier}`).join(' · ')}</dd></dl></section>
    <section><h3>Señales automáticas</h3>{analysis.signals.map((signal) => <div className="opportunity-item" key={signal.id}><Badge value="AUTOMATIC"/><strong>{signal.type}</strong><p>{signal.observation}</p><small className="mono">{signal.sourceKeys.join(', ')}</small></div>)}</section>
    <VerificationEvidence verification={verification}/>
    <section><h3>Revisión humana</h3><div className="review-form-grid">
      <label className="field">Autor<input value={form.reviewedBy} onChange={(event) => setForm({...form, reviewedBy: event.target.value})}/></label>
      <ReviewSelect label="Estado operativo" value={form.operationalStatus} values={['confirmed-open', 'confirmed-closed', 'unknown']} onChange={(value) => setForm({...form, operationalStatus: value as any})}/>
      <ReviewSelect label="Identidad" value={form.identityStatus} values={['confirmed', 'ambiguous', 'conflict']} onChange={(value) => setForm({...form, identityStatus: value as any})}/>
      <ReviewSelect label="Web oficial" value={form.officialPresence.website} values={['confirmed', 'not-found', 'ambiguous']} onChange={(value) => setPresence('website', value)}/>
      <ReviewSelect label="Google Business Profile" value={form.officialPresence.googleProfile} values={['confirmed', 'not-found', 'not-checked']} onChange={(value) => setPresence('googleProfile', value)}/>
      <ReviewSelect label="Redes sociales" value={form.officialPresence.socialProfiles} values={['confirmed', 'not-found', 'not-checked']} onChange={(value) => setPresence('socialProfiles', value)}/>
      <ReviewSelect label="Teléfono" value={form.contactChannels.phone ?? ''} values={['', 'confirmed', 'unverified']} onChange={(value) => setContact('phone', value)}/>
      <ReviewSelect label="Email" value={form.contactChannels.email ?? ''} values={['', 'confirmed', 'unverified']} onChange={(value) => setContact('email', value)}/>
      <ReviewSelect label="Formulario" value={form.contactChannels.contactForm ?? ''} values={['', 'confirmed', 'not-found']} onChange={(value) => setContact('contactForm', value)}/>
      <ReviewSelect label="Booking" value={form.contactChannels.booking ?? ''} values={['', 'confirmed', 'not-found']} onChange={(value) => setContact('booking', value)}/>
      <label className="field">Expires at (opcional)<input type="datetime-local" value={form.expiresAt?.slice(0, 16) ?? ''} onChange={(event) => { const {expiresAt: _old, ...rest} = form; setForm(event.target.value ? {...rest, expiresAt: new Date(event.target.value).toISOString()} : rest) }}/></label>
    </div>
    <label className="field">Notas<textarea rows={3} value={form.notes ?? ''} onChange={(event) => setForm({...form, notes: event.target.value})}/></label>
    <strong>Provenance revisada</strong>{sources.map((source: any) => <label className="review-check" key={source.key}><input type="checkbox" checked={form.reviewedSourceKeys.includes(source.key)} onChange={() => toggleSource(source.key)}/><span><span className="mono">{source.key}</span><small className="block">{source.attribution} · {source.retrievedAt}</small></span></label>)}
    {conflicts.length > 0 && <><strong>Conflictos resueltos explícitamente</strong>{conflicts.map((signal) => <label className="review-check" key={signal.id}><input type="checkbox" checked={(form.resolvedSignalIds ?? []).includes(signal.id)} onChange={() => toggleResolution(signal.id)}/><span>{signal.type}<small className="block">{signal.observation}</small></span></label>)}</>}
    </section>
    <div className="actions review-actions"><button className="secondary" onClick={() => void save('reviewing')}>Marcar pendiente</button><button className="danger" onClick={() => void save('rejected')}>No contactar</button><button onClick={() => void save('verified')}>Guardar verificada</button></div>
    <p className="footnote">Guardar no ejecuta outreach ni modifica evidence automática. Reejecuta opportunities:analyze para recalcular hipótesis.</p>
  </div></div>
}

export function VerificationEvidence({verification}: {verification: any}) {
  if (!verification) return <section><h3>Verification Enrichment</h3><p className="muted">Sin verificación disponible.</p></section>
  const signalList = (title: string, signals: any[]) => <div><strong>{title}</strong>{signals.length ? signals.map((signal) => <div className="opportunity-item" key={signal.id}><Badge value="AUTOMATIC SUPPORTING EVIDENCE"/><strong>{signal.type}</strong><p>{signal.observation}</p><small className="mono">{signal.evidenceRole} · {signal.sourceKeys.join(', ')}</small></div>) : <p className="muted">Sin señales suficientes.</p>}</div>
  const presence = verification.digitalPresence ?? {}
  return <section><h3>Verification Enrichment</h3><p><Badge value="AUTOMATIC SUPPORTING EVIDENCE"/> No sustituye la decisión manual.</p>
    <div className="opportunity-columns">
      {signalList(`IDENTITY · ${verification.identityEvidence?.status}`, verification.identityEvidence?.signals ?? [])}
      {signalList(`OPERATION · ${verification.operationalEvidence?.status}`, verification.operationalEvidence?.signals ?? [])}
      <div><strong>DIGITAL PRESENCE</strong><List items={[
        presence.website ? `website: ${presence.website.value} (${presence.website.scope})` : 'website: —',
        `phone: ${(presence.phones ?? []).map((item: any) => item.value).join(', ') || '—'}`,
        `email: ${(presence.emails ?? []).map((item: any) => item.value).join(', ') || '—'}`,
        `forms: ${(presence.forms ?? []).map((item: any) => item.value).join(', ') || '—'}`,
        `booking: ${(presence.bookingUrls ?? []).map((item: any) => item.value).join(', ') || '—'}`,
        `socials: ${(presence.socialProfiles ?? []).map((item: any) => item.value).join(', ') || '—'}`,
      ]}/></div>
      {signalList('WEBSITE', verification.websiteSignals ?? [])}
    </div>
    {(verification.errors ?? []).length > 0 && <div className="notice"><strong>Errores observados</strong><span>{verification.errors.map((item: any) => `${item.url}: ${item.message}`).join(' · ')}</span></div>}
  </section>
}

function ReviewSelect({label, value, values, onChange}: {label: string; value: string; values: string[]; onChange: (value: string) => void}) { return <label className="field">{label}<select value={value} onChange={(event) => onChange(event.target.value)}>{values.map((item) => <option value={item} key={item}>{item || 'no revisado'}</option>)}</select></label> }
