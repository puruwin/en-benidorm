import assert from 'node:assert/strict'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, resolve} from 'node:path'
import test from 'node:test'
import {createApp} from './app'

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'business-catalog-'))
  const write = async (path: string, data: unknown) => {await mkdir(dirname(resolve(root, path)), {recursive: true}); await writeFile(resolve(root, path), typeof data === 'string' ? data : JSON.stringify(data))}
  const entity = (id: string, name: string, sector = 'retail', municipality = 'Benidorm') => ({schemaVersion: 2, id, targetDocumentType: 'business', raw: {name, tags: {'addr:street': 'Calle Uno', website: 'https://example.com'}, latitude: 38.55, longitude: -0.12}, businessClassification: {sector, subsector: sector === 'retail' ? 'fashion' : 'lawyer'}, geography: {municipality}, sources: [{key: `osm:${id}`, provider: 'OSM', retrievedAt: '2026-10-16', attribution: 'OSM', url: null}]})
  await write('content/discovered/business-zeta.json', entity('business-zeta', 'Zeta', 'professional-services', 'La Nucía'))
  await write('content/discovered/business-uno.json', entity('business-uno', 'Álvaro'))
  await write('content/discovered/business-dos.json', entity('business-dos', 'Alvaro'))
  await write('content/discovered/business-place.json', {...entity('business-place', 'Place'), targetDocumentType: 'place'})
  await write('content/discovered/business-broken.json', '{')
  const app = createApp(root)
  const get = async (url: string) => app.inject({method: 'GET', url})
  const close = async () => {await app.close(); await rm(root, {recursive: true, force: true})}
  return {root, app, write, entity, get, close}
}

test('catálogo completo, paginación estable y filtros combinados', async () => {
  const f = await fixture()
  try {
    const first = (await f.get('/api/businesses?pageSize=1')).json()
    assert.equal(first.total, 3); assert.equal(first.catalogTotal, 3)
    assert.equal(first.items[0].businessId, 'business-dos')
    assert.equal(first.warnings.length, 1)
    assert.equal((await f.get('/api/businesses?pageSize=1&page=2')).json().items[0].businessId, 'business-uno')
    assert.deepEqual((await f.get('/api/businesses?q=alvaro&sector=retail&municipality=Benidorm&subsector=fashion')).json().items.map((i: any) => i.businessId), ['business-dos', 'business-uno'])
    assert.equal((await f.get('/api/businesses?municipality=La%20Nuc%C3%ADa')).json().total, 1)
    assert.equal((await f.get('/api/businesses?q=not-found')).json().total, 0)
    assert.deepEqual((await f.get('/api/businesses?page=999')).json().items, [])
    for (const url of ['/api/businesses?page=0', '/api/businesses?page=1.2', '/api/businesses?pageSize=101', '/api/businesses?analysis=available', '/api/businesses?sample=yes', '/api/businesses?unexpected=1', '/api/businesses?sector=a&sector=b']) assert.equal((await f.get(url)).statusCode, 400, url)
  } finally {await f.close()}
})

test('ficha Discovery-only con fuentes y datos desconocidos sin fabricar nada', async () => {
  const f = await fixture()
  try {
    const response = await f.get('/api/businesses/business-uno')
    assert.equal(response.statusCode, 200)
    const detail = response.json()
    assert.equal(detail.business.name, 'Álvaro')
    assert.deepEqual(detail.identity, {entry: null, enriched: null})
    assert.equal(detail.contacts.length, 1); assert.deepEqual(detail.contacts[0].sourceKeys, ['osm:business-uno'])
    assert.deepEqual(detail.coordinates, {latitude: 38.55, longitude: -0.12})
    assert.deepEqual(detail.warnings, [])
    assert.equal((await f.get('/api/businesses/business-missing')).statusCode, 404)
    assert.equal((await f.get('/api/businesses/business-broken')).statusCode, 422)
    assert.equal((await f.get('/api/businesses/business-place')).statusCode, 422)
    assert.equal((await f.get('/api/businesses/not-a-business')).statusCode, 400)
  } finally {await f.close()}
})

