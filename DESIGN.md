---
name: Synod Council
description: A dimensional companion workspace for accountable decisions.
colors:
  guidance-mint: "#91ffd4"
  synthesis-violet: "#b6a5ff"
  challenge-rose: "#ff9ecf"
  commitment-gold: "#f3cf82"
  midnight-canvas: "#060813"
  glass-surface: "rgba(14, 18, 38, 0.68)"
  text-primary: "#f2f5ff"
  text-muted: "#9aa5bf"
typography:
  title:
    fontFamily: "Instrument Serif, Georgia, serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Instrument Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.65
  input:
    fontFamily: "Instrument Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 450
    lineHeight: 1.55
  label:
    fontFamily: "Instrument Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.2
rounded:
  control: "10px"
  utility: "16px"
  stage: "28px"
spacing:
  compact: "8px"
  control: "12px"
  panel: "24px"
  section: "34px"
components:
  button-primary:
    backgroundColor: "{colors.guidance-mint}"
    textColor: "{colors.midnight-canvas}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "38px"
  button-quiet:
    backgroundColor: "rgba(255, 255, 255, 0.035)"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "38px"
  input:
    backgroundColor: "rgba(8, 12, 27, 0.94)"
    textColor: "{colors.text-primary}"
    typography: "{typography.input}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
---

# Design System: Synod Council

## Overview

**Creative North Star: "Folded Signal Field"**

Synod is an operating surface with depth, not a dashboard dressed in effects. A live isometric canvas field responds beneath translucent indigo planes while the companion remains the human anchor. The result feels dimensional and personal without moving the task away from the conversation.

Glass is structural here: it lets the decision workspace rise above the field and keeps the system calm at high information density. The interface preserves ordinary controls, readable structured outcomes, and a reduced-motion fallback.

**Key Characteristics:**

- Canvas-powered isometric depth field behind live HTML
- Indigo optical glass, mint guidance, violet synthesis, and restrained gold commitment
- A prominent companion stage balanced against one continuous conversation plane
- Raised composer, crisp functional controls, and disclosed council mechanics
- Same spatial language from wide desktop to single-column mobile

## Colors

The palette is a cool night workspace: mint carries helpful action, violet carries synthesis, and the dimensional field stays quiet enough for evidence to lead.

### Primary

- **Guidance Mint** (`#91ffd4`): Primary action, live listening, verified state, and focus.

### Secondary

- **Synthesis Violet** (`#b6a5ff`): Decision convergence, section emphasis, and optical edge light.
- **Challenge Rose** (`#ff9ecf`): Dissent and challenge only.
- **Commitment Gold** (`#f3cf82`): Reserved for an irreversible or high-commitment state.

### Neutral

- **Midnight Canvas** (`#060813`): The deep field below the application planes.
- **Indigo Glass** (`rgba(14, 18, 38, 0.68)`): Major translucent surface material.
- **Soft White** (`#f2f5ff`): Primary content and durable contrast.
- **Signal Gray** (`#9aa5bf`): Context, metadata, and secondary copy.

**The Field-Behind-Work Rule.** Dimensional canvas effects always sit behind interactive HTML and may never obscure text, controls, or the presenter.

**The Signal Rarity Rule.** Mint communicates action and healthy state; passive regions use neutral glass.

## Typography

**Display Font:** Instrument Serif for consequential headlines and editorial emphasis.

**Body and Interface Font:** Instrument Sans for controls, inputs, navigation, and long-form clarity.

**Character:** Familiar platform typography supports a companion users can trust for long conversations. Hierarchy comes from size, weight, and spatial placement rather than theatrical lettering.

### Hierarchy

- **Title** (600, 20px, 1.2): Conversation and decision-plane headings.
- **Body** (400–500, 16px, 1.65): Verdict narrative and primary explanation; keep long prose near 65–75 characters per line.
- **Input** (450, 15px, 1.55): Prompts and conversational responses.
- **Label** (600, 12px, 1.2): Controls, state, and compact structural labels.

**The Quiet Authority Rule.** The advice should look certain because it is structured and readable, not because type is oversized or ultra-bold.

## Layout

Desktop uses a 30/70 split: a persistent, tall companion stage sits left of the continuous conversation plane. The command header contains contextual upload, voice, phone upload, council disclosure, and report actions; advanced controls stay in a disclosure. The composer is anchored below the conversation.

