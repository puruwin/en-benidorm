import assert from 'node:assert/strict'
import {mkdir, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import {createApp} from './app'
import {ArtifactLoader} from './artifact-loader'
import {ImageCandidates} from './image-candidates'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const candidate = (id: string, thumbnailUrl: string, placeBasis: string | null = null) => ({
  id, provider: id.split(':')[0], title: id, thumbnailUrl, sourceUrl: `https://commons.wikimedia.org/wiki/${id}`,
  originalUrl: thumbnailUrl, author: 'Autora', license: {id: 'cc0'}, retrievedAt: '2026-10-01T00:00:00.000Z',
  use: placeBasis ? 'lugar' : 'ambiental', placeBasis, warnings: [],
})
const file = (candidates: unknown[], extra: Record<string, unknown> = {}) => ({
  version: 1, target: {kind: 'term', term: 'playa'}, generatedAt: '2026-10-01T00:00:00.000Z', query: {term: 'playa'}, warnings: [],
  candidates, rejected: [], approvals: [], imports: [], ...extra,
})

type Call = {url: string}
async function fixture(responses: Record<string, () => Response> = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'content-lab-images-'))
  await mkdir(resolve(root, 'content/images/candidates'), {recursive: true})
  const calls: Call[] = []
  let clock = Date.parse('2026-10-29T10:00:00.000Z')
  const fetcher = async (url: string) => {
    calls.push({url})
    const respond = responses[url]
    if (!respond) throw new Error(`Sin respuesta para ${url}`)
    return respond()
  }
  const loader = new ArtifactLoader(root)
  const app = createApp(root, {loader, images: new ImageCandidates(root, loader, {fetcher, now: () => clock})})
  const write = (slug: string, content: unknown) => writeFile(resolve(root, `content/images/candidates/${slug}.json`), typeof content === 'string' ? content : JSON.stringify(content))
  const get = (url: string) => app.inject({method: 'GET', url})
  return {root, calls, write, get, advance: (ms: number) => {clock += ms}, close: async () => {await app.close(); await rm(root, {recursive: true, force: true})}}
}

test('GET /api/images lista ficheros con contadores; un fichero v1 sin descartes cuenta vacío', async () => {
  const f = await fixture()
  try {
    await f.write('beach-playa-levante', file([
      candidate('commons:1', 'https://upload.wikimedia.org/1.jpg', 'commons-category'),
      candidate('commons:2', 'https://upload.wikimedia.org/2.jpg', 'coordinates'),
      candidate('pixabay:3', 'https://cdn.pixabay.com/3.jpg'),
      candidate('pexels:4', 'https://images.pexels.com/4.jpg'),
    ], {
      rejected: [{id: 'commons:9', reason: 'NC'}],
      approvals: [{candidateId: 'commons:1'}, {candidateId: 'commons:2'}],
      imports: [{candidateId: 'commons:1'}],
      dismissals: [{candidateId: 'pixabay:3', reason: 'otra playa'}, {candidateId: 'pexels:4', reason: 'x', undoneAt: '2026-10-02'}],
    }))
    await f.write('termino-playa', file([candidate('commons:5', 'https://upload.wikimedia.org/5.jpg')]))
    await f.write('roto', '{no es json')
    await writeFile(resolve(f.root, 'content/images/candidates/NO_VALIDO.json'), '{}')
    const response = await f.get('/api/images')
    assert.equal(response.statusCode, 200)
    const items = response.json() as any[]
    assert.deepEqual(items.map(item => item.slug), ['beach-playa-levante', 'roto', 'termino-playa'])
    assert.deepEqual(items[0].counts, {candidates: 4, withPlaceBasis: 2, rejected: 1, dismissed: 1, approved: 2, imported: 1, pendingImport: 1})
    assert.deepEqual(items[2].counts, {candidates: 1, withPlaceBasis: 0, rejected: 0, dismissed: 0, approved: 0, imported: 0, pendingImport: 0})
    assert.equal(items[1].status, 'invalid')
    assert.equal(items[1].counts, undefined)
  } finally {await f.close()}
})

test('GET /api/images sin directorio devuelve lista vacía', async () => {
  const f = await fixture()
  try {
    await rm(resolve(f.root, 'content/images'), {recursive: true})
    assert.deepEqual((await f.get('/api/images')).json(), [])
  } finally {await f.close()}
})

test('GET /api/images/:slug devuelve el fichero y su plan si existe; JSON corrupto queda como invalid', async () => {
  const f = await fixture()
  try {
    await f.write('termino-playa', file([]))
    let detail = (await f.get('/api/images/termino-playa')).json()
    assert.equal(detail.file.status, 'available')
    assert.equal(detail.plan.status, 'missing')
    await mkdir(resolve(f.root, 'content/images/plans'), {recursive: true})
    await writeFile(resolve(f.root, 'content/images/plans/termino-playa.json'), JSON.stringify({planHash: 'a'.repeat(64)}))
    detail = (await f.get('/api/images/termino-playa')).json()
    assert.equal(detail.plan.data.planHash, 'a'.repeat(64))
    await f.write('roto', '{')
    detail = (await f.get('/api/images/roto')).json()
    assert.equal(detail.file.status, 'invalid')
    assert.equal((await f.get('/api/images/no-existe')).json().file.status, 'missing')
  } finally {await f.close()}
})

