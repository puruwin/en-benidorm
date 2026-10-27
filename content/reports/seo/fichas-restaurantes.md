# Revisión de calidad de las fichas de restaurante

- Fecha: 2026-10-27
- Revisor: subagente `revisor-calidad` (solo lectura), en 4 lotes.
- Alcance: las 17 rutas `/restaurantes/*` del sitemap de producción (enbenidorm.es).
- Material: el HTML publicado, descargado el 2026-10-27 **antes** de los cambios de la rama
  `9-f02-…` (todavía con el sello «✓ Información verificada» y la repetición de secciones), y
  `content/enriched/business-<slug>.json`. Las fichas reales están en Sanity; solo
  `cucina-italiana` y `essenza-italiana` tienen además `content/generated/businesses/`.
- Regla provisional de noindex (hasta la issue del umbral de indexación): una ficha lleva noindex
  si todas sus fuentes son OpenStreetMap y no tiene precio, horario ni características
  (`src/lib/business-presentation.ts`, `provisionalNoIndex`). Esta regla solo afecta a
  **amigos-bistro** y **country-ribs**.

## Resumen

| Ruta | Fuentes | Noindex provisional | Veredicto del revisor | Motivo principal |
| --- | --- | --- | --- | --- |
| /restaurantes/amigos-bistro/ | OSM | sí | descartar | No dice qué cocina tiene; el único dato es «terraza» (OSM), repetido 4 veces |
| /restaurantes/arenas/ | OSM + web oficial (no se extrajo nada) | no | descartar | Su único contenido es «cocina regional» de OSM; por el dominio, puede ser una cafetería |
| /restaurantes/buffalo-beel/ | OSM + web oficial (portada) | no | descartar | Todo el cuerpo reescribe una frase promocional de la web; sin horario ni platos |
| /restaurantes/cafeteria-la-bahia/ | OSM + web oficial (4 URL) | no | noindex | Repite el concepto de la web; sus señales de elección solo aparecen en la comparativa de arroces |
| /restaurantes/clay-oven/ | OSM + web oficial | no | descartar | Solo «cocina india» y un eslogan de la web |
| /restaurantes/country-ribs/ | OSM | sí | descartar | Solo la etiqueta «ribs», repetida; ningún dato propio |
| /restaurantes/cucina-italiana/ | manual-json (transcribe la web) + web oficial | no | noindex | Concepto genérico sin platos ni precios; la meta dice «Abierto todos los días» y no aclara que es el horario publicado |
| /restaurantes/dvora-gastrobar/ | OSM + web oficial (4 URL) | no | noindex | Solo repite OSM y la web; da como actual el horario de OSM |
| /restaurantes/essenza-italiana/ | manual-json (transcribe la web) + web oficial | no | noindex | Concepto de la web traducido y repetido; no tiene dirección completa |
| /restaurantes/jardin-mediterraneo/ | OSM + web oficial (5 URL) | no | noindex | Lista genérica de cinco cocinas; los arroces de la comparativa no llegan a la ficha |
| /restaurantes/la-cava-aragonesa/ | OSM + web oficial (5 URL) | no | noindex | Algo de diferenciación (tapas y bodega), pero le faltan los arroces y el precio fechado de la comparativa |
| /restaurantes/la-oficina-del-gusto/ | OSM + web oficial (5 URL) | no | noindex | Afirma «servicio para llevar» sin respaldo (`takeaway: null`); sí explica bien el conflicto de horario |
| /restaurantes/marisqueria-cordoba/ | OSM + web oficial (2 URL) | no | noindex | La más delgada: no tiene teléfono, reservas ni horario |
| /restaurantes/ongi-etorri/ | OSM + web oficial (5 URL) | no | noindex | Procedencia correcta, pero no usa los arroces, el precio fechado ni los mínimos de la comparativa |
| /restaurantes/restaurante-trasto-bar/ | OSM + web oficial (1 página de eatbu) | no | descartar | Precio de 5,50 € sin fecha; vuelca la lista de categorías y reformula el texto de marketing |
| /restaurantes/sushi-poke-chen-s-kitchen/ | OSM (2 nodos) + web oficial (4 URL) | no | descartar | Aplica al local reserva y concepto que pueden ser de la marca (§5); horario sin fecha; sin carta |
| /restaurantes/ulia/ | OSM + web oficial (1 página en 4 URL de idioma) | no | descartar | No cumple el título; afirma «almuerzo y para llevar» sin respaldo (`services` y `takeaway` son null) |

Recuento:
- publicar: 0
- noindex: 9
- descartar: 8

Hoy las 17 se publican con `index,follow`.

## Hallazgos comunes

