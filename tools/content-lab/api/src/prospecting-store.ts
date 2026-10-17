import {createHash, randomUUID} from 'node:crypto'
import {lstat, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import type {ProspectingRecord, ProspectingStatus, ProspectingView} from '../../shared/business-types'
import {validateBusinessId} from './validation'

export class BusinessError extends Error {
  constructor(readonly statusCode: number, message: string) {super(message)}
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const statuses: ProspectingStatus[] = ['unmanaged', 'following', 'archived']
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

export class ProspectingStore {
  private directory: string
  constructor(root: string) {this.directory = resolve(root, 'content/manual/prospecting')}
  private path(id: string) {return resolve(this.directory, `${validateBusinessId(id)}.json`)}
  private async regular(path: string, directory = false) {
    try {
      const info = await lstat(path)
      if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) throw new BusinessError(409, 'Seguimiento inválido: se requiere un archivo/directorio local regular.')
    } catch (error) {if (!isMissing(error)) throw error}
  }
  async read(id: string): Promise<ProspectingView> {
    const path = this.path(id)
    await this.regular(this.directory, true)
    await this.regular(path)
    let text: string
    try {text = await readFile(path, 'utf8')} catch (error) {
      if (!isMissing(error)) throw error
      return {record: {schemaVersion: 1, businessId: id, status: 'unmanaged', notes: '', updatedAt: null}, revision: null}
    }
    try {
      const record = JSON.parse(text) as ProspectingRecord
      if (record.schemaVersion !== 1 || record.businessId !== id || !statuses.includes(record.status)
        || typeof record.notes !== 'string' || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))) throw Error('schema')
      return {record, revision: digest(text)}
    } catch {throw new BusinessError(409, 'El archivo de seguimiento es inválido. Se conserva sin sobrescribirlo.')}
  }
  async save(id: string, body: unknown): Promise<ProspectingView> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BusinessError(400, 'Seguimiento inválido.')
    const input = body as Record<string, unknown>
    if (Object.keys(input).some(key => !['status', 'notes', 'expectedRevision'].includes(key))
      || !statuses.includes(input.status as ProspectingStatus) || typeof input.notes !== 'string' || input.notes.length > 10000
      || !('expectedRevision' in input) || (input.expectedRevision !== null && (typeof input.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedRevision)))) {
      throw new BusinessError(400, 'Estado, notas (máximo 10.000 caracteres) o revisión inválidos.')
    }
    const path = this.path(id)
    await this.regular(this.directory, true)
    await mkdir(this.directory, {recursive: true})
    const lock = `${path}.lock`
    try {await mkdir(lock)} catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new BusinessError(409, 'Otra edición está guardándose. Recarga el seguimiento antes de volver a guardar.')
      throw error
    }
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      const current = await this.read(id)
      if (current.revision !== input.expectedRevision) throw new BusinessError(409, 'El seguimiento ha cambiado. Conserva tus notas y carga la versión actual antes de guardar.')
      const record: ProspectingRecord = {schemaVersion: 1, businessId: id, status: input.status as ProspectingStatus, notes: input.notes, updatedAt: new Date().toISOString()}
      const text = `${JSON.stringify(record, null, 2)}\n`
      await writeFile(temporary, text, {flag: 'wx'})
      await rename(temporary, path)
      return {record, revision: digest(text)}
    } finally {await rm(temporary, {force: true}); await rm(lock, {recursive: true, force: true})}
  }
}
