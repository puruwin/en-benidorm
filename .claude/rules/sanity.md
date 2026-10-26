---
paths:
  - "sanity/**"
  - "sanity.config.ts"
  - "sanity.cli.ts"
  - "schema.json"
---

# Sanity (sanity/)

- Tras cualquier cambio de esquema, ejecuta `npm run sanity:schema:validate`.
- Si cambian tipos o campos, regenera con `npm run typegen` y comprueba con `npm run check`.
  Las queries de `src/lib/sanity/queries.ts` deben seguir siendo válidas.
- Nunca `npm run studio:deploy` ni `npm run content:import`: escriben en el proyecto real.
