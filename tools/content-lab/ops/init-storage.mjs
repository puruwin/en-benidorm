import {cp, mkdir, readdir, realpath, stat} from 'node:fs/promises'
import {resolve, sep} from 'node:path'

const args = process.argv.slice(2)
const sourceArg = args.find(arg => arg.startsWith('--source='))?.slice(9)
const targetArg = args.find(arg => arg.startsWith('--target='))?.slice(9)
if (args.length !== 2 || !sourceArg || !targetArg) throw Error('Uso: content-lab:storage -- --source=/ruta/content --target=/ruta/persistente/content')
const source = await realpath(resolve(sourceArg))
const target = resolve(targetArg)
if (source === target || target.startsWith(`${source}${sep}`) || source.startsWith(`${target}${sep}`)) throw Error('Origen y destino deben ser directorios independientes y no anidados.')
if (!(await stat(source)).isDirectory()) throw Error('El origen debe ser un directorio content.')
// A restore is explicit and refuses existing data. Run with the service stopped.
await mkdir(target, {recursive: true})
if ((await readdir(target)).length) throw Error('El destino no está vacío. No se sobrescriben datos persistentes.')
if (await realpath(target) !== target) throw Error('El destino no puede ser un enlace simbólico.')
async function inspect(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw Error('El origen contiene enlaces o entradas no regulares; revisa el snapshot antes de copiar.')
    if (entry.name.endsWith('.lock') || entry.name.endsWith('.tmp')) throw Error('Hay locks/temporales. Detén los escritores y revisa la copia antes de migrar.')
    if (entry.isDirectory()) await inspect(resolve(directory, entry.name))
  }
}
await inspect(source)
for (const entry of await readdir(source)) await cp(resolve(source, entry), resolve(target, entry), {recursive: true, force: false, errorOnExist: true})
console.log('Contenido copiado sin sobrescribir archivos existentes. Configura CONTENT_LAB_CONTENT_PATH con este destino.')
