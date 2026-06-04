import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const supabase = readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')

test('profile, snapshot, and feedback writes expose temporary end-to-end diagnostics', () => {
  assert.match(supabase, /type SyncTarget = 'profile' \| 'snapshot' \| 'feedback'/)
  assert.match(supabase, /recordSyncDebug/)
  assert.match(supabase, /sightly-profile-sync-debug/)
  assert.match(supabase, /sightly-snapshot-sync-debug/)
  assert.match(supabase, /sightly-feedback-sync-debug/)
  assert.match(supabase, /console\.(info|warn)\('\[Sightly profile sync\]'/)
  assert.match(supabase, /console\.(info|warn)\('\[Sightly snapshot sync\]'/)
  assert.match(supabase, /console\.(info|warn)\('\[Sightly feedback sync\]'/)
})

test('diagnostics include configured state, current user, guest id, payload, and exact Supabase error', () => {
  assert.match(supabase, /supabaseConfigured/)
  assert.match(supabase, /currentUserId/)
  assert.match(supabase, /guestId/)
  assert.match(supabase, /insertPayload|upsertPayload/)
  assert.match(supabase, /exactSupabaseError/)
  assert.match(supabase, /policyFailure/)
  assert.match(supabase, /getErrorCode/)
  assert.match(supabase, /getErrorMessage/)
})

test('profile and snapshot failures return exact error details instead of opaque fallback only', () => {
  assert.match(supabase, /saveCloudProfile[\s\S]*recordSyncDebug\('profile'/)
  assert.match(supabase, /saveCloudSnapshot[\s\S]*recordSyncDebug\('snapshot'/)
  assert.match(supabase, /return \{ cloud: false, reason: errorMessage, errorMessage, fallbackUsed: true \}/)
})
