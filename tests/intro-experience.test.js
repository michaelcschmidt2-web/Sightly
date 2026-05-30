import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

test('first-run onboarding is a premium three-card carousel before setup details', () => {
  assert.match(app, /function SightlyIntroExperience/)
  assert.match(app, /const introSlides = \[/)
  assert.match(app, /Sightly/)
  assert.match(app, /Build Your Vision Baseline/)
  assert.match(app, /Your Vision Journey Starts Here/)
  assert.match(app, /intro-carousel/)
  assert.match(app, /onTouchStart/)
  assert.match(app, /onTouchEnd/)
  assert.match(app, /setIntroComplete\(true\)/)
  assert.match(app, /setStep\(1\)/)
  assert.match(app, /if \(!introComplete\)/)
})

test('intro copy explains purpose, baseline, and journey without adding setup text or exam language', () => {
  assert.match(app, /See what eyes miss\./)
  assert.match(app, /Vision often changes gradually enough that you don’t notice it happening\./)
  assert.match(app, /Sightly helps you track changes over time with simple vision snapshots\./)
  assert.match(app, /Sightly learns what is normal for you through a few quick snapshots\./)
  assert.match(app, /Track your vision over time with simple check-ins designed to help you notice gradual changes\./)
  assert.doesNotMatch(app.slice(app.indexOf('const introSlides'), app.indexOf('function FirstRunOnboarding')), /Create an account to begin building your baseline\./)
  assert.doesNotMatch(app.slice(app.indexOf('const introSlides'), app.indexOf('function FirstRunOnboarding')), /assessment|evaluation|diagnosis|exam-like/i)
})

test('third slide carries account actions as large native-feeling buttons', () => {
  assert.match(app, /const authActions/)
  assert.match(app, /Continue with Apple/)
  assert.match(app, /Continue with Google/)
  assert.match(app, /Continue with Email/)
  assert.match(app, /Continue as Guest/)
  assert.match(app, /intro-auth-actions/)
})

test('carousel includes liquid-glass visuals, paging, safe-area layout, and compact phone guards', () => {
  assert.match(css, /\.intro-carousel/)
  assert.match(css, /\.intro-slide-card/)
  assert.match(css, /\.intro-orb/)
  assert.match(css, /\.milestone-card/)
  assert.match(css, /\.timeline-card/)
  assert.match(css, /env\(safe-area-inset-top\)/)
  assert.match(css, /@media \(max-height: 780px\)/)
  assert.match(css, /@keyframes introOrbFloat/)
  assert.match(css, /@keyframes introOrbTurn/)
  assert.match(css, /@keyframes ambientGlassDrift/)
  assert.match(css, /@keyframes journeyFade/)
})
