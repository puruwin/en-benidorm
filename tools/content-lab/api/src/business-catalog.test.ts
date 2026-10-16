import assert from 'node:assert/strict'
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises'
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
  await write('content/reports/opportunity-experiment/sample-20.json', {businesses: [{businessId: 'business-uno'}]})
  const app = createApp(root)
  const get = async (url: string) => app.inject({method: 'GET', url})
  const close = async () => {await app.close(); await rm(root, {recursive: true, force: true})}
  return {root, app, write, entity, get, close}
}

test('catálogo completo, paginación estable, filtros combinados y muestra sin depender de latest', async () => {
  const f = await fixture()
  try {
    const first = (await f.get('/api/businesses?pageSize=1')).json()
    assert.equal(first.total, 3); assert.equal(first.catalogTotal, 3)
    assert.equal(first.items[0].businessId, 'business-dos')
    assert.equal(first.warnings.length, 1)
    assert.equal((await f.get('/api/businesses?pageSize=1&page=2')).json().items[0].businessId, 'business-uno')
    assert.deepEqual((await f.get('/api/businesses?q=alvaro&sector=retail&municipality=Benidorm&subsector=fashion&analysis=missing&sample=yes')).json().items.map((i: any) => i.businessId), ['business-uno'])
    assert.equal((await f.get('/api/businesses?sample=no')).json().total, 2)
    assert.equal((await f.get('/api/businesses?q=not-found')).json().total, 0)
    assert.deepEqual((await f.get('/api/businesses?page=999')).json().items, [])
    for (const url of ['/api/businesses?page=0', '/api/businesses?page=1.2', '/api/businesses?pageSize=101', '/api/businesses?sample=wrong', '/api/businesses?analysis=wrong', '/api/businesses?unexpected=1', '/api/businesses?sector=a&sector=b']) assert.equal((await f.get(url)).statusCode, 400, url)
  } finally {await f.close()}
})

test('ficha Discovery-only, fuentes y datos desconocidos sin fabricar análisis o review', async () => {
  const f = await fixture()
  try {
    const response = await f.get('/api/businesses/business-uno')
    assert.equal(response.statusCode, 200)
    const detail = response.json()
    assert.equal(detail.business.name, 'Álvaro'); assert.equal(detail.business.inExperimentSample, true)
    assert.equal(detail.context.analysis.status, 'missing'); assert.equal(detail.context.verification.status, 'missing')
    assert.equal(detail.context.reviewEvaluation.workflowStatus, 'unreviewed')
    assert.equal(detail.tracking.record.status, 'unmanaged'); assert.equal(detail.tracking.revision, null)
    assert.equal(detail.contacts.length, 1); assert.deepEqual(detail.contacts[0].sourceKeys, ['osm:business-uno'])
    assert.deepEqual(detail.coordinates, {latitude: 38.55, longitude: -0.12})
    assert.equal((await f.get('/api/businesses/business-missing')).statusCode, 404)
    assert.equal((await f.get('/api/businesses/business-broken')).statusCode, 422)
    assert.equal((await f.get('/api/businesses/business-place')).statusCode, 422)
    assert.equal((await f.get('/api/businesses/not-a-business')).statusCode, 400)
    await assert.rejects(readFile(resolve(f.root, 'content/manual/prospecting/business-uno.json')), {code: 'ENOENT'})
  } finally {await f.close()}
})

test('artefactos opcionales inválidos no impiden consultar ni sobrescriben datos', async () => {
  const f = await fixture()
  try {
    for (const path of ['content/opportunities/business-uno.json', 'content/verification/business-uno.json', 'content/enriched/business-uno.json', 'content/manual/opportunity-reviews/business-uno.json', 'content/manifest.json']) await f.write(path, {})
    await f.write('content/manual/prospecting/business-uno.json', '{invalid')
    const response = await f.get('/api/businesses/business-uno')
    assert.equal(response.statusCode, 200)
    const detail = response.json()
    assert.equal(detail.context.analysis.status, 'invalid')
    assert.equal(detail.context.review.status, 'invalid')
    assert.equal(detail.context.reviewEvaluation.workflowStatus, 'unreviewed')
    assert.equal(detail.warnings.length, 6); assert.equal(detail.tracking, null)
    assert.equal((await f.get('/api/businesses?analysis=invalid')).json().total, 1)
    const save = await f.app.inject({method: 'PUT', url: '/api/businesses/business-uno/prospecting', payload: {status: 'following', notes: '', expectedRevision: null}})
    assert.equal(save.statusCode, 409)
    assert.equal(await readFile(resolve(f.root, 'content/manual/prospecting/business-uno.json'), 'utf8'), '{invalid')
  } finally {await f.close()}
})

