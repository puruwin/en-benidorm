import type {ComparisonOptions} from './types'

export function parseComparisonOptions(args = process.argv.slice(2)): ComparisonOptions {
  const options: ComparisonOptions = {dryRun: false, force: false}
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--force') options.force = true
    else if (argument.startsWith('--topic')) {
      options.topic = normalizeTopic(optionValue(args, index, '--topic'))
      if (!argument.includes('=')) index += 1
    } else if (argument.startsWith('--id')) {
      options.id = optionValue(args, index, '--id')
      if (!argument.includes('=')) index += 1
    } else if (argument.startsWith('--limit')) {
      const limit = Number(optionValue(args, index, '--limit'))
      if (!argument.includes('=')) index += 1
      if (!Number.isInteger(limit) || limit <= 0) throw new Error('--limit debe ser un entero positivo.')
      options.limit = limit
    } else throw new Error(`Argumento no reconocido: ${argument}`)
  }
  if (!options.topic && !options.id) throw new Error('Indica --topic o --id.')
  if (!options.topic && options.id?.startsWith('comparison-')) options.topic = options.id.slice('comparison-'.length)
  if (!options.id && options.topic) options.id = `comparison-${options.topic}`
  return options
}

export function normalizeTopic(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function optionValue(args: readonly string[], index: number, option: string): string {
  const argument = args[index]!
  const equals = argument.indexOf('=')
  const value = equals >= 0 ? argument.slice(equals + 1) : args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${option} requiere un valor.`)
  return value
}
