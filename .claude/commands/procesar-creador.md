---
description: Valida una observación de creador (notas de una persona que vio el vídeo) y muestra dónde se conecta con la ficha y las comparativas.
argument-hint: <content/manual/creator-observations/archivo.json>
---

# Procesar observación de creador: `$ARGUMENTS`

Si `$ARGUMENTS` está vacío, lista `content/manual/creator-observations/*.json` (sin las `_*.json`,
que son plantillas) y pregunta cuál. No sigas sin archivo.

## Reglas fijas

- La observación la escribe **una persona que ha visto el vídeo** (David o el propio creador).
  **Prohibido que Claude la cree, la edite o complete campos**, también a partir de un enlace, una
  miniatura, un título, una transcripción o una descripción del vídeo: Claude no ha visto el vídeo.
  Si David pide que la rellenes tú, niégate y ofrécele `content/manual/creator-observations/_plantilla-creador.json`.
- No hay scraping: no abras, descargues, transcribas ni consultes por oEmbed el vídeo, el perfil o
  los comentarios. Tampoco para «comprobar» la observación.
- Es evidencia de tercero. No la uses para rellenar dimensiones de Comparison, `content/facts/` ni
  la web oficial, ni la presentes como comprobada por enBenidorm. No toques `content/generated/**`.
- Si algo falla (fecha, URL con `?igsh=`, unidad de precio, `businessId`), di archivo, campo y
  error y **PARA**: lo corrige quien vio el vídeo.

## Pasos

1. **Validar y conectar** (no escribe nada):

   ```bash
   npm run creator:process -- $ARGUMENTS
   ```

   Si sale «Observación de creador no válida», muestra los errores tal cual y **PARA**.
2. **Resumen para David.** El bloque tal como se verá y dónde: ficha, comparativas publicadas y
   artefactos de Comparison Enrichment. Señala:
   - `permisoCreador: "pendiente"`: se muestra atribuida y enlazada, pero conviene pedir permiso;
     `"no"`: no se muestra en ninguna página;
   - `colaboracionPagada: "sí"` o `"desconocido"`: la página muestra el aviso;
   - si el local no tiene ficha ni comparativa publicada: la observación no se ve todavía;
   - frases del resumen o las notas que parezcan copiadas literalmente del vídeo o que añadan
     valoraciones («el mejor…») que la persona no escribió como lo que el creador dijo. Proponlo; no
     lo cambies.
3. **Validar.** `npm run content:validate`, `npm test` y `npm run build`. Comprueba en
   `dist/restaurantes/<slug>/index.html` que aparece «Lo que han contado creadores locales» con la
   fecha, el @creador y el enlace de texto, y que no hay `<script>` ni `<iframe>` de la plataforma.
4. **Comparison Enrichment.** No ejecutes `comparison:enrich` (hace research web). Indica a David
   que la observación se adjuntará al artefacto en el próximo `comparison:enrich --force` de esa
   comparativa, fuera de `evidence` y sin mover el gate.
5. **Commit** en español, en imperativo, solo con el archivo de la observación. Nada más.
