import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { BetaFeedbackTag, CorrectionProfile, LastEyeExamRange, TestResult, VisionCheck } from '../types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

export const supabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  : null

export type FeedbackSyncStatus =
  | 'cloud_saved'
  | 'local_fallback_supabase_unconfigured'
  | 'local_fallback_rls_error'
  | 'local_fallback_network_error'

export type SyncResult = {
  cloud: boolean
  reason?: string
  status?: FeedbackSyncStatus
  errorMessage?: string
  fallbackUsed?: boolean
}

export type BetaProfilePayload = {
  userId: string | null
  firstName: string
  ageRange?: string
  correctionType?: CorrectionProfile
  lastEyeExam?: LastEyeExamRange
}

export type BetaSnapshotPayload = {
  userId: string | null
  check: VisionCheck
}

export type BetaFeedbackPayload = {
  userId: string | null
  guestId: string | null
  snapshotId: string
  believabilityRating: 1 | 2 | 3 | 4 | 5
  comment: string
  tags: BetaFeedbackTag[]
}

type SyncTarget = 'profile' | 'snapshot' | 'feedback'

type SyncDebugPayload = {
  supabaseConfigured: boolean
  currentUserId: string | null
  guestId: string | null
  isAuthenticated: boolean
  fallbackUsed: boolean
  exactSupabaseError?: string
  errorCode?: string
  policyFailure: boolean
  upsertPayload?: unknown
  insertPayload?: unknown
  payloadShape?: unknown
}

function getErrorMessage(error: unknown) {
  if (!error) return undefined
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return String(error)
}

function getErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return undefined
}

function isPolicyFailure(error: unknown) {
  const message = getErrorMessage(error)?.toLowerCase() ?? ''
  const code = getErrorCode(error)
  return code === '42501'
    || message.includes('row-level security')
    || message.includes('violates row-level security')
    || message.includes('policy')
    || message.includes('permission denied')
}

function classifyFeedbackFailure(error: unknown): FeedbackSyncStatus {
  return isPolicyFailure(error) ? 'local_fallback_rls_error' : 'local_fallback_network_error'
}

function fallbackResult(error: unknown): SyncResult {
  const errorMessage = getErrorMessage(error) || 'Supabase unavailable; localStorage fallback used.'
  return { cloud: false, reason: errorMessage, errorMessage, fallbackUsed: true }
}

function unconfiguredResult(target: SyncTarget, currentUserId: string | null, insertPayload?: unknown, upsertPayload?: unknown): SyncResult {
  const errorMessage = 'Supabase is not configured in this build. Confirm VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are set and redeployed.'
  recordSyncDebug(target, {
    supabaseConfigured,
    currentUserId,
    guestId: null,
    isAuthenticated: Boolean(currentUserId),
    fallbackUsed: true,
    exactSupabaseError: errorMessage,
    policyFailure: false,
    insertPayload,
    upsertPayload,
  })
  return { cloud: false, reason: errorMessage, errorMessage, fallbackUsed: true }
}

const syncDebugStorageKeys: Record<SyncTarget, string> = {
  profile: 'sightly-profile-sync-debug',
  snapshot: 'sightly-snapshot-sync-debug',
  feedback: 'sightly-feedback-sync-debug',
}

function logSyncDebug(target: SyncTarget, fallbackUsed: boolean, debugWithTime: SyncDebugPayload & { updatedAt: string }) {
  if (target === 'profile') {
    if (fallbackUsed) console.warn('[Sightly profile sync]', debugWithTime)
    else console.info('[Sightly profile sync]', debugWithTime)
    return
  }
  if (target === 'snapshot') {
    if (fallbackUsed) console.warn('[Sightly snapshot sync]', debugWithTime)
    else console.info('[Sightly snapshot sync]', debugWithTime)
    return
  }
  if (fallbackUsed) console.warn('[Sightly feedback sync]', debugWithTime)
  else console.info('[Sightly feedback sync]', debugWithTime)
}

function recordSyncDebug(target: SyncTarget, debug: SyncDebugPayload) {
  const debugWithTime = { ...debug, updatedAt: new Date().toISOString() }
  try {
    sessionStorage.setItem(syncDebugStorageKeys[target], JSON.stringify(debugWithTime))
  } catch {
    // Temporary diagnostics are best-effort and must never block local-first saving.
  }

  logSyncDebug(target, debug.fallbackUsed, debugWithTime)
}

