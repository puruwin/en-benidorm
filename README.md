# enBenidorm

Guía local y turística SEO-first sobre Benidorm. El frontend está construido con Astro y Tailwind CSS; Sanity funciona como CMS desacoplado. La salida pública es estática y las páginas editoriales no envían JavaScript al navegador.

## Requisitos

- Node.js 22.12 o posterior
- npm
- Un proyecto de Sanity para trabajar con contenido real

## Primer arranque

```bash
npm install
cp .env.example .env
npm run dev
```

El proyecto arranca en modo `demo` de forma predeterminada. Los negocios y guías ficticios se identifican tanto en sus nombres como mediante una franja visible en todas las páginas.

Scripts principales:

```bash
npm run dev                    # frontend Astro
npm run build                  # build estático en dist/
npm run check                  # TypeScript y diagnósticos Astro
npm run studio                 # Sanity Studio local
npm run studio:build           # build del Studio en sanity-dist/
npm run content:seed           # crea la configuración y taxonomía inicial
npm run content:discover       # descubre entidades mediante adapters
npm run content:enrich         # produce facts trazables, sin texto editorial
npm run content:generate       # genera sólo campos editoriales en staging
npm run content:qa             # valida y promociona candidatos aprobados
npm run content:validate       # valida seed y JSON generado sin conectar a Sanity
npm run content:import         # valida e importa los JSON como borradores
npm run sanity:schema:validate # valida todos los schemas
npm run typegen                # extrae schema y genera tipos GROQ
```

## Configurar Sanity