- **Plantilla compartida.** Todas siguen «X es un restaurante situado en…» → Cocina / La experiencia /
  Ubicación / Servicios → «Lo más destacado», y este último bloque repite lo ya dicho (§9). En
  producción los encabezados salían como `<p>`, porque la query aplanaba el cuerpo. La rama los pinta
  como `<h2>`, quita el texto repetido y, si solo hay un hecho, deja una única sección.
- **Las señales de elección se pierden por el camino.** Las comparativas de arroces e italiano sí
  tienen platos, precios fechados y mínimos de comensales, pero esos datos no pasan a las fichas.
- **Afirmaciones sin respaldo en el artefacto:**
  - ulia: «almuerzo y para llevar».
  - la-oficina-del-gusto: «servicio para llevar».
  - `comparison-italiano.json`: el horario «Todos los días: 14:00–23:00» y las «reservas online» de
    Buffalo Beel, y el «servicio para llevar» de La Oficina del Gusto.
- **Las fechas no coinciden.** Las páginas muestran que se consultó el 6 o el 7 de octubre, pero
  `content/enriched` dice `retrievedAt` 2026-10-08. Lo más probable es que el enriquecimiento se
  volviera a ejecutar después de importar a Sanity: Sanity conserva la fecha de la importación.
- **Fuentes infladas.** En ulia, la misma página aparece como cuatro fuentes, una por cada URL de
  idioma (`/Base/ChangeLang/*`). Chen's Kitchen tiene un segundo nodo de OSM que nadie ha revisado.

## Detalle por ficha

### /restaurantes/amigos-bistro/ — descartar

- **Fuentes:** solo OSM (`node/5522417399`).
- **Señal de elección:** ninguna. La terraza es contexto y viene de una etiqueta de OSM.

Motivos:
1. El cuerpo no dice qué tipo de cocina tiene, así que no ayuda a decidir (§1, §7).
2. Todo es la ficha de OSM reescrita (§12).
3. La terraza aparece en la description, en la entradilla, en «La experiencia» y en «Lo más destacado» (§9).

Para publicar le faltan: un tipo de cocina con su fuente, señales de elección concretas y una
observación manual fechada.

### /restaurantes/arenas/ — descartar

- **Fuentes:** OSM y web oficial (`cafeteriaarenas.com`), aunque de la web no se extrajo ningún dato.

Motivos:
1. Todo el contenido es «Su cocina está clasificada como regional»: no hay platos, precios ni horario (§7, §10).
2. Por el dominio, puede ser una cafetería, y aun así el `<title>` dice «restaurante de cocina regional» (§4, §5).

### /restaurantes/buffalo-beel/ — descartar

- **Fuentes:** OSM y la portada de la web oficial.
- **Señal de elección:** ninguna. «Menú del día» es, como mucho, un ancla débil.

Motivos:
1. Reescribe una sola frase promocional de la web (§1, §10).
2. El mismo hecho aparece tres veces (§9).
3. «Pizzas caseras» aparece como hecho en el subtítulo y en la meta (§4).
4. No tiene horario ni platos (§7).

### /restaurantes/cafeteria-la-bahia/ — noindex

- **Fuentes:** OSM y web oficial (4 URL).
- **Señal de elección:** débil (primera línea de Levante, vistas al mar).

Motivos:
1. El cuerpo parafrasea el concepto de la web (§1, §12).
2. La cocina se repite en cuatro sitios (§9).
3. La comparativa de arroces tiene arroz a banda, menú diario y menú de grupo (mínimo 8), pero nada
   de eso está en la ficha (§7–8).

### /restaurantes/clay-oven/ — descartar

- **Fuentes:** OSM y web oficial, de la que solo salen la cocina india y un eslogan.

Motivos:
1. No ayuda a elegir frente a otros restaurantes indios (§7).
2. Aporta menos que la propia web (§12).
3. La cocina india aparece en el título, en «Cocina» y en «Lo más destacado» (§9).

### /restaurantes/country-ribs/ — descartar

- **Fuentes:** solo OSM.
- **Señal de elección:** «ribs» es un ancla de tema, no una señal para comparar.

Motivos:
1. Dice el mismo dato dos veces (§9).
2. No aporta nada que no esté ya en OSM o en el nombre (§12).
3. La dirección no tiene número.

### /restaurantes/cucina-italiana/ — noindex

- **Fuentes:** manual-json (transcribe la web oficial, no es una visita) y web oficial (portada, carta y reservas).
- **Señal de elección:** el horario continuo. La carbonara a 16,95 € de la comparativa no está en la ficha.

Motivos:
1. La cocina se describe con el concepto de la web, sin platos (§7–8).
2. «Abre todos los días» y «Abierto…» en la meta no aclaran que es el horario publicado (§6).
3. «Lo más destacado» repite «Cocina» (§9).
4. El título casi coincide con la intención de `/donde-comer/italiano/`.

