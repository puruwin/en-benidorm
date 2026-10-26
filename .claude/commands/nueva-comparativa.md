---
description: Crea una comparativa de principio a fin (select → enrich → gate → verificar → generate → QA → revisor → audit → PR) y se detiene en cada gate.
argument-hint: <topic>
---

# Nueva comparativa: `$ARGUMENTS`

Si `$ARGUMENTS` está vacío, pregunta el topic y no sigas. El topic se normaliza a minúsculas y
guiones; el id es `comparison-<topic>` y la página `/donde-comer/<topic>/`.

## Reglas fijas

- **Nunca** `npm run content:import`, `studio:deploy`, `git push` a `main` ni `--force` en git.
- No uses `--force` en `comparison:*` salvo que David lo pida. Si un paso dice `skipped=1`, el
  artefacto ya existe: dilo y pregunta si se reutiliza o se recalcula.
- **Una parada es el resultado, no un obstáculo.** Cuando un paso dice PARA, informa y termina. No
  bajes umbrales, no toques `scripts/comparison/lib/gate.ts`, no reincluyas candidatos excluidos o
  débiles, no añadas observaciones manuales para rellenar dimensiones y no reescribas la página para
  cambiar un veredicto (principios §9).
- No borres ni reescribas artefactos de `content/discovered`, `content/enriched` ni de otras
  comparativas.

## Pasos

1. **Rama.** Si no estás en la rama de la issue de esta comparativa, pregunta el número de issue y
   crea `<n>-<slug>` desde `main` actualizado.
2. **Selection.** `npm run comparison:select -- --topic $ARGUMENTS`. Resume direct, potential y
   excluded con sus motivos de exclusión (`content/comparisons/candidates/comparison-<topic>.json`).
3. **Enrichment.** `npm run comparison:enrich -- --topic $ARGUMENTS`. Resume confirmados,
   rechazados y cobertura de evidencia.
4. **Gate de datos.** `enrich` no para en el gate; compruébalo antes de seguir:

   ```bash
   node --import tsx --input-type=module -e "
   import {readFile} from 'node:fs/promises'
   import {evaluateComparisonDataGate} from './scripts/comparison/lib/gate.ts'
   const enriched = JSON.parse(await readFile('content/comparisons/enriched/comparison-<topic>.json', 'utf8'))
   const gate = evaluateComparisonDataGate(enriched)
   console.log(JSON.stringify({pass: gate.pass, differentiatedDimensions: gate.differentiatedDimensions, issues: gate.issues, warnings: gate.warnings}, null, 2))
   process.exitCode = gate.pass ? 0 : 2
   "
   ```

   Si `pass` es `false`: **PARA**. Lista cada issue y warning y qué evidencia real faltaría (sin
   proponer inventarla). La cohorte se queda bloqueada.
5. **Verificación de datos.** Usa la skill `verificar-datos` con
   `content/comparisons/enriched/comparison-<topic>.json`. Muestra la tabla, las discrepancias y lo
   que no se pudo comprobar.
6. **Confirmación.** Pregunta a David con AskUserQuestion si se genera o se para. Recuerda que
   `comparison:generate` consume API de pago y menciona las discrepancias del paso 5. Sin un «generar»
   explícito, **PARA**.
7. **Generation y QA.**
   - `npm run comparison:generate -- --topic $ARGUMENTS`. Si sale `STOP: gate de datos no superado`,
     **PARA**.
   - `npm run comparison:qa -- --topic $ARGUMENTS`. Si el resultado es `FAIL`, **PARA** y muestra
     los motivos de `content/reports/comparison-qa.json`.
8. **Revisión de calidad.** `npm run build` y lanza el subagente `revisor-calidad` sobre
   `/donde-comer/<topic>/`. Si el veredicto no es **publicar** (`noindex` o `descartar`), **PARA** y
   muestra motivos, señales de escalado y «Qué haría falta para publicar».
9. **Auditoría SEO.** `npm run build && npm run seo:audit -- --baseline scripts/seo/baseline.json`.
   Si hay errores nuevos que afectan a la página, **PARA**. Si la página sale `orphan`, ejecuta
   `/huerfanas` y propone los enlaces, pero no los apliques sin que David los elija.
10. **Validación.** `npm run content:validate` y `npm run check`. Si falla, muestra la salida.
11. **PR.**
    - Commit en español, en imperativo, solo con los artefactos de esta comparativa:
      `content/comparisons/candidates/comparison-<topic>.json`,
      `content/comparisons/enriched/comparison-<topic>.json`,
      `content/generated/comparisons/comparison-<topic>.json`, `content/manifest.json` y, si existe,
      `content/manual/comparisons/<topic>.json`. Nunca `.staging/` ni `content/reports/`.
    - `git push -u origin <rama>` y PR contra `main` con `Closes #<n>`.
    - En el cuerpo del PR, incluye:
      - resultado del gate (dimensiones diferenciadas y warnings);
      - tabla de `verificar-datos` y discrepancias;
      - resumen de QA;
      - veredicto de `revisor-calidad`;
      - resultado de `seo:audit`;
      - la nota de que con `CONTENT_SOURCE=demo` el grafo de enlaces no es el de producción.
    - **No** se ejecuta `content:import`: la publicación en Sanity la hace David.
