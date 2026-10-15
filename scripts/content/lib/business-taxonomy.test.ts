import assert from 'node:assert/strict'
import test from 'node:test'
import {classifyBusiness} from './business-taxonomy'

test('clasifica sector y subsector comercial con reglas reproducibles', () => {
  assert.deepEqual(classifyBusiness({healthcare: 'physiotherapist'}), {
    sector: 'healthcare', subsector: 'physiotherapy',
    matches: [{sector: 'healthcare', subsector: 'physiotherapy', osmTag: 'healthcare=physiotherapist'}],
  })
  assert.equal(classifyBusiness({craft: 'plumber'}).subsector, 'plumber')
  assert.equal(classifyBusiness({office: 'estate_agent'}).sector, 'real-estate')
})

test('conserva múltiples matches pero elige una clasificación canónica', () => {
  const result = classifyBusiness({shop: 'optician', healthcare: 'doctor'})
  assert.equal(result.sector, 'healthcare')
  assert.equal(result.subsector, 'optician')
  assert.deepEqual(new Set(result.matches.map((match) => match.subsector)), new Set(['medical-clinic', 'optician']))
})

test('un shop no mapeado es retail/specialty-shop y un caso ambiguo other/unknown', () => {
  assert.equal(classifyBusiness({shop: 'model_train'}).subsector, 'specialty-shop')
  assert.deepEqual(classifyBusiness({amenity: 'bench'}), {sector: 'other', subsector: 'unknown', matches: []})
})