test('slug con traversal o inválido da 400 sin leer fuera del directorio', async () => {
  const f = await fixture()
  try {
    await writeFile(resolve(f.root, 'content/secreto.json'), JSON.stringify({secret: 'NO'}))
    for (const url of ['/api/images/..%2F..%2Fsecreto', '/api/images/..%2Fsecreto', '/api/images/%2E%2E', '/api/images/Mayus', '/api/images/..%2Fsecreto/thumbnail/commons:1']) {
      const response = await f.get(url)
      assert.ok([400, 404].includes(response.statusCode), `${url} → ${response.statusCode}`)
      assert.ok(!response.body.includes('NO'), url)
    }
    assert.equal((await f.get('/api/images/..%2F..%2Fsecreto')).statusCode, 400)
    assert.equal(f.calls.length, 0)
  } finally {await f.close()}
})

test('miniatura: la candidata tiene que existir en ese fichero; JSON corrupto no hace fetch', async () => {
  const f = await fixture()
  try {
    await f.write('termino-a', file([candidate('commons:1', 'https://upload.wikimedia.org/1.jpg')]))
    await f.write('termino-b', file([candidate('commons:2', 'https://upload.wikimedia.org/2.jpg')]))
    await f.write('roto', '{')
    assert.equal((await f.get('/api/images/termino-a/thumbnail/commons:2')).statusCode, 404)
    assert.equal((await f.get('/api/images/termino-a/thumbnail/..%2Fx')).statusCode, 400)
    assert.equal((await f.get('/api/images/no-existe/thumbnail/commons:1')).statusCode, 404)
    assert.equal((await f.get('/api/images/roto/thumbnail/commons:1')).statusCode, 422)
    assert.equal(f.calls.length, 0)
  } finally {await f.close()}
})

test('miniatura: host fuera de lista, redirect a otro host, > 2 MB y content-type no imagen dan 502', async () => {
  const big = Buffer.alloc(2_000_001)
  const f = await fixture({
    'https://upload.wikimedia.org/redirect.jpg': () => new Response(null, {status: 302, headers: {location: 'https://evil.example/x.jpg'}}),
    'https://upload.wikimedia.org/declared.jpg': () => new Response(JPEG, {headers: {'content-type': 'image/jpeg', 'content-length': '2000001'}}),
    'https://upload.wikimedia.org/body.jpg': () => new Response(big, {headers: {'content-type': 'image/jpeg'}}),
    'https://upload.wikimedia.org/html.jpg': () => new Response('<script>alert(1)</script>', {headers: {'content-type': 'text/html'}}),
  })
  try {
    await f.write('termino-playa', file([
      candidate('commons:host', 'https://example.com/x.jpg'),
      candidate('commons:http', 'http://upload.wikimedia.org/x.jpg'),
      candidate('commons:redirect', 'https://upload.wikimedia.org/redirect.jpg'),
      candidate('commons:declared', 'https://upload.wikimedia.org/declared.jpg'),
      candidate('commons:body', 'https://upload.wikimedia.org/body.jpg'),
      candidate('commons:html', 'https://upload.wikimedia.org/html.jpg'),
    ]))
    for (const id of ['host', 'http']) assert.equal((await f.get(`/api/images/termino-playa/thumbnail/commons:${id}`)).statusCode, 502, id)
    assert.equal(f.calls.length, 0, 'un host fuera de lista no llega a pedirse')
    for (const id of ['redirect', 'declared', 'body', 'html']) {
      const response = await f.get(`/api/images/termino-playa/thumbnail/commons:${id}`)
      assert.equal(response.statusCode, 502, id)
      assert.equal(response.headers['content-type']?.toString().startsWith('application/json'), true, id)
    }
    assert.ok(!f.calls.some(call => call.url.includes('evil.example')), 'el redirect a otro host no se sigue')
    assert.deepEqual(await readdir(resolve(f.root, 'content/images')).then(entries => entries.includes('.cache')), false)
  } finally {await f.close()}
})

test('miniatura válida: cabeceras, caché en disco de 24 h y content-type normalizado', async () => {
  const f = await fixture({
    'https://cdn.pixabay.com/ok.jpg': () => new Response(JPEG, {headers: {'content-type': 'image/JPEG; charset=binary'}}),
  })
  try {
    await f.write('termino-playa', file([candidate('pixabay:7', 'https://cdn.pixabay.com/ok.jpg')]))
    const first = await f.get('/api/images/termino-playa/thumbnail/pixabay:7')
    assert.equal(first.statusCode, 200)
    assert.equal(first.headers['content-type'], 'image/jpeg')
    assert.equal(first.headers['x-content-type-options'], 'nosniff')
    assert.equal(first.headers['cache-control'], 'private, max-age=3600')
    assert.deepEqual(first.rawPayload, JPEG)
    f.advance(23 * 60 * 60 * 1000)
    assert.deepEqual((await f.get('/api/images/termino-playa/thumbnail/pixabay:7')).rawPayload, JPEG)
    assert.equal(f.calls.length, 1, 'la segunda petición sale de la caché')
    assert.equal((await readdir(resolve(f.root, 'content/images/.cache/thumbs'))).length, 2)
    f.advance(60 * 60 * 1000)
    assert.equal((await f.get('/api/images/termino-playa/thumbnail/pixabay:7')).statusCode, 200)
    assert.equal(f.calls.length, 2, 'pasadas 24 h se vuelve a pedir')
  } finally {await f.close()}
})
