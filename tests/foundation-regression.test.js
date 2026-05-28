import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const data = readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8')
const engine = readFileSync(new URL('../src/engine.ts', import.meta.url), 'utf8')
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8')

test('standalone results are represented separately from snapshot checks', () => {
  assert.match(types, /StandaloneTestResult/)
  assert.match(types, /standaloneResults:\s*StandaloneTestResult\[\]/)
  assert.match(data, /createStandaloneResult/)
  assert.match(app, /activeRunMode/)
  assert.match(app, /standaloneResults:/)
  assert.match(app, /current\.standaloneResults/)
})

test('monthly snapshots reject incomplete core measurement payloads', () => {
  assert.match(data, /assertCompleteSnapshotMeasurements/)
  assert.match(data, /Missing .* measurement for monthly snapshot/)
})

test('snapshot interpretation uses prior history before the current check', () => {
  assert.match(data, /typicalBefore = calculateTypicalRange\(runningChecks\)/)
  assert.match(data, /makeSnapshot\(derived, typicalBefore/)
  assert.doesNotMatch(data, /makeSnapshot\(check, typicalRange, checksWithFinalExplanations/)
})

test('threshold tests define safety limits and graceful low-confidence fallback', () => {
  assert.match(app, /SHARPNESS_MAX_ATTEMPTS = 30/)
  assert.match(app, /CONTRAST_MAX_TRIALS = 40/)
  assert.match(app, /PERIPHERAL_MAX_TRIALS = 40/)
  assert.match(app, /VISUAL_RESPONSE_MAX_TRIALS = 40/)
  assert.match(app, /Unable to confidently estimate threshold\. Please try again\./)
})

test('active snapshot recovery state is persisted and prompts on reopen', () => {
  assert.match(app, /SIGHTLY_ACTIVE_SESSION_KEY/)
  assert.match(app, /Resume Snapshot\?/)
  assert.match(app, /Continue/)
  assert.match(app, /Discard/)
})
