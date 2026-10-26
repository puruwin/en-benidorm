---
name: verificar-datos
description: Úsala cuando una página o comparativa incluya precios, horarios, accesos, ubicaciones o servicios.
context: fork
agent: general-purpose
allowed-tools: Read, Grep, Glob, WebFetch, WebSearch, Bash(git log *), Bash(git show *)
---

# Verificar datos de una página o comparativa

Devuelve una tabla que dice, para cada dato práctico de la página, de dónde sale, cuánto vale esa
fuente y en qué estado queda. Es solo lectura: no edita páginas, artefactos ni observaciones.

Entrada: `$ARGUMENTS` (ruta pública, slug, archivo o comparativa). Si no se indica, pregunta cuál.

## Pasos

1. **Localiza el contenido.** Plantilla en `src/pages/**`; datos en `content/generated/**`
   (fichas, comparativas, artículos), `content/manual/**` y, con `CONTENT_SOURCE=demo`, el contenido
   demo de `src/data/demo/content.ts` (lo resuelve `src/lib/content-source.ts`). Si existe `dist/<ruta>/index.html`, úsalo para ver lo que se
   publica de verdad.
2. **Extrae cada dato** de estos tipos: precio, horario, acceso (reserva, accesibilidad, aparcamiento,
   transporte), ubicación (dirección, municipio, zona) y servicio (terraza, para llevar, opciones
   dietéticas…). Un dato por fila, con su unidad y periodo tal como los muestra la página.
3. **Busca la evidencia guardada antes que la web**: fuentes de la ficha (`sources`, con
   `accessedAt`), evidencias del artefacto generado y observaciones de `content/manual/**`.
4. **Consulta la fuente solo si falta.** Prioriza la de nivel más alto de
   [references/niveles-y-estados.md](references/niveles-y-estados.md). Anota la fecha de hoy como
   fecha de consulta solo para lo que hayas consultado tú ahora.
5. **Asigna nivel y estado** según esa referencia.

## Salida

```markdown
| Dato | Fuente | Nivel | Fecha de consulta | Estado |
| --- | --- | --- | --- | --- |
| Menú del día 14 € por persona, L–V mediodía | https://… (carta PDF) | 1 | 2026-10-20 | confirmed |
```

- **Fuente**: URL o ruta de archivo del repo (`content/manual/…#campo`). Nunca «web oficial» sin URL.
- **Nivel**: 1–5.
- **Fecha de consulta**: `AAAA-MM-DD`, o `sin fecha` si la evidencia no la tiene.
- **Estado**: `confirmed` / `unknown` / `needs verification` / `conflict`.

Después de la tabla:

1. **Discrepancias**: datos que la página muestra distinto de la fuente, o que muestra sin fuente.
2. **Lo que no se pudo comprobar**: solo datos que ninguna fuente consultada publica.
3. **Fuentes consultadas**: lista deduplicada por dominio.

## Gotchas

- **Otro municipio.** Si el lugar está en Altea, l'Alfàs del Pi, Finestrat, Guadalest o La Vila
  Joiosa, añade una fila de ubicación con el municipio y comprueba que la página lo dice y explica el
  traslado desde Benidorm. Si no lo hace, va a discrepancias aunque la dirección sea correcta.
- **Unidades de precio.** «Por persona», «por ración», «por unidad» y «mínimo 2» no son
  equivalentes. Si la página dice «14 €» y la fuente «14 € por persona, mínimo 2», el estado no es
  `confirmed`: es `needs verification` y va a discrepancias hasta que la página copie la unidad.
- **Una fuente, varios idiomas.** Varias URLs del mismo dominio en distintos idiomas (`/es/`, `/en/`,
  `?lang=`) son una sola fuente. No cuentan como corroboración mutua; si se contradicen entre sí, es
  `conflict` dentro de la misma fuente.
- **«Lo que no pudimos comprobar».** No puede contener datos que la fuente sí publica. Antes de
  entregar, revisa cada línea de esa lista contra las fuentes de la tabla; si la página tiene una
  sección con ese título, contrasta también la suya.
- **La fecha es la de la evidencia.** Si reutilizas una fuente guardada, la fecha es su `accessedAt`
  o la de la observación, no la de hoy.
- **Carta sin fecha.** Un PDF o una foto de carta sin fecha no da `confirmed` a un precio, aunque sea
  nivel 1: queda `needs verification` con `sin fecha`.
- **Temporada.** Un horario de verano no confirma un horario anual. Si la fuente distingue temporadas
  y la página no, es discrepancia.
- **Redes sociales.** Una publicación de Instagram del propio local es nivel 5 si no está enlazada
  desde su web; su fecha de publicación es la fecha del dato, no la de consulta.
