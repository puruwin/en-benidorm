---
paths:
  - "src/**"
---

# Frontend (src/)

- Toda página usa `BaseLayout` o `ContentLayout` con una prop `seo` completa. Así pasa por
  `components/seo/SeoHead.astro` (canonical, title, description, robots, OG). No hay `<head>` propios.
- Las páginas editoriales (guías, fichas, comparativas) no llevan JS de cliente: ni directivas
  `client:*` ni `<script>`, salvo `<script type="application/ld+json">`.
- JSON-LD solo con información visible en la página.
- Nunca afirmes una verificación que el dato no tenga. Sin evidencia actual con fecha, no muestres
  "verificado", "abierto ahora", "precio actual" ni fecha de verificación. Usa los estados
  `confirmed` / `unknown` / `needs verification` / `conflict` y muestra la fecha de observación de los precios.
- El contenido demo debe seguir marcado como demo (`demo` en el layout).
- Validación: `npm run check` y `npm run build`.