test('seguimiento aislado persiste al reiniciar y evita actualizaciones obsoletas o simultáneas', async () => {
  const f = await fixture()
  try {
    const protectedFiles = ['content/manifest.json', 'content/comparisons/candidates/desayunos.json', 'content/manual/opportunity-reviews/business-uno.json', 'content/opportunities/business-uno.json', 'content/verification/business-uno.json', 'content/manual/opportunity-experiment/sample-20-review.json']
    for (const path of protectedFiles) await f.write(path, {marker: 'untouched'})
    const url = '/api/businesses/business-uno/prospecting'
    const responses = await Promise.all(['first', 'second'].map(notes => f.app.inject({method: 'PUT', url, payload: {status: 'following', notes, expectedRevision: null}})))
    assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409])
    const saved = responses.find(r => r.statusCode === 200)!.json()
    const stale = await f.app.inject({method: 'PUT', url, payload: {status: 'archived', notes: 'overwrite', expectedRevision: null}})
    assert.equal(stale.statusCode, 409)
    const updated = await f.app.inject({method: 'PUT', url, payload: {status: 'archived', notes: 'latest', expectedRevision: saved.revision}})
    assert.equal(updated.statusCode, 200)
    const newApp = createApp(f.root)
    try {const detail = (await newApp.inject({method: 'GET', url: '/api/businesses/business-uno'})).json(); assert.equal(detail.tracking.record.notes, 'latest'); assert.equal(detail.tracking.record.status, 'archived')}
    finally {await newApp.close()}
    for (const path of protectedFiles) assert.equal(await readFile(resolve(f.root, path), 'utf8'), JSON.stringify({marker: 'untouched'}))
    assert.deepEqual(await readdir(resolve(f.root, 'content/manual/prospecting')), ['business-uno.json'])
    for (const payload of [{status: 'verified', notes: '', expectedRevision: null}, {status: 'following', notes: '', reviewedAt: 'fake', expectedRevision: null}, {status: 'following', notes: 'x'.repeat(10001), expectedRevision: null}, {status: 'following', notes: ''}]) {
      assert.equal((await f.app.inject({method: 'PUT', url, payload})).statusCode, 400)
    }
    assert.equal((await f.app.inject({method: 'PUT', url: '/api/businesses/business-missing/prospecting', payload: {status: 'following', notes: '', expectedRevision: null}})).statusCode, 404)
  } finally {await f.close()}
})

test('actualizar catálogo recoge cambios y eliminaciones de Discovery y cambios en muestra', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.get('/api/businesses')).json().total, 3)
    await f.write('content/discovered/business-uno.json', f.entity('business-uno', 'New Name'))
    await f.write('content/discovered/business-tres.json', f.entity('business-tres', 'Tres'))
    await rm(resolve(f.root, 'content/discovered/business-zeta.json'))
    await f.write('content/reports/opportunity-experiment/sample-20.json', {businesses: []})
    const result = (await f.get('/api/businesses?refresh=1')).json()
    assert.equal(result.total, 3)
    assert.ok(result.items.some((i: any) => i.name === 'New Name'))
    assert.ok(!result.items.some((i: any) => i.businessId === 'business-zeta'))
    assert.equal(result.items.filter((i: any) => i.inExperimentSample).length, 0)
  } finally {await f.close()}
})

