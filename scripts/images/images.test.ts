import assert from 'node:assert/strict'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import {createJsonCache} from './lib/cache'
import {distanceMeters, mergeCandidates, type CandidatesFile, type ImageCandidate} from './lib/candidates'
import {assertAllowedUrl, fetchBytes} from './lib/http'
import {executeImports, planOwnImports, planStockImports, type OwnPhotosFile, type TargetDocument} from './lib/importer'
import {commonsLicense} from './lib/licenses'
import {commonsCandidate} from './lib/providers'
import {searchCandidates} from './lib/search'
import {stripMetadata} from './lib/strip'
import type {SiteVisit} from '../content/lib/site-visits'

const LEVANTE = {lat: 38.5368, lng: -0.1215}
const NOW = new Date('2026-10-28T10:00:00Z')

function commonsPage(title: string, overrides: {license?: string; shortName?: string; artist?: string; mime?: string; coordinates?: {lat: number; lon: number}} = {}) {
  return {
    title,
    ...(overrides.coordinates ? {coordinates: [overrides.coordinates]} : {}),
    imageinfo: [{
      url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${encodeURIComponent(title.replace('File:', ''))}`,
      descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
      thumburl: 'https://upload.wikimedia.org/thumb.jpg',
      width: 4000, height: 3000,
      mime: overrides.mime ?? 'image/jpeg',
      extmetadata: {
        License: {value: overrides.license ?? 'cc-by-sa-4.0'},
        LicenseShortName: {value: overrides.shortName ?? 'CC BY-SA 4.0'},
        LicenseUrl: {value: 'https://creativecommons.org/licenses/by-sa/4.0'},
        Artist: {value: overrides.artist ?? '<a href="//commons.wikimedia.org/wiki/User:Ana" title="User:Ana">Ana</a>'},
        ImageDescription: {value: 'Playa de Levante desde el Mirador'},
        DateTimeOriginal: {value: '2019-07-14 12:00:00'},
      },
    }],
  }
}

test('licencias de Commons: admite CC BY-SA, CC0 y dominio público; descarta NC, ND, GFDL y sin licencia', () => {
  assert.deepEqual(commonsLicense({license: 'cc-by-sa-4.0', shortName: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0'}), {ok: true, license: {id: 'cc-by-sa-4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0'}})
  assert.deepEqual(commonsLicense({license: 'cc-by-sa-3.0-es', shortName: 'CC BY-SA 3.0 es', url: 'https://creativecommons.org/licenses/by-sa/3.0/es'}), {ok: true, license: {id: 'cc-by-sa-3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/es'}})
  assert.equal(commonsLicense({license: 'cc0'}).ok, true)
  assert.equal(commonsLicense({license: 'pd', shortName: 'Public domain'}).ok, true)
  assert.equal(commonsLicense({license: 'cc-by-nc-sa-4.0', shortName: 'CC BY-NC-SA 4.0'}).ok, false)
  assert.equal(commonsLicense({license: 'cc-by-nd-4.0', shortName: 'CC BY-ND 4.0'}).ok, false)
  assert.equal(commonsLicense({license: 'gfdl', shortName: 'GFDL'}).ok, false)
  assert.equal(commonsLicense({}).ok, false)
})

test('candidata de Commons: autor sin HTML, distancia y base de lugar por coordenadas', () => {
  const near = commonsCandidate(commonsPage('File:Levante.jpg', {coordinates: {lat: 38.5371, lon: -0.1210}}), {retrievedAt: NOW.toISOString(), center: LEVANTE, radius: 500, basis: 'coordinates'})
  assert.ok(!('reason' in near))
  assert.equal(near.author, 'Ana')
  assert.equal(near.authorUrl, 'https://commons.wikimedia.org/wiki/User:Ana')
  assert.equal(near.placeBasis, 'coordinates')
  assert.equal(near.use, 'lugar')
  assert.equal(near.takenAt, '2019-07-14')
  assert.ok((near.distanceMeters ?? 0) < 100)

  const far = commonsCandidate(commonsPage('File:Lejos.jpg', {coordinates: {lat: 38.60, lon: -0.10}}), {retrievedAt: NOW.toISOString(), center: LEVANTE, radius: 500, basis: 'coordinates'})
  assert.ok(!('reason' in far))
  assert.equal(far.use, 'ambiental')
  assert.match(far.warnings.join(' '), /No verifica el lugar/)

  assert.deepEqual(commonsCandidate(commonsPage('File:Mapa.svg', {mime: 'image/svg+xml'}), {retrievedAt: '', basis: null}), {id: 'commons:File:Mapa.svg', reason: 'formato no admitido: image/svg+xml'})
  assert.deepEqual(commonsCandidate(commonsPage('File:NC.jpg', {license: 'cc-by-nc-4.0', shortName: 'CC BY-NC 4.0'}), {retrievedAt: '', basis: null}), {id: 'commons:File:NC.jpg', reason: 'licencia no admitida (NC/ND): CC BY-NC 4.0'})
  assert.equal(distanceMeters(LEVANTE, LEVANTE), 0)
})

function fakeGetter(routes: Array<[RegExp, unknown]>, calls: string[]) {
  return async <T>(url: string): Promise<T> => {
    calls.push(url)
    assertAllowedUrl(url)
    const match = routes.find(([pattern]) => pattern.test(url))
    return (match ? match[1] : {}) as T
  }
}

test('búsqueda por documento: geosearch y categoría propuesta, sin stock si Commons da candidatas', async () => {
  const calls: string[] = []
  const getJson = fakeGetter([
    [/list=geosearch/, {query: {geosearch: [{title: 'File:Levante.jpg'}, {title: 'File:NC.jpg'}]}}],
    [/titles=/, {query: {pages: [commonsPage('File:Levante.jpg', {coordinates: {lat: 38.5371, lon: -0.1210}}), commonsPage('File:NC.jpg', {license: 'cc-by-nc-4.0', shortName: 'CC BY-NC 4.0'})]}}],
    [/list=search/, {query: {search: [{title: 'Category:Playa de Levante (Benidorm)'}]}}],
    [/generator=categorymembers/, {query: {pages: [commonsPage('File:Levante.jpg'), commonsPage('File:Cat.jpg')]}}],
  ], calls)
  const file = await searchCandidates({kind: 'document', type: 'beach', id: 'beach-levante', slug: 'playa-levante', name: 'Playa de Levante', coordinates: LEVANTE}, {}, {getJson, keys: {pixabay: 'k', pexels: 'k'}, now: () => NOW})

  assert.deepEqual(file.candidates.map((candidate) => [candidate.id, candidate.placeBasis]), [['commons:File:Levante.jpg', 'coordinates'], ['commons:File:Cat.jpg', null]])
  assert.match(file.candidates[1]!.warnings.join(' '), /Categoría propuesta automáticamente/)
  assert.deepEqual(file.rejected, [{id: 'commons:File:NC.jpg', reason: 'licencia no admitida (NC/ND): CC BY-NC 4.0'}])
  assert.equal(file.query.categorySuggested, true)
  assert.ok(calls.every((url) => url.startsWith('https://commons.wikimedia.org/')), 'no consulta Pixabay ni Pexels')
})

test('búsqueda con categoría confirmada: base commons-category', async () => {
  const getJson = fakeGetter([[/generator=categorymembers/, {query: {pages: [commonsPage('File:Cat.jpg')]}}]], [])
  const file = await searchCandidates({kind: 'document', type: 'place', id: 'p', slug: 'guadalest', name: 'Castell de Guadalest'}, {category: 'Category:Castell de Guadalest'}, {getJson, keys: {}, now: () => NOW})
  assert.equal(file.candidates[0]?.placeBasis, 'commons-category')
  assert.equal(file.candidates[0]?.use, 'lugar')
  assert.match(file.warnings.join(' '), /no tiene coordenadas/)
})

test('si Commons no da candidatas válidas, Pixabay y Pexels como ambientales; nunca Unsplash', async () => {
  const calls: string[] = []
  const getJson = fakeGetter([
    [/pixabay\.com\/api/, {hits: [{id: 1, pageURL: 'https://pixabay.com/photos/mar-1/', webformatURL: 'https://cdn.pixabay.com/w.jpg', largeImageURL: 'https://cdn.pixabay.com/l.jpg', user: 'Bea', user_id: 9, tags: 'mar, playa'}]}],
    [/api\.pexels\.com/, {photos: [{id: 2, url: 'https://www.pexels.com/photo/2/', photographer: 'Carlos', photographer_url: 'https://www.pexels.com/@carlos', alt: 'Olas', src: {original: 'https://images.pexels.com/2.jpg'}}]}],
  ], calls)
  const file = await searchCandidates({kind: 'term', term: 'mar al atardecer'}, {}, {getJson, keys: {pixabay: 'k', pexels: 'k'}, now: () => NOW})
  assert.deepEqual(file.candidates.map((candidate) => [candidate.id, candidate.use, candidate.license.id]), [['pexels:2', 'ambiental', 'pexels'], ['pixabay:1', 'ambiental', 'pixabay']])
  assert.ok(!calls.some((url) => url.includes('unsplash')))

  const withoutKeys = await searchCandidates({kind: 'term', term: 'mar'}, {}, {getJson: fakeGetter([], []), keys: {}, now: () => NOW})
  assert.deepEqual(withoutKeys.candidates, [])
  assert.match(withoutKeys.warnings.join(' '), /Falta PIXABAY_API_KEY.*Falta PEXELS_API_KEY/)
})

const candidate = (overrides: Partial<ImageCandidate> = {}): ImageCandidate => ({
  id: 'commons:File:Levante.jpg', provider: 'commons', title: 'Levante.jpg', thumbnailUrl: 'https://upload.wikimedia.org/t.jpg',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Levante.jpg', originalUrl: 'https://upload.wikimedia.org/a/Levante.jpg',
  author: 'Ana', license: {id: 'cc-by-sa-4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0'}, sourceDescription: 'Playa de Levante desde el Mirador',
  retrievedAt: NOW.toISOString(), use: 'lugar', placeBasis: 'coordinates', warnings: [], ...overrides,
})

const candidatesFile = (overrides: Partial<CandidatesFile> = {}): CandidatesFile => ({
  version: 1, target: {kind: 'document', type: 'beach', id: 'beach-levante', slug: 'playa-levante', name: 'Playa de Levante'},
  generatedAt: NOW.toISOString(), query: {}, warnings: [], candidates: [candidate(), candidate({id: 'pixabay:1', provider: 'pixabay', use: 'ambiental', placeBasis: null, sourceDescription: 'mar, playa'})],
  rejected: [], approvals: [], imports: [], ...overrides,
})

const approval = {candidateId: 'commons:File:Levante.jpg', approvedBy: 'David', approvedAt: '2026-10-28', alt: 'Arena y hamacas frente a los edificios altos', placeVerified: true}
const levante: TargetDocument = {type: 'beach', id: 'beach-levante', slug: 'playa-levante', name: 'Playa de Levante'}
const resolveDocument = async (type: string, slug: string) => (type === 'beach' && slug === 'playa-levante' ? levante : null)

test('mergeCandidates conserva aprobaciones, importaciones y candidatas aprobadas', () => {
  const previous = candidatesFile({approvals: [approval], imports: [{candidateId: approval.candidateId, documentId: 'beach-levante', field: 'images', assetId: 'image-1', importedAt: ''}]})
  const merged = mergeCandidates(previous, candidatesFile({candidates: []}))
  assert.deepEqual(merged.approvals, [approval])
  assert.equal(merged.imports.length, 1)
  assert.deepEqual(merged.candidates.map((item) => item.id), ['commons:File:Levante.jpg'])
})

test('plan de importación: crédito y metadatos completos desde la candidata aprobada', async () => {
  const plan = await planStockImports(candidatesFile({approvals: [approval]}), {places: [], resolveDocument})
  assert.deepEqual(plan.issues, [])
  assert.equal(plan.imports.length, 1)
  assert.deepEqual(plan.imports[0]?.value, {
    _type: 'imageWithAlt', alt: approval.alt, origin: 'stock', provider: 'commons', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Levante.jpg',
    author: 'Ana', license: {id: 'cc-by-sa-4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0'}, retrievedAt: NOW.toISOString(), placeVerified: true, approvedBy: 'David',
  })
  assert.equal(plan.imports[0]?.field, 'images')
  assert.equal(plan.imports[0]?.isArray, true)
})

test('importación: rechaza negocios, ambientales con lugar verificado, lugares sin verificar y alt copiado', async () => {
  const issues = async (overrides: Record<string, unknown>, file: Partial<CandidatesFile> = {}) =>
    (await planStockImports(candidatesFile({approvals: [{...approval, ...overrides}], ...file}), {places: ['Benidorm'], resolveDocument})).issues

  assert.match((await issues({document: {type: 'business', slug: 'casa-x'}})).join(), /negocio/)
  assert.match((await issues({candidateId: 'pixabay:1'})).join(), /ambiental/)
  assert.match((await issues({placeVerified: false, alt: 'Atardecer en la Playa de Levante'})).join(), /«Playa de Levante» con placeVerified = false/)
  assert.match((await issues({placeVerified: false, caption: 'Vista de Benidorm'})).join(), /«Benidorm»/)
  assert.match((await issues({alt: 'Playa de Levante desde el mirador'})).join(), /copia la descripción/)
  assert.match((await issues({field: 'seo'})).join(), /no es de imagen/)
  assert.match((await issues({}, {target: {kind: 'term', term: 'mar'}})).join(), /indica document/)
  assert.deepEqual(await issues({candidateId: 'pixabay:1', placeVerified: false, alt: 'Olas rompiendo en la orilla'}), [])

  const imported = await planStockImports(candidatesFile({approvals: [approval], imports: [{candidateId: approval.candidateId, documentId: 'beach-levante', field: 'images', assetId: 'a', importedAt: ''}]}), {places: [], resolveDocument})
  assert.equal(imported.imports.length, 0)
  assert.equal(imported.skipped.length, 1)
})

test('fotos propias: documento y fecha de la visita, alt de la aprobación de David', () => {
  const visit = {kind: 'site-visit', observedAt: '2026-10-20', observer: 'David', sourceType: 'first-party-observation', text: 'Nota.', checks: [],
    place: {type: 'beach', name: 'Playa de Levante', municipality: 'Benidorm', documentId: 'beach-levante'}, photos: ['visits/fotos/2026-10-20-levante-1.jpg']} as unknown as SiteVisit
  const own: OwnPhotosFile = {visit: 'visits/2026-10-20-levante.json', imports: [], approvals: [
    {photo: 'visits/fotos/2026-10-20-levante-1.jpg', approvedBy: 'David', approvedAt: '2026-10-21', alt: 'Rampa de madera hacia la arena', caption: 'Acceso junto al puesto de socorro', placeVerified: true},
    {photo: 'visits/fotos/otra.jpg', approvedBy: 'David', approvedAt: '2026-10-21', alt: 'x', placeVerified: true},
  ]}
  const plan = planOwnImports(own, visit, {places: [], slug: 'playa-levante'})
  assert.deepEqual(plan.issues, ['foto visits/fotos/otra.jpg: no está en photos de la visita.'])
  assert.deepEqual(plan.imports[0]?.value, {_type: 'imageWithAlt', alt: 'Rampa de madera hacia la arena', caption: 'Acceso junto al puesto de socorro', origin: 'propia', takenAt: '2026-10-20', placeVerified: true, approvedBy: 'David'})
  assert.deepEqual(plan.imports[0]?.source, {kind: 'file', path: 'visits/fotos/2026-10-20-levante-1.jpg'})
})

test('executeImports quita EXIF antes de subir y asigna el asset con su procedencia', async () => {
  const plan = (await planStockImports(candidatesFile({approvals: [approval]}), {places: [], resolveDocument})).imports
  const steps: string[] = []
  const patched: unknown[] = []
  const done = await executeImports(plan, {
    read: async () => { steps.push('read'); return Buffer.from('original') },
    strip: async () => { steps.push('strip'); return {bytes: Buffer.from('limpia')} },
    upload: async (bytes) => { steps.push(`upload ${bytes.toString()}`); return 'image-abc' },
    patch: async (_plan, value) => { steps.push('patch'); patched.push(value) },
    now: () => NOW,
  })
  assert.deepEqual(steps, ['read', 'strip', 'upload limpia', 'patch'])
  assert.deepEqual((patched[0] as {asset: unknown}).asset, {_type: 'reference', _ref: 'image-abc'})
  assert.equal(typeof (patched[0] as {_key?: string})._key, 'string')
  assert.equal(done[0]?.assetId, 'image-abc')
})

test('stripMetadata elimina EXIF y GPS', async () => {
  const withGps = await sharp({create: {width: 16, height: 16, channels: 3, background: '#3a8'}})
    .jpeg()
    .withExif({IFD0: {Copyright: 'David', Artist: 'David'}, IFD3: {GPSLatitudeRef: 'N', GPSLatitude: '38/1 32/1 0/1'}})
    .toBuffer()
  assert.ok((await sharp(withGps).metadata()).exif, 'el fixture lleva EXIF')
  const {bytes, format} = await stripMetadata(withGps)
  const metadata = await sharp(bytes).metadata()
  assert.equal(format, 'jpeg')
  assert.equal(metadata.exif, undefined)
  assert.equal(metadata.xmp, undefined)
})

test('http: solo hosts de los proveedores y redirects dentro de la lista', async () => {
  assert.throws(() => assertAllowedUrl('https://api.unsplash.com/photos'), /Host no permitido/)
  assert.throws(() => assertAllowedUrl('http://commons.wikimedia.org/'), /Solo https/)
  const redirecting = async () => new Response(null, {status: 302, headers: {location: 'https://169.254.169.254/latest'}})
  await assert.rejects(fetchBytes('https://upload.wikimedia.org/a.jpg', {}, redirecting), /Host no permitido/)
  const big = async () => new Response('x'.repeat(20), {status: 200, headers: {'content-length': '20'}})
  await assert.rejects(fetchBytes('https://upload.wikimedia.org/a.jpg', {maxBytes: 10}, big), /supera/)
})

test('la caché caduca a las 24 h', async () => {
  let now = 0
  const cache = createJsonCache(await mkdtemp(join(tmpdir(), 'images-cache-')), () => now)
  await cache.set('https://pixabay.com/api/?key=secreto', {hits: []})
  assert.deepEqual(await cache.get('https://pixabay.com/api/?key=secreto'), {hits: []})
  now = 24 * 60 * 60 * 1000
  assert.equal(await cache.get('https://pixabay.com/api/?key=secreto'), undefined)
})
