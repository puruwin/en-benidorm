import assert from 'node:assert/strict'
import test from 'node:test'
import {indexableSeoIssues} from '../../sanity/lib/seo-rules'
import {restaurantJsonLd} from '../../src/lib/jsonld'
import {breadcrumbTrail} from '../../src/lib/routes'
import {assertBreadcrumbs, resolveSeo} from '../../src/lib/seo'
import type {BusinessDetail} from '../../src/types/content'

const text = (length: number) => 'a'.repeat(length)
const site = new URL('https://enbenidorm.es')

test('una página noindex no exige título ni description', () => {
  assert.deepEqual(indexableSeoIssues({noIndex: true}), [])
})

test('una página indexable exige título y description de 70 a 155 caracteres', () => {
  assert.equal(indexableSeoIssues(undefined).length, 2)
  assert.equal(indexableSeoIssues({metaTitle: '   ', metaDescription: text(100)}).length, 1)
  assert.equal(indexableSeoIssues({metaTitle: 'Título', metaDescription: text(69)}).length, 1)
  assert.deepEqual(indexableSeoIssues({metaTitle: 'Título', metaDescription: text(70)}), [])
  assert.deepEqual(indexableSeoIssues({metaTitle: 'Título', metaDescription: text(155), noIndex: false}), [])
  assert.equal(indexableSeoIssues({metaTitle: 'Título', metaDescription: text(156)}).length, 1)
  assert.equal(indexableSeoIssues({metaTitle: text(61), metaDescription: text(100)}).length, 1)
})

test('resolveSeo hace fallar una página indexable sin title, description o canonical', () => {
  assert.throws(() => resolveSeo({description: 'D'}, {title: 'R', description: 'R'}, site, '/x/'), /\/x\/: página indexable sin title/)
  assert.throws(() => resolveSeo({title: 'T', description: ' '}, undefined, site, '/x/'), /sin description/)
  assert.throws(() => resolveSeo({title: 'T', description: 'D'}, undefined, undefined, '/x/'), /sin canonical/)
  assert.deepEqual(resolveSeo({title: 'T', description: 'D'}, {title: 'R', description: 'R'}, site, '/x/'), {title: 'T', description: 'D'})
})

test('resolveSeo solo usa el respaldo en páginas noindex', () => {
  assert.deepEqual(resolveSeo({noIndex: true}, {title: 'R', description: 'RD'}, site, '/x/'), {noIndex: true, title: 'R', description: 'RD'})
  assert.deepEqual(resolveSeo({noIndex: true, title: 'T'}, {title: 'R', description: 'RD'}, site, '/x/'), {noIndex: true, title: 'T', description: 'RD'})
})

test('las migas salen del registro: el hub solo se enlaza si existe', () => {
  assert.deepEqual(breadcrumbTrail('dining', 'Bar X', new Set(['/', '/donde-comer/'])), [
    {label: 'Inicio', href: '/'}, {label: 'Dónde comer', href: '/donde-comer/'}, {label: 'Bar X'},
  ])
  assert.deepEqual(breadcrumbTrail('beaches', 'Levante', new Set(['/'])), [{label: 'Inicio', href: '/'}, {label: 'Playas'}, {label: 'Levante'}])
  assert.deepEqual(breadcrumbTrail(null, 'Dónde comer', new Set(['/'])), [{label: 'Inicio', href: '/'}, {label: 'Dónde comer'}])
})

test('assertBreadcrumbs exige migas hasta la página actual salvo en el inicio', () => {
  assert.doesNotThrow(() => assertBreadcrumbs([], '/'))
  assert.throws(() => assertBreadcrumbs([{label: 'Inicio', href: '/'}], '/x/'))
  assert.throws(() => assertBreadcrumbs([{label: 'Inicio', href: '/'}, {label: 'X', href: '/x/'}], '/x/'))
  assert.doesNotThrow(() => assertBreadcrumbs([{label: 'Inicio', href: '/'}, {label: 'X'}], '/x/'))
})

test('restaurantJsonLd solo emite campos con valor y nunca valoraciones', () => {
  const business: BusinessDetail = {
    name: 'Bar X', slug: 'bar-x', href: '/restaurantes/bar-x/', kind: 'restaurant', shortDescription: '', categories: [], description: [],
    address: {street: 'Calle Mayor 1', postalCode: '', locality: 'Benidorm', province: '', country: ''},
    hours: [], features: [], images: [], sources: [], seo: {},
  }
  const data = restaurantJsonLd(business, site)
  assert.deepEqual(data, {
    '@context': 'https://schema.org', '@type': 'Restaurant', name: 'Bar X', url: 'https://enbenidorm.es/restaurantes/bar-x/',
    address: {'@type': 'PostalAddress', streetAddress: 'Calle Mayor 1', addressLocality: 'Benidorm'},
  })
  assert.doesNotMatch(JSON.stringify(data), /aggregateRating|review/i)
  const empty = restaurantJsonLd({...business, address: {street: '', postalCode: '', locality: '', province: '', country: ''}}, site)
  assert.equal('address' in empty, false)
})
