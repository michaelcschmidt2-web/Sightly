import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('post-snapshot feedback captures fresh beta feedback before returning home', () => {
  assert.match(app, /function SnapshotCompleteScreen/)
  assert.match(app, /<BetaFeedbackCard\s*\n\s*context="post-snapshot"/)
  assert.match(app, /Tell us while the result is fresh/)
  assert.match(app, /Continue to Home/)
})

test('internal beta diagnostics expose feedback sync status and Supabase logging state', () => {
  assert.match(app, /function BetaDiagnosticsScreen/)
  assert.match(app, /Recent Feedback/)
  assert.match(app, /Local \/ cloud status/)
  assert.match(app, /Supabase Logging/)
  assert.match(app, /loadInternalSyncDebugEntries/)
  assert.match(app, /sightly-feedback-sync-debug/)
  assert.match(app, /Open Beta Diagnostics/)
})

test('internal beta diagnostics show repeatability metrics using product language', () => {
  assert.match(app, /Snapshot variance/)
  assert.match(app, /Confidence average/)
  assert.match(app, /Calibration consistency/)
  assert.match(app, /repeatabilityConfidence/)
  assert.match(app, /snapshotToSnapshotVariance/)
})
