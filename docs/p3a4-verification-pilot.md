# P3A.4 — piloto de Verification Enrichment

Fecha: 2026-10-15. Muestra: los mismos 24 `businessId` de P3A.2/P3A.3, seleccionados por round-robin determinista entre `hospitality`, `professional-services` y `retail` en Benidorm. No se eligieron por apariencia de oportunidad.

## Resultado agregado

- 24 procesados; 0 errores finales de crawl (el primer intento en sandbox produjo 2 errores de red y se repitió con acceso autorizado).
- Evidencia de identidad nueva: 24 (4 `strong-match`, 20 `probable-match`, 0 conflictos).
- Evidencia operativa nueva: 3 (2 `supported-open`, 1 `supported-closed`); 21 siguen `insufficient`.
- Presencia web candidata: 2; web oficial local respaldada: 1; web de marca: 1.
- Teléfono: 4 negocios; formulario de contacto: 0; booking: 0. Se observó 1 email explícito y 7 enlaces sociales, todos conservando el alcance de su fuente.
- Señales técnicas: 2 webs reachable, 2 TLS válidos, 2 viewport móvil.
- Extracción comercial: 3 productos, 0 servicios, 0 precios y 0 horarios verificables en las páginas recorridas.
- No se usaron ratings/reviews, no se infirieron emails y ninguna señal convirtió automáticamente una review en `verified`.

## Antes / después

| Business | Categoría | Antes (review) | Identidad automática | Operación automática | Presencia/contacto nuevo | Después (review) |
|---|---|---|---|---|---|---|
| business-100-montaditos | hospitality | rejected | probable | insufficient | web de marca | rejected |
| business-albereda-36 | retail | reviewing | probable | insufficient | — | reviewing |
| business-112-technology | professional-services | reviewing | strong | insufficient | teléfono | reviewing |
| business-7-spices | hospitality | unreviewed | probable | insufficient | — | unreviewed |
| business-area | retail | unreviewed | probable | insufficient | — | unreviewed |
| business-1950 | professional-services | reviewing | probable | insufficient | — | reviewing |
| business-abuela-herminia | hospitality | rejected | probable | supported-closed | etiqueta OSM supporting | rejected |
| business-asegil | retail | unreviewed | probable | insufficient | — | unreviewed |
| business-aaron-sanchis | professional-services | unreviewed | probable | insufficient | — | unreviewed |
| business-al-terrazzo | hospitality | unreviewed | strong | insufficient | teléfono | unreviewed |
| business-asisa | retail | verified | probable | supported-open | check_date OSM supporting | verified |
| business-acero-puro | professional-services | unreviewed | probable | insufficient | — | unreviewed |
| business-alfredo | hospitality | unreviewed | probable | insufficient | — | unreviewed |
| business-axa | retail | unreviewed | probable | insufficient | — | unreviewed |
| business-agara | professional-services | unreviewed | probable | insufficient | — | unreviewed |
| business-amazonas | hospitality | unreviewed | probable | insufficient | — | unreviewed |
| business-ayuso | retail | unreviewed | probable | insufficient | — | unreviewed |
| business-agencia-de-viajes-hispania | professional-services | unreviewed | probable | insufficient | — | unreviewed |
| business-amigo | hospitality | unreviewed | probable | insufficient | — | unreviewed |
| business-benidorm-ncs-consulting | retail | unreviewed | probable | insufficient | — | unreviewed |
| business-agraz | professional-services | reviewing | strong | insufficient | teléfono | reviewing |
| business-amigos | hospitality | reviewing | strong | insufficient | web local, teléfono | reviewing |
| business-castillo | retail | verified | probable | supported-open | check_date OSM supporting | verified |
| business-al-paradise | professional-services | unreviewed | probable | insufficient | — | unreviewed |

## Segunda pasada manual representativa

Se inspeccionaron `100 Montaditos`, `Abuela Herminia`, `Asisa`, `Castillo`, `Amigos`, `112 Technology`, `Agraz` y `Albereda 36`. La evidencia automática ayudó a localizar rápidamente los dos `check_date` recientes, la marca sin página local, la web local candidata y cuatro teléfonos. No se modificó ni ratificó automáticamente ninguna review:

- Asisa y Castillo permanecen `verified`; la evidencia nueva es supporting y no reemplaza la decisión humana existente.
- 100 Montaditos y Abuela Herminia permanecen `rejected`; marca activa o señal OSM no resuelven sus conflictos/rechazo.
- Amigos, 112 Technology, Agraz y Albereda 36 permanecen `reviewing`: identidad o contacto mejoraron, pero no hay evidencia operativa suficiente.

Opportunity Analysis, reejecutado después, conserva el resultado de P3A.3: 2 `analyzed`, 2 `not-actionable`, 20 `needs-review` y cuatro hipótesis (dos `web-presence`, dos `content`). La ausencia de variación es deliberada: Verification aporta soporte al revisor, no decisiones.
