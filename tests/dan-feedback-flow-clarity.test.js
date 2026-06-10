import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8')

test('home surfaces one clear next action and explains baseline snapshot availability', () => {
  assert.match(app, /aria-label="Next action"/)
  assert.match(app, /Next Action/)
  assert.match(app, /Snapshot \$\{nextSnapshotNumber\} available/)
  assert.match(app, /Snapshot \$\{nextSnapshotNumber\} unlocks in \$\{nextSnapshotLabel\}/)
  assert.match(app, /Start Snapshot \$\{nextSnapshotNumber\}/)
  assert.match(app, /3 snapshots build your personal baseline\./)
  assert.match(app, /They happen in separate sessions so one moment does not define your normal range\./)
  assert.match(css, /\.home-next-action-card/)
  assert.match(css, /\.home-next-action-button[\s\S]*min-height:\s*56px/)
})

test('peripheral test lets users recover from a missed cue without guessing', () => {
  assert.match(app, /I missed it — show again/)
  assert.match(app, /function replayCue\(\)/)
  assert.match(app, /Replay shown\. Answer this round when ready\./)
  assert.match(app, /replayed:\s*roundReplayCount > 0/)
  assert.match(app, /replayedTrials/)
  assert.match(types, /replayed\?: boolean/)
  assert.match(types, /replayCount\?: number/)
  assert.match(types, /replayedTrials\?: number/)
  assert.match(css, /\.replay-cue-button[\s\S]*min-height:\s*52px/)
})

test('contrast not visible answer has equal visual weight in the answer grid', () => {
  assert.match(app, /tap Not visible/)
  assert.match(app, /contrast-answer-grid/)
  assert.match(app, /className="glass-button direction not-visible-button"/)
  assert.match(css, /\.contrast-answer-grid[\s\S]*'miss miss'/)
  assert.match(css, /\.contrast-answer-grid \.not-visible-button[\s\S]*grid-area:\s*miss/)
  assert.match(css, /\.not-visible-button[\s\S]*min-height:\s*54px/)
})
