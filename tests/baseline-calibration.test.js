import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const data = readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8')
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8')

test('baseline calibration requires three snapshots spaced at least twelve hours apart', () => {
  assert.match(app, /CALIBRATION_REQUIRED_SNAPSHOTS\s*=\s*3/)
  assert.match(app, /CALIBRATION_MIN_INTERVAL_MS\s*=\s*12 \* 60 \* 60 \* 1000/)
  assert.match(app, /nextCalibrationSnapshotAt/)
  assert.match(app, /baselineCtaDisabled/)
  assert.match(app, /Snapshot \$\{nextSnapshotNumber\} unlocks in \$\{nextSnapshotLabel\}/)
})

test('pre-baseline home explains Sightly and baseline before showing progress', () => {
  assert.match(app, /Welcome to Sightly/)
  assert.match(app, /Sightly helps you track changes in your visual performance over time\./)
  assert.match(app, /Start by completing 3 baseline snapshots across separate sessions\./)
  assert.match(app, /This helps Sightly learn your normal range so future changes can be compared to you — not everyone else\./)
  assert.match(app, /What is a baseline\?/)
  assert.match(app, /A baseline is your personal normal range\./)
  assert.match(app, /baselineReady && completedChecks > CALIBRATION_REQUIRED_SNAPSHOTS && latestCheck\?\.explanation/)
  assert.match(app, /baselineReady && \(\s*<section className="supporting-details-section"/)
  assert.match(app, /baselineReady \? `Typical Range · \$\{typicalRangeLabel\}` : 'Baseline Progress'/)
})

test('calibration completion records consistency and optional fourth snapshot messaging', () => {
  assert.match(types, /BaselineCalibration/)
  assert.match(types, /consistency:\s*'high' \| 'needs-more-data' \| 'building'/)
  assert.match(data, /calculateBaselineCalibration/)
  assert.match(data, /Baseline Established/)
  assert.match(app, /Additional calibration may improve accuracy\./)
  assert.match(app, /Take Optional Calibration Snapshot/)
})

test('calibration snapshots use progress notifications instead of warnings', () => {
  assert.match(app, /Snapshot 2 ready/)
  assert.match(app, /Final baseline snapshot ready/)
  assert.match(app, /Baseline snapshot \$\{nextCompleted\} of 3 saved/)
  assert.doesNotMatch(app, /lastNotification: 'Your Monthly Vision Snapshot is ready\.'/)
})