test('análisis individual, contactos con provenance y review caducada sin depender del reporte latest', async () => {
  const f = await fixture()
  try {
    const source = {key: 'verified:site', provider: 'official', url: 'https://example.com', retrievedAt: '2026-10-16', attribution: 'fixture'}
    const analysis = {businessId: 'business-uno', businessName: 'Álvaro', category: 'retail', status: 'needs-review', signals: [{id: 'signal-1', type: 'official_website_found', observation: 'Available evidence', sourceKeys: ['verified:site'], observedAt: '2026-10-16', confidence: 'moderate'}], hypotheses: [], suggestedActions: [], summary: {evidenceStrength: 'moderate', opportunityAreas: [], manualReviewRequired: true}, provenance: {sources: [source]}}
    await f.write('content/opportunities/business-uno.json', analysis)
    const presence = {value: '+34900111222', sourceKeys: ['verified:site'], observedAt: '2026-10-15'}
    await f.write('content/verification/business-uno.json', {businessId: 'business-uno', identityEvidence: {status: 'probable-match', signals: []}, operationalEvidence: {status: 'insufficient', signals: []}, digitalPresence: {phones: [presence], emails: [{...presence, value: 'public@example.com'}], forms: [], bookingUrls: [], quoteRequestUrls: [], ecommerceUrls: [], socialProfiles: []}, websiteSignals: [], sources: [source], errors: []})
    await f.write('content/manual/opportunity-reviews/business-uno.json', {businessId: 'business-uno', reviewedAt: '2020-01-01T00:00:00.000Z', reviewedBy: 'Tester', workflowStatus: 'reviewing', operationalStatus: 'unknown', identityStatus: 'ambiguous', officialPresence: {website: 'ambiguous', googleProfile: 'not-checked', socialProfiles: 'not-checked'}, contactChannels: {}, reviewedSourceKeys: []})
    const list = (await f.get('/api/businesses?analysis=available')).json()
    assert.equal(list.total, 1); assert.equal(list.items[0].businessId, 'business-uno')
    const detail = (await f.get('/api/businesses/business-uno')).json()
    assert.equal(detail.context.analysis.status, 'available'); assert.deepEqual(detail.context.analysis.data, analysis)
    assert.equal(detail.context.verification.status, 'available')
    assert.equal(detail.context.reviewEvaluation.workflowStatus, 'stale')
    assert.equal(detail.business.knownPhone, true)
    const contact = detail.contacts.find((c: any) => c.kind === 'email')
    assert.deepEqual(contact, {kind: 'email', value: 'public@example.com', origin: 'Verification', sourceKeys: ['verified:site'], observedAt: '2026-10-15'})
    assert.equal(detail.sources.length, 2)
    assert.deepEqual(detail.warnings, [])
    assert.equal((await f.app.inject({method: 'PUT', url: '/api/businesses/business-uno/prospecting', payload: {status: 'archived', notes: 'Internal only', expectedRevision: null}})).statusCode, 200)
    const after = (await f.get('/api/businesses/business-uno')).json()
    assert.deepEqual(after.context.review, detail.context.review)
    assert.deepEqual(after.context.analysis, detail.context.analysis)
  } finally {await f.close()}
})

test('estructuras anidadas inválidas se señalan sin romper la ficha o el catálogo', async () => {
  const f = await fixture()
  try {
    await f.write('content/discovered/business-zeta.json', {...f.entity('business-zeta', 'Zeta'), businessClassification: {sector: {}, subsector: []}})
    await f.write('content/verification/business-uno.json', {businessId: 'business-uno', identityEvidence: {signals: []}, operationalEvidence: {signals: []}, digitalPresence: {phones: [null]}, sources: [], websiteSignals: []})
    const detail = (await f.get('/api/businesses/business-uno')).json()
    assert.equal(detail.context.verification.status, 'invalid')
    const list = (await f.get('/api/businesses')).json()
    assert.equal(list.total, 2); assert.ok(list.warnings.some((w: string) => w.includes('business-zeta')))
    for (const id of ['not-business', 'business-%2e%2e', 'business-%2Fmanifest']) {
      const result = await f.app.inject({method: 'PUT', url: `/api/businesses/${id}/prospecting`, payload: {status: 'following', notes: '', expectedRevision: null}})
      assert.equal(result.statusCode, 400)
    }
  } finally {await f.close()}
})
