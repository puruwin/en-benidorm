---
description: Valida una visita de campo de David (playa o lugar) y la conecta con los hechos prácticos de content/facts/.
argument-hint: <content/manual/visits/archivo.json>
---

# Procesar visita: `$ARGUMENTS`

Si `$ARGUMENTS` está vacío, lista `content/manual/visits/*.json` y pregunta cuál. No sigas sin archivo.

## Reglas fijas

- La visita es de David. **No la crees, no la edites y no completes campos.** Si algo falla (fecha,
  cita que no está en `text`, foto que no existe, `factId` mal escrito), di archivo, campo y error y
  **PARA**: lo corrige David.
- Lo único que entra en `content/facts/` es el `value` que David anotó en cada comprobación, escrito
  literalmente en su `quote`. Prohibido añadir adjetivos, opiniones, valoraciones o datos que no
  estén escritos en `text`; tampoco en el resumen ni en propuestas de copy.
- No inventes `factId` ni `value` para las comprobaciones que no los tienen: quedan registradas como
  observación sin hecho. Puedes señalar a qué hecho existente podrían corresponder; lo decide David.
- No escribas `resolution` ni borres claims para evitar un conflicto (`.claude/rules/facts.md`).
- No toques la página (`content/generated/**`) en este comando.

## Pasos

1. **Validar y planificar** (no escribe nada):

   ```bash
   npm run visit:process -- $ARGUMENTS
   ```

   Si sale «Visita no válida», muestra los errores tal cual y **PARA**.
   Si un `factId` no existe en `content/facts/`, **PARA** y propón a David el hecho vacío
   (`id`, `subject`, `attribute`, `municipality`, `unit`, `claims: []`) sin crearlo.
2. **Resumen para David.** Tabla por comprobación: categoría, cita literal, hecho, valor y estado
   (`AÑADIR`, `AÑADIR → CONFLICT`, `YA REGISTRADO`, sin hecho). Señala:
   - los `CONFIRMAR` (booleanos: son lectura de la cita, no texto literal);
   - los `→ CONFLICT`, con los otros valores y sus fuentes: el claim dejará el hecho en «conflict» y
     bloqueará las páginas que lo citan hasta que David lo resuelva;
   - si la página de la visita no cita algún hecho.
3. **Confirmación.** Pregunta a David con AskUserQuestion si se añaden los claims. Sin un «sí»
   explícito, **PARA**.
4. **Escribir.**

   ```bash
   npm run visit:process -- $ARGUMENTS --write
   ```

   Añade `--confirmed` solo si David confirmó los booleanos en el paso 3.
5. **Validar.** `npm run content:validate` y `npm test`. Un conflicto nuevo o una copia de página
   desactualizada aparecen aquí: repórtalos con la salida, no los arregles en este comando. Las
   copias `practicalFacts[]` de la página se actualizan en la tarea de esa página; con un claim
   `manual-first-party` su `sourceClass` es el que la página muestra como «Comprobado en persona».
6. **Commit** en español, en imperativo, con la visita, sus fotos y los `content/facts/**` tocados.
   Nada más.
