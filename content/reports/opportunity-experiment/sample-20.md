# Opportunity Experiment — muestra 20

Seed: frappe-pilot-01

Fingerprint: 246ee95d31694e48effa2a7b28daf9827a87c7079d9228eb357ccd967b860587

Taxonomía: osm-business-p3a5a-b469be6b2c56b1055e680c812c2d5c0597508747589aad25f1ab5028c861ad0c

Generado: 2026-10-16T04:34:16.987Z

Sorteo por SHA-256(seed,businessId), cuotas sectoriales y representación de ambos sectores agrupados; objetivo geográfico 13/4/3 con alternativas 14/4/2 y 14/3/3. Sin score comercial ni informativo. Duplicados exact/strong sin resolución canónica excluidos; probable incompatible dentro de la muestra.

Número de familias presentes: web, teléfono, email, dirección, horarios, descripción, fecha de revisión y detalles de servicio. sparse=0–1; moderate=2–4; rich=5–8. Descriptivo, no criterio de elegibilidad ni ranking.

| businessId | Negocio | Sector | Subsector | Municipio | Web | Teléfono | Email | Metadata |
|---|---|---|---|---|---|---|---|---|
| business-europcar | Europcar | automotive | rental | Benidorm | sí | sí | no | rich |
| business-seguricar-primoti | Seguricar / Primoti | automotive | rental | l'Alfàs del Pi | no | no | no | sparse |
| business-server-ip | Server Ip | b2b-services | it-services | Benidorm | no | no | no | moderate |
| business-koketas | Koketas | beauty-wellness | hairdresser | Benidorm | no | sí | no | moderate |
| business-brooklyn-fitboxing | Brooklyn Fitboxing | beauty-wellness | fitness | Benidorm | no | no | no | sparse |
| business-tirolinasgo-alicante-forestal-park | TirolinasGo Alicante Forestal Park | beauty-wellness | fitness | La Nucía | sí | sí | no | moderate |
| business-autoescula-el-cruce | Autoescula El cruce | education | driving-school | La Nucía | no | no | no | sparse |
| business-escuela-infantil-altea | Escuela Infantil Altea | education | childcare-activities | l'Alfàs del Pi | no | sí | no | moderate |
| business-farmacia-salort | Farmacia Salort | healthcare | pharmacy | La Nucía | no | no | no | sparse |
| business-optima-vision | Óptima Visión | healthcare | optician | Benidorm | sí | sí | no | rich |
| business-vilar | Vilar | home-services | electrician | l'Alfàs del Pi | no | no | no | sparse |
| business-cafeteria-costa-games-2 | Cafetería Costa Games 2 | hospitality | bar | Benidorm | no | no | no | sparse |
| business-winston | Winston | hospitality | bar | Benidorm | no | sí | no | moderate |
| business-amigos-bistro | Amigos Bistro | hospitality | restaurant | Benidorm | sí | sí | no | rich |
| business-veronica-corbacho | Verónica Corbacho | professional-services | lawyer | Benidorm | no | no | no | moderate |
| business-j-garcia-llorente | J. García Llorente | professional-services | accountant | Benidorm | no | no | no | moderate |
| business-marco-polo | Marco Polo | professional-services | travel-agency | Benidorm | sí | sí | no | rich |
| business-fincas-arena | Fincas Arena | real-estate | property-management | Benidorm | no | no | no | moderate |
| business-benipisos | Benipisos | real-estate | estate-agent | Benidorm | sí | sí | no | moderate |
| business-mari-andre | Mari-André | retail | fashion | l'Alfàs del Pi | sí | no | no | sparse |

## Métricas

```json
{
  "sectors": {
    "automotive": 2,
    "b2b-services": 1,
    "beauty-wellness": 3,
    "education": 2,
    "healthcare": 2,
    "home-services": 1,
    "hospitality": 3,
    "professional-services": 3,
    "real-estate": 2,
    "retail": 1
  },
  "municipalities": {
    "Benidorm": 13,
    "La Nucía": 3,
    "l'Alfàs del Pi": 4
  },
  "withWebsite": 7,
  "withoutWebsite": 13,
  "withPhone": 9,
  "withoutPhone": 11,
  "withEmail": 0,
  "withoutEmail": 20,
  "metadata": {
    "moderate": 9,
    "rich": 4,
    "sparse": 7
  }
}
```

