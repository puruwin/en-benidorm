# P3A.5b — Preparación del Opportunity Experiment

Desde la raíz del repositorio:

```bash
npm run opportunities:sample -- --size=20 --seed=frappe-pilot-01
```

Sólo prepara la muestra. No importa ni ejecuta Opportunity Analysis, Verification,
Discovery, búsquedas, generación, contactos ni pipelines editoriales. Esta fase no
necesita claves de API. El tamaño de esta iteración es 20; otros tamaños se rechazan
porque no tienen una distribución sectorial definida.

## Prerrequisito: el catálogo real

`content/discovered/*.json` está ignorado por Git: una copia nueva del repositorio
puede contener el informe de cobertura de 3.103 negocios pero cero registros.
Restaurar los artefactos originales de P3A.5a desde la instancia/snapshot que los
produjo. Conservar también los informes originales de Discovery y los artefactos
existentes de Verification y Human Review si estaban presentes: son evidencia
local de identidad y cierre que debe acompañar el sorteo. No volver a ejecutar
Discovery, Verification ni análisis para sustituir datos ausentes.

El comando aborta sin escribir resultados si falta el catálogo o el número de
negocios no coincide con el informe de cobertura. Los totales agregados no permiten
reconstruir nombres, coordenadas ni businessIds. No hay fallback sintético.

## Reproducibilidad y neutralidad

- Orden de sorteo: SHA-256 de `[seed, businessId]`; desempate por businessId.
- `catalogFingerprint`: SHA-256 del catálogo ordenado por businessId y de los
  reviews, Verification y pistas de duplicados leídos. Cambiar la evidencia es
  cambiar los inputs. El orden de archivos no interviene.
- `taxonomyVersion`: versión de contenido calculada sobre las reglas comerciales
  OSM existentes. No se modifica la taxonomía compartida.
- `generatedAt` documenta la ejecución; no interviene en la selección. Dos
  ejecuciones con los mismos inputs/seed producen los mismos businessIds, no
  necesariamente el mismo timestamp.
- Cuotas: 3 hospitality, 3 beauty-wellness, 3 professional-services,
  3 real-estate/home-services, 2 healthcare, 2 automotive, 2 education,
  2 retail/b2b-services. Se reserva representación de ambos sectores agrupados
  cuando hay candidatos elegibles. No se rellenan carencias con otros estratos.
