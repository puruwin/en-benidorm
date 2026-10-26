---
description: Construye el sitio, lista las páginas huérfanas según seo:audit y propone enlaces internos con la skill enlazado-interno.
---

# Páginas huérfanas

Solo lectura salvo `dist/` y `content/reports/seo/crawl.json`: propone, no edita páginas.

1. Construye y audita:

   ```bash
   npm run build
   npm run seo:audit -- --baseline scripts/seo/baseline.json
   ```

   `seo:audit` sale con 1 si hay errores nuevos de cualquier regla; eso no impide seguir con este
   comando, pero menciónalos al final.
2. Lista las huérfanas a partir de `content/reports/seo/crawl.json` (`errors` con
   `rule: "orphan"`). Por cada una, muestra la ruta, los enlaces entrantes (detalle del hallazgo) y si
   está en `scripts/seo/baseline.json` o es nueva. Si no hay ninguna, dilo y termina.
3. Usa la skill `enlazado-interno` para pedir propuestas:

   ```bash
   node --import tsx .claude/skills/enlazado-interno/scripts/proponer-enlaces.ts --dist dist
   ```

   Con muchas huérfanas, filtra por ruta con `--route /ruta/`.
4. Presenta el resultado agrupado por huérfana:
   - propuestas que llegan a ella («Destino bajo mínimo: sí» primero), con motivo y página de origen
     donde iría el enlace en el cuerpo;
   - huérfanas sin propuesta, con la pregunta de la skill: ¿debe ser indexable con tan poco contenido?
   - descarta en voz alta las propuestas que solo sirven para pasar el mínimo (gotchas de la skill:
     otro municipio, cercanía temática frente a geográfica, unidades de precio).
5. No apliques enlaces sin que David elija cuáles. Nunca en menú ni footer para tapar una huérfana.
   No actualices la línea base.

Recuerda que con `CONTENT_SOURCE=demo` el grafo es el del contenido demo: una huérfana puede no
serlo en producción, y al revés.
