# Cambios de estado de indexación (#15)

Comparación del build de `main` (8494ccf) con el de la rama `15-f23-regla-única-de-indexación`, ambos
con `seo:audit`. Generado el 2026-10-27.

**Fuente de contenido: `CONTENT_SOURCE=demo`.** Es la única disponible en local. En producción
(Sanity) hay más fichas (17 según `fichas-restaurantes.md`) y la comparativa de arroces tiene sus
entradas: **David tiene que repetir este informe con la fuente de producción antes de fusionar**
(`npm run build && npm run seo:audit`, y leer `pages[ruta].indexabilityReasons` en
`content/reports/seo/crawl.json`).

Enlaces contextuales = páginas distintas que la enlazan desde el cuerpo (sin menú, migas ni pie).
Antes se contaban todos los enlaces.

| Ruta | Antes | Después | Enlaces antes (todos) / ahora (cuerpo) | Motivos de `isIndexable` |
| --- | --- | --- | --- | --- |
| `/` | index | index | 9 / 0 (exenta) | — |
| `/donde-comer/` | index | index | 9 / 3 | — |
| `/donde-comer/italiano/` | index | index | 3 / 3 | — |
| `/sobre-david/` | index | index | 9 / 2 | — |
| `/donde-comer/arroces/` | index | **noindex** | 1 / 1 | `no-contribution`, `few-links` |
| `/restaurantes/cucina-italiana/` | index | **noindex** | 1 / 1 | `no-contribution`, `few-links` |
| `/restaurantes/essenza-italiana/` | index | **noindex** | 1 / 1 | `no-address`, `no-contribution`, `few-links` |
| `/restaurantes/arroz-y-brisa-demo/` | index | **noindex** | 2 / 2 | `demo`, `no-evidence`, `no-contribution`, `title-subject` |
| `/restaurantes/la-esquina-azul-demo/` | index | **noindex** | 2 / 2 | `demo`, `no-evidence`, `no-contribution`, `title-subject` |
| `/restaurantes/mercat-de-ponent-demo/` | index | **noindex** | 2 / 2 | `demo`, `no-evidence`, `no-contribution`, `title-subject` |
| `/404.html` | 404 | 404 | — | — |

Ninguna página pasa de noindex a index.

## Qué explica cada cambio

- **Fichas reales (cucina-italiana, essenza-italiana).** Tienen web oficial fechada, pero ninguna
  aportación propia: no hay campo de foto propia (#23) ni observaciones de creador (#29), y el bloque
  «Aparece en estas comparativas» es un enlace, no una comparación. Es lo que decidiste en #9: se
  quedan en `noindex,follow` hasta tener aportación. Además solo las enlaza `/donde-comer/italiano/`.
- **essenza-italiana no tiene calle**: el artefacto generado solo guarda `address.locality`. Es un hueco
  de datos real; no lo relleno.
- **Fichas demo.** Antes se indexaban (la regla provisional solo miraba OSM). Ahora `demo` las saca
  siempre, como pide `docs/arquitectura-seo.md` §3. Su título tampoco nombra el H1 tal cual
  («Arroz & Brisa · DEMO» frente a «Arroz & Brisa · Restaurante DEMO…»).
- **`/donde-comer/arroces/`.** En demo sus entradas no se resuelven (sus negocios no están en
  `content/generated/businesses/`), así que no muestra comparación. Con producción debería tener
  entradas: comprueba ahí si sigue en noindex solo por `few-links` (hoy solo la enlaza el hub).
- **`/donde-comer/`, `/sobre-david/`.** Siguen indexables con 3 y 2 enlaces del cuerpo; antes llegaban
  a 9 gracias al menú y al pie.

## Para que una ficha vuelva a indexarse

Le falta una aportación visible en la página (foto propia u observación de creador resumida) y un
segundo enlace contextual (otra comparativa, el hub o una ficha hermana: `/huerfanas` los propone).
