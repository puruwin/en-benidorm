import assert from 'node:assert/strict'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'
import {createApp} from './app'

test('API persiste review manual sin modificar Opportunity Analysis', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'opportunity-review-api-'))
  const app = createApp(root)
  try {
    await mkdir(resolve(root, 'content/opportunities'), {recursive: true})
    const analysis = {businessId: 'business-uno', status: 'needs-review', provenance: {sources: [{key: 'osm:1'}]}}
    await writeFile(resolve(root, 'content/opportunities/business-uno.json'), JSON.stringify(analysis))
    const response = await app.inject({method: 'PUT', url: '/api/opportunity-reviews/business-uno', payload: {
      reviewedAt: '2026-10-15T12:00:00.000Z', reviewedBy: 'Ana', workflowStatus: 'verified',
      operationalStatus: 'confirmed-open', identityStatus: 'confirmed',
      officialPresence: {website: 'not-found', googleProfile: 'not-checked', socialProfiles: 'not-checked'},
      contactChannels: {}, reviewedSourceKeys: ['osm:1'],
    }})
    assert.equal(response.statusCode, 200)
    assert.deepEqual(JSON.parse(response.body).review.reviewedSourceKeys, ['osm:1'])
    const context = await app.inject({method: 'GET', url: '/api/opportunity-reviews/business-uno'})
    assert.equal(JSON.parse(context.body).review.data.reviewedBy, 'Ana')
    assert.deepEqual(JSON.parse(await readFile(resolve(root, 'content/opportunities/business-uno.json'), 'utf8')), analysis)
  } finally { await app.close(); await rm(root, {recursive: true, force: true}) }
})

test('API rechaza provenance ajena al negocio', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'opportunity-review-api-invalid-'))
  const app = createApp(root)
  try {
    await mkdir(resolve(root, 'content/opportunities'), {recursive: true})
    await writeFile(resolve(root, 'content/opportunities/business-uno.json'), JSON.stringify({provenance: {sources: [{key: 'osm:1'}]}}))
    const response = await app.inject({method: 'PUT', url: '/api/opportunity-reviews/business-uno', payload: {
      reviewedAt: '2026-10-15T12:00:00.000Z', reviewedBy: 'Ana', workflowStatus: 'reviewing', operationalStatus: 'unknown', identityStatus: 'ambiguous',
      officialPresence: {website: 'ambiguous', googleProfile: 'not-checked', socialProfiles: 'not-checked'}, contactChannels: {}, reviewedSourceKeys: ['osm:other'],
    }})
    assert.equal(response.statusCode, 400)
  } finally { await app.close(); await rm(root, {recursive: true, force: true}) }
})
