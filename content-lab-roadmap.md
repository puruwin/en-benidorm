# Content Lab — Current Roadmap

## Current status

The project has completed:

- P0 — integrity and source/identity rules
- P1 — gap-oriented research
- P2 — structured commercial extraction
- P3A.1 — shared business catalog
- P3A.1b — resilient discovery/checkpoints
- P3A.2 — Opportunity Analysis
- P3A.3 — Human Review
- P3A.4 — Verification Enrichment
- P3A.5a — Business Discovery Expansion

The immediate next task is:

## P3A.5b — Prepare the 20-business commercial experiment sample

P3A.5a concluded that the catalog is now diverse enough to prepare the experiment.

Do **not** add more discovery architecture before preparing the sample.

---

## P3A.5a result

Catalog:

- 3,103 businesses
- Benidorm, La Nucía and l'Alfàs/Albir represented
- taxonomy spans hospitality, beauty, healthcare, professional services, real estate, home services, automotive, education, retail, tourism and B2B

Known limitations:

- Benidorm heavily dominates the catalog
- hospitality and retail dominate sector share
- several service sectors remain underrepresented in OSM
- contact and website coverage remain low

This is acceptable for the next experiment if sampling is stratified and limitations are recorded.

---

## P3A.5b target

Create a deterministic, reproducible sample of 20 businesses.

Target allocation:

- 3 hospitality
- 3 beauty-wellness
- 3 professional-services
- 3 real-estate / home-services
- 2 healthcare
- 2 automotive
- 2 education
- 2 retail / b2b-services

Geographic intent:

- mostly Benidorm,
- but include La Nucía,
- include l'Alfàs/Albir when candidate quality allows.

The selector must not optimize for “bad digital presence”.

Include a neutral mix of:

- businesses with/without known website,
- businesses with/without phone,
- sparse/moderate/rich metadata.

Exclude only clear invalid cases such as:

- confirmed closure,
- severe unresolved identity conflict,
- unresolved exact/strong duplicate,
- unusable location,
- clearly non-commercial entity.

Persist:

- sample JSON,
- sample Markdown,
- empty manual evaluation template.

Do not run the experiment itself during P3A.5b.

---

## After P3A.5b: Commercial usefulness experiment

Once the 20-business sample exists, run the experiment.

For each business, Content Lab should attempt to provide:

### Identity
- name
- sector
- location
- external IDs

### Digital presence
- official/candidate/no website
- phone
- explicit email
- forms
- booking
- social presence

### Commercial information
- services
- products
- prices
- hours
- observable customer journey

### Evidence state
- identity confidence
- operational evidence
- conflicts
- review requirement

### Commercial hypothesis

Only when evidence supports one.

Classify the result:

- A — worth immediate commercial review
- B — potential but needs more research
- C — little commercial signal
- D — do not contact / invalid / closed / conflict

Do not use a numeric score.

---

## Human evaluation fields

David should manually evaluate each business using fields equivalent to:

```json
{
  "businessId": "...",
  "wouldContact": "yes | no | maybe",
  "commercialAngle": "",
  "usefulWithoutExtraResearch": "yes | no",
  "estimatedManualMinutesSaved": null,
  "comments": ""
}
```

These fields must not be auto-filled.

---

## Experiment metrics

Measure:

### Coverage rate

Businesses where Content Lab provides enough context to make a meaningful decision without starting from zero.

### Actionable rate

Businesses that end up as genuinely worthwhile immediate prospects.

### Potential rate

Businesses that are either actionable or plausible after limited extra research.

Also record:

- number of specific hypotheses,
- number of generic hypotheses,
- businesses needing substantial external research,
- sources per business,
- approximate automatic analysis time,
- recurring missing information.

---

## Decision after the experiment

Do not automatically continue building.

Use the result to choose among:

### Continue automation

If Content Lab consistently surfaces useful, specific opportunities and saves meaningful research time.

### Improve sources

If the main failure is lack of public/business-source coverage.

### Simplify

If the architecture produces too much workflow relative to the value of the result.

### Reduce or abandon Opportunity Analysis

If commercial prospecting still requires nearly the same manual effort as researching businesses from scratch.

---

## enBenidorm editorial work to revisit

The commercial experiment temporarily took priority, but editorial work remains active.

Important pending issue:

The expanded catalog changed the breakfast selection universe.

Historical breakfast artifacts should not be trusted as current.

When returning to editorial work:

1. rerun Selection/Enrichment with the expanded catalog,
2. review the changed candidate cohort,
3. reassess whether discovered candidates are actually editorially recommendable,
4. implement or finalize editorial eligibility before Generation if still needed,
5. regenerate only after the new cohort passes integrity and quality checks.

Do not force a comparison to pass by lowering gates or re-including weak candidates.

---

## Near-term priority order

1. P3A.5b — prepare representative 20-business sample.
2. Run the commercial usefulness experiment.
3. Review results manually.
4. Decide whether commercial Opportunity Analysis merits further investment.
5. Return to enBenidorm editorial pipeline with the expanded catalog.
