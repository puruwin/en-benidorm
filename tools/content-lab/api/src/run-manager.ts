import {spawn as nodeSpawn, type ChildProcess} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import type {PipelineLog, PipelinePhase, PipelineRun} from '../../shared/types'
import {buildCommand, type CommandOptions} from './command-builder'

type SpawnFn = typeof nodeSpawn
type Listener = (run: PipelineRun, log?: PipelineLog) => void

export class RunManager {
  private runs = new Map<string, PipelineRun>()
  private activeId: string | undefined
  private children = new Map<string, ChildProcess>()
  private listeners = new Map<string, Set<Listener>>()
  private sequence = 0

  constructor(private root: string, private spawnFn: SpawnFn = nodeSpawn) {}

  list(): PipelineRun[] { return [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)) }
  get(id: string): PipelineRun | undefined { return this.runs.get(id) }
  active(): PipelineRun | undefined { return this.activeId ? this.runs.get(this.activeId) : undefined }

  start(topic: string, phase: PipelinePhase, options: CommandOptions = {}): PipelineRun {
    if (this.active()) throw new Error('Ya existe una ejecución activa.')
    const built = buildCommand(topic, phase, options)
    const run: PipelineRun = {id: randomUUID(), topic, phase, status: 'running', command: built.command, args: built.args, startedAt: new Date().toISOString(), logs: []}
    this.runs.set(run.id, run)
    this.activeId = run.id
    this.log(run, 'system', `Running comparison:${phase}...`)
    const child = this.spawnFn(built.command, built.args, {cwd: this.root, env: process.env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']})
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
    })
    readable.on('end', () => { if (pending) this.log(run, stream, pending) })
  }

  private log(run: PipelineRun, stream: PipelineLog['stream'], message: string) {
    const log = {id: ++this.sequence, timestamp: new Date().toISOString(), stream, message}
    run.logs.push(log)
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
