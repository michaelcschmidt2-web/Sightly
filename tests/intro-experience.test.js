import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

test('first-run onboarding starts with a premium intro before account setup', () => {
  assert.match(app, /function SightlyIntroExperience/)
  assert.match(app, /const introSlides = \[/)
  assert.match(app, /Welcome to Sightly/)
  assert.match(app, /Begin Setup/)
  assert.match(app, /setIntroComplete\(true\)/)
  assert.match(app, /if \(!introComplete\)/)
})

test('intro explains tracking, baseline, change detection, consistency, and care boundary', () => {
  assert.match(app, /See what eyes miss\./)
  assert.match(app, /Track your vision over time with simple monthly snapshots\./)
  assert.match(app, /Your first few snapshots help Sightly learn your normal visual range\./)
  assert.match(app, /Future snapshots are compared against you — not everyone else\./)
  assert.match(app, /Sightly helps you notice gradual changes you may not realize are happening\./)
  assert.match(app, /Testing under similar conditions improves reliability/)
  assert.match(app, /does not replace professional eye care/)
})

test('intro includes subtle liquid glass motion patterns without medical dashboard visuals', () => {
  assert.match(css, /\.intro-orb/)
  assert.match(css, /\.snapshot-node/)
  assert.match(css, /\.journey-marker/)
  assert.match(css, /\.brightness-sheen/)
  assert.match(css, /@keyframes introOrbFloat/)
  assert.match(css, /@keyframes nodeConnect/)
  assert.match(css, /@keyframes introSlideIn/)
  assert.doesNotMatch(app, /diagnosis|doctor dashboard|symptom|treatment/i)
})
