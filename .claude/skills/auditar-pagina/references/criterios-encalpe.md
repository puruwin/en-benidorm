# Criterios: hallazgos de la auditoría de encalpe

La auditoría de encalpe está reproducida en `scripts/seo/fixtures/encalpe/` y en el test
«reproduce los hallazgos de la auditoría de encalpe» de `scripts/seo/audit.test.ts`. Sus cuatro
hallazgos son los fallos que más se repiten en un sitio estático de este tipo. Cada página nueva o
modificada debe pasar los cuatro.

## 1. Enlace roto en una plantilla compartida

- **Salida**: `ERROR [broken-link:footer] /aviso-legal/`
- **Qué pasó**: el footer enlazaba una página que no existía. Como el footer está en todas las
  páginas, un solo enlace produce un error por página.
- **Criterio**: todo enlace interno apunta a una ruta que existe en `dist`. Las rutas salen de
  `src/lib/routes.ts`, no se escriben a mano.
- **Corrección**: crear la página o quitar el enlace de `Footer.astro` / `Header.astro`. Nunca
  enlazar una página «que vendrá».

## 2. Enlace a una redirección

- **Salida**: `ERROR [link-to-redirect:menu] /donde-comer/ → /restaurantes/ficha/`
- **Qué pasó**: el menú enlazaba una URL que en el build solo existía como redirección
  (página con `<meta http-equiv="refresh">`, que es lo que genera Astro para un redirect estático).
- **Criterio**: los enlaces internos apuntan al destino final, no a una URL antigua.
- **Corrección**: cambiar el `href` al destino. La redirección se queda para enlaces externos.

## 3. Página huérfana

- **Salida**: `ERROR [orphan] 0 enlaces entrantes (mínimo 2)`
- **Qué pasó**: una página indexable a la que no enlazaba ninguna otra. Los enlaces desde la 404 o
  desde redirecciones no cuentan; dos enlaces desde la misma página cuentan como uno.
- **Criterio**: toda página indexable (salvo `/`) recibe al menos `MIN_INCOMING_LINKS` (2) enlaces
  de páginas distintas.
- **Corrección**: skill `enlazado-interno`. Si la página no merece enlaces, probablemente no merece
  ser indexable.

## 4. Página sin `<h1>`

- **Salida**: `ERROR [h1-missing] la página no tiene <h1>`
- **Qué pasó**: la guía empezaba en `<h2>`.
- **Criterio**: exactamente un `<h1>` por página, con el tema de la página.
- **Corrección**: el `<h1>` lo pone la plantilla de la página (`src/pages/**`), no el contenido
  de Sanity.

## Resto de reglas del auditor

| Regla | Nivel | Qué exige |
| --- | --- | --- |
| `h1-multiple` | error | un solo `<h1>` |
| `title-missing` / `title-duplicate` | error | `<title>` propio y único entre indexables |
| `description-missing` / `description-duplicate` | error | meta description propia y única |
| `canonical-mismatch` | error | canonical = origen + ruta propia (solo indexables) |
| `jsonld-invalid` | error | cada bloque JSON-LD parsea |
| `unreviewed-verified` | error | «verificada» solo dentro de `[data-human-review]` |
| `facts-without-sources` | error | precios u horarios en `<main>` exigen el componente `Sources` |
| `img-missing-alt` | aviso | toda `<img>` con `alt` (vacío si es decorativa) |
| `title-too-long` | aviso | `<title>` de 60 caracteres como máximo |
