# Content Lab P3A.1b: estabilización de Business Discovery

## Arquitectura de ejecución

El catálogo y la identidad no cambian: `content/manifest.json` es canónico y los snapshots
normalizados siguen en `content/discovered/`. P3A.1b añade una capa de ejecución alrededor del
mismo `SourceAdapter`/`SourceRecord`; no crea un catálogo paralelo.

Una consulta live se divide en unidades `(type, primitive, bbox)`. Por defecto se consulta una
zona, cada tipo por separado y las primitivas `node`, `way` y `relation`. `--tile-grid=2` o mayor
subdivide además el bbox cuando una zona densa lo justifica. El máximo es 4×4 para evitar una
fragmentación accidental excesiva.

Parámetros operativos:

- `--concurrency=1..4`, por defecto 2;
- `--timeout-ms=1000..60000`, por defecto 20000;
- `--max-attempts=1..10`, por defecto al menos 3 y una rotación completa de endpoints;
- `--backoff-ms`, base del backoff exponencial, con máximo interno de 30 segundos;
- `Retry-After` prevalece sobre el backoff cuando el servidor lo envía.

Los endpoints configurados son `lz4.overpass-api.de`, `z.overpass-api.de`,
`overpass.kumi.systems` y `overpass-api.de`; `OVERPASS_API_URL` puede anteponer otro endpoint.
Cada unidad guarda la consulta Overpass exacta, bbox, endpoint, tiempo, código HTTP, outcome y
reintentos.

## Estados, checkpoints y atomicidad

Cada run se escribe en `content/reports/discovery-runs/<timestamp>.json` con uno de estos estados:

- `success`: todas las unidades terminaron y existe al menos un resultado;
- `partial`: alguna unidad terminó y otra falló; solo se incorporan resultados completos;
- `failed`: ninguna unidad terminó;
- `anomalous-empty`: todas terminaron sin resultados, o una fuente legacy devolvió cero contra
  un catálogo existente.

`failed` y `anomalous-empty` nunca actualizan el catálogo. Un `partial` es incremental: conserva
los registros de unidades completas y no infiere ausencias en las fallidas.

Los checkpoints viven en `content/discovery/checkpoints/`, separados por versión de query,
geografía, categorías/tipos y tiles. Se escriben atómicamente después de cada unidad exitosa,
incluidas las respuestas vacías válidas. `--resume` reutiliza únicamente esas unidades; las
fallidas se vuelven a consultar. Sin `--resume` se inicia una observación nueva.

## Extractos OSM locales

`--osm-extract=<ruta>` acepta JSON Overpass previamente descargado con `elements[]`. No existe
descarga automática. El adapter aplica la misma clasificación, normalización, filtro geográfico,
deduplicación e identidad que la API live.

Opcionalmente se registran `--extract-source-url` y `--extract-downloaded-at`. Cada source conserva:

- provider e identificador OSM;
- URL del objeto;
- fecha de recuperación;
- `© OpenStreetMap contributors`;
- URL de licencia;
- dataset `local-osm-extract`, nombre de archivo, URL de origen y fecha de descarga.

## Identidad y posibles duplicados

Los aliases exactos del mismo proveedor conservan `businessId`. Dos proveedores distintos ya no
se fusionan automáticamente aunque coincidan nombre y coordenadas. Se genera en su lugar un
`ProbableDuplicate` cuando hay al menos dos señales compatibles:

- similitud de nombre;
- distancia máxima de 100 metros;
- teléfono normalizado exacto;
- dominio normalizado exacto.

Teléfono o dominio junto con nombre/proximidad producen confianza `strong`; nombre más proximidad,
`probable`. El reporte se limita a revisión: no altera IDs ni datos manuales.

## Piloto controlado — 15 de octubre de 2026

### Live Overpass

Comando:

```bash
npm run content:discover -- --area=Benidorm \
  --category=hosteleria,servicios --concurrency=2 \
  --max-attempts=2 --timeout-ms=10000 --backoff-ms=500 \
  --research-limit=25
```

Resultado `failed`, correctamente aislado del catálogo:

| Métrica | Resultado |
| --- | ---: |
| Unidades/consultas | 15 |
| Unidades completadas | 0 |
| Intentos | 30 |
| Reintentos | 15 |
| Errores HTTP 429/502 | 18 |
| Timeouts | 12 |
| Negocios recibidos/nuevos/existentes | 0 / 0 / 0 |
| Catálogo antes/después | 474 / 474 |

El límite explícito de dos intentos hizo que este piloto probara los dos primeros endpoints. El
run detallado conserva cada error; el cero no se interpreta como cobertura.

### Validación local real identificada

Ante el fallo live se usó `scripts/content/fixtures/discovery/benidorm-osm-sample.json`: una muestra
de tres elementos OSM reales ya presentes en el catálogo, capturada desde sus artefactos. No es
un censo, no contiene negocios simulados y no se presenta como descubrimiento nuevo.

| Métrica | Resultado |
| --- | ---: |
| Estado | success |
| Registros encontrados/únicos | 3 / 3 |
| Existentes/nuevos | 3 / 0 |
| Duplicados exactos/probables | 0 / 0 |
| Cobertura declarada | hospitality: 1/1 unidad, 3 registros |
| Catálogo final | 474 |

## Regresión de Comparison

`npm run comparison:regression` ejecuta, sobre los mismos datos actuales, el selector anterior a
P3A.1 (`enriched` solamente) y el selector Discovery (`enriched` más fallback `discovered`).

| Topic | Legacy | Discovery | Añadidos/eliminados/reordenados por código |
| --- | ---: | ---: | --- |
| italiano | 8 direct | 8 direct | 0 / 0 / no |
| arroces | 8 direct | 8 direct | 0 / 0 / no |
| desayunos | 6 direct + 25 potential | 6 direct + 25 potential | 0 / 0 / no |

No existe regresión causada por Selection o deduplicación: los 474 negocios ya tienen enrichment,
por lo que el fallback Discovery no añade candidatos.

Los artefactos persistidos antiguos sí difieren:

- italiano tenía 4 candidatos sobre 12 registros; los cuatro adicionales actuales fueron
  descubiertos/enriquecidos el 8 de octubre, después del artefacto del día 7;
- arroces tenía 7 sobre 202; `business-la-murada` también llegó con la ampliación de datos del día 8;
- desayunos tenía 32; `business-100-montaditos` ya no aporta evidence local de desayuno porque su
  web fue reclasificada como `official-brand`/`brand`, no por un cambio de Selection o de gates.

## Recomendación para P3A.2

Se puede iniciar P3A.2 sobre el contrato estable, pero el análisis debe consumir solo runs
`success` o las unidades completas de `partial`. Antes de automatizar cobertura amplia conviene
operar con extractos OSM regionales descargados explícitamente y versionados fuera del repositorio,
mantener Overpass como refresco incremental, y añadir una cola de revisión humana para
`ProbableDuplicate`.