- Matching integral de plazas, negocios y municipios: se intenta 13/4/3
  (Benidorm/l'Alfàs/La Nucía), después 14/4/2 y 14/3/3. Si no resulta viable,
  se mantienen los sectores y se registra la desviación municipal.
- Web, teléfono, email, ratings, reviews y oportunidad aparente no definen
  elegibilidad ni score. Los dos primeros y metadata sólo permiten reparar un
  estrato completamente homogéneo mediante un intercambio que mantiene sector,
  municipio y ausencia de duplicados. No se deshace diversidad ya conseguida.
  Se registran reparaciones y homogeneidad residual por estrato.

## Identidad y exclusiones

Se excluyen cierres explícitos en los datos disponibles, conflictos de identidad,
entidades explícitamente no comerciales, sector other/unknown y ubicación inválida.
Una ubicación válida contiene coordenadas finitas en rango (excepto 0,0) o dirección
identificable (addr:full, o calle/lugar y municipio). No se interpreta falta de web,
teléfono o evidencia de apertura como cierre. El estado desconocido puede entrar.
No se usa la existencia de Human Review como requisito de selección.

Se recalculan duplicados localmente con el detector existente sobre todo el catálogo,
y se incorporan pistas de los informes de Discovery. Una source key compartida es
identidad exacta. Pares exact/strong-probable sin resolución canónica explícita se
excluyen conservadoramente en ambos sentidos; no se inventa una identidad canónica.
Los probable pueden ser elegibles, pero nunca aparecer juntos. Si colisionan, se
prueban ambas sustituciones y se conserva primero la que permite más plazas; el
orden de la seed desempata. Todos los descartes por este motivo quedan registrados.

El registro pequeño de exclusiones recorre los predecesores del sorteo en el mismo
sector/municipio que el candidato definitivo; sólo anota los que fallan los filtros,
no todos los no seleccionados. Las sustituciones por duplicados durante matching y
las reparaciones descriptivas están identificadas por separado. No se excluye un
negocio por no ser seleccionado.

## Metadata descriptiva

Ocho familias booleanas de información existente: web, teléfono, email, dirección,
horarios, descripción, fecha de revisión y detalles de servicio. Cada familia cuenta
una vez: `sparse`=0–1, `moderate`=2–4, `rich`=5–8. No se valora la calidad comercial de
esos datos ni se realiza enriquecimiento para rellenar huecos.

## Salidas y evaluación

- `content/reports/opportunity-experiment/sample-20.json`: muestra, trazabilidad,
  métricas globales/por estrato, controles y desviaciones.
- `content/reports/opportunity-experiment/sample-20.md`: resumen legible.
- `content/manual/opportunity-experiment/sample-20-review.json`: array independiente
  con una entrada vacía por negocio. Sólo David rellenará los campos después del
  experimento; no se copia información de Human Reviews existentes.

Una repetición con los mismos businessIds preserva la evaluación byte por byte,
incluidas respuestas humanas. Cambiar los businessIds exige archivar manualmente
la evaluación anterior; el comando aborta antes de sobrescribir los artefactos.
Una muestra incompleta se marca `ready:false` y el CLI termina con código 1.

## Validación y límites

```bash
npm test
ASTRO_TELEMETRY_DISABLED=1 npm run check
npm run content-lab:build
```

La variable de telemetría permite el chequeo en entornos donde no se puede escribir
la configuración de Astro fuera del workspace.

La muestra es estratificada intencionalmente: no replica la proporción global del
catálogo. Siguen vigentes los sesgos de cobertura OSM y los estados desconocidos;
no se promete representatividad estadística de todas las empresas locales.

P3A.5a observó que desayunos pasa de 31 a 33 candidatos. Esta iteración no corrige,
regenera, selecciona ni reenriquece desayunos o cualquier otra comparativa. Las
referencias a negocios ausentes de comparativas existentes son un defecto editorial
independiente y no se modifican para este experimento.

## Restauración y ejecución sobre el catálogo real — 16 de octubre de 2026

Se restauró el ZIP aportado por el usuario, `p3a5a-business-discovery-artifacts.zip`
(SHA-256 `9d2a9777f114270740a4c0b267065e5ca6e5c5fe2fa7c32db6b6eccd4fd4b63d`).
Contiene 3.176 registros: 3.103 negocios y 73 lugares. Los 3.176 IDs están en el
manifiesto restaurado; los sectores y municipios de los negocios coinciden con el
informe de cobertura versionado. El catálogo, el manifiesto y los informes de
Discovery permanecen ignorados por Git; no se incluyen en los cambios de código.

La seed `frappe-pilot-01` produjo 20 negocios con todas las cuotas cumplidas:
13 Benidorm, 4 l'Alfàs del Pi/Albir y 3 La Nucía. Web conocida: 7/20; teléfono:
9/20; email: 0/20. Metadata: 7 sparse, 9 moderate, 4 rich. Estas ausencias son
únicamente ausencia de datos conocidos, no una verificación de presencia digital.

El fingerprint de inputs es
`246ee95d31694e48effa2a7b28daf9827a87c7079d9228eb357ccd967b860587`.
La taxonomía registrada es
`osm-business-p3a5a-b469be6b2c56b1055e680c812c2d5c0597508747589aad25f1ab5028c861ad0c`.

Se registraron seis intercambios para evitar estratos homogéneos en web conocida;
no alteraron cuotas sectoriales ni municipales. Persisten dos advertencias:
education sin web conocida en ambos casos, y retail/b2b sin teléfono conocido en
ambos casos. No se forzaron más intercambios. El registro contiene cuatro descartes
por duplicado, sin descartes por cierre o conflicto de identidad en esa secuencia.
Los detalles están en los dos informes de muestra.

Una auditoría independiente sobre los veinte registros encontró cero pares exact,
strong-probable o probable. La evaluación tiene veinte entradas vacías. Los hashes
de los 3.247 archivos existentes de contenido y Comparison, tomados después de
restaurar los artefactos, permanecieron iguales tras generar la muestra. El
manifiesto se restauró desde el ZIP y no fue modificado por la selección.

Validación: 185 tests aprobados, Astro check sin errores ni advertencias y
content-lab:build correcto. No se ejecutó el experimento comercial ni ningún
pipeline editorial. No se corrigieron las referencias ausentes ni desayunos.

Se repitió el comando con los inputs reales: los veinte businessIds, el fingerprint
y todo el informe fueron idénticos salvo `generatedAt`. La plantilla humana se
preservó byte por byte, y los 3.247 hashes de entrada volvieron a coincidir.
