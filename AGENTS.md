# AGENTS.md

## Project overview

This repository contains **enBenidorm.es** and **Content Lab**.

The project has two related goals:

1. **enBenidorm.es**: build a useful local SEO/content project focused on Benidorm and surrounding areas.
2. **Content Lab**: the auditable pipeline that discovers businesses, enriches their data, generates evidence-backed editorial content and evaluates data quality for enBenidorm.es.

Before changing Content Lab, read:

- `content-lab-context.md`
- `content-lab-roadmap.md`
- `enbenidorm-editorial-principles.md`

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
- Human Review

A change in one layer must not silently change Selection, Comparison gates, ranking or Generation in another.

### Provenance first

Any fact that can influence:

- editorial inclusion,
- business identity,
- operational status,
- or generated content

must preserve provenance.

Prefer explicit evidence over inference.

Do not fill missing fields merely to improve coverage.

Do not promote:

- brand-level evidence to a local establishment,
- third-party claims to first-party facts,
- a candidate URL to an official URL,
- a reachable website to proof that a business is open.

### Editorial independence

Frappé Tech's commercial interest must never influence which businesses are included, recommended, ranked or excluded. See principle 13 in `enbenidorm-editorial-principles.md`.

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

The current priority is the **enBenidorm.es editorial SEO plan**, tracked in GitHub issue #26 and its milestones 0–6.

The commercial prospecting experiments (Opportunity Analysis, Verification Enrichment, prospecting notes and the P3A.5b sample) were removed on 2026-10-26. Do not reintroduce them unless an issue explicitly asks for it.

Work on the issue you were given and respect its dependencies. Do not add Content Lab architecture unless an issue of the plan requires it.

See `content-lab-roadmap.md` for what the pipeline already does and what is pending.

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

- opaque scores,
- hidden ranking heuristics,
- hard-coded logic for one comparison topic,
- silently treating missing data as negative evidence,
- creating new databases when the manifest and artifact model are sufficient.

## Product principle

Content Lab should reduce research effort and improve decision quality.

If a new layer only creates more internal states, reports, or workflow without reducing uncertainty or manual work, question whether it should exist.
