import {spawn as nodeSpawn, type ChildProcess} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import type {PipelineLog, PipelinePhase, PipelineRun} from '../../shared/types'
import {buildCommand, type CommandOptions} from './command-builder'

type SpawnFn = typeof nodeSpawn
type Listener = (run: PipelineRun, log?: PipelineLog) => void

export interface CommandSpec {
  kind: NonNullable<PipelineRun['kind']>
  label: string
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  topic?: string
  phase?: PipelinePhase
  /** Ficheros que escribe el run (imágenes). */
  files?: string[]
}

export class RunManager {
  private runs = new Map<string, PipelineRun>()
  private activeId: string | undefined
  private children = new Map<string, ChildProcess>()
  private listeners = new Map<string, Set<Listener>>()
  private sequence = 0
  private stopping = false

  constructor(private root: string, private spawnFn: SpawnFn = nodeSpawn) {}

  list(): PipelineRun[] { return [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)) }
  get(id: string): PipelineRun | undefined { return this.runs.get(id) }
  active(): PipelineRun | undefined { return this.activeId ? this.runs.get(this.activeId) : undefined }

  start(topic: string, phase: PipelinePhase, options: CommandOptions = {}): PipelineRun {
    const built = buildCommand(topic, phase, options)
    return this.startCommand({kind: 'comparison', label: `comparison:${phase}`, command: built.command, args: built.args, env: process.env, topic, phase})
  }

  /** Lanza un comando ya validado. `env` es el entorno completo del hijo: no se mezcla con `process.env`. */
  startCommand(spec: CommandSpec): PipelineRun {
    if (this.stopping) throw new Error('Content Lab está cerrándose.')
    if (this.active()) throw new Error('Ya existe una ejecución activa.')
    const completed = this.list().filter(run => Boolean(run.finishedAt))
    for (const old of completed.slice(99)) this.runs.delete(old.id)
    const run: PipelineRun = {id: randomUUID(), kind: spec.kind, label: spec.label, ...(spec.topic ? {topic: spec.topic} : {}), ...(spec.phase ? {phase: spec.phase} : {}), ...(spec.files ? {files: spec.files} : {}), status: 'running', command: spec.command, args: spec.args, startedAt: new Date().toISOString(), logs: []}
    this.runs.set(run.id, run)
    this.activeId = run.id
    this.log(run, 'system', `Running ${spec.label}...`)
    const child = this.spawnFn(spec.command, spec.args, {cwd: this.root, env: spec.env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']})
    this.children.set(run.id, child)
    this.consume(run, 'stdout', child.stdout!)
    this.consume(run, 'stderr', child.stderr!)
    child.on('error', (error) => { this.log(run, 'stderr', error.message); this.finish(run, 'failed', null) })
    child.on('close', (code, signal) => {
      if (run.status === 'cancelled') this.finish(run, 'cancelled', code)
      else this.finish(run, code === 0 ? 'completed' : 'failed', code)
      if (signal) this.log(run, 'system', `Process ended by ${signal}.`)
    })
    return run
  }

  cancel(id: string): PipelineRun {
    const run = this.runs.get(id)
    if (!run) throw new Error('Ejecución no encontrada.')
    if (run.status !== 'running') return run
    run.status = 'cancelled'
    this.log(run, 'system', 'Cancellation requested.')
    const child = this.children.get(id)
    if (child?.pid) {
      try {
        if (process.platform === 'win32') child.kill('SIGTERM')
        else process.kill(-child.pid, 'SIGTERM')
      } catch { child.kill('SIGTERM') }
      const timer = setTimeout(() => {
        if (this.children.has(id) && child.pid) {
          try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL') } catch { /* already stopped */ }
        }
      }, 5000)
      timer.unref()
    } else this.finish(run, 'cancelled', null)
    return run
  }

  async shutdown(): Promise<void> {
    this.stopping = true
    const children = [...this.children.entries()]
    if (!children.length) return
    await Promise.all(children.map(([id, child]) => new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 6000)
      child.once('close', () => {clearTimeout(timer); resolve()})
      this.cancel(id)
    })))
  }

  subscribe(id: string, listener: Listener): () => void {
    const listeners = this.listeners.get(id) ?? new Set<Listener>()
    listeners.add(listener); this.listeners.set(id, listeners)
    return () => listeners.delete(listener)
  }

  private consume(run: PipelineRun, stream: 'stdout' | 'stderr', readable: NodeJS.ReadableStream) {
    let pending = ''
    readable.on('data', (chunk) => {
      pending += String(chunk)
      const lines = pending.split(/\r?\n/); pending = lines.pop() ?? ''
      for (const line of lines) if (line) this.log(run, stream, line)
      if (pending.length > 10000) pending = '[line truncated]'
    })
    readable.on('end', () => { if (pending) this.log(run, stream, pending) })
  }

  private log(run: PipelineRun, stream: PipelineLog['stream'], message: string) {
    for (const [key, value] of Object.entries(process.env)) if (/(TOKEN|PASSWORD|SECRET|API_KEY)$/i.test(key) && value && value.length >= 6) message = message.replaceAll(value, '[REDACTED]')
    const log = {id: ++this.sequence, timestamp: new Date().toISOString(), stream, message: message.slice(0, 10000)}
    run.logs.push(log)
    if (run.logs.length > 5000) run.logs.splice(0, run.logs.length - 5000)
    for (const listener of this.listeners.get(run.id) ?? []) listener(run, log)
  }

  private finish(run: PipelineRun, status: PipelineRun['status'], code: number | null) {
    if (run.finishedAt) return
    run.status = status; run.exitCode = code; run.finishedAt = new Date().toISOString()
    run.durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
    this.children.delete(run.id)
    if (this.activeId === run.id) this.activeId = undefined
    this.log(run, 'system', `${status.toUpperCase()}${code === null ? '' : ` (exit ${code})`} in ${(run.durationMs / 1000).toFixed(1)}s`)
  }
}
