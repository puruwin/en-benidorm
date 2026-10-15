# Content Lab P3A.1: catálogo común y Discovery

## Arquitectura e identidad

No se crea una segunda base de negocios. `content/manifest.json` sigue siendo el índice
canónico y `ManifestEntry.id` (`businessId` para Business) es la identidad interna estable.
`content/discovered/<businessId>.json` conserva el snapshot normalizado más reciente y
`content/enriched/` continúa siendo una vista derivada.

Cada identificador externo se guarda como `(provider, identifier)` en `sources` y en
`discovery.sourceIdentifiers`. La clave serializada es `provider:identifier`. Un identificador
ya conocido resuelve al mismo `businessId`, aunque cambien nombre o slug en la fuente. Entre
fuentes distintas solo se fusionan registros si coinciden el tipo, el nombre normalizado y una
ubicación con precisión aproximada de un metro. Los homónimos sin coordenadas nunca se fusionan.
Una colisión de slug obtiene un sufijo determinista derivado de la fuente.

## Modelo persistente

`ManifestEntry.discovery` es opcional para leer manifests legacy y se normaliza al cargarlos.
Contiene:

- `state: discovered`, `firstSeenAt` y `lastSeenAt`;
- categorías y ámbitos geográficos acumulativos;
- aliases de fuente;
- `researchSelections[]`, separado por `purpose` y `contextId`, con fechas de selección e
  investigación;
- `editorialEligibility[]`, siempre contextual y separada de Discovery y research;
- historial append-only de avistamientos, fuentes nuevas, selección, investigación y evaluación.

Los propósitos admiten `editorial-business`, `editorial-comparison` y el contrato reservado
`opportunity-analysis`. P3A.1 no implementa Opportunity Analysis ni atribuye señales comerciales.

Una actualización combina tags y fuentes con el snapshot previo, conserva propiedades no
gestionadas por la pipeline y no borra artefactos downstream ni observaciones manuales. La fecha
de recuperación de una fuente se refresca; sus avistamientos históricos permanecen en el
manifest.

## Descubrimiento e integración

El adapter OSM admite categorías `hospitality`, `professional-services`, `retail` y
`attractions`. `professional-services` usa objetos OSM etiquetados con `office`; no presupone
que tengan web. La geografía se configura con `--area` y `--bbox=south,west,north,east`. Benidorm
mantiene además el filtro por su relación administrativa oficial.

`--research-limit` decide cuántos resultados se marcan para investigación, pero todos los
resultados únicos se persisten. En Discovery, el antiguo `--limit` se interpreta como alias
compatible de ese límite; en las demás fases conserva su significado previo.

Comparison carga primero `content/enriched/` y completa los IDs ausentes con una vista factual
determinista de `content/discovered/`. Sus límites direct/potential siguen en la configuración de
topic y no reducen el catálogo. Selection no cambia sus umbrales, scoring ni gates. Al ejecutar
Selection y Enrichment reales se registran, respectivamente, `selectedForResearch`, `researched`
y la evaluación editorial contextual.

Ejemplo:

```bash
npm run content:discover -- --area=Benidorm \
  --category=hosteleria,servicios --research-limit=25
```

Solo se consultan Nominatim y Overpass/OpenStreetMap, fuentes públicas ya utilizadas por el
proyecto. No se consultan directorios restringidos ni APIs de pago.

## Piloto del 15 de octubre de 2026

El catálogo previo contiene 474 negocios (367 restaurantes y 107 cafeterías), todos con
artefacto discovered y enriched. El refresco live combinado y el intento aislado de servicios
profesionales se ejecutaron. Las instancias globales devolvieron 500/502 o agotaron el timeout;
una instancia alternativa respondió correctamente pero con cero elementos para España, por lo
que la respuesta se considera sin cobertura útil y no como prueba de que no existan negocios.
No hubo escrituras parciales de entidades ni bajas del catálogo. El manifest sí quedó migrado al
contrato lifecycle de P3A.1. No es correcto declarar nuevos registros ni cobertura live inventada.

Métricas comprobables del piloto:

| Métrica | Resultado |
| --- | ---: |
| Catálogo antes/después del intento | 474 / 474 |
| Registros existentes auditados | 474 |
| Registros devueltos por el endpoint que completó | 0 (respuesta sin cobertura útil) |
| Nuevos persistidos | 0 |
| Duplicados live medidos | 0 sobre la respuesta vacía; no representativo |
| Seleccionados/investigados por el intento | 0 / 0 |

Las regresiones dry-run de Comparison sí recorrieron el catálogo completo: italiano 474
considerados (8 direct), arroces 474 (8 direct) y desayunos 474 (6 direct, 25 potential). No se
generaron artículos ni se alteraron artefactos Comparison.

## Limitaciones y P3A.2

- Overpass público no ofrece SLA; un run fallido no debe confundirse con catálogo vacío.
- La deduplicación cross-provider es deliberadamente conservadora. Teléfono/dominio podrían
  incorporarse como señales exactas en una fase posterior, con revisión de conflictos.
- `office=*` depende de cobertura comunitaria y no equivale a un censo mercantil.
- El historial guarda eventos de catálogo, no snapshots completos de cada campo.

Para P3A.2 se recomienda añadir checkpoints/reintentos por tipo y primitiva, un estado explícito
de run incompleto y un fallback cacheado a extractos OSM abiertos. Después puede construirse
Opportunity Analysis como consumidor de solo lectura de `businessId`, aliases y lifecycle, en un
artefacto separado: nunca añadiendo criterios comerciales a Selection ni modificando elegibilidad
editorial.
