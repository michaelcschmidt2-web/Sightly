import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

test('Supabase client reads Vite env vars and is safe when unconfigured', () => {
  const supabasePath = join(root, 'src/lib/supabase.ts')
  assert.equal(existsSync(supabasePath), true)
  const supabase = readFileSync(supabasePath, 'utf8')

  assert.match(supabase, /@supabase\/supabase-js/)
  assert.match(supabase, /VITE_SUPABASE_URL/)
  assert.match(supabase, /VITE_SUPABASE_PUBLISHABLE_KEY/)
  assert.match(supabase, /createClient/)
  assert.match(supabase, /supabaseConfigured/)
  assert.match(supabase, /return null/)
})

test('env example documents Supabase beta variables without secrets', () => {
  const envExample = readFileSync(join(root, '.env.example'), 'utf8')
  assert.match(envExample, /^VITE_SUPABASE_URL=$/m)
  assert.match(envExample, /^VITE_SUPABASE_PUBLISHABLE_KEY=$/m)
})

test('package includes Supabase JS dependency', () => {
  assert.match(pkg.dependencies?.['@supabase/supabase-js'] ?? '', /\^?2\./)
})

test('app keeps guest mode local and attempts Supabase email auth only for email entry', () => {
  const supabase = readFileSync(join(root, 'src/lib/supabase.ts'), 'utf8')
  assert.match(app, /getOrCreateGuestId/)
  assert.match(app, /SIGHTLY_GUEST_ID_KEY/)
  assert.match(supabase, /signInWithOtp/)
  assert.match(app, /authMode === 'guest'/)
  assert.match(app, /authMode === 'email'/)
  assert.doesNotMatch(app, /signInWithOAuth\([\s\S]*google|signInWithOAuth\([\s\S]*apple/)
})

test('completed profiles, snapshots, and feedback attempt Supabase writes with quiet local fallback', () => {
  assert.match(app, /saveCloudProfile/)
  assert.match(app, /saveCloudSnapshot/)
  assert.match(app, /saveCloudFeedback/)
  assert.match(app, /setSyncStatus/)
  assert.match(app, /cloud: false/)
  assert.match(app, /localStorage fallback/i)
})
