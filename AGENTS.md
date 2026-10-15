# AGENTS.md

## Project overview

This repository contains **enBenidorm.es** and **Content Lab**.

The project has three related but distinct goals:

1. **enBenidorm.es**: build a useful local SEO/content project focused on Benidorm and surrounding areas.
2. **Content Lab**: build a reusable, auditable system for discovering businesses, enriching their data, generating evidence-backed editorial content, and evaluating data quality.
3. **Frappé Tech opportunity discovery**: reuse the same local-business research infrastructure to identify potential commercial opportunities for Frappé Tech without confusing commercial hypotheses with facts.

These goals share data and infrastructure, but their decisions must remain separated.

Before changing Content Lab, read:

- `content-lab-context.md`
- `content-lab-roadmap.md`
- `enbenidorm-editorial-principles.md`
- `frappe-opportunity-strategy.md`

## Core architectural rules

### Separation of concerns

Keep these layers independent:

- Discovery
- Business enrichment
- Comparison Selection
- Comparison Enrichment
- Editorial eligibility / cohort gating
- Generation
- QA
- Opportunity Analysis
- Verification Enrichment
- Human Review

A change intended for Frappé commercial prospecting must not silently change editorial Selection, Comparison gates, ranking, or Generation.

A change intended for editorial quality must not turn commercial hypotheses into facts.

### Provenance first

Any fact that can influence:

- editorial inclusion,
- business identity,
- operational status,
- commercial opportunity,
- or generated content

must preserve provenance.

Prefer explicit evidence over inference.

Do not fill missing fields merely to improve coverage.

Do not promote:

- brand-level evidence to a local establishment,
- third-party claims to first-party facts,
- a candidate URL to an official URL,
- a reachable website to proof that a business is open.

### Human decisions

Human reviews must remain separate from automatic evidence.

Automatic analysis may propose or support a conclusion, but must not silently overwrite a manual decision.

### Compatibility

Preserve compatibility with legacy artifacts unless a migration is explicitly required.

Do not delete or rewrite downstream artifacts merely to make a new pipeline pass.

### Security

Maintain existing protections around:

- SSRF
- redirects
- same-domain crawling
- request limits
- file size limits
- crawl depth
- timeouts
- PDF parsing limits

Do not execute untrusted JavaScript while extracting embedded data.

## Validation

For code changes, run the relevant subset of:

```bash
npm test
npm run check
npm run content-lab:build
npm run comparison:regression
```

Use `comparison:regression` whenever shared Discovery, taxonomy, Selection, or Comparison behavior could change.

Do not run Generation or publication unless the task explicitly requires it.

## Current project direction

The current priority is **not** to keep adding architecture indefinitely.

Content Lab has already demonstrated technical viability.

The next major milestone is to validate whether it produces practical value in two ways:

1. Better editorial inputs for enBenidorm.es.
2. Faster and more specific commercial prospecting for Frappé Tech.

The current workstream is preparing a representative local-business sample for a real commercial usefulness experiment.

See `docs/content-lab-roadmap.md` for the exact current state.

## Coding approach

Prefer:

- deterministic functions,
- explicit contracts,
- auditable reports,
- append-only/manual history where relevant,
- stable IDs,
- reproducible sampling,
- conservative fallbacks.

Avoid:

- opaque commercial scores,
- hidden ranking heuristics,
- hard-coded logic for one comparison topic,
- silently treating missing data as negative evidence,
- creating new databases when the manifest and artifact model are sufficient.

## Product principle

Content Lab should reduce research effort and improve decision quality.

If a new layer only creates more internal states, reports, or workflow without reducing uncertainty or manual work, question whether it should exist.