## Sustituciones y exclusiones

```json
{
  "exclusions": [
    {
      "businessId": "business-sanigrif-d49efa",
      "name": "Sanigrif",
      "reasons": [
        "duplicate"
      ],
      "relatedBusinessIds": [
        "business-sanigrif"
      ]
    },
    {
      "businessId": "business-mercadona-704685",
      "name": "Mercadona",
      "reasons": [
        "duplicate"
      ],
      "relatedBusinessIds": [
        "business-mercadona",
        "business-mercadona-2cdaa7",
        "business-mercadona-412157",
        "business-mercadona-74d161",
        "business-mercadona-77ddc0",
        "business-mercadona-b685be",
        "business-mercadona-ccd0ee",
        "business-mercadona-fcb624"
      ]
    },
    {
      "businessId": "business-consum-a3c9a6",
      "name": "Consum",
      "reasons": [
        "duplicate"
      ],
      "relatedBusinessIds": [
        "business-consum",
        "business-consum-fb154f"
      ]
    },
    {
      "businessId": "business-ale-hop-790133",
      "name": "ALE-HOP",
      "reasons": [
        "duplicate"
      ],
      "relatedBusinessIds": [
        "business-ale-hop",
        "business-ale-hop-1922a7",
        "business-ale-hop-5cc94a",
        "business-ale-hop-86a39a"
      ]
    }
  ],
  "substitutions": [
    {
      "discardedBusinessId": "business-sanigrif-d49efa",
      "replacementBusinessId": "business-mari-andre",
      "reasons": [
        "duplicate"
      ]
    },
    {
      "discardedBusinessId": "business-mercadona-704685",
      "replacementBusinessId": "business-mari-andre",
      "reasons": [
        "duplicate"
      ]
    },
    {
      "discardedBusinessId": "business-consum-a3c9a6",
      "replacementBusinessId": "business-mari-andre",
      "reasons": [
        "duplicate"
      ]
    },
    {
      "discardedBusinessId": "business-ale-hop-790133",
      "replacementBusinessId": "business-mari-andre",
      "reasons": [
        "duplicate"
      ]
    }
  ],
  "duplicateReplacements": [],
  "diversityRepairs": [
    {
      "discardedBusinessId": "business-restaurante-bar-la-valenciana",
      "replacementBusinessId": "business-amigos-bistro",
      "field": "knownWebsite"
    },
    {
      "discardedBusinessId": "business-maribel",
      "replacementBusinessId": "business-tirolinasgo-alicante-forestal-park",
      "field": "knownWebsite"
    },
    {
      "discardedBusinessId": "business-seguros-occident",
      "replacementBusinessId": "business-marco-polo",
      "field": "knownWebsite"
    },
    {
      "discardedBusinessId": "business-energy-vet",
      "replacementBusinessId": "business-optima-vision",
      "field": "knownWebsite"
    },
    {
      "discardedBusinessId": "business-motos-syf",
      "replacementBusinessId": "business-europcar",
      "field": "knownWebsite"
    },
    {
      "discardedBusinessId": "business-batik",
      "replacementBusinessId": "business-mari-andre",
      "field": "knownWebsite"
    }
  ]
}
```

## Desviaciones y controles de diversidad

- education: muestra homogénea en knownWebsite; se conserva el sorteo neutral, sin score informativo.
- retail / b2b-services: muestra homogénea en knownPhone; se conserva el sorteo neutral, sin score informativo.

P3A.5a: desayunos pasa de 31 a 33 candidatos. No se corrige ni se reejecuta el pipeline editorial.

No se ha ejecutado análisis comercial, investigación web, verificación adicional, propuestas ni contacto.
