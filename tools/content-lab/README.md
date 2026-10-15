# enBenidorm Content Lab

Content Lab es una herramienta local de desarrollo para inspeccionar y orquestar la pipeline de Comparisons. No contiene scoring, enrichment, generación, QA, gates ni adapters propios: ejecuta los scripts oficiales y lee sus artefactos JSON.

## Arranque

Desde la raíz del proyecto:

```bash
npm run content-lab
```

- Web: http://127.0.0.1:4173
- API: http://127.0.0.1:4174

Ambos procesos escuchan únicamente en `127.0.0.1`. Las variables de servidor como `OPENAI_API_KEY` permanecen en el proceso de la pipeline y nunca se envían al navegador.

También pueden arrancarse por separado con `npm run content-lab:web` y `npm run content-lab:api`.

## Arquitectura

```text
Web UI
  ↓ HTTP + SSE
Fastify API
  ↓
CommandRunner
  ↓ child_process.spawn("npm", argv)
existing npm scripts
  ↓
content artifacts / reports

ArtifactLoader
  ↓
existing JSON outputs

PromptBuilder
  ↓
deterministic Codex prompt
```

Las fases soportadas son selection, enrichment, generation y QA, mapeadas a `comparison:select`, `comparison:enrich`, `comparison:generate` y `comparison:qa`. Generation muestra una confirmación porque puede consumir cuota de OpenAI. El report de enrichment incluye el resultado calculado por `evaluateComparisonDataGate`; la UI lo consume y bloquea Generation cuando falla, sin duplicar thresholds. Content Lab no importa ni publica en Sanity.

Sólo se admite un proceso activo. stdout y stderr se conservan en memoria y se envían por Server-Sent Events. La cancelación envía `SIGTERM` al grupo del proceso y usa `SIGKILL` como último recurso tras cinco segundos.

## Artefactos

El backend sólo expone loaders para rutas conocidas. No existe un endpoint de lectura de paths arbitrarios. Un archivo ausente se presenta como “Not generated yet” (o el estado equivalente) y un JSON corrupto como `Invalid JSON` sin detener la aplicación.

La pestaña Evidence muestra las observaciones manuales incorporadas por enrichment con el badge
`Manual observation`, observador, fecha, dimensión y valor. Es una vista de sólo lectura: los
archivos se mantienen en `content/manual/comparison-observations/` y Content Lab no ofrece
formularios ni endpoints para editarlos.

Cada ejecución no dry-run conserva el último report real de cada fase en:

```text
content/reports/comparisons/<topic>/
├── selection.json
├── enrichment.json
├── generation.json
└── qa.json
```

Los reports incluyen `topic`, `phase`, `startedAt`, `finishedAt`, `status` y `stale`. `completed` significa que la fase terminó; `stale: true` significa que el resultado existía pero una fase upstream se volvió a ejecutar. Un estado `inferred` sólo existe en la vista de compatibilidad de Content Lab: se deduce de un artefacto antiguo y no se escribe como si fuera un report histórico real.

El orden de lectura es report persistente por topic, artefacto específico del topic, report global si coincide el topic y, por último, inferencia. Los reports globales `content/reports/comparison-*.json` se siguen escribiendo como “última ejecución” para no romper herramientas existentes. Content Lab nunca presenta una QA stale como validación actual.

Con `--force`, selection marca stale enrichment, generation y QA; enrichment marca generation y QA; generation marca QA; QA no invalida ninguna fase. La acción principal vuelve a la primera fase ausente o stale, y las fases posteriores quedan bloqueadas hasta recuperar un estado actual.

## Topics nuevos

La configuración actual de search intent y aliases está en TypeScript. El MVP no intenta reescribirla. “Nueva Comparison” valida el slug y genera un prompt determinista con el search intent, aliases y archivos relevantes. Una vez configurado el topic, las fases pueden ejecutarse visualmente.

## Prompts para Codex

En la pestaña Codex se selecciona un issue del report o se añade una nota editorial. El PromptBuilder incorpora el resultado actual, evidence/coverage relevante, archivos probables, restricciones contra hardcodes del topic y comandos de validación. No usa IA, no llama a Codex y permite revisar y copiar el texto antes de usarlo.

## Tests

```bash
npm run content-lab:test
```

Los tests cubren validación del topic, construcción segura de comandos, traversal/injection, prioridad y fallback de reports, estado stale, dos topics simultáneos, bloqueo de fases, lectura missing/invalid, transiciones de runs y templates de prompts. No ejecutan OpenAI ni Sanity.