### /restaurantes/dvora-gastrobar/ — noindex

- **Fuentes:** OSM (incluido el horario) y web oficial (4 URL).
- **Señal de elección:** la terraza en la azotea.

Motivos:
1. Solo repite la web y OSM (§1, §12).
2. Da como actual el horario de OSM, sin fecha (§6).
3. El desayuno y las reservas aparecen tres veces cada uno (§9).

### /restaurantes/essenza-italiana/ — noindex

- **Fuentes:** manual-json y la portada de la web oficial.
- **Señal de elección:** las pinse romanas, aunque quedan diluidas en una lista.

Motivos:
1. Traduce literalmente el concepto de la web y lo repite tres veces (§9, §10).
2. No da la dirección completa (solo «Benidorm») y las coordenadas son aproximadas (§5).
3. Lo bueno: el horario se presenta como «horario publicado» (§6).

### /restaurantes/jardin-mediterraneo/ — noindex

- **Fuentes:** OSM y web oficial (5 URL).
- **Señal de elección:** débil (desayunos, para llevar, Levante).

Motivos:
1. La lista de cinco cocinas no ayuda a elegir y aparece tres veces (§7, §10).
2. Los seis arroces de la comparativa, y el aviso de que su carta no publica precios, no están en la ficha (§7–8).

### /restaurantes/la-cava-aragonesa/ — noindex

- **Fuentes:** OSM y web oficial (5 URL).
- **Señal de elección:** tapas y bodega de vinos, ubicación en el centro.

Motivos:
1. La lista de cocinas aparece tres veces (§9).
2. Tiene la señal más fuerte del grupo en la comparativa, el arroz a banda a 19,30 € observado el
   2026-10-07, y no aparece en la ficha (§7–8, §10).

### /restaurantes/la-oficina-del-gusto/ — noindex

- **Fuentes:** OSM y web oficial (5 páginas).
- **Señal de elección:** moderada (pasta fresca, focaccia, horario partido).

Motivos:
1. Afirma «servicio para llevar» sin respaldo: `takeaway` y `services` son null (§4).
2. Lo bueno: explica el conflicto de horario entre la web y OSM (§6).
3. Repite el concepto de la web tres veces (§9).

### /restaurantes/marisqueria-cordoba/ — noindex

- **Fuentes:** OSM y web oficial (2 URL).
- **Señal de elección:** cocina abierta y ubicación en el centro.

Motivos:
1. Es la más delgada: no tiene teléfono, reservas ni horario.
2. Mariscos y arroces aparecen cuatro veces (§7, §9).
3. La paella de marisco a 10 € y el mínimo de 2 personas solo están en la comparativa (§7–8).

### /restaurantes/ongi-etorri/ — noindex

- **Fuentes:** OSM y web oficial (portada, historia, carta, especialidades y contacto).

Motivos:
1. No nombra ni un arroz, aunque la carta está entre sus fuentes (§7–8).
2. Las reservas, la terraza y el servicio para llevar se repiten (§9).
3. «Manolo 1» es el title SEO de su web y no aporta nada al lector (§10).
4. Su procedencia es correcta y enlaza a la comparativa de arroces.

### /restaurantes/restaurante-trasto-bar/ — descartar

- **Fuentes:** OSM y una sola página de eatbu.
- **Señal de elección:** sí la tiene (menú del día, formato de bar informal).

Motivos:
1. Da el precio de 5,50 € sin fecha de observación (§10).
2. Vuelca la lista de categorías de eatbu en vez de describir la oferta (§2, §7).
3. Reformula el texto de marketing (§10, §11).
4. La dirección no tiene localidad.

### /restaurantes/sushi-poke-chen-s-kitchen/ — descartar

- **Fuentes:** OSM (2 nodos) y web oficial (4 URL).

Motivos:
1. No menciona sushi ni poke concretos, ni precios (§7).
2. La web parece cubrir varios locales (La Nucía, l'Alfàs del Pi), pero la reserva y el concepto se
   aplican a este local sin evidencia propia (§5). El segundo nodo de OSM está sin revisar (§3–4).
3. Da el horario de OSM como actual (§6, §10).

### /restaurantes/ulia/ — descartar

- **Fuentes:** OSM y web oficial (una sola página, contada cuatro veces por las URL de idioma).

Motivos:
1. El título promete arroces y el cuerpo no nombra ninguno (§7).
2. Afirma «almuerzo y para llevar» sin respaldo en el artefacto (§4, §10).
3. «Primera línea de Poniente» sale de un eslogan (§10).
4. Las fuentes están infladas por las URL de idioma (§9).
