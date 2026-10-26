---
name: auditar-pagina
description: Úsala al terminar de crear o modificar una página pública, antes de abrir un PR.
---

# Auditar una página pública

Comprueba una ruta concreta con las reglas de `npm run seo:audit` y con los criterios de la
auditoría de encalpe, y revisa a mano lo que el auditor no puede ver.

## Pasos

1. `npm run build` (la auditoría lee `dist/`).
2. Audita la ruta:

   ```bash
   node --import tsx .claude/skills/auditar-pagina/scripts/auditar-ruta.ts /ruta/de/la-pagina/
   ```

   Audita el build entero y filtra lo que afecta a esa ruta: tipo de página, enlaces entrantes y
   salientes, errores (marcados `nuevo` o `en línea base`) y avisos. Sale con 1 si hay errores
   nuevos o si la ruta no existe en `dist`. Opciones: `--dist`, `--baseline`, `--site`.
3. Corrige los errores `nuevo`. Para cada uno, el criterio y la corrección están en
   [references/criterios-encalpe.md](references/criterios-encalpe.md).
4. Si la ruta sale `orphan`, usa la skill `enlazado-interno`.
5. Si la página tiene precios, horarios, accesos, ubicaciones o servicios, usa la skill
   `verificar-datos` antes del PR.
6. Revisa a mano lo que el auditor no comprueba (Gotchas).
7. Vuelve a ejecutar el paso 2 hasta que no haya errores nuevos y menciona el resultado en el PR.

No actualices `scripts/seo/baseline.json` para que la página pase. `--update-baseline` solo si
David lo pide, y nunca para errores de la página que estás tocando.

## Gotchas

- **Otro municipio.** Si el lugar está en Altea, l'Alfàs del Pi, Finestrat, Guadalest o La Vila
  Joiosa, la página tiene que decirlo de forma visible (no solo en la dirección) y explicar el
  traslado desde Benidorm. El auditor no lo detecta: revisa título, `<h1>`, description y primer
  párrafo para que no presenten el sitio como «en Benidorm».
- **Unidades de precio.** «Por persona», «por ración», «por unidad» y «mínimo 2» no son
  equivalentes. El auditor solo comprueba que haya un `Sources`; revisa que cada precio publicado
  conserve su unidad y que una tabla no mezcle unidades en la misma columna.
- **Una fuente, varios idiomas.** Varias URLs del mismo dominio en distintos idiomas cuentan como
  una sola fuente. Si el bloque de fuentes las lista por separado, aparenta más respaldo del que hay.
- **«Lo que no pudimos comprobar».** No puede contener datos que la fuente sí publica. Antes del
  PR, contrasta cada línea de esa sección con las fuentes listadas en la propia página.
- **Las huérfanas dependen del sitio entero.** Por eso el script audita todo `dist` y filtra. Una
  página nueva nace huérfana hasta que otras la enlazan; arreglarla implica tocar otras páginas.
- **Demo no es producción.** Con `CONTENT_SOURCE=demo` el grafo de enlaces es el del contenido demo.
  Un `orphan` o un `broken-link` que dependa de datos de Sanity puede no reproducirse igual en
  producción: dilo en el PR en lugar de darlo por resuelto.
- **Una redirección que «funciona» sigue siendo un error.** `link-to-redirect` no se acepta porque
  el navegador llegue al destino.
- **Errores en plantillas compartidas.** Un `broken-link:menu` o `:footer` aparece en todas las
  páginas. Corrígelo una vez en `Header.astro` / `Footer.astro`, no página a página.