At 820px and below, the surface stacks presenter, advanced disclosure, conversation header, and decision content. The composer is fixed safely above mobile browser chrome with transcript clearance below it. The layout keeps an 8px compact rhythm, 12px controls, 24px panels, and 34px sectional separation.

## Elevation & Depth

Depth combines canvas geometry, translucent material, and diffused ambient shadow. The field reacts to pointer position on capable devices; every important control remains ordinary semantic HTML above it. Reduced-motion users receive a static, low-opacity field.

### Shadow Vocabulary

- **Stage Depth** (`0 40px 105px rgba(0, 0, 0, .52), 0 8px 34px rgba(38, 49, 102, .20)`): Main application plane.
- **Surface Depth** (`0 20px 54px rgba(0, 0, 0, .28)`): Navigation, drawers, and raised glass.
- **Composer Lift** (`0 22px 46px rgba(0, 0, 0, .28)`): Focused conversation input.

**The Depth-With-Purpose Rule.** 3D motion communicates spatial material and input response; it never becomes navigation, progress, or a replacement for state text.

## Shapes

Controls use 10px corners, utility glass uses 16px, and the main stage uses a 28px continuous shell. Major planes are smooth and precise; the canvas field supplies the angular, isometric geometry. Circle shapes are reserved for presence and status.

## Components

### Buttons

- **Shape:** 38px-high instrument control with a 10px radius.
- **Primary:** Mint gradient with midnight text; one local commitment per region.
- **Hover / Focus:** A quiet lift and bright focus ring; no bouncy motion.
- **Secondary:** Translucent glass, visible border, and mint-violet hover tint.

### Cards / Containers

- **Corner Style:** 16px for utility surfaces; 28px only for the full workspace shell.
- **Background:** Layered indigo glass that reveals a controlled amount of the field below.
- **Border:** Fine cool-white hairline.
- **Shadow Strategy:** Diffuse ambient depth only for raised shells, the presenter, and composer.

### Inputs / Fields

- **Style:** Deep indigo field, hairline border, 10px corners, and familiar platform input behavior.
- **Focus:** Mint border and modest halo with a raised composer plane.
- **Mobile:** The conversation composer remains safely reachable at the bottom of the visual viewport.

### Navigation

Navigation is a slim optical command bar. The current destination gets a mint-violet glass tint; mobile retains text destinations in a readable second row rather than replacing them with ambiguous icons.

### Folded Signal Field

The signature material is a lightweight, canvas-rendered isometric tessellation. It follows pointer movement and pulses on tap while real HTML remains selectable, clickable, and accessible above it. It is intentionally decorative only at the field layer, with no role in task completion.

### Landing Decision Chamber

The `/about.html` landing surface extends the same identity into a persuasion page. It uses a full-bleed Three.js council chamber, a CSS 3D fallback construct, large Instrument Serif product typography, and chaptered scroll sections to explain the product without changing the application workflow.

- **Landing display scale:** Product-name hero type may exceed the app type ramp because it is a first-viewport brand signal, not an operating-control label.
- **Landing material:** Glass planes, rings, and mint-violet light represent evidence, dissent, synthesis, and commitment. They remain abstract and may not become fake product screenshots or invented customer proof.
- **Landing motion:** Scroll reveal, sticky process cards, CSS horizontal journey motion, waveform animation, and section-aware WebGL color shifts are allowed when reduced-motion users receive static content.
- **Landing proof:** The page may describe implemented product behavior such as voice review, session archive/restore, exports, diagnostics, and multilingual interface examples. Certification, customer, adoption, or benchmark claims require real evidence before appearing.

## Do's and Don'ts

### Do:

- **Do** keep the companion and live conversation dominant over the council machinery.
- **Do** use the canvas field as background depth only, with motion disabled or reduced when requested.
- **Do** preserve a continuous conversation plane and structured decision sections.
- **Do** reserve mint for commitment, healthy state, focus, and live input.

### Don't:

- **Don't** let a canvas, shader, or overlay cover interactive content.
- **Don't** expose raw provider payloads or internal reasoning as primary UI.
- **Don't** turn every result section into a floating rounded card.
- **Don't** use decorative motion that delays or confuses a decision task.
