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
  assert.match(app, /Preliminary Vision Score/)
  assert.match(app, /Snapshot \{snapshotNumber\} of 3 complete/)
  assert.match(app, /Your score is an early estimate\. Complete 3 snapshots across separate sessions to build your personal baseline\./)
  assert.match(app, /One more snapshot will help Sightly confirm your normal range\./)
  assert.match(app, /Baseline Established/)
  assert.match(app, /context="post-snapshot"/)
  assert.match(app, /syncStatus=\{syncStatus\?\.target === 'feedback' \? syncStatus : null\}/)
  assert.match(app, /Continue to Home/)
})

test('snapshot complete screen shows preliminary score and measurements before baseline without trend artifacts', () => {
  const screen = app.slice(app.indexOf('function SnapshotCompleteScreen'), app.indexOf('function HomeScreen'))
  const preBaselineSummary = screen.slice(screen.indexOf('aria-label="Preliminary Snapshot Summary"'), screen.indexOf(') : (', screen.indexOf('aria-label="Preliminary Snapshot Summary"')))
  const baselineBranch = screen.slice(screen.indexOf('<Metric label="Vision Score"'), screen.indexOf('<BetaFeedbackCard'))
  assert.match(screen, /Visual Sharpness/)
  assert.match(screen, /Contrast Sensitivity/)
  assert.match(screen, /Peripheral Awareness/)
  assert.match(screen, /Confidence/)
  assert.match(screen, /<strong>\{check\.score \?\? '—'\}<\/strong>/)
  assert.match(screen, /Preliminary Vision Score/)
  assert.match(preBaselineSummary, /Snapshot breakdown/)
  assert.match(preBaselineSummary, /Baseline insights, typical range, and trend alerts stay locked until 3 snapshots are complete\./)
  assert.doesNotMatch(preBaselineSummary, /<Metric label="Typical Range"/)
  assert.doesNotMatch(preBaselineSummary, /Main insight/)
  assert.match(baselineBranch, /<Metric label="Vision Score"/)
  assert.match(baselineBranch, /<Metric label="Typical Range"/)
  assert.match(baselineBranch, /Main insight/)
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
