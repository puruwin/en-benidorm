# Niveles de fuente y estados

La jerarquía es la de la sección 4 de `enbenidorm-editorial-principles.md`. Aquí solo se numera
y se aterriza con ejemplos para rellenar la columna «Nivel».

## Niveles

| Nivel | Tipo | Ejemplos que sí cuentan | Ejemplos que no cuentan en este nivel |
| --- | --- | --- | --- |
| 1 | Fuente oficial local | Web propia del local; carta PDF enlazada desde su web; cartel o carta del local publicado por el propio local; web del ayuntamiento para un servicio municipal | Ficha de Google gestionada por el local (es nivel 5) |
| 2 | Fuente oficial de marca ligada al local | Página de la cadena para *esa* dirección (localizador de tiendas con la dirección de Benidorm) | Carta o precios genéricos de la cadena sin dirección (no prueban nada del local) |
| 3 | Dato estructurado abierto | OpenStreetMap (`opening_hours`, `addr:*`, `wheelchair`), datos abiertos de la Generalitat | Datos derivados de OSM por terceros |
| 4 | Observación manual revisada | Entrada de `content/manual/**` con fecha y autor | Una observación sin fecha o que no cubre ese dato |
| 5 | Tercero de apoyo | Google Maps, TripAdvisor, TheFork, redes sociales, prensa, blogs | — |

Si un dato tiene varias fuentes, la fila lleva la de nivel más alto y las demás se citan como apoyo
o como conflicto.

## Estados

| Estado | Cuándo |
| --- | --- |
| `confirmed` | Fuente de nivel 1–4 que publica el dato tal como aparece en la página (misma unidad, mismo periodo), con fecha de consulta u observación conocida |
| `needs verification` | Solo hay nivel 5; o la fuente de nivel 1–4 no tiene fecha y el dato cambia con el tiempo (precio, horario); o la fuente lo publica distinto pero no contradice (otra unidad, otra temporada) |
| `conflict` | Dos fuentes, o la fuente y la página, dicen cosas incompatibles. Indica cuáles |
| `unknown` | Ninguna fuente consultada publica el dato |

Un dato que la página muestra y que queda en `unknown` o `conflict` es una discrepancia: la página
lo afirma sin respaldo.
