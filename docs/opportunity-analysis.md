# P3A.2 — Opportunity Analysis

Opportunity Analysis es un consumidor de solo lectura del catálogo canónico `content/manifest.json`, los snapshots `content/discovered`, los facts `content/enriched`, los artefactos de Comparison y los reportes de duplicados probables de Discovery. No importa código de Selection ni del gate editorial y no modifica ninguno de esos artefactos.

## Flujo y persistencia

`npm run opportunities:analyze -- [opciones]` selecciona negocios de forma determinista, alternando las categorías solicitadas y ordenando por `businessId`. La selección no usa señales ni apariencia de oportunidad. Cada resultado se guarda en `content/opportunities/<businessId>.json`; el resumen de la ejecución queda en `content/reports/opportunities/latest.json`.

Opciones:

- `--business=<id>`: analiza una identidad concreta.
- `--area=<slug>`: filtra por scopes de Discovery o localidad verificada.
- `--category=hospitality,professional-services,retail`: filtra categorías.
- `--limit=<n>`: limita la muestra, no el catálogo.
- `--force`: recalcula aunque no hayan cambiado las entradas.

El `inputFingerprint` cubre la entrada del manifest, snapshots factual/discovered, evaluación operativa de Comparison y duplicados probables. Si no cambia, se reutiliza el artefacto anterior. El proceso nunca guarda lifecycle en el manifest.

## Separación semántica

Cada análisis conserva cuatro niveles distintos:

1. `signals`: observaciones comprobables, con `sourceKeys` y fecha.
2. `hypotheses`: interpretaciones cautas vinculadas mediante `basedOnSignalIds`.
3. `limitations`: lo que la evidencia no permite concluir.
4. `suggestedActions`: acciones internas; nunca contacto automático ni propuesta económica.

Un conflicto de identidad, duplicado probable o estado operativo desconocido/contradictorio produce `needs-review`, no genera hipótesis comercial y añade `do-not-contact` hasta revisión humana. `no_official_website_found` significa únicamente que las fuentes consultadas no permitieron verificar una web oficial.

## Evidence strength

La clasificación es determinista y no es un score comercial:

- `weak`: menos de dos señales con provenance completo.
- `moderate`: dos o más señales cubiertas por al menos una fuente conocida.
- `strong`: tres o más señales cubiertas, dos proveedores distintos y al menos una fuente oficial del establecimiento o manual de primera parte.

Una señal sólo cuenta como cubierta si tiene al menos un `sourceKey` y todos sus keys existen en el registro de provenance del análisis. Por eso la ausencia de provenance impide `strong`. Ratings y reviews no se consultan ni intervienen.

## Límites actuales

- No se descubren emails ni datos de contacto nuevos; sólo se usan campos explícitos ya disponibles.
- No se infieren procesos internos ni necesidades, presupuesto o intención de compra.
- `contact_form_available` y `quote_request_process_visible` requieren tags/datos explícitos; una URL genérica no basta.
- Un estado operativo no evaluado bloquea la interpretación comercial hasta revisión.
- El reporte `latest.json` representa la última muestra ejecutada, no necesariamente todo el catálogo.

## P3A.3: revisión humana

Las decisiones manuales viven exclusivamente en `content/manual/opportunity-reviews/<businessId>.json`. El análisis automático no modifica esos archivos ni copia sus campos dentro de `content/opportunities`; sólo incorpora una referencia a la review en cada hipótesis derivada.

Estados efectivos:

- `unreviewed`: no existe artefacto manual.
- `reviewing`: revisión guardada como pendiente.
- `verified`: operación e identidad confirmadas, web resuelta y provenance revisada.
- `rejected`: cierre, conflicto o decisión explícita de no contactar.
- `stale`: alguna verificación ha superado su vigencia; el artefacto se conserva.

Política inicial, calculada desde `reviewedAt` salvo un `expiresAt` anterior:

- estado operativo: 90 días;
- web/dominio: 180 días;
- canales de contacto revisados: 180 días.

Una hipótesis posterior a review incluye tanto `basedOnSignalIds` como `basedOnReview` (`reviewedAt`, autor, campos y fuentes revisadas). Sólo se habilita con `confirmed-open`, identidad `confirmed`, review vigente, provenance existente y conflictos explícitamente resueltos. Cierre o conflicto produce `do-not-contact` sin hipótesis.

## P3A.4: Verification Enrichment

`npm run opportunities:verify -- [opciones]` añade evidencia pública antes de la revisión y la persiste en `content/verification/<businessId>.json`. Acepta `--business`, `--area`, `--category`, `--limit` y `--force`. Usa la misma selección determinista y no escribe en manifest, Selection, Comparison, reviews ni gates.

Cada artefacto separa `identityEvidence`, `operationalEvidence`, `digitalPresence`, `websiteSignals` e información comercial extraída con el extractor común. Las fuentes conservan URL, fecha, atribución, licencia y alcance. Una URL accesible es sólo una señal técnica; una página de marca o URL candidata no acredita una ubicación concreta; OSM y terceros son soporte, nunca confirmación humana. No se consultan ratings ni reviews y los emails sólo se incorporan cuando aparecen explícitamente en la fuente.

La caché usa un fingerprint de inputs/versiones y guarda caducidades independientes: reachability y operación 30 días, contactos 90 días e identidad 180 días. Si vence cualquier dimensión el artefacto se vuelve a recopilar de forma conservadora; `--force` invalida la reutilización. El reporte agregado se guarda en `content/reports/verification/latest.json`.

Opportunity Analysis consume únicamente el fingerprint, un resumen de estados y las fuentes verificadas; no copia el artefacto. Content Lab presenta el detalle como `AUTOMATIC SUPPORTING EVIDENCE`, separado de los campos `MANUAL` y de las hipótesis `INFERRED`. Ningún resultado cambia una review existente ni convierte `supported-open` en `confirmed-open`.