function makeFeedbackPayloadShape(payload: BetaFeedbackPayload) {
  return {
    user_id: payload.userId ? 'present' : null,
    rating: payload.believabilityRating,
    believable_score: payload.believabilityRating,
    feedback_text: payload.comment ? 'present' : null,
    metadata: {
      guestId: payload.guestId,
      snapshotId: payload.snapshotId,
      tagsCount: payload.tags.length,
    },
  }
}

function recordFeedbackDebug(payload: BetaFeedbackPayload, status: FeedbackSyncStatus, fallbackUsed: boolean, insertPayload?: unknown, exactSupabaseError?: string, error?: unknown) {
  recordSyncDebug('feedback', {
    supabaseConfigured,
    currentUserId: payload.userId,
    guestId: payload.guestId,
    isAuthenticated: Boolean(payload.userId),
    fallbackUsed,
    exactSupabaseError,
    errorCode: getErrorCode(error),
    policyFailure: isPolicyFailure(error),
    insertPayload,
    payloadShape: makeFeedbackPayloadShape(payload),
  })

  try {
    sessionStorage.setItem('sightly-feedback-sync-debug', JSON.stringify({
      supabaseConfigured,
      isAuthenticated: Boolean(payload.userId),
      guestIdPresent: Boolean(payload.guestId),
      fallbackUsed,
      status,
      errorMessage: exactSupabaseError,
      exactSupabaseError,
      insertPayload,
      payloadShape: makeFeedbackPayloadShape(payload),
      updatedAt: new Date().toISOString(),
    }))
  } catch {
    // Keep legacy feedback diagnostics best-effort too.
  }
}

export async function getCurrentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user?.id ?? null
}

export function subscribeToAuthChanges(onUserId: (userId: string | null) => void) {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    onUserId(session?.user?.id ?? null)
  })
  return () => data.subscription.unsubscribe()
}

export async function signInWithEmail(email: string): Promise<SyncResult> {
  if (!supabase) return { cloud: false, reason: 'Supabase unavailable; localStorage fallback used.', fallbackUsed: true }
  const normalizedEmail = email.trim()
  if (!normalizedEmail) return { cloud: false, reason: 'Email missing.', fallbackUsed: true }

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: window.location.origin,
      },
    })
    if (error) return fallbackResult(error)
    return { cloud: true, fallbackUsed: false }
  } catch (error) {
    return fallbackResult(error)
  }
}

export async function saveCloudProfile(payload: BetaProfilePayload): Promise<SyncResult> {
  const upsertPayload = {
    user_id: payload.userId,
    first_name: payload.firstName,
    age_range: payload.ageRange ?? null,
    correction_type: payload.correctionType ?? null,
    last_eye_exam: payload.lastEyeExam ?? null,
  }

  if (!supabase || !payload.userId) return unconfiguredResult('profile', payload.userId, undefined, upsertPayload)

  try {
    const { error } = await supabase.from('profiles').upsert(upsertPayload, { onConflict: 'user_id' })
    if (error) {
      const errorMessage = getErrorMessage(error) ?? 'Supabase profile upsert failed.'
      recordSyncDebug('profile', {
        supabaseConfigured,
        currentUserId: payload.userId,
        guestId: null,
        isAuthenticated: true,
        fallbackUsed: true,
        exactSupabaseError: errorMessage,
        errorCode: getErrorCode(error),
        policyFailure: isPolicyFailure(error),
        upsertPayload,
      })
      return { cloud: false, reason: errorMessage, errorMessage, fallbackUsed: true }
    }
    recordSyncDebug('profile', {
      supabaseConfigured,
      currentUserId: payload.userId,
      guestId: null,
      isAuthenticated: true,
      fallbackUsed: false,
      policyFailure: false,
      upsertPayload,
    })
    return { cloud: true, fallbackUsed: false }
  } catch (error) {
    const errorMessage = getErrorMessage(error) ?? 'Supabase profile upsert failed.'
    recordSyncDebug('profile', {
      supabaseConfigured,
      currentUserId: payload.userId,
      guestId: null,
      isAuthenticated: true,
      fallbackUsed: true,
      exactSupabaseError: errorMessage,
      errorCode: getErrorCode(error),
      policyFailure: isPolicyFailure(error),
      upsertPayload,
    })
    return { cloud: false, reason: errorMessage, errorMessage, fallbackUsed: true }
  }
}

function scoreForCapability(check: VisionCheck, capability: TestResult['capability']) {
  return check.testResults.find((result) => result.capability === capability)?.normalizedScore ?? null
}

