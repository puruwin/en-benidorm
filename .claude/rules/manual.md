---
paths:
  - "content/manual/**"
---

# Observaciones manuales (content/manual/)

- Claude **no crea, edita ni borra** observaciones manuales. Son evidencia de algo que David observó
  y fechó. Generarlas sería inventar procedencia.
- Claude solo puede leerlas y validarlas: `npm test` y `npm run comparison:regression`
  (`scripts/comparison/enrich.ts` las consume).
- Si una observación tiene un problema (formato, fecha que falta, contradicción con otra evidencia),
  repórtalo a David con el archivo y el campo. No lo corrijas.
- Nunca uses una observación manual para rellenar un campo que nadie observó.
