# P3A.6 — Catálogo navegable y ficha de prospección

Content Lab incorpora la sección **Negocios**, independiente del último informe de
Opportunity Analysis. El catálogo usa los registros locales de Discovery y excluye
`targetDocumentType=place`. En el catálogo restaurado de P3A.5a son 3.103 negocios.
No se ejecutan comandos de análisis, verificación, Discovery ni búsquedas al navegar.

## Recorrido

1. Abre **Negocios** en el menú de Content Lab.
2. Busca por nombre o businessId, o filtra municipio, sector, subsector, disponibilidad
   del análisis y pertenencia a la muestra experimental. Las búsquedas ignoran
   mayúsculas y acentos. Cambiar filtros vuelve a la primera página.
3. Abre una ficha. Su URL `/businesses/<businessId>` funciona directamente y al
   recargar; los filtros y la página del listado se conservan en su URL.
4. Consulta identidad, ubicación, contactos con fuente/fecha, evidencia de
   Verification, revisión humana efectiva y análisis existente. Los artefactos
   ausentes o inválidos se presentan explícitamente sin ejecutar sustitutos.
5. Guarda notas y estado en **Seguimiento de prospección**.

La lista se ordena por nombre normalizado y businessId, con 25 filas por página.
«Actualizar catálogo» fuerza la comprobación de cambios en los archivos locales.
Los indicadores de web/teléfono del listado proceden de Discovery; la ficha agrega
los contactos disponibles en Enrichment y Verification, manteniendo su procedencia.
«No registrado» no afirma que el canal no exista. Abrir un enlace externo es una
acción manual; consultar la ficha no verifica la vigencia de esas páginas.

Las hipótesis y evidencias reutilizan las vistas existentes de Opportunity Analysis.
El estado de Human Review mantiene la política de caducidad existente. Su formulario
se ofrece cuando existe un análisis válido; una review inválida se conserva y no se
abre para editar desde la ficha. Un negocio que sólo tiene Discovery sigue siendo
consultable y permite seguimiento, sin fabricar análisis o reviews.

## Seguimiento independiente

Persistencia: `content/manual/prospecting/<businessId>.json`.

```json
{
  "schemaVersion": 1,
  "businessId": "business-ejemplo",
  "status": "following",
  "notes": "Nota escrita manualmente",
  "updatedAt": "2026-10-16T00:00:00.000Z"
}
```

Estados: `unmanaged` (sin gestionar), `following` (en seguimiento), `archived`
(archivado). No alteran la elegibilidad comercial, identidad, operación, hipótesis ni
Human Review. Leer una ficha no crea archivos de seguimiento; sin archivo se devuelve
un estado inicial sin gestionar y revisión `null`.

El servidor calcula una revisión SHA-256 sobre el archivo leído. El cliente debe
aportar `expectedRevision` al guardar; si no coincide, recibe HTTP 409. Se usa un lock
por negocio en disco para serializar escrituras entre peticiones o instancias y un
archivo temporal con rename para guardar atómicamente. Si el proceso muere mientras
guarda y deja un directorio `.lock`, debe comprobarse que no hay un escritor activo
antes de retirarlo manualmente; no se borra automáticamente un lock ajeno.

Los conflictos no descartan el borrador del usuario. La interfaz permite consultar
la versión actual y cargarla explícitamente en el formulario. Hay aviso al recargar
con cambios sin guardar y al salir mediante los botones/enlaces internos de la
aplicación. Los botones Atrás/Adelante del navegador restauran la ruta; no proporcionan
un historial de borradores sin guardar.

El servidor limita las notas a 10.000 caracteres, valida ID/estado/revisión y rechaza
campos adicionales. No permite escribir seguimiento de identidades ajenas al catálogo,
archivos de seguimiento inválidos o enlaces simbólicos en el archivo/directorio de
seguimiento. Los timestamps se generan en el servidor.

## API

- `GET /api/businesses`: `q`, `municipality`, `sector`, `subsector`,
  `analysis=all|available|missing|invalid`, `sample=all|yes|no`, `page`, `pageSize`
  (1–100), `refresh=1`.
- `GET /api/businesses/:businessId`: ficha, artefactos existentes, fuentes y seguimiento.
- `PUT /api/businesses/:businessId/prospecting`:
  `{status, notes, expectedRevision}`. No acepta datos de Human Review ni análisis.

Los IDs/filtros inválidos devuelven 400; identidades ausentes, 404; conflictos de
seguimiento, 409; registros de Discovery inválidos, 422. Los artefactos opcionales
inválidos generan advertencias y no bloquean el resto de la ficha. Un archivo inválido
de Discovery se omite del listado con una advertencia, sin repararlo silenciosamente.

El índice se comparte entre peticiones, agrupa la carga inicial en lotes de 32 y
comprueba cambios con un TTL de dos segundos. Los registros Discovery y análisis sin
cambios de metadata no vuelven a parsearse. No hay índice nuevo persistente, base de
datos ni dependencia del reporte `latest.json`. El refresco explícito no ejecuta
ningún pipeline.

Content Lab usa `node_modules/.vite-content-lab` como caché propia para evitar
colisiones con Astro al ejecutar checks o desarrollo en paralelo.

## Validación de la entrega

- `npm test`: 192 pruebas aprobadas.
- `ASTRO_TELEMETRY_DISABLED=1 npm run check`: sin errores, advertencias ni hints.
- `npm run content-lab:build`: correcto.
- Chromium con el catálogo real: 3.103 negocios; filtros de muestra/sector,
  paginación, búsqueda con acentos, enlaces directos, recarga y negocio ausente.
- Chromium con datos temporales: formulario de Human Review existente, revisión
  caducada, guardado/recarga del seguimiento y conflicto entre dos pestañas con
  conservación del borrador y recuperación de la versión actual. Ninguna escritura
  de estas pruebas se realizó sobre notas o reviews reales.

Las siete pruebas nuevas de API cubren también filtros combinados, orden/paginación,
artefactos ausentes e inválidos, recarga del catálogo, persistencia tras reinicio,
escrituras concurrentes/obsoletas, validación y aislamiento de los archivos protegidos.

No se ejecutaron Opportunity Experiment, análisis, Verification, Discovery, generación,
contactos ni pipelines editoriales. La muestra de 20, su evaluación vacía, manifest,
Human Reviews y artefactos previos se conservan sin cambios. La observación de desayunos
(31 → 33 candidatos) sigue pendiente y no se regeneraron comparativas.
