import assert from 'node:assert/strict'
import test from 'node:test'
import {buildCommand, buildImagesCommand, buildImagesEnv} from './command-builder'
import {parseRunOptions, validateTopic} from './validation'

test('command builder usa argv separados y mapea las cuatro fases', () => {
  assert.deepEqual(buildCommand('arroces', 'selection', {limit: 7, force: true}), {
    command: 'npm',
    args: ['run', 'comparison:select', '--', '--topic', 'arroces', '--limit', '7', '--force'],
    display: 'npm run comparison:select -- --topic arroces --limit 7 --force',
  })
  assert.equal(buildCommand('italiano', 'enrichment').args[1], 'comparison:enrich')
  assert.equal(buildCommand('italiano', 'generation').args[1], 'comparison:generate')
  assert.equal(buildCommand('italiano', 'qa').args[1], 'comparison:qa')
})

test('topic validation bloquea shell injection y path traversal', () => {
  for (const unsafe of ['../../etc/passwd', 'arroces; rm -rf x', '$(whoami)', 'Arroces', '', '--force', 'a b']) {
    assert.throws(() => validateTopic(unsafe), /Topic inválido/)
  }
  assert.equal(validateTopic('arroz-a-banda-2'), 'arroz-a-banda-2')
})

test('run options rechaza claves arbitrarias y límites inválidos', () => {
  assert.deepEqual(parseRunOptions({limit: 8, force: true, dryRun: false}), {limit: 8, force: true, dryRun: false})
  assert.throws(() => parseRunOptions({args: '--foo'}), /no permitida/)
  assert.throws(() => parseRunOptions({limit: 0}), /entero/)
})


test('images find monta argv sin shell con --opcion=valor', () => {
  assert.deepEqual(buildImagesCommand({action: 'find', doc: 'beach:playa-levante', category: 'Category:Platja de Llevant (Benidorm)', radius: 1000}), {
    command: process.execPath,
    args: ['--import', 'tsx', 'scripts/images/find-candidates.ts', '--doc=beach:playa-levante', '--category=Category:Platja de Llevant (Benidorm)', '--radius=1000'],
    display: 'node --import tsx scripts/images/find-candidates.ts --doc=beach:playa-levante --category=Category:Platja de Llevant (Benidorm) --radius=1000',
    label: 'images:find beach:playa-levante',
    files: ['content/images/candidates/beach-playa-levante.json'],
  })
  assert.deepEqual(buildImagesCommand({action: 'find', term: "  atardecer, mar Mediterráneo l'Albir  "}).args.slice(3), ["--term=atardecer, mar Mediterráneo l'Albir"])
  assert.deepEqual(buildImagesCommand({action: 'find', term: "  atardecer, mar Mediterráneo l'Albir  "}).files, ['content/images/candidates/termino-atardecer-mar-mediterraneo-l-albir.json'])
})

test('images import construye la ruta de candidatas y exige by y expectPlan para escribir', () => {
  const hash = 'a'.repeat(64)
  assert.deepEqual(buildImagesCommand({action: 'import', slug: 'beach-playa-levante'}).args, ['--import', 'tsx', 'scripts/images/import-approved.ts', 'content/images/candidates/beach-playa-levante.json'])
  assert.equal(buildImagesCommand({action: 'import', slug: 'beach-playa-levante'}).label, 'images:import beach-playa-levante (simulación)')
  assert.deepEqual(buildImagesCommand({action: 'import', slug: 'beach-playa-levante'}).files, ['content/images/candidates/beach-playa-levante.json'])
  assert.deepEqual(buildImagesCommand({action: 'import', slug: 'beach-playa-levante', write: true, by: 'david', expectPlan: hash}).args.slice(3), ['content/images/candidates/beach-playa-levante.json', '--write', '--by=david', `--expect-plan=${hash}`])
  assert.throws(() => buildImagesCommand({action: 'import', slug: 'x', write: true, by: 'david'}), /exige by y expectPlan/)
  assert.throws(() => buildImagesCommand({action: 'import', slug: 'x', write: true, expectPlan: hash}), /exige by y expectPlan/)
  assert.throws(() => buildImagesCommand({action: 'import', slug: 'x', write: 'true'}), /boolean/)
})

