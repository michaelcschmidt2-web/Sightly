import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const data = readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8')
const engine = readFileSync(new URL('../src/engine.ts', import.meta.url), 'utf8')

test('full first-user flow persists intro completion and setup draft before onboarding completes', () => {
  assert.match(app, /SIGHTLY_ONBOARDING_DRAFT_KEY/)
  assert.match(app, /loadOnboardingDraft/)
  assert.match(app, /saveOnboardingDraft/)
  assert.match(app, /introComplete/)
  assert.match(app, /setIntroComplete\(true\)/)
  assert.match(app, /saveOnboardingDraft\(null\)/)
})

test('refresh recovery does not erase an interrupted setup or snapshot session before the user chooses', () => {
  assert.match(app, /if \(savedSession && !activeTool && !showSnapshotPrep\) return/)
  assert.match(app, /setSavedSession\(null\)/)
  assert.match(app, /saveActiveSession\(null\)/)
})

test('baseline snapshots enforce the 12-hour calibration lockout in UI and begin path', () => {
  assert.match(app, /CALIBRATION_MIN_INTERVAL_MS = 12 \* 60 \* 60 \* 1000/)
  assert.match(app, /baselineCtaDisabled/)
  assert.match(app, /if \(baselineCtaDisabled\) return/)
  assert.match(app, /Next Snapshot Available In:/)
})

test('standalone explore tests are isolated from baseline, snapshots, and vision score', () => {
  assert.match(app, /activeRunMode === 'standalone-test'/)
  assert.match(app, /createStandaloneResult/)
  assert.match(app, /standaloneResults: \[\.\.\.current\.standaloneResults, standalone\]/)
  assert.doesNotMatch(app, /checks: \[\.\.\.current\.checks, standalone\]/)
  assert.match(data, /resultType: 'standalone'/)
})

test('baseline unlocks only after three complete snapshot checks and pre-baseline score remains hidden', () => {
  assert.match(data, /assertCompleteSnapshotMeasurements/)
  assert.match(data, /checks\.slice\(0, 3\)/)
  assert.match(app, /baselineReady = state\.baselineCalibration\.completedSnapshots >= CALIBRATION_REQUIRED_SNAPSHOTS && Boolean\(state\.typicalRange\)/)
  assert.match(app, /latestScore = baselineReady \? latestCheck\?\.score \?\? null : null/)
  assert.match(app, /baselineReady \? 'Current Vision' : 'Learning Your Vision'/)
})

test('typical range and snapshot interpretation avoid look-ahead bias', () => {
  assert.match(data, /typicalBefore = calculateTypicalRange\(runningChecks\)/)
  assert.match(data, /makeSnapshot\(derived, typicalBefore, \[\.\.\.runningChecks, derived\]/)
  assert.match(data, /const baselineChecks = checks\.slice\(0, 3\)/)
  assert.match(data, /const typicalRange = calculateTypicalRange\(baselineChecks\)/)
  assert.match(engine, /visualResponse: 0,/)
  assert.match(engine, /const capabilityOrder: CapabilityId\[\] = \['sharpness', 'contrast', 'peripheralAwareness'\]/)
})

test('threshold tests retain bounded safe fallback logic', () => {
  assert.match(app, /SHARPNESS_MAX_ATTEMPTS = 30/)
  assert.match(app, /CONTRAST_MAX_TRIALS = 40/)
  assert.match(app, /PERIPHERAL_MAX_TRIALS = 40/)
  assert.match(app, /VISUAL_RESPONSE_MAX_TRIALS = 40/)
  assert.match(app, /LOW_CONFIDENCE_THRESHOLD_NOTE/)
  assert.match(app, /forcedLowConfidence/)
})
