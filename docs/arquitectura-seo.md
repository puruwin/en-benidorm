# Arquitectura SEO de enbenidorm.es

Fuente de verdad de rutas, hubs, indexación, enlazado y redirecciones. Desarrolla la issue #26 (issue #11).
Cualquier página nueva tiene que encajar aquí; si no encaja, primero se cambia este documento.

## 1. Modelo: hub → guías → fichas

    /  (inicio)
    │
    ├── /que-ver/ ─────────────── hub
    │     ├── /que-ver/{guía}/            guía (article)
    │     └── /que-ver/{lugar}/           ficha (place)
    │
    ├── /playas/ ──────────────── hub
    │     ├── /playas/{guía}/             guía (article)
    │     └── /playas/{playa}/            ficha (beach)
    │
    ├── /donde-comer/ ─────────── hub
    │     ├── /donde-comer/{tema}/        comparativa = página de categoría (comparison)
    │     │       └──► /restaurantes/{slug}/   ficha (business) · ruta con historial
    │     └── /donde-comer/{guía}/        guía (article)
    │
    ├── /que-hacer/ ───────────── hub
    │     └── /que-hacer/{guía}/          guía (article; eventos recurrentes vía event)
    │
    ├── /informacion-practica/ ── hub
    │     └── /informacion-practica/{guía}/  guía (article)
    │
    ├── /donde-dormir/ ────────── hub
    │     └── /donde-dormir/{guía}/       guía por zona o uso (article + area)  · sin fichas
    │
    └── /sobre-david/             autor (fuera de hubs)

    Enlaces:  hub ⇄ guía/comparativa ⇄ ficha   ·   ficha ⇄ ficha (misma zona / misma comparativa)
    Nunca:    hub → redirección → ficha

Reglas del modelo:

- Tres niveles como máximo. Una ficha cuelga de un hub; una guía o comparativa también.
- Dentro de un hub, el `slug` es único entre guías, comparativas y fichas, porque comparten espacio
  de nombres.
- Un hub no se genera ni sale en el menú hasta tener al menos una guía o ficha publicable. Así ya
  funciona `filterLinks` en `src/lib/routes.ts`.
- Las zonas (`area`) dan contexto y sirven de filtro, no de página. Una guía por zona vive en su hub
  (p. ej. `/donde-dormir/levante/`).

## 2. Hubs

| Hub | Ruta | Promesa (lo que el lector obtiene) | Tipos de Sanity |
| --- | --- | --- | --- |
| Qué ver | `/que-ver/` | Qué lugares de Benidorm y alrededores merecen la visita, cuánto tiempo piden y cómo llegar. Sitios físicos: miradores, casco antiguo, parques, monumentos. | `place` (fichas), `article` (guías), intro del hub en `siteSettings` |
| Playas | `/playas/` | Qué playa o cala elegir según lo que buscas (familia, accesibilidad, tranquilidad, parking), con servicios y accesos comprobados. | `beach` (fichas), `article` (guías), `siteSettings` |
| Dónde comer | `/donde-comer/` | Dónde comer según el plan (desayuno, arroz, menú del día…), con comparativas que explican por qué elegir cada local y con qué datos. | `comparison`, `business` (restaurante, bar, cafetería), `article`, `category` (temas), `siteSettings.diningPage` |
| Qué hacer | `/que-hacer/` | Planes y actividades: excursiones, parques temáticos, rutas, actividades acuáticas y fiestas o eventos que se repiten cada año. | `article` (guías), `event` (solo recurrentes, sin ruta propia), `place` como referencia, `siteSettings` |
| Información práctica | `/informacion-practica/` | Lo que hay que saber para organizar la visita: cómo llegar, moverse, aparcar, clima por meses, salud y emergencias. | `article` (guías), `siteSettings` |
| Dónde dormir | `/donde-dormir/` | En qué zona alojarse según el tipo de viaje y qué tipo de alojamiento conviene. No es un catálogo de hoteles. | `article` (guías), `area` (contexto), `siteSettings` |

Frontera Qué ver / Qué hacer: un **lugar** que se visita va en Qué ver; una **actividad** o un plan
va en Qué hacer. Si una actividad ocurre en un lugar con ficha, la guía de Qué hacer enlaza a esa
ficha de Qué ver.

## 3. Inventario de páginas

Estado: **E** existe y está publicada, **P** está prevista.

