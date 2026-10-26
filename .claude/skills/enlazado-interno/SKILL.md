---
name: enlazado-interno
description: Úsala al publicar una página nueva o cuando seo:audit detecte huérfanas.
---

# Enlazado interno

Propone enlaces contextuales hub ↔ ficha y ficha ↔ ficha cercana a partir del grafo que deja
`seo:audit`, para que ninguna página indexable quede por debajo del mínimo de enlaces entrantes.
El script propone; quien edita decide qué enlace aporta algo al lector y redacta el ancla.

## Pasos

1. Genera el grafo actual:

   ```bash
   npm run build
   npm run seo:audit -- --baseline scripts/seo/baseline.json
   ```

   Escribe `content/reports/seo/crawl.json` (no se versiona).
2. Pide propuestas:

   ```bash
   node --import tsx .claude/skills/enlazado-interno/scripts/proponer-enlaces.ts --dist dist [--route /ruta/]
   ```

   - `--dist` lee la «Zona» de cada ficha del HTML construido y añade propuestas `misma-zona`.
   - `--route` filtra las propuestas que salen de o llegan a esa ruta.

   La lógica está en `scripts/seo/lib/links.ts` (con tests en `scripts/seo/links.test.ts`). Motivos:

   | Motivo | Qué significa |
   | --- | --- |
   | `hub-ficha` | la ficha ya enlaza el hub, pero el hub no la enlaza |
   | `ficha-hub` | el hub ya enlaza la ficha, pero la ficha no enlaza el hub |
   | `ficha-hermana` | las dos fichas cuelgan del mismo hub de categoría (`/donde-comer/<categoría>/`) |
   | `misma-zona` | las dos fichas están en la misma zona |

   Las filas con «Destino bajo mínimo: sí» van primero: son las que resuelven huérfanas.
3. Elige. Para cada propuesta aceptada, el enlace va en el cuerpo de la página de origen (texto,
   bloque «Cerca de aquí», «Otras opciones de la categoría»), con un ancla que diga qué hay al otro
   lado. Nunca en menú ni footer para tapar una huérfana.
4. Repite el paso 1 y comprueba que la ruta ya no sale como `orphan`. Con la skill
   `auditar-pagina` lo ves por ruta.

## Gotchas

- **Otro municipio.** Una ficha de Altea, l'Alfàs del Pi, Finestrat, Guadalest o La Vila Joiosa no
  es «cercana» a una de Benidorm por compartir categoría. Si se enlaza, el ancla o la frase que la
  rodea dice el municipio y cómo se llega (coche, TRAM, bus, tiempo).
- **Unidades de precio.** Un enlace del tipo «otra opción más barata» solo vale si los dos precios
  están en la misma unidad: «por persona», «por ración», «por unidad» y «mínimo 2» no se comparan
  entre sí.
- **Una fuente, varios idiomas.** Las versiones en otros idiomas de la web de un local no son
  páginas nuestras ni fuentes distintas: no generan enlaces internos ni cuentan como «más
  información» en el ancla.
- **«Lo que no pudimos comprobar».** Si el ancla o el texto del enlace resume la ficha de destino,
  no puede presentar como desconocido algo que la fuente de esa ficha sí publica, ni al revés.
- **Cercanía temática no es geográfica.** `ficha-hermana` solo dice que comparten categoría. No
  escribas «muy cerca» salvo que la propuesta sea `misma-zona` o lo confirmen las direcciones.
- **El hub general no hace hermanas.** `/donde-comer/` lista todo; compartirlo no genera
  `ficha-hermana`. Si dos fichas solo comparten ese hub, no hay propuesta ficha ↔ ficha.
- **Huérfanas sin propuesta.** Un hub de categoría que no enlaza ninguna ficha (o una guía) no tiene
  relación hub ↔ ficha; el script lo lista aparte. Antes de enlazarlo, pregúntate si debe ser
  indexable con tan poco contenido (`MIN_INDEXABLE_CATEGORY_ITEMS` en `src/lib/routes.ts`).
- **El grafo es el del build que tengas.** Con `CONTENT_SOURCE=demo` las fichas son demo: no enlaces
  una ficha demo desde contenido real ni al revés.
- **Enlazar no arregla una página débil.** Si una propuesta solo sirve para pasar el mínimo y no
  ayuda a elegir, descártala.
