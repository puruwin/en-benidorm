---
description: Lista, por página, los datos con fecha de consulta de más de 90 días.
argument-hint: "[días]"
---

# Datos caducados

Solo lectura salvo `dist/`. Umbral: `$ARGUMENTS` días si se indica; si no, 90.

1. `npm run build`.
2. Ejecuta el detector:

   ```bash
   node --import tsx scripts/seo/stale-data.ts --dist dist --max-age <días>
   ```

   Junta dos orígenes (lógica en `scripts/seo/lib/freshness.ts`):
   - **página**: lo que el HTML publicado muestra al lector («consultada AAAA-MM-DD» en las fuentes
     y la fecha de consulta que muestra `DataProvenance`);
   - **artefacto (no visible)**: fechas de `content/generated/businesses` y
     `content/generated/comparisons` que la página no pinta, como `sources[].accessedAt` y la
     `retrievedAt` del precio destacado de cada comparativa.

   Las filas con «sin fecha válida» también se listan: sin fecha no se puede saber si un dato sigue
   vigente.
3. Resume por página: cuántos datos caducados tiene, el más antiguo y qué tipo de dato es (precio,
   horario, fuente general). Los precios y horarios primero: son los que más cambian.
4. Para las páginas con precios u horarios caducados, sugiere pasar la skill `verificar-datos`.

No cambies fechas ni artefactos. Una fecha solo se renueva volviendo a consultar la fuente
(`verificar-datos`: «la fecha es la de la evidencia»), nunca poniendo la de hoy.

Con `CONTENT_SOURCE=demo`, las fechas de página son las del contenido demo; las de producción
pueden ser otras.