| Ruta | Estado | Hub padre | Necesidad que resuelve | Indexable | Enlaces que da | Enlaces que recibe |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | E | — | Orientarse y elegir por dónde empezar | Sí | Hubs generados, guías destacadas, fichas recomendadas | Todas (logo) |
| `/donde-comer/` | E | — | Elegir tipo de comida o plan gastronómico | Sí | Comparativas, guías y fichas del hub | Inicio, menú, migas de comparativas, guías y fichas |
| `/donde-comer/{tema}/` | E | Dónde comer | Decidir entre 4–8 locales para una intención concreta | Sí, si pasa el gate y la QA | Hub, cada ficha comparada, comparativas hermanas cuando aporten | Hub, fichas incluidas, guías relacionadas, inicio si está destacada |
| `/donde-comer/{guía}/` | P | Dónde comer | Contexto gastronómico que no es una comparativa (p. ej. platos típicos) | Sí, si pasa auditar-pagina | Hub, fichas o comparativas citadas | Hub y al menos otra página distinta |
| `/restaurantes/{slug}/` | E | Dónde comer | Datos comprobados de un local concreto, con procedencia | Sí si cumple `isIndexable` (evidencia, dirección, aportación propia, enlaces); si no, `noindex,follow` | Hub (migas), comparativas donde aparece, fichas de la misma zona o comparativa | Hub, comparativas, fichas hermanas (mínimo 2 páginas distintas) |
| `/que-ver/` | P | — | Saber qué visitar | Sí, cuando se genere | Guías y fichas de lugares | Inicio, menú, migas de sus páginas |
| `/que-ver/{lugar}/` | P | Qué ver | Cómo es, cómo se llega, horario y acceso de un lugar | Sí, con evidencia propia | Hub, lugares cercanos, guías de Qué hacer que lo usan | Hub, guías, lugares cercanos |
| `/que-ver/{guía}/` | P | Qué ver | Recorrido o selección (p. ej. «Benidorm en un día») | Sí, si pasa auditar-pagina | Hub, fichas de lugares y playas citadas | Hub y otra página distinta |
| `/playas/` | P | — | Elegir playa | Sí, cuando se genere | Fichas de playas, guías | Inicio, menú, migas |
| `/playas/{playa}/` | P | Playas | Servicios, accesibilidad, parking y accesos de una playa | Sí, con evidencia propia | Hub, playas cercanas, restaurantes de la zona si aportan | Hub, guías, playas vecinas |
| `/playas/{guía}/` | P | Playas | Comparar playas o calas para un uso (familias, calas cercanas…) | Sí, si pasa auditar-pagina | Hub, fichas de playas | Hub y otra página distinta |
| `/que-hacer/` | P | — | Elegir actividad | Sí, cuando se genere | Guías | Inicio, menú, migas |
| `/que-hacer/{guía}/` | P | Qué hacer | Planificar una actividad o un evento recurrente (fechas, precio, reserva) | Sí, si pasa auditar-pagina | Hub, fichas de Qué ver o Playas implicadas, Información práctica si toca transporte | Hub y otra página distinta |
| `/informacion-practica/` | P | — | Organizar la visita | Sí, cuando se genere | Guías | Inicio, menú, migas, guías de otros hubs |
| `/informacion-practica/{guía}/` | P | Información práctica | Resolver una duda logística (aeropuerto, TRAM, aparcar…) | Sí, si pasa auditar-pagina | Hub, guías de otros hubs que dependen del dato | Hub y guías que la necesitan |
| `/donde-dormir/` | P | — | Elegir dónde alojarse | Sí, cuando se genere | Guías por zona o uso | Inicio, menú, migas |
| `/donde-dormir/{guía}/` | P | Dónde dormir | Elegir zona o tipo de alojamiento según el viaje | Sí, si pasa auditar-pagina | Hub, guías de Qué ver o Playas de esa zona | Hub y otra página distinta |
| `/sobre-david/` | E | — | Quién escribe y con qué método (confianza) | Sí | Inicio, hubs | Pie de página, firma de guías y comparativas |
| `/404` | E | — | Recuperar la navegación | No | Inicio, hubs | — |

Reglas de indexación:

