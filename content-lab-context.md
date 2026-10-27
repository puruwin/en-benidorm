# Content Lab — Technical and Product Context

## 1. Why Content Lab exists

Content Lab started as infrastructure for **enBenidorm.es**, a local SEO project used to:

- learn and practice SEO,
- regain a steady development/content-production rhythm,
- create useful local editorial content,
- investigate how much of local-content research can be systematized.

Content Lab serves enBenidorm.es only. A commercial prospecting use case was explored and discontinued on 2026-10-26; its code and artifacts were removed.

The current priority is the editorial SEO plan tracked in GitHub issue #26.

---

## 2. Editorial pipeline evolution

The editorial Comparison pipeline evolved through several stages.

### P0 — Integrity and identity

Implemented protections around:

- source classification,
- source scope,
- local-vs-brand evidence,
- operational status,
- identity resolution,
- evidence ID uniqueness,
- manual observation provenance,
- conflict handling.

Important concepts include:

- `sourceClass`
- `claimScope`
- `operationalStatus`
- `needsVerification`

A brand-level source must not automatically become local-establishment evidence.

Third-party closure/opening signals are supporting evidence, not automatic truth.

---

### P1 — Gap-oriented research

Research was changed from a potential-candidates-only process into a reusable planner.

The planner now:

- calculates current coverage,
- identifies missing dimensions,
- prioritizes research,
- researches incomplete `direct` candidates as well as `potential` candidates,
- reuses the shared Business crawler,
- records attempted URLs, discarded URLs, crawl limitations and reasons,
- uses persistent cache/fingerprints.

This made research explainable even when it finds nothing.

---

### P2 — Structured offer extraction (menus, prices, hours)

The shared crawler/extractor was extended to process:

- HTML lists,
- tables,
- cards,
- nested links/text,
- JSON-LD:
  - `Menu`
  - `MenuItem`
  - `Product`
  - `Offer`
  - `Service`
  - `OpeningHoursSpecification`
- embedded JSON via `JSON.parse` only,
- text-layer PDFs.

It does **not**:

- run page JavaScript,
- perform OCR,
- render scanned PDFs.

Offer findings are normalized as structured items such as:

- product,
- service,
- specialty,
- price,
- currency,
- observed date,
- confidence,
- exact source URL.

One important result was La Murada, where P2 extracted a real menu with products, prices and hours. This demonstrated that the extraction layer adds meaningful evidence rather than just more facts.

---

## 3. Comparison lessons

The breakfast comparison exposed a structural problem:

A business can be topically relevant but still be a poor editorial recommendation.

The system previously risked conflating:

- “we know enough facts about this business”
with
- “this business deserves to be recommended”.

Important examples:

- some businesses had good web coverage but were not necessarily emblematic,
- some potentially good local businesses had weak online documentation,
- weak candidates could block an entire comparison because every confirmed candidate was fed into the gate.

The resulting principle is:

> Editorial quality must not be determined by data availability alone.

Selection, topic confirmation, editorial eligibility, cohort gating and generation should be separate concepts.