export async function saveCloudSnapshot(payload: BetaSnapshotPayload): Promise<SyncResult> {
  const { check } = payload
  const insertPayload = {
    user_id: payload.userId,
    snapshot_type: check.status,
    vision_score: check.score,
    sharpness_score: scoreForCapability(check, 'sharpness'),
    contrast_score: scoreForCapability(check, 'contrast'),
    peripheral_score: scoreForCapability(check, 'peripheralAwareness'),
    confidence: check.confidence,
    metadata: {
      localSnapshotId: check.id,
      measurementConfidence: check.measurementConfidence,
      readiness: check.readiness,
      analytics: check.analytics,
      stabilityMetrics: check.stabilityMetrics,
      testResults: check.testResults,
      localStorageFallback: true,
    },
    created_at: check.date,
  }

  if (!supabase || !payload.userId) return unconfiguredResult('snapshot', payload.userId, insertPayload)

  try {
    const { error } = await supabase.from('snapshots').insert(insertPayload)
    if (error) {
      const errorMessage = getErrorMessage(error) ?? 'Supabase snapshot insert failed.'
      recordSyncDebug('snapshot', {
        supabaseConfigured,
        currentUserId: payload.userId,
        guestId: null,
        isAuthenticated: true,
        fallbackUsed: true,
        exactSupabaseError: errorMessage,
        errorCode: getErrorCode(error),
        policyFailure: isPolicyFailure(error),
        insertPayload,
      })
      return { cloud: false, reason: errorMessage, errorMessage, fallbackUsed: true }
    }
    recordSyncDebug('snapshot', {
      supabaseConfigured,
      currentUserId: payload.userId,
      guestId: null,
      isAuthenticated: true,
      fallbackUsed: false,
      policyFailure: false,
      insertPayload,
    })
    return { cloud: true, fallbackUsed: false }
  } catch (error) {
    const errorMessage = getErrorMessage(error) ?? 'Supabase snapshot insert failed.'
    recordSyncDebug('snapshot', {
      supabaseConfigured,
      currentUserId: payload.userId,
      guestId: null,
      isAuthenticated: true,
      fallbackUsed: true,
      exactSupabaseError: errorMessage,
      errorCode: getErrorCode(error),
      policyFailure: isPolicyFailure(error),
      insertPayload,
    })
    return { cloud: false, reason: errorMessage, errorMessage, fallbackUsed: true }
  }
}

export async function saveCloudFeedback(payload: BetaFeedbackPayload): Promise<SyncResult> {
  const insertPayload = {
    user_id: payload.userId,
    rating: payload.believabilityRating,
    believable_score: payload.believabilityRating,
    feedback_text: payload.comment || null,
    metadata: {
      guestId: payload.guestId,
      snapshotId: payload.snapshotId,
      tags: payload.tags,
    },
  }

  if (!supabase) {
    const status: FeedbackSyncStatus = 'local_fallback_supabase_unconfigured'
    const errorMessage = 'Supabase is not configured in this build. Confirm VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are set and redeployed.'
    recordFeedbackDebug(payload, status, true, insertPayload, errorMessage)
    return { cloud: false, reason: errorMessage, status, errorMessage, fallbackUsed: true }
  }

  // Guest feedback RLS contract: user_id is null; rating between 1 and 5; believable_score between 1 and 5; metadata.guestId starts with guest-.
  const guestFeedbackWithoutValidGuestId = !payload.userId && (!payload.guestId || !payload.guestId.startsWith('guest-'))
  if (guestFeedbackWithoutValidGuestId) {
    const status: FeedbackSyncStatus = 'local_fallback_rls_error'
    const errorMessage = 'Guest feedback requires metadata.guestId starting with guest- for RLS.'
    recordFeedbackDebug(payload, status, true, insertPayload, errorMessage)
    return { cloud: false, reason: errorMessage, status, errorMessage, fallbackUsed: true }
  }

  try {
    const { error } = await supabase.from('feedback').insert(insertPayload)
    if (error) {
      const status = classifyFeedbackFailure(error)
      const errorMessage = getErrorMessage(error) ?? 'Supabase feedback insert failed.'
      recordFeedbackDebug(payload, status, true, insertPayload, errorMessage, error)
      return { cloud: false, reason: errorMessage, status, errorMessage, fallbackUsed: true }
    }
    const status: FeedbackSyncStatus = 'cloud_saved'
    recordFeedbackDebug(payload, status, false, insertPayload)
    return { cloud: true, status, fallbackUsed: false }
  } catch (error) {
    const status = classifyFeedbackFailure(error)
    const errorMessage = getErrorMessage(error) ?? 'Supabase feedback insert failed.'
    recordFeedbackDebug(payload, status, true, insertPayload, errorMessage, error)
    return { cloud: false, reason: errorMessage, status, errorMessage, fallbackUsed: true }
  }
}
