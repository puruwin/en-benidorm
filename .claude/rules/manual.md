---
paths:
  - "content/manual/**"
---

# Observaciones manuales (content/manual/)

- Claude **no crea, edita ni borra** observaciones manuales. Son evidencia de algo que David observó
  y fechó. Generarlas sería inventar procedencia.
- Hay dos contratos:
  - `comparison-observations/`: negocios de una comparativa
    (`scripts/comparison/schemas/manual-observation.schema.json`, lo consume `comparison:enrich`);
  - `visits/`: visitas de campo a playas y lugares (`scripts/content/schemas/site-visit.schema.json`,
    `scripts/content/lib/site-visits.ts`), que respaldan hechos de `content/facts/`. Se procesan con
    `/procesar-visita`.
- Los archivos que empiezan por `_` son plantillas (`_plantilla-visita.json`), no observaciones.
- Claude solo puede leerlas y validarlas: `npm test`, `npm run content:validate` y
  `npm run comparison:regression`.
- Si una observación tiene un problema (formato, fecha que falta, cita que no está en el texto,
  contradicción con otra evidencia), repórtalo a David con el archivo y el campo. No lo corrijas.
- Nunca uses una observación manual para rellenar un campo que nadie observó, ni añadas adjetivos,
  opiniones o datos que no estén escritos literalmente en ella.