test('images rechaza acciones, combinaciones y claves no previstas', () => {
  for (const input of [null, [], 'find', {action: 'publish'}, {action: 'find'}, {action: 'find', doc: 'beach:a', term: 'playa'},
    {action: 'find', doc: 'beach:a', out: '/tmp'}, {action: 'import', slug: 'a', path: '../x.json'}, {action: 'find', term: 'playa', env: {}}]) {
    assert.throws(() => buildImagesCommand(input))
  }
})

test('images bloquea inyección y traversal en cada argumento', () => {
  const find = (extra: Record<string, unknown>) => () => buildImagesCommand({action: 'find', ...extra})
  assert.throws(find({doc: 'business:bar-pepe'}), /fichas de negocio no admiten imágenes de stock: solo fotos propias/)
  for (const doc of ['beach:../x', 'beach:a;rm -rf x', 'beach:$(id)', 'Beach:x', 'beach:a\nb', 'beach:', 'hotel:x', 'beach:a/b', `beach:${'a'.repeat(102)}`, 42]) {
    assert.throws(find({doc}), /Documento inválido/, String(doc))
  }
  for (const term of ['--write', '-x', 'a', ' ', 'a'.repeat(101), '$(id)', 'a;b', '`id`', 'a\nb', '../../etc/passwd', 'a|b', 'a&b', 'a"b', 7]) {
    assert.throws(find({term}), /Término inválido/, String(term))
  }
  for (const category of ['Platja de Llevant', 'Category:a|b', 'Category:a\nb', 'Category:[[x]]', 'Category:{x}', 'Category:a#b', 'Category:<x>', `Category:${'a'.repeat(201)}`, 'Category:']) {
    assert.throws(find({term: 'playa', category}), /Categoría inválida/, category)
  }
  for (const radius of [49, 5001, 1.5, '500', -100, Number.NaN]) {
    assert.throws(find({term: 'playa', radius}), /radius/, String(radius))
  }
  const imp = (extra: Record<string, unknown>) => () => buildImagesCommand({action: 'import', slug: 'beach-playa-levante', ...extra})
  for (const slug of ['../x', 'a/b', 'A', '-a', 'a.json', '', 'a b', '..', `a${'b'.repeat(101)}`]) {
    assert.throws(imp({slug}), /Slug de candidatas inválido/, slug)
  }
  for (const by of ['a b', 'a;b', '$(id)', '', '--write', 'a'.repeat(101)]) {
    assert.throws(imp({by}), /Usuario inválido/, by)
  }
  for (const expectPlan of ['xyz', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), `${'a'.repeat(63)};`]) {
    assert.throws(imp({expectPlan}), /Hash de plan inválido/, expectPlan)
  }
})

test('entorno de imágenes con lista cerrada: nunca OPENAI_* ni el token general de Sanity', () => {
  const source = {
    PATH: '/usr/bin', HOME: '/home/node', TZ: 'Europe/Madrid', NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=512',
    SANITY_PROJECT_ID: 'p', SANITY_DATASET: 'production', SANITY_API_TOKEN: 'general-token', SANITY_IMAGES_TOKEN: 'images-token',
    OPENAI_API_KEY: 'sk-x', OPENAI_ORG: 'org', PIXABAY_API_KEY: 'pix', PEXELS_API_KEY: 'pex',
    CONTENT_LAB_PASSWORD_HASH: 'scrypt$x', CONTENT_LAB_AUTH_USER: 'david', npm_config_userconfig: '/x',
  }
  const base = {PATH: '/usr/bin', HOME: '/home/node', TZ: 'Europe/Madrid', NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=512', SANITY_PROJECT_ID: 'p', SANITY_DATASET: 'production', CONTENT_LAB_CLOSED_ENV: '1'}
  assert.deepEqual(buildImagesEnv('find', source), {...base, PIXABAY_API_KEY: 'pix', PEXELS_API_KEY: 'pex'})
  assert.deepEqual(buildImagesEnv('import', source), {...base, SANITY_API_TOKEN: 'images-token'})
  const withoutImagesToken = buildImagesEnv('import', {...source, SANITY_IMAGES_TOKEN: undefined})
  assert.equal(withoutImagesToken.SANITY_API_TOKEN, undefined)
  for (const env of [buildImagesEnv('find', source), buildImagesEnv('import', source), withoutImagesToken]) {
    assert.ok(!Object.keys(env).some(key => key.startsWith('OPENAI_')))
    assert.ok(!Object.values(env).includes('general-token'))
  }
})
