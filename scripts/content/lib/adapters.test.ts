import assert from 'node:assert/strict'
import test from 'node:test'
import {buildOverpassQuery, OpenStreetMapAdapter} from './adapters'

test('discovery separa primitivas y filtra contra el polígono municipal', async () => {
  const calls: string[] = []
  const fetcher = (async (input: string | URL | globalThis.Request) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('nominatim')) {
      return Response.json({
        features: [{geometry: {type: 'Polygon', coordinates: [[[-1, 0], [1, 0], [1, 2], [-1, 2], [-1, 0]]]}}],
      })
    }
    const index = calls.filter((call) => call === 'https://overpass.test/api/interpreter').length
    return Response.json({
      elements: index === 1 ? [
        {type: 'node', id: 1, lat: 1, lon: 0, tags: {name: 'Dentro', amenity: 'restaurant'}},
        {type: 'node', id: 2, lat: 3, lon: 0, tags: {name: 'Fuera', amenity: 'restaurant'}},
      ] : [],
    })
  }) as typeof fetch
  const adapter = new OpenStreetMapAdapter('https://overpass.test/api/interpreter', fetcher)
  const records = await adapter.discover({type: 'restaurant', retrievedAt: '2026-10-06T10:00:00.000Z'})
  assert.deepEqual(records.map((record) => record.raw.name), ['Dentro'])
  assert.equal(calls.filter((call) => call.includes('overpass.test')).length, 3)
})

test('el query evita nwr/area y consulta una primitiva sobre el bbox de control', () => {
  const query = buildOverpassQuery('restaurant', undefined, 'way')
  assert.match(query, /way\["name"\]\["amenity"="restaurant"\]/)
  assert.doesNotMatch(query, /nwr|area\(/)
})
