---
paths:
  - "scripts/content/**"
  - "scripts/comparison/**"
---

# Pipeline (scripts/content, scripts/comparison)

- Si el cambio puede afectar a Discovery, taxonomy, Selection o Comparison (gates, enrichment,
  ranking), ejecuta `npm run comparison:regression` además de `npm test`. Revisa el diff del informe:
  un cambio de selección o de gate no buscado es un bug, no un efecto secundario aceptable.
- No ejecutes `content:discover`, `content:enrich`, `content:generate` ni `comparison:generate` para
  "probar". Usa los tests y la regresión. Solo se ejecutan si la issue lo pide.
- No reescribas ni borres artefactos en `content/discovered`, `content/enriched`, `content/generated`
  ni `content/manifest.json` para que algo pase.
- No toques las protecciones de red (SSRF, redirects, límites, timeouts, PDF) sin un test que las cubra.
