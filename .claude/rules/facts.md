---
paths:
  - "content/facts/**"
  - "scripts/content/lib/practical-facts.ts"
---

# Hechos prácticos (content/facts/)

- Un dato práctico (precio, horario, acceso, tarifa) existe una sola vez aquí; las páginas lo citan
  en `practicalFacts[]`. No copies el valor a texto libre (`body`, `parking`, `accessInfo`).
- Claude puede añadir claims con una URL consultable y su `retrievedAt`. No puede:
  - añadir hosts a `official-sources.json` (una URL candidata no es oficial hasta que David la aprueba);
  - crear `observationRef` ni observaciones en `content/manual/`;
  - escribir `resolution`: resolver un conflicto es una decisión humana.
- Un hecho en `conflict` no se arregla borrando el claim incómodo. Repórtalo con los dos valores y sus fuentes.
- Validación: `npm test` y `npm run content:validate`.