A future editorial-eligibility layer is still relevant and pending (see GitHub issues #15 and #19).

---

## 4. Manual observations

Manual observations exist to add human-verified evidence without pretending it came from an automated source.

They preserve:

- author,
- date,
- source nature,
- fields/facts observed,
- optional URL,
- provenance.

They must not be used to manufacture missing dimensions.

### Practical facts (place, beach, practical-information articles)

Prices, hours, access and fees for places, beaches and practical guides (parking, transport, markets)
live once in `content/facts/<municipality>/<topic>.json` (`scripts/content/lib/practical-facts.ts`).

- Stable id `<municipality>.<subject>.<attribute>[.<qualifier>]`, a closed `unit` and `municipality`.
- Each claim reuses `SourceProvenance`; `sourceClass` is the evidence hierarchy of the editorial principles.
- Status is derived, never written: `unknown` (no claims), `conflict` (different values, unless a
  human `resolution` dated on or after the newest claim), `confirmed` (an official or first-party
  observed claim), `needs verification` (only open data / third party).
- Official claims need a URL whose host David approved in `content/facts/official-sources.json`;
  observed claims need an `observationRef` to a file in `content/manual/` with the same date.
- Pages cite facts in `practicalFacts[]` (a snapshot; `value` only when `confirmed`, as canonical
  text because a Sanity field cannot hold mixed types). `content:validate`
  and `content:import` block a page that cites a fact in conflict, an out-of-date copy, or the same
  fact with different values elsewhere, and a page that includes a place outside Benidorm without a
  `travelNotes[]` entry for that municipality.
- Figures written in free text (`body`) are not checked here; that is the `verificador` agent's job.

---

## 5. Shared business catalog

Content Lab now uses a persistent business catalog.

Canonical identity remains in:

- `content/manifest.json`

Per-business discovery snapshots remain in:

- `content/discovered/<businessId>.json`

The catalog supports lifecycle information such as:

- first seen,
- last seen,
- discovery source IDs,
- categories,
- geography,
- research selections,
- downstream evaluation metadata,
- history.

`businessId` is the stable internal identifier.

External IDs are preserved as provider + identifier.

---

## 6. Discovery resilience

Public Overpass proved unreliable for broad local discovery.

P3A.1b added:

- resumable discovery,
- per-unit checkpoints,
- retries,
- timeout handling,
- exponential backoff,
- `Retry-After`,
- partial-run handling,
- `anomalous-empty`,
- local Overpass JSON imports,
- detailed run reports.

A failed or anomalously empty run must never be interpreted as “there are no businesses”.

Regional/local OSM extracts are preferred for reproducible broad discovery.

Overpass is better suited to incremental refreshes.

---

## 7. Sector taxonomy

P3A.5a introduced a sector taxonomy independent of raw OSM tags.

Main sectors:

- hospitality
- beauty-wellness
- healthcare
- professional-services
- real-estate
- home-services
- automotive
- education
- retail
- tourism
- b2b-services
- other

Original OSM tags remain preserved.

It organizes the catalog. It must not alter editorial Comparison behavior unless explicitly designed to do so.

---

## 8. Current catalog scale

After P3A.5a:

- businesses before expansion: 930
- businesses after expansion: 3,103
- net new businesses: 2,173
- total entities including tourism/place entities: 3,177
- unknown sector: about 1.5%

Pilot geography:

- Benidorm
- La Nucía
- l'Alfàs del Pi
- Albir

Approximate business distribution:

- Benidorm: 2,626
- l'Alfàs del Pi: 298
- La Nucía: 117
- unresolved geography: 62

Sector distribution:

- hospitality: 1,252
- retail: 1,024
- beauty-wellness: 217
- tourism: 197
- healthcare: 109
- real-estate: 83
- professional-services: 51
- automotive: 46
- other: 46
- home-services: 37
- education: 22
- b2b-services: 19

The catalog is still biased:

- hospitality + retail ≈ 73.3%
- Benidorm ≈ 84.6%

OSM appears reasonably useful for:

- hospitality,
- retail,
- beauty/wellness,
- healthcare,
- real-estate,
- tourism.

It is weaker for:

- professional services,
- home services,
- automotive,
- education,
- B2B services.

That weakness must be interpreted as **OSM underrepresentation**, not lack of real businesses.

---

## 9. Catalog data coverage

After the P3A.5a pilot, approximate coverage was:

- website: 14.1%
- phone: 19.3%
- email: 1.9%
- address: 63.3%
- coordinates: approximately 100%
- opening hours: 4.0%
- recent explicit check date: 19.3%

This explains why editorial facts often need an official source or a human check before publication.

---

## 10. Duplicate handling

Deduplication is intentionally conservative.

Identity signals may include:

- normalized name,
- coordinates,
- phone,
- domain,
- address.

Candidate relationships may be:

- exact,
- strong-probable,
- probable,
- unresolved.

Ambiguous candidates must not be automatically merged.

---

## 11. Current product-level conclusion

Content Lab has demonstrated strong potential for **enBenidorm.es**.

The next proof point is not another architectural layer. It is whether the editorial plan (GitHub issue #26) turns the pipeline into pages that are useful, verifiable and indexable.

Further architecture should be justified by an issue of that plan.
