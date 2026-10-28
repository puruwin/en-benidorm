# CLAUDE.md

@AGENTS.md
@enbenidorm-editorial-principles.md

Lo anterior es la fuente de verdad. Este archivo solo añade lo específico de Claude Code.
Las reglas por zona están en `.claude/rules/` y se cargan al tocar esos archivos.

## Entorno

- El `.env` local usa `CONTENT_SOURCE=demo`: build, check y tests funcionan sin red ni credenciales.
- No leas ni edites `.env` ni `deploy/content-lab/*.env`.
- No hay CI. La validación local es la única barrera antes del merge.

## Validación

Ejecuta todo lo que aplique a lo que has tocado antes de dar una tarea por terminada o abrir un PR:

| Zona tocada | Comandos |
| --- | --- |
| Cualquier `.ts`/`.astro` | `npm run check` |
| `src/**`, `astro.config.mjs` | `npm run build` |
| `scripts/**`, `tools/content-lab/api/**` | `npm test` |
| Discovery, taxonomy, Selection, Comparison | `npm run comparison:regression` |
| `content/seed/**`, `content/generated/**`, `scripts/content-validation.ts` | `npm run content:validate` |
| `sanity/**`, `sanity.config.ts` | `npm run sanity:schema:validate` |
| `tools/content-lab/web/**` | `npm run content-lab:build` |

Si un comando falla, dilo con su salida. No lo saltes ni lo des por bueno.

## Comandos prohibidos

Nunca, ni siquiera si parece útil para probar algo:

- `npm run content:import` (escribe en Sanity de producción)
- `npm run images:import -- … --write` (sube assets y modifica documentos en Sanity de producción)
- `npm run studio:deploy`
- `git push --force` / `--force-with-lease`
- `git push` a `main`: un push a `main` despliega enbenidorm.es en Hostinger
- `docker compose` sobre `deploy/` o cualquier operación sobre el servidor

Solo cuando la issue lo pida explícitamente (consumen API de pago y reescriben artefactos):

- `npm run content:discover*`, `content:enrich*`, `content:generate*`
- `npm run comparison:generate*`
- `npm run images:find` (consulta Commons, Pixabay y Pexels y reescribe `content/images/candidates/`)

## Flujo de trabajo

1. Una issue → una rama desde `main` actualizado: `<n>-<slug>` (ej. `3-t01-configurar-claude-code`).
2. Commits pequeños y enfocados, en español, en imperativo.
3. Valida (tabla de arriba) antes de cada push.
4. `git push -u origin <rama>` y PR pequeño contra `main` con `Closes #<n>`,
   qué cambia, por qué y qué se ha validado.
5. El merge es **squash merge** y lo hace David. Claude no hace merge ni push a `main`.

Un PR que mezcla varias issues o capas del pipeline debe dividirse.
