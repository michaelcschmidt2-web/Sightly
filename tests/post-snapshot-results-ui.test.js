import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

test('completed monthly snapshots route to a Snapshot Complete screen before Home', () => {
  assert.match(app, /pendingCompletedSnapshot/)
  assert.match(app, /setPendingCompletedSnapshot\(\{\s*check,/)
  assert.match(app, /<SnapshotCompleteScreen/)
  assert.match(app, /onContinue=\{\(\) => \{\s*setPendingCompletedSnapshot\(null\)/)
  assert.match(app, /function SnapshotCompleteScreen/)
  assert.match(app, /Snapshot Complete/)
  assert.match(app, /Snapshot \{snapshotNumber\} of 3 complete/)
  assert.match(app, /Sightly is learning your normal visual range\./)
  assert.match(app, /Your Vision Score unlocks after 3 baseline snapshots\./)
  assert.match(app, /View Home/)
})

test('snapshot complete screen shows early measurements but withholds Vision Score until baseline unlocks', () => {
  const screen = app.slice(app.indexOf('function SnapshotCompleteScreen'), app.indexOf('function HomeScreen'))
  assert.match(screen, /Visual Sharpness/)
  assert.match(screen, /Contrast Sensitivity/)
  assert.match(screen, /Peripheral Awareness/)
  assert.match(screen, /Confidence/)
  assert.match(screen, /baselineReady \?/)
  assert.match(screen, /Vision Score/)
  assert.match(screen, /Typical Range/)
  assert.match(screen, /Test breakdown/)
  assert.match(screen, /Main insight/)
})

test('beta feedback card and post-snapshot home spacing are overflow-safe on mobile', () => {
  assert.match(css, /\.home-feedback-section/)
  assert.match(css, /\.home-feedback-section\s*\{[^}]*display:\s*grid[^}]*gap:/s)
  assert.match(css, /\.beta-feedback-card\s*\{[^}]*overflow:\s*visible[^}]*min-width:\s*0/s)
  assert.match(css, /\.beta-feedback-card \*\s*\{[^}]*min-width:\s*0/s)
  assert.match(css, /\.beta-feedback-tags\s*\{[^}]*grid-template-columns:\s*1fr/s)
  assert.match(css, /\.beta-feedback-tags button\s*\{[^}]*white-space:\s*normal[^}]*line-height:/s)
  assert.match(css, /\.beta-save-button\s*\{[^}]*white-space:\s*normal/s)
  assert.match(css, /\.post-snapshot-results-screen/)
})
