# P3A.5a — Discovery comercial y cobertura sectorial

Discovery conserva `EntityType` y `DiscoveryCategory` como contratos editoriales legacy. La clasificación comercial vive en `businessClassification`, no interviene en Selection, Comparison, Opportunity Analysis, Human Review ni Verification.

## Geografía

Áreas CLI admitidas por `--area`: `Benidorm`, `La Nucía`, `l'Alfàs del Pi`, `Albir` y `target` (bbox conjunto). También se admite un `--bbox=south,west,north,east` explícito. Los providers filtran el bbox antes de persistir. La asignación de municipio/zona prioriza `addr:city`, `addr:municipality`, `addr:place`, `is_in:city` e `is_in`; sólo usa coordenadas en zonas interiores conservadoras. Lo ambiguo queda en `unknown`.

## Taxonomía y tags OSM

La tabla resume los tags que alimentan cada sector. El detalle normativo, los valores admitidos y el orden canónico reproducible están en `OSM_BUSINESS_RULES` (`scripts/content/lib/business-taxonomy.ts`). Todos los tags originales permanecen en `raw.tags`.

| sector | tags OSM y subsectores |
|---|---|
| hospitality | `amenity=restaurant/fast_food/food_court` → restaurant; `cafe` → cafe; `bar/pub/biergarten` → bar; `amenity/shop=ice_cream`; `shop=bakery/pastry/confectionery` |
| beauty-wellness | `shop=hairdresser/barber/beauty/cosmetics/nail_salon/massage`; `beauty=nails/salon`; `leisure=spa/fitness_centre/sports_centre`; `sport=fitness` |
| healthcare | `amenity=dentist/clinic/doctors/veterinary/physiotherapist/pharmacy`; `healthcare=dentist/physiotherapist/podiatrist/veterinary/clinic/doctor/pharmacy`; `shop=optician` |
| professional-services | `office=lawyer/accountant/tax_advisor/insurance/consulting/architect/engineer/translator/travel_agent`; `shop=insurance/travel_agency` |
| real-estate | `office=estate_agent/property_management/holiday_rental`; `shop=estate_agent`; `rental=holiday_apartment` |
| home-services | `craft=builder/renovation/electrician/plumber/hvac/carpenter/painter/gardener/swimming_pool/locksmith/handyman`; `office=construction_company/cleaning/maintenance`; varios `shop` específicos |
| automotive | `shop=car_repair/tyres/car_detailing/car/car_rental/motorcycle/motorcycle_repair/car_parts`; `amenity=car_wash/car_rental` |
| education | `amenity=college/language_school/driving_school/music_school/childcare/kindergarten`; `office=educational_institution/tutoring` |
| retail | `shop=furniture/bed/kitchen/interior_decoration/houseware/curtain/lighting/computer/mobile_phone/mobile_phone_accessories/appliance/electronics/clothes/shoes/fashion/bag/accessories/leather/jewelry/jewellery/watches`; cualquier otro `shop=*` → specialty-shop |
| tourism | `tourism=hotel/hostel/guest_house/motel/apartment/camp_site/caravan_site/attraction/museum/theme_park/information`; `leisure=water_park`; `office=tourism` |
| b2b-services | `office=it/advertising_agency/company` |
| other | ningún match comercial reproducible → `other/unknown` |

Cuando coinciden varios tags, se guardan todos en `matches`; el primer rule específico define `sector/subsector`. Un `shop=*` no mapeado cae de forma explícita en `retail/specialty-shop`; una entidad sin regla comercial cae en `other/unknown`.

## Provider y extractos

`DiscoveryProvider` formaliza `id`, `discover`, `normalize` y `provenance`. OSM continúa como provider principal mediante Overpass o un extracto JSON Overpass local pasado con `--osm-extract`. La provenance registra dataset, nombre/origen local, URL fuente opcional, fecha de descarga opcional, atribución OSM y licencia ODbL.

## Cobertura

Cada ejecución persistente recalcula `content/reports/discovery-coverage/latest.json` y `.md` sobre el catálogo completo. Las métricas se agrupan por sector y municipio e incluyen identidad, web, teléfono, email, dirección, coordenadas, horarios, fecha reciente, providers y candidatos a duplicado. Son métricas de representación OSM: cero resultados nunca se interpreta como ausencia real de empresas.