- La decisión index/noindex es una sola función, `isIndexable` en `src/lib/indexability.ts` (issue #15),
  con su contrato documentado allí. La usan `SeoHead` (meta robots) y `seo:audit`, que la repite con el
  grafo recién rastreado y da `indexability-mismatch` si no coinciden. Una ficha, comparativa o guía es
  indexable solo con evidencia (fuente oficial fechada, observación propia u observación de creador
  atribuida y fechada; en fichas, además la dirección), una aportación que se ve en la propia página
  (foto propia, comparación, condición práctica, advertencia o resumen de creador), enlaces
  contextuales suficientes y título y H1 propios que nombran el sujeto. Inicio, hubs y autor solo exigen
  enlaces y título/H1. Un `noIndex` guardado en el documento siempre gana.
- Toda página indexable, salvo `/`, recibe enlaces del cuerpo de al menos 2 páginas distintas
  (`MIN_INCOMING_LINKS`). No cuentan el menú, las migas ni el pie de página, ni los enlaces que pasan
  por una redirección.
- Los enlaces salen de `content/reports/seo/crawl.json`: `npm run build` hace dos pasadas (build →
  `seo:audit --graph-only` → build) para que la segunda lea el grafo del mismo contenido.
- Una guía o comparativa indexable pasa `auditar-pagina` y, si tiene datos prácticos,
  `verificar-datos`. Si no tiene enlaces que merezca, probablemente no merece ser indexable.
- Una ficha con contenido de demo nunca se indexa ni se enlaza desde contenido real.

## 4. Política de redirecciones

1. **Las URLs con historial se conservan.** Tiene historial toda URL que haya estado publicada en
   producción (todo lo que se ha desplegado desde `main`). Hoy son: `/`, `/donde-comer/`,
   `/donde-comer/{slug}/` de cada comparativa publicada, `/restaurantes/{slug}/` y `/sobre-david/`.
   No se renombran para que queden más bonitas; `/restaurantes/` se queda aunque el resto de fichas
   vayan bajo su hub.
2. **Un hub nunca redirige a una ficha**, ni a una guía. Un hub sin contenido no se genera; si ya
   estuvo publicado, se mantiene con el contenido que tenga (o con `noindex`), no redirige.
3. **Solo se redirige a contenido equivalente:** de ficha a ficha (cambio de slug o fusión de
   duplicados), de guía a guía (fusión) y de comparativa a comparativa (fusión de temas). Si no hay
   equivalente, se redirige al hub padre, nunca a una ficha suelta.
4. **Página que pierde calidad** (una comparativa que deja de pasar el gate, una ficha sin evidencia
   vigente): se mantiene la URL con `noindex` y enlaces a su hub. No se borra ni se redirige para
   esconder el problema.
5. **Negocio cerrado:** solo con evidencia actual que lo confirme (principios editoriales, §6). La
   ficha se mantiene, marcada como cerrada y con `noindex`, y sale de las comparativas. Si hay
   evidencia débil o contradictoria, el estado es «needs verification», no «cerrado».
6. **No enlazar redirecciones:** los enlaces internos apuntan al destino final (`link-to-redirect`
   en `seo:audit`). La redirección se queda para los enlaces externos.
7. Las rutas de `routes.ts` que nunca se han publicado (`/guias/`, `/eventos/`, `/informacion/`) no
   tienen historial: se eliminan sin redirección.

## 5. Temas descartados

No se publican ni listados ni fichas de directorios sin aporte propio: páginas que solo repetirían
nombre, dirección, teléfono y horario, lo mismo que ya da Google Maps, sin criterio para elegir ni
datos comprobados.

- Servicios personales: peluquerías, gimnasios, estancos.
- Servicios para residentes: talleres, fontaneros, cerrajeros, inmobiliarias, gestorías, dentistas,
  abogados, clínicas.
- Comercio genérico: supermercados, tiendas de ropa, souvenirs, ópticas. Un dato práctico concreto
  (p. ej. farmacias de guardia) puede ir dentro de una guía de Información práctica, no como listado.
- Listado de todos los hoteles o apartamentos: Dónde dormir solo publica guías por zona o uso.
- Listado de todos los bares o pubs: el ocio nocturno entra solo como guía o comparativa con
  criterio.

Un tema descartado puede volver solo si existe una intención de visitante clara y un aporte que no
dé Maps (comparativa con gate, datos verificados). Ese cambio se hace primero en este documento.

## 6. Pendiente para la implementación (sesión aparte)

- `src/lib/routes.ts`: quitar `guides`, `guide`, `events` e `information`; añadir
  `informationPractical`, `beach`, `place` y las rutas de guía por hub; resolver la colisión
  `diningCategory`/comparativa.
- `article.section`: valores por hub (hoy solo `guides`, `thingsToDo` e `information`).
- `siteSettings`: intro y SEO de cada hub, como hoy `diningPage`.
- `/donde-comer/` «Elige por estilo»: enlazar solo categorías con comparativa publicada.
- Validar que un `slug` es único dentro de cada hub.
