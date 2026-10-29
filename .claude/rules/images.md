---
paths:
  - "scripts/images/**"
  - "content/images/**"
  - "sanity/schemaTypes/objects/imageWithAlt.ts"
  - "src/lib/image-credit.ts"
  - "src/components/media/**"
  - "src/components/ImageGallery.astro"
  - "src/components/Hero.astro"
---

# Imágenes (#23)

Cada imagen tiene origen y licencia trazables. Ninguna imagen de stock se presenta como propia ni
como foto de un establecimiento concreto.

## Flujo

1. **Buscar** (solo si la issue lo pide): `npm run images:find -- --doc <tipo>:<slug>` o
   `--term "<término>"`. Deja `content/images/candidates/<slug>.json`.
   - Commons primero: geosearch (500 m) y categoría. `--category` es una categoría confirmada por
     David y cuenta como base de lugar; sin ella, la categoría propuesta solo da candidatas ambientales.
   - Pixabay y Pexels solo si Commons no deja ninguna válida, y siempre como `use: 'ambiental'`.
   - Unsplash está fuera: su API obliga al hotlinking y a notificar cada descarga.
   - En Content Lab: `POST /api/images/search` (`{doc|term, category?, radius?}`) lanza el run con un
     entorno de lista cerrada, sin token de Sanity.
2. **Aprobar**: David añade entradas a `approvals` (`candidateId`, `approvedBy`, `approvedAt`,
   `alt`, `caption?`, `placeVerified`, `field?`, `document?`). Fotos propias: aprobación en
   `content/images/own/<visita>.json` sobre una visita de `content/manual/visits/` (#14).
   Otras decisiones de David quedan en el mismo fichero, opcionales: `dismissals` (descarte con motivo;
   deshacerlo rellena `undoneAt`, no lo borra) y `withdrawn` (aprobación retirada antes de importar).
   Las reglas de aprobación están en una sola función, `validateStockApproval` (`scripts/images/lib/importer.ts`).
   En Content Lab, cada decisión es un clic de David: `POST /api/images/<slug>/validate|approve|dismiss|undismiss|withdraw`
   (una candidata por petición, sin endpoints en bloque). El servidor pone `approvedBy` (usuario de la sesión),
   `approvedAt` y `via: 'content-lab'` y rechaza un body que traiga `approvedBy`/`approvedAt`; sin actor, 409.
   Escribe con lock por fichero, relectura y escritura atómica, y responde 409 si un run de imágenes está
   escribiendo ese fichero. Solo se retira una aprobación no importada.
3. **Importar**: `npm run images:import -- <fichero>` simula. Con `--write` descarga, quita EXIF
   (sharp sin `withMetadata`), sube el asset y lo asigna **en el borrador** (`drafts.<id>`). Lo ejecuta David.
   - Nunca publica ni toca el documento publicado: publicar es de David en el Studio. Toda escritura de
     documentos pasa por `draftWriter` (`scripts/images/lib/draft-import.ts`), que rechaza ids sin `drafts.`.
   - Sin borrador, lo crea como copia del publicado; con borrador, `images` añade al final (se conservan los
     cambios abiertos) y un campo único (`image`, `heroImage`) que el borrador ya cambió es un error que se
     resuelve en el Studio. El patch exige la revisión del borrador leído.
   - Una imagen con el mismo `sourceUrl` ya presente en el publicado o el borrador se omite.
   - `--plan-out content/images/plans/<slug>.json` guarda el plan con su `planHash` (ignorado en git);
     `--expect-plan <hash>` aborta si el plan recalculado difiere; `--by` y `--run-id` quedan en `imports`
     junto a `mode: 'draft'` y `draftId`. Los `imports` sin `mode` son anteriores y fueron al publicado.
   - En Content Lab: `POST /api/images/<slug>/import/plan` simula y guarda el plan; `POST /api/images/<slug>/import`
     con `{planHash}` (tiene que coincidir con el plan guardado) lanza `--write --expect-plan --by <actor> --run-id`.
     Solo ese run recibe `SANITY_IMAGES_TOKEN` (Editor dedicado, plan Free); sin él, 409, y nunca usa
     `SANITY_API_TOKEN` como alternativa. Ver `deploy/content-lab/README.md`.

## Licencias

Lista cerrada en `src/lib/image-credit.ts` (`IMAGE_LICENSES`), que usan el esquema, el crédito y los
scripts: CC0, dominio público, CC BY y CC BY-SA (2.0–4.0), Pixabay Content License y Pexels License.

- Fuera **NC**: la web tiene uso comercial.
- Fuera **ND**: Sanity recorta con el hotspot, y recortar es una obra derivada.
- Fuera GFDL sin CC, «fair use» y cualquier fichero sin licencia o sin autor.

## Reglas

- **Origen obligatorio** (`propia` | `stock`). El crédito lo calcula `imageCredit()`: nunca se
  escribe a mano. El campo `credit` es obsoleto y solo existe para no perder datos antiguos.
- **Stock nunca en negocios.** Ni en la ficha ni en su tarjeta: solo fotos propias o ninguna.
  `business.images` lo valida en el Studio, `images:find`/`images:import` rechazan `business` y
  `seo:audit` da `image-stock-business`.
- **Lugar verificado.** Si el alt o el pie nombran un lugar, `placeVerified` tiene que ser `true`
  (categoría de Commons confirmada, coordenadas o comprobación de David). Si no, la imagen es
  ambiental y no nombra el lugar. Topónimos sin ficha: `scripts/seo/place-names.json`.
- **Alt propio.** Describe lo que se ve. No copia la descripción de la fuente.

## Lo que Claude no hace

- No escribe ni edita `approvals` ni los ficheros de `content/images/own/`: aprobar es de David.
- No propone un alt como si fuera de David. Si se lo pide, lo deja como sugerencia en el chat.
- No ejecuta `images:import --write` ni `images:find` salvo que la issue lo pida (ver `CLAUDE.md`).
- No mete stock en un negocio ni marca `placeVerified` para que el audit pase.
- Si una página necesita imagen y no la hay, se queda sin imagen. El aviso `image-no-own-photo`
  solo lo quita una foto propia.
