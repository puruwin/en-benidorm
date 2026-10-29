import {useEffect, useRef, useState} from 'react'
import type {PipelineLog, PipelineRun} from '../../shared/types'

export function Badge({value}: {value: string}) {const normalized = String(value).toLowerCase().replaceAll('_', '-'); return <span className={`badge badge-${normalized}`}>{value}</span>}
export function List({items}: {items?: string[]}) {return <ul>{items?.map(item => <li key={item}>{item}</li>)}</ul>}
export function message(cause: unknown) {return cause instanceof Error ? cause.message : String(cause)}

export const safeUrl = (value: string | null | undefined) => {
  if (!value) return undefined
  try {const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined} catch {return undefined}
}

export function date(value?: string) {return value ? new Date(value).toLocaleString('es-ES', {dateStyle: 'medium', timeStyle: 'short'}) : '—'}

export function Header({eyebrow, title: heading, subtitle, actions}: {eyebrow: string; title: string; subtitle?: string; actions?: any}) { return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{heading}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="actions">{actions}</div></header> }
export function Empty({title: heading, detail}: {title: string; detail?: string}) { return <div className="empty-state"><strong>{heading}</strong>{detail && <p>{detail}</p>}</div> }

export function Logs({run}: {run: PipelineRun | undefined}) {
  if (!run) return <Empty title="Sin ejecuciones en esta sesión" detail="Ejecuta una fase para ver stdout, stderr, exit code y duración."/>
  return <section className="panel"><div className="section-head"><div><h2>{run.topic && run.phase ? `${run.topic} · ${run.phase}` : run.label} <Badge value={run.status}/></h2><p className="mono">{run.command} {run.args.join(' ')}</p></div>{run.durationMs != null && <strong>{(run.durationMs / 1000).toFixed(1)}s · exit {run.exitCode ?? '—'}</strong>}</div><div className="terminal">{run.logs.map((log) => <div className={log.stream} key={log.id}><time>[{new Date(log.timestamp).toLocaleTimeString()}]</time> {log.message}</div>)}</div></section>
}

export function appendLog(logs: PipelineLog[], log: PipelineLog) { return logs.some((item) => item.id === log.id) ? logs : [...logs, log] }

/** Sigue un run por `/api/runs/:id/events`; `onFinish` recibe el run con su estado final. */
export function useRunStream(onFinish: (run: PipelineRun) => void) {
  const eventSources = useRef<EventSource[]>([])
  const finish = useRef(onFinish)
  finish.current = onFinish
  useEffect(() => () => {for (const source of eventSources.current) source.close()}, [])
  const [run, setRun] = useState<PipelineRun>()
  const stream = (started: PipelineRun) => {
    setRun(started)
    const source = new EventSource(`/api/runs/${started.id}/events`)
    eventSources.current.push(source)
    source.addEventListener('snapshot', (event) => setRun(JSON.parse((event as MessageEvent).data)))
    source.addEventListener('log', (event) => setRun((current) => current ? {...current, logs: appendLog(current.logs, JSON.parse((event as MessageEvent).data))} : current))
    source.addEventListener('status', (event) => {
      const status = JSON.parse((event as MessageEvent).data)
      setRun((current) => current ? {...current, ...status} : current)
      if (status.finishedAt) { source.close(); finish.current({...started, ...status}) }
    })
  }
  return {run, setRun, stream}
}
