---
version: 1
slug: "frontend-about-html"
primary_target: "frontend/about.html"
related_targets: ["frontend/landing.css","frontend/landing.js","frontend/vendor/three.module.js"]
---

# Synod Landing Surface Brief

- Scope: `/about.html`, the public-facing product and information page that routes into the main Synod application.
- Mode: Persuade.
- Audience/job: founders, operators, consultants, leadership teams, and technical reviewers evaluating whether Synod is serious enough for consequential decisions.
- Primary action: open the Synod application.
- Secondary action: understand the product mechanism before entering the app.
- Content/proof: product truth only: voice review, multilingual interface examples, session lifecycle, council dissent, structured decision briefs, diagnostics, exports, and governance posture.
- Constraints: do not change the main app functionality; do not invent customers, certifications, adoption metrics, or benchmarks; maintain reduced-motion fallback and responsive text fit.
- Direction: Enterprise decision chamber inspired by the Kage reference's chaptered scroll pacing, translated into a calm Synod product narrative.
- Memorable moment: a full-bleed Three.js council chamber and CSS 3D fallback sit behind the product-name hero, then the scroll moves through voice, method, artifact, trust, and language sections.
- Responsive rule: desktop uses asymmetry, sticky cards, and horizontal journey motion; mobile collapses into single-column sections with the first viewport kept readable and actionable.

## Fidelity inventory

| Ingredient | Commitment | Medium |
|---|---|---|
| Hero | Product-name first viewport with visible action and dimensional council geometry | HTML/CSS + Three.js |
| 3D chamber | Section-aware WebGL planes, rings, nodes, and core with software fallback verification | `frontend/landing.js` + local Three module |
| CSS fallback | Visible abstract glass construct when WebGL is blocked or unavailable | CSS 3D transforms |
| Product narrative | Voice, memory, council, governance, artifact, journey, language, and final action sections | Authored semantic HTML |
| Motion | IntersectionObserver reveals, sticky flow cards, waveform animation, CSS horizontal journey, reduced-motion fallback | CSS + lightweight JS |
| Trust copy | Enterprise seriousness expressed through implemented behavior, not unsupported certification or customer claims | Visible copy |
| Typography | Instrument Serif for major headlines and Instrument Sans for navigation, labels, controls, and body | Google Fonts |
