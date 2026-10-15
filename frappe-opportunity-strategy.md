# Frappé Tech — Opportunity Discovery Strategy

## 1. Purpose

Content Lab may serve as a local-business intelligence layer for Frappé Tech.

The goal is to reduce blind cold prospecting.

Instead of:

> Visit or email random businesses and then discover whether there is anything useful to discuss.

The intended workflow is:

```text
Discover
→ collect public evidence
→ identify possible opportunity
→ verify
→ human commercial decision
→ contact only when there is a concrete angle
```

This is a hypothesis being tested, not yet a proven acquisition channel.

---

## 2. What Content Lab should do

Content Lab should help answer:

- What businesses exist locally?
- What public digital presence can we verify?
- What services/products are publicly visible?
- What contact or booking paths are visible?
- Are there observable gaps worth reviewing?
- What evidence supports each observation?
- What should a human verify before outreach?

It should reduce research time and improve specificity.

---

## 3. What Content Lab should not do

Do not automatically conclude:

- “no website found → needs website”
- “phone visible → process is manual”
- “no booking found → needs automation”
- “old website → owner wants redesign”
- “few public details → bad marketing”
- “low ratings → sales opportunity”

Absence of evidence is not proof of a business problem.

---

## 4. Commercial hypotheses

The system may produce cautious hypotheses such as:

> No official website has been identified for a business that appears active. There may be an opportunity around owned web presence, but need and willingness are unconfirmed.

or:

> A phone contact channel is visible, but no online booking channel has been identified. There may be an opportunity to review the booking journey.

Every hypothesis should contain:

- supporting signals,
- provenance,
- limitations,
- confidence,
- suggested next action.

---

## 5. Opportunity areas

Current areas:

- web-presence
- local-seo
- content
- conversion
- booking
- automation
- unknown

These are areas for investigation, not product prescriptions.

---

## 6. Services Frappé may eventually map to opportunities

Potential service families include:

### Web presence

- website creation,
- website modernization,
- landing pages,
- technical improvements.

### Local SEO

- Google Business Profile optimization,
- local landing content,
- consistency of business information,
- search visibility work.

### Content

- service/product presentation,
- case studies,
- before/after content,
- local/service pages.

### Conversion

- clearer calls to action,
- quote/request forms,
- lead capture,
- landing-page optimization.

### Booking

- booking flows,
- appointment requests,
- scheduling integrations.

### Automation

Only after explicit evidence of a suitable workflow.

Examples could eventually include:

- inquiry routing,
- follow-up,
- reminders,
- qualification,
- internal administrative automation.

Do not infer internal workflows from weak public evidence.

---

## 7. Discovery geography

Current focus:

- Benidorm
- La Nucía
- l'Alfàs del Pi
- Albir

The commercial logic may later extend across Costa Blanca Norte, but the current experiment should stay close enough to allow manual validation.

---

## 8. Sector strategy

Frappé should not restrict prospecting to hospitality.

Relevant sectors include:

- beauty and wellness,
- private healthcare,
- real estate,
- property management,
- professional services,
- home services,
- automotive,
- education,
- specialized retail,
- tourism,
- local B2B services.

OSM coverage varies significantly by sector.

Poor OSM coverage must not be interpreted as lack of commercial opportunity.

---

## 9. Human review policy

Before a business becomes a serious prospect, confirm:

- identity,
- operational status,
- official presence,
- relevant contact channel,
- evidence behind the proposed angle.

Conflict or uncertainty should lead to review, not automatic outreach.

---

## 10. Outreach policy

Content Lab does not currently send outreach.

The system may eventually help prepare research or draft messaging, but:

- contact decision remains human,
- channel selection remains human,
- commercial claims must be evidence-backed,
- messages should be specific to the business,
- avoid pretending to know internal problems.

Avoid mass cold-email automation before the acquisition model is validated.

---

## 11. What success looks like

The commercial experiment should test whether Content Lab produces useful decisions.

Key questions:

### Does it save time?

Can David understand a business faster than researching it from scratch?

### Does it improve specificity?

Can the resulting outreach angle refer to a concrete, verifiable observation?

### Does it identify worthwhile prospects?

Do enough businesses move from “random local company” to “I would actually contact this business”?

### Does it reduce wasted outreach?

Can the system identify:

- closed businesses,
- identity conflicts,
- obvious non-fits,
- weak/no-angle cases

before time is spent contacting them?

---

## 12. Experiment categories

For the first representative experiment, use a stratified sample across:

- hospitality,
- beauty/wellness,
- professional services,
- real-estate/home-services,
- healthcare,
- automotive,
- education,
- retail/B2B.

The sample must not be selected based on apparent poor digital presence.

The experiment must be able to fail honestly.

---

## 13. Manual experiment evaluation

For each sampled business, David should manually record:

```json
{
  "wouldContact": "yes | no | maybe",
  "commercialAngle": "",
  "usefulWithoutExtraResearch": "yes | no",
  "estimatedManualMinutesSaved": null,
  "comments": ""
}
```

The system must not populate these answers.

---

## 14. Current maturity assessment

Current expectation:

### enBenidorm editorial use

High confidence that Content Lab can add real value.

### Frappé prospecting use

Promising but not validated.

### SaaS

Too early.

Do not optimize architecture for a future SaaS until the internal workflow proves that it solves a repeated, valuable problem.

---

## 15. Product discipline

Do not keep adding layers merely because the architecture allows it.

After the representative 20-business experiment:

- continue if commercial usefulness is clear,
- improve data sources if coverage is the limiting factor,
- simplify if workflow complexity exceeds value,
- reduce or abandon commercial Opportunity Analysis if it does not meaningfully save effort.

The purpose is to create commercial leverage, not an elaborate internal research system.