test('artefactos opcionales inválidos se señalan sin impedir consultar ni sobrescribirse', async () => {
  const f = await fixture()
  try {
    for (const path of ['content/enriched/business-uno.json', 'content/manifest.json']) await f.write(path, {})
    const response = await f.get('/api/businesses/business-uno')
    assert.equal(response.statusCode, 200)
    const detail = response.json()
    assert.equal(detail.warnings.length, 2)
    assert.equal(detail.identity.enriched, null)
    for (const path of ['content/enriched/business-uno.json', 'content/manifest.json']) assert.equal(await readFile(resolve(f.root, path), 'utf8'), '{}')
  } finally {await f.close()}
})

test('la antigua ruta de seguimiento comercial ya no existe', async () => {
  const f = await fixture()
  try {
    const result = await f.app.inject({method: 'PUT', url: '/api/businesses/business-uno/prospecting', payload: {status: 'following', notes: '', expectedRevision: null}})
    assert.equal(result.statusCode, 404)
    await assert.rejects(readFile(resolve(f.root, 'content/manual/prospecting/business-uno.json')), {code: 'ENOENT'})
  } finally {await f.close()}
})

test('actualizar catálogo recoge cambios y eliminaciones de Discovery', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.get('/api/businesses')).json().total, 3)
    await f.write('content/discovered/business-uno.json', f.entity('business-uno', 'New Name'))
    await f.write('content/discovered/business-tres.json', f.entity('business-tres', 'Tres'))
    await rm(resolve(f.root, 'content/discovered/business-zeta.json'))
    const result = (await f.get('/api/businesses?refresh=1')).json()
    assert.equal(result.total, 3)
    assert.ok(result.items.some((i: any) => i.name === 'New Name'))
    assert.ok(!result.items.some((i: any) => i.businessId === 'business-zeta'))
  } finally {await f.close()}
})

test('contactos y fuentes de Enrichment conservan su procedencia', async () => {
  const f = await fixture()
  try {
    const source = {key: 'web:official', provider: 'official', url: 'https://example.com', retrievedAt: '2026-10-16', attribution: 'fixture'}
    await f.write('content/enriched/business-uno.json', {id: 'business-uno', facts: {address: {value: null, sources: []}, location: {value: null, sources: []}, phone: {value: '+34900111222', sources: ['web:official']}, website: {value: null, sources: []}}, sources: [source]})
    await f.write('content/manifest.json', {entries: [{id: 'business-uno', status: 'enriched'}]})
    const detail = (await f.get('/api/businesses/business-uno')).json()
    assert.equal(detail.business.knownPhone, true)
    assert.deepEqual(detail.contacts.find((c: any) => c.kind === 'phone'), {kind: 'phone', value: '+34900111222', origin: 'Enrichment', sourceKeys: ['web:official'], observedAt: null})
    assert.equal(detail.sources.length, 2)
    assert.deepEqual(detail.identity.entry, {id: 'business-uno', status: 'enriched'})
    assert.deepEqual(detail.warnings, [])
  } finally {await f.close()}
})

test('estructuras anidadas inválidas se señalan sin romper el catálogo', async () => {
  const f = await fixture()
  try {
    await f.write('content/discovered/business-zeta.json', {...f.entity('business-zeta', 'Zeta'), businessClassification: {sector: {}, subsector: []}})
    const list = (await f.get('/api/businesses')).json()
    assert.equal(list.total, 2); assert.ok(list.warnings.some((w: string) => w.includes('business-zeta')))
    for (const id of ['not-business', 'business-%2e%2e', 'business-%2Fmanifest']) assert.equal((await f.get(`/api/businesses/${id}`)).statusCode, 400, id)
  } finally {await f.close()}
})
