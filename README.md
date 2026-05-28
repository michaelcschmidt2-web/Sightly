# Sightly

**See what eyes miss.**

Sightly V1 is a mobile-first React/Vite application for tracking personal vision changes over time through recurring Vision Snapshots. The app uses local browser storage for the prototype database and never compares users against other users.

## Features

- Apple-style light UI with frosted liquid-glass materials
- First-launch onboarding
- Home screen with explainable Vision Score orb, typical range, insight card, capability contribution cards, check CTA, snapshot carousel
- Bottom navigation: Home, Explore, Settings
- Baseline flow:
  - Check #1: Baseline Started
  - Check #2: Building Your Baseline
  - Check #3: Baseline Established
  - After 3 checks: Vision Score unlocks
- Four measurable visual capability assessments:
  - Sharpness: smallest six-letter row typed correctly, tracked in px
  - Contrast: adaptive Landolt-C opening-direction threshold in percent contrast
  - Peripheral Awareness: thresholded edge stimulus detection while maintaining focus on a center dot
  - Visual Response: adaptive directional-symbol recognition threshold in milliseconds
- Local data model for:
  - Vision Score history
  - Snapshot history
  - Test history
  - Typical Range
  - Device information
  - Testing conditions
  - Lighting confidence
  - Date/time
- Sharpness row test records: eye mode, randomized rows completed, smallest passed font size, first failed font size, per-row accuracy, response times, estimated threshold between pass/fail rows, device/screen/brightness context, and confidence
- Contrast sensitivity test records: Landolt-C direction trials, lowest passed contrast, first failed contrast, adaptive threshold estimate, response accuracy, average response time, confidence, device/screen/brightness, and ambient lighting estimate
- Peripheral awareness test records: score, reaction time, detection accuracy, misses, miss rate, last passed difficulty, first failed difficulty, estimated threshold, confidence, device/screen/brightness, timestamp, and full trial history
- Visual response test records: recognition threshold, accuracy, average response time, rounds completed, shortest passed exposure, first failed exposure, confidence, device/screen/brightness, timestamp, and full trial history
- Vision Score weighting: Sharpness 50%, Contrast Sensitivity 30%, Peripheral Awareness 10%, Visual Response 10%
- Vision Profile is separated from Vision Score and includes Color Vision (Ishihara), Eye Dominance, Astigmatism Screening, and Night Vision as non-scored informational screens
- Scoring engine compares measured capability results against personal baseline
- Every score change is attributed to weighted capability point contributions
- Example explanation: “Sharpness and peripheral awareness measured below your typical range, moving this snapshot 3 points lower than the last one.”
- Monthly Snapshot readiness screen with consistent-conditions checklist, eye-fatigue question, and usual-correction question
- Measurement Confidence tracks brightness, device model, screen size, orientation, time of day, battery saver mode, eye fatigue, and correction usage for confidence-aware trend analysis
- Reliability & Validation Engine calculates repeatability, variance, standard deviation, consistency score, condition impact, baseline stability, and whether a change is likely real before trend messaging escalates
- Hidden developer Reliability Dashboard in Settings shows per-test Repeatability Scores for Visual Sharpness, Contrast Sensitivity, Peripheral Awareness, Visual Response, and Overall Snapshot Reliability
- Annual summary engine
- Settings for profile, notifications, accessibility, privacy, export, and about

## Run locally

```bash
cd ~/agent-workspace/sightly
npm install
npm run dev -- --host 0.0.0.0
```

Open:

```text
http://localhost:5173
```

## Production build

```bash
npm run build
npm run lint
```

## Prototype storage

Sightly V1 stores data in browser `localStorage` under:

```text
sightly-v2-explainable-state
```

Use Settings → Reset to Fresh Baseline to test the baseline flow from zero checks, or Settings → Restore Demo Baseline to return to the Mike example state.