1. Crea un proyecto en [sanity.io/manage](https://sanity.io/manage) y anota el `projectId`.
2. Copia `.env.example` como `.env`.
3. Completa las variables:

```dotenv
CONTENT_SOURCE=sanity
PUBLIC_SITE_URL=https://enbenidorm.es
PUBLIC_SANITY_PROJECT_ID=tu_project_id
PUBLIC_SANITY_DATASET=production
SANITY_STUDIO_PROJECT_ID=tu_project_id
SANITY_STUDIO_DATASET=production

# Exclusivas de servidor para seed e importación
SANITY_PROJECT_ID=tu_project_id
SANITY_DATASET=production
SANITY_API_TOKEN=tu_token_de_escritura

# Exclusivas del proceso server-side de generación
OPENAI_API_KEY=tu_openai_api_key
OPENAI_CONTENT_MODEL=gpt-5-mini
```

`SANITY_API_TOKEN` necesita permiso de escritura sobre el dataset. Es una credencial exclusivamente server-side: no debe llevar el prefijo `PUBLIC_`, importarse desde componentes o incluirse en un despliegue cliente. `.env` está ignorado por Git.

4. Ejecuta `npm run content:seed` para crear la portada, los ajustes, las zonas, las categorías y el autor iniciales.
5. Ejecuta `npm run studio` y abre la URL local que muestra la terminal, normalmente `http://localhost:3333`.
6. Ejecuta `npm run content:validate`, `npm run check` y `npm run build`.

El Studio está separado del frontend. Sanity usa React internamente, pero Astro no carga React ni el Studio en las páginas públicas. Para alojar el Studio en la infraestructura de Sanity se puede ejecutar `npm run studio:deploy` después de configurar el proyecto.

En producción, configura un webhook de Sanity que lance un nuevo despliegue cuando se publique contenido. `@sanity/astro` consulta el dataset durante el build con `useCdn: false` para evitar contenido obsoleto.

## Pipeline de contenido

La pipeline masiva se ejecuta por fases y, en esta etapa, sólo genera documentos `Business`:

```text
discovery → enrichment → generation → QA → content/generated → importación como draft
```

Ninguna de las cuatro primeras fases se conecta a Sanity. `content:generate` escribe candidatos en `content/generated/.staging/businesses/`; sólo `content:qa` copia los que no tienen ningún `FAIL` a `content/generated/businesses/`. La publicación nunca es automática: después siguen siendo obligatorios `content:import`, la revisión manual en Sanity Studio y la publicación manual.

Directorios y estado persistente:

```text
content/discovered/                  respuesta normalizada del adapter
content/enriched/                    modelo intermedio facts/editorial
content/generated/.staging/         candidatos aún no importables
content/generated/businesses/       documentos aprobados por QA
content/reports/                     un informe JSON por fase
content/manifest.json                estado y fechas por entidad
```

Cada entrada del manifest mantiene ID, tipo, slug, prioridad, fuentes y los estados `discovered`, `enriched`, `generated`, `validated`, `imported`, `reviewed`, `published` o `error`. También conserva fechas de cada transición. Una ejecución normal no recalcula fases completadas; `--force` recalcula la fase elegida e invalida sus fases posteriores. La importación real marca `importedAt`, pero una importación `--dry-run` no modifica el manifest.

Todos los comandos nuevos aceptan los mismos filtros:

```bash
npm run content:discover -- --type=restaurant --limit=50
npm run content:enrich -- --limit=50
npm run content:generate -- --id=business-restaurante-x
npm run content:qa -- --type=cafe --limit=10
```

- `--type`: `restaurant`, `bar`, `cafe`, `hotel`, `attraction` o `shop`; se aceptan también varios alias plurales.
- `--limit`: limita las entidades de esa ejecución.
- `--id`: procesa un ID determinista concreto.
- `--force`: vuelve a ejecutar la fase aunque ya conste como completada.
- `--dry-run`: ejecuta lectura, transformación y comprobaciones sin escribir artefactos, informes ni manifest. En generation sí realiza la llamada al proveedor de IA, por lo que puede consumir cuota.

Los resúmenes legibles aparecen en consola. Las ejecuciones no dry-run actualizan `content/reports/discovery.json`, `enrichment.json`, `generation.json` y `qa.json`.

### Discovery y fuentes

`SourceAdapter` desacopla la pipeline del proveedor. `OpenStreetMapAdapter` consulta por separado nodos, vías y relaciones de Overpass sobre el bounding box de control y filtra después sus centros contra el polígono oficial que Nominatim devuelve para la relación administrativa de Benidorm (`341148`). Esta estrategia evita las consultas `nwr(area)` costosas sin admitir resultados de municipios vecinos. Localiza restaurantes, bares/pubs, cafeterías, hoteles, atracciones y tiendas con nombre. `ManualJsonAdapter` permite añadir lotes revisados con el mismo contrato.

Durante enrichment, `OfficialWebsiteAdapter` sólo se ejecuta si OSM aporta un website. Sigue un máximo de cinco páginas públicas del mismo dominio, prioriza carta, reservas, contacto y páginas descriptivas, y extrae facts verificables desde JSON-LD y señales explícitas del HTML. No guarda el texto para publicarlo: conserva valores estructurados y provenance por página. Un fallo HTTP deja los facts correspondientes en `null` y se registra como aviso; no se sustituye por una inferencia.

Cada registro conserva proveedor, identificador, URL original, fecha de consulta, atribución y URL de licencia. No se extraen ni copian fichas de Google Maps. Las atracciones se descubren y enriquecen, pero no se convierten artificialmente en `Business`: quedan preparadas para una futura pipeline `Place`.

Los datos de OpenStreetMap se distribuyen bajo ODbL. Antes de publicar datos derivados hay que mostrar la atribución `© OpenStreetMap contributors` de forma razonablemente visible y revisar las obligaciones aplicables en [OpenStreetMap Copyright and License](https://www.openstreetmap.org/copyright) y [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Para cualquier adapter futuro hay que guardar su atribución/licencia en cada fuente y cumplir las condiciones del proveedor; una URL accesible no equivale por sí sola a permiso de reutilización.

### Enrichment y generación

El artefacto enriquecido separa explícitamente `facts` de `editorial`. Cada fact presente contiene las claves de sus fuentes; un valor ausente queda como `null` y con una lista de fuentes vacía. `factsBySource.openStreetMap` y `factsBySource.officialWebsite` conservan ambos conjuntos de evidencia de forma independiente, mientras `facts` expone la vista integrada. No se infieren direcciones, horarios ni otros datos faltantes. `opening_hours` de OSM se conserva como fact crudo, pero no se importa como horario de Sanity mientras no exista un parser verificable para ese formato.

La generación usa un `AIProvider` intercambiable. `OpenAIResponsesProvider` llama a Responses API con [Structured Outputs y JSON Schema](https://developers.openai.com/api/docs/guides/structured-outputs). El modelo y el cliente están centralizados en `scripts/content/lib/ai.ts`; `OPENAI_API_KEY` sólo se lee desde el script de Node y nunca se expone con prefijo `PUBLIC_`. La IA recibe únicamente facts, fuentes, taxonomía válida, contrato del documento e instrucciones editoriales. Su schema de salida sólo admite:

- `contentQuality`: `sufficient` o `insufficient`
- `shortDescription`
- `whatIsIt`
- `whatToExpect`
- `whyGo`
- `goodFor`
- `highlights`
- `seo.metaTitle`
- `seo.metaDescription`

Cuando faltan facts específicos, el modelo debe devolver `insufficient`, textos/SEO nulos y arrays vacíos; no se genera relleno. Las secciones suficientes se transforman después a Portable Text. Nombre, dirección, teléfono, web, coordenadas y tipo de negocio se incorporan mediante código determinista desde los facts.

### QA

QA reutiliza la validación del importador y añade controles de procedencia, integridad facts/documento, completitud, duplicados de entidad, coordenadas, enums, referencias, similitud léxica y semántica aproximada dentro del lote, y duplicados exactos de títulos y meta descriptions. `GENERIC_EDITORIAL_CONTENT`, `LOW_INFORMATION_DENSITY` e `INSUFFICIENT_FACTS` impiden que una ficha factual pero genérica pase. El resultado por documento es `PASS`, `WARNING` o `FAIL`. Un `WARNING` permite la promoción para revisión humana; cualquier `FAIL` impide que el candidato quede en la carpeta importable.

`scripts/content/comparison-report.ts` genera un JSON y un Markdown before/after con facts por fuente, textos y QA en `content/reports/business-before-after.*`.

Para ejecutar la cadena sobre una muestra:

```bash
npm run content:discover -- --type=restaurant --limit=5
npm run content:enrich -- --type=restaurant --limit=5
npm run content:generate -- --type=restaurant --limit=5
npm run content:qa -- --type=restaurant --limit=5
npm run content:validate
npm run content:import -- --dry-run
```

Los tests unitarios cubren normalización, IDs, slugs, deduplicación, transiciones del manifest, procedencia, schema de generación y QA:

```bash
npm test
```

## Seed e importación de contenido

El contenido inicial vive en `content/seed/`. Todos sus IDs son deterministas (`site-settings`, `homepage`, `area-levante`, `category-arroces`, etc.), por lo que se puede repetir el seed sin duplicar documentos:

```bash
npm run content:seed
```

La estrategia de escritura es deliberadamente distinta según la propiedad editorial:

- `site-settings` y `homepage` usan `createOrReplace`: el repositorio es la fuente de verdad y cada seed vuelve a sincronizarlos.
- Zonas, categorías y autores usan `createIfNotExists`: el seed crea el catálogo inicial, pero no pisa cambios posteriores hechos en Studio.
- Los documentos de `content/generated/` usan `createOrReplace` sobre `drafts.<id>`. Una importación nunca publica automáticamente contenido editorial ni reemplaza directamente su versión publicada.

El importador recorre un archivo JSON por documento en:

```text
content/generated/businesses/
content/generated/places/
content/generated/beaches/
content/generated/events/
content/generated/articles/
```

Cada carpeta obliga al `_type` correspondiente. Un ejemplo mínimo de negocio es:

```json
{
  "_id": "business-restaurante-x",
  "_type": "business",
  "name": "Restaurante X",
  "slug": {"_type": "slug", "current": "restaurante-x"},
  "businessKind": "restaurant",
  "shortDescription": "Descripción breve pendiente de revisión editorial.",
  "area": {"_type": "reference", "_ref": "area-levante"},
  "categories": [
    {"_type": "reference", "_ref": "category-arroces"}
  ],
  "language": "es"
}
```

Los IDs de documentos con slug siguen `<tipo>-<slug>`. Las referencias siempre usan el ID base, nunca el prefijo `drafts.`. El normalizador añade `_key` deterministas a objetos dentro de arrays cuando el JSON no los trae.

Para comprobar todos los archivos sin acceder ni escribir en Sanity:

```bash
npm run content:validate
npm run content:import -- --dry-run
```

La validación comprueba antes de cualquier escritura `_id`, `_type`, slug, campos obligatorios, enumeraciones, duplicados, formato de valores y referencias. La importación real verifica además que las referencias externas existen en Sanity. Si encuentra un error, cancela antes de mutar el dataset y muestra el archivo y campo afectados.

Para importar los JSON validados como borradores:

```bash
npm run content:import
```

Al finalizar muestra el número de negocios, lugares, playas, eventos y artículos procesados. Volver a ejecutar el comando actualiza el mismo borrador determinista, sin crear duplicados. La revisión y publicación se hacen después desde Studio.

## Arquitectura

```text
sanity/schemaTypes/   schemas de documentos y objetos compartidos
sanity/structure.ts   navegación editorial y singletons del Studio
src/components/       componentes Astro reutilizables
src/data/demo/        fixtures locales explícitamente DEMO
src/layouts/          shell HTML, SEO y layouts de contenido
src/lib/sanity/       GROQ centralizado y utilidades de imágenes
src/lib/              rutas, JSON-LD y selección de fuente de contenido
src/pages/            rutas estáticas de Astro
src/styles/           estilos globales y tokens de Tailwind
src/types/            view models y tipos generados por Sanity
```

`src/lib/content-source.ts` es la única frontera entre las páginas y la fuente de datos. En modo DEMO devuelve fixtures locales; en modo Sanity ejecuta las consultas centralizadas de `src/lib/sanity/queries.ts`. Los componentes reciben datos tipados y no contienen contenido editorial hardcodeado.

## Modelo de contenido

Documentos principales:

- `Article`: guías y contenido editorial, con referencias a otras entidades.
- `Business`: restaurantes, bares, hoteles, tiendas y servicios.
- `Place`: miradores, parques, monumentos, rutas y puntos de interés.
- `Beach`: información específica de playas y calas.
- `Event`: fechas, estado, recinto y entradas.
- `Category`: taxonomía reutilizable por grupos.
- `Area`: zonas de Benidorm.
- `Author`: autoría y biografía.
- `HomePage` y `SiteSettings`: singletons para portada y configuración global.

Los objetos `seo`, `source`, `imageWithAlt`, `address`, `openingHours` y los bloques editoriales se comparten entre documentos. Las guías guardan referencias a negocios y lugares, nunca copias de sus datos.

Todos los documentos incorporan un idioma base `es`. Las consultas ya filtran por idioma y la resolución de URLs está centralizada en `src/lib/routes.ts`, preparando una futura estructura inglesa sin añadir `/es/` a las rutas actuales.

## Añadir un tipo de contenido

1. Crea el schema en `sanity/schemaTypes/documents/` u `objects/` con `defineType` y `defineField`.
2. Expórtalo en `sanity/schemaTypes/index.ts`.
3. Añade su consulta o proyección a `src/lib/sanity/queries.ts`; no escribas GROQ dentro de páginas o componentes.
4. Añade o ajusta el view model correspondiente en `src/types/content.ts`.
5. Si genera una URL, incorpora el resolver en `src/lib/routes.ts` y usa `getStaticPaths()`.
6. Ejecuta:

```bash
npm run sanity:schema:validate
npm run typegen
npm run check
npm run build
```

No deben generarse páginas de categorías sin introducción editorial o con menos de tres entidades publicadas. El umbral está centralizado en `MIN_INDEXABLE_CATEGORY_ITEMS`.

## Imágenes y rendimiento

- Los recursos locales usan `Image` de `astro:assets`.
- Las imágenes editoriales usan `@sanity/image-url`, respetan crop/hotspot y se sirven desde el CDN de Sanity con `srcset` responsivo.
- La imagen principal usa prioridad alta; el resto se carga de forma diferida.
- Las dimensiones se conservan para evitar layout shift.
- No hay islands ni scripts de cliente en las páginas implementadas.

La imagen panorámica del modo DEMO fue generada específicamente para este proyecto. No debe interpretarse como documentación fotográfica exacta ni reutilizarse como fuente factual.

## SEO

`BaseLayout.astro` centraliza canonical, title, description, robots, Open Graph y Twitter Cards. `@astrojs/sitemap` genera el sitemap durante el build y `public/robots.txt` apunta al índice. Los breadcrumbs visuales y `BreadcrumbList` comparten los mismos datos. La ficha de restaurante produce `Restaurant` JSON-LD únicamente con información visible.
