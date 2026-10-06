import assert from 'node:assert/strict'
import test from 'node:test'
import type {ContentDocument} from '../../content-validation'
import {prepareDraftDocument} from './import-drafts'

test('draft import debilita temporalmente referencias a targets aún no publicados', () => {
  const document: ContentDocument = {
    _id: 'comparison-italiano',
    _type: 'comparison',
    author: {_type: 'reference', _ref: 'author-david'},
    entries: [
      {_type: 'comparisonEntry', business: {_type: 'reference', _ref: 'business-cucina-italiana'}},
      {_type: 'comparisonEntry', business: {_type: 'reference', _ref: 'business-publicado'}},
    ],
  }
  const draft = prepareDraftDocument(document, new Map([['business-cucina-italiana', 'business']]))
  assert.equal(draft._id, 'drafts.comparison-italiano')
  const entries = draft.entries as Array<{business: Record<string, unknown>}>
  assert.deepEqual(entries[0]!.business, {
    _type: 'reference', _ref: 'business-cucina-italiana', _weak: true,
    _strengthenOnPublish: {type: 'business'},
  })
  assert.deepEqual(entries[1]!.business, {_type: 'reference', _ref: 'business-publicado'})
  assert.deepEqual(draft.author, {_type: 'reference', _ref: 'author-david'})
  assert.equal(document._id, 'comparison-italiano')
})
