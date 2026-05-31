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

type FeedbackDebugPayload = {
  supabaseConfigured: boolean
  isAuthenticated: boolean
  guestIdPresent: boolean
  fallbackUsed: boolean
  status: FeedbackSyncStatus
  errorMessage?: string
  payloadShape: {
    user_id: 'present' | null
    rating: number
    believable_score: number
    feedback_text: 'present' | null
    metadata: {
      guestId: string | null
      snapshotId: string
      tagsCount: number
    }
  }
}

function quietFailure(error: unknown): SyncResult {
  const message = getErrorMessage(error) || 'Supabase unavailable; localStorage fallback used.'
  return { cloud: false, reason: message, errorMessage: message, fallbackUsed: true }
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

function classifyFeedbackFailure(error: unknown): FeedbackSyncStatus {
  const message = getErrorMessage(error)?.toLowerCase() ?? ''
  const code = getErrorCode(error)
  if (code === '42501' || message.includes('row-level security') || message.includes('violates row-level security') || message.includes('policy') || message.includes('permission denied')) {
    return 'local_fallback_rls_error'
  }
  return 'local_fallback_network_error'
}

function recordFeedbackDebug(debug: FeedbackDebugPayload) {
  try {
    sessionStorage.setItem('sightly-feedback-sync-debug', JSON.stringify({ ...debug, updatedAt: new Date().toISOString() }))
  } catch {
    // Debugging is best-effort and must never block local-first feedback saving.
  }

  if (debug.fallbackUsed) {
    console.warn('[Sightly feedback sync]', debug)
  } else {
    console.info('[Sightly feedback sync]', debug)
  }
}

function makeFeedbackDebug(payload: BetaFeedbackPayload, status: FeedbackSyncStatus, fallbackUsed: boolean, errorMessage?: string): FeedbackDebugPayload {
  return {
    supabaseConfigured,
    isAuthenticated: Boolean(payload.userId),
    guestIdPresent: Boolean(payload.guestId),
    fallbackUsed,
    status,
    errorMessage,
    payloadShape: {
      user_id: payload.userId ? 'present' : null,
      rating: payload.believabilityRating,
      believable_score: payload.believabilityRating,
      feedback_text: payload.comment ? 'present' : null,
      metadata: {
        guestId: payload.guestId,
        snapshotId: payload.snapshotId,
        tagsCount: payload.tags.length,
      },
    },
  }
}

export async function getCurrentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user?.id ?? null
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
    if (error) return quietFailure(error)
    return { cloud: true, fallbackUsed: false }
  } catch (error) {
    return quietFailure(error)
  }
}

export async function saveCloudProfile(payload: BetaProfilePayload): Promise<SyncResult> {
  if (!supabase || !payload.userId) return { cloud: false, reason: 'Supabase unavailable; localStorage fallback used.', fallbackUsed: true }

  try {
    const { error } = await supabase.from('profiles').upsert({
      user_id: payload.userId,
      first_name: payload.firstName,
      age_range: payload.ageRange ?? null,
      correction_type: payload.correctionType ?? null,
      last_eye_exam: payload.lastEyeExam ?? null,
    }, { onConflict: 'user_id' })
    if (error) return quietFailure(error)
    return { cloud: true, fallbackUsed: false }
  } catch (error) {
    return quietFailure(error)
  }
}

function scoreForCapability(check: VisionCheck, capability: TestResult['capability']) {
  return check.testResults.find((result) => result.capability === capability)?.normalizedScore ?? null
}

export async function saveCloudSnapshot(payload: BetaSnapshotPayload): Promise<SyncResult> {
  if (!supabase || !payload.userId) return { cloud: false, reason: 'Supabase unavailable; localStorage fallback used.', fallbackUsed: true }

  const { check } = payload
  try {
    const { error } = await supabase.from('snapshots').insert({
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
    })
    if (error) return quietFailure(error)
    return { cloud: true, fallbackUsed: false }
  } catch (error) {
    return quietFailure(error)
  }
}

export async function saveCloudFeedback(payload: BetaFeedbackPayload): Promise<SyncResult> {
  if (!supabase) {
    const status: FeedbackSyncStatus = 'local_fallback_supabase_unconfigured'
    const errorMessage = 'Supabase is not configured in this build. Confirm VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are set and redeployed.'
    recordFeedbackDebug(makeFeedbackDebug(payload, status, true, errorMessage))
    return { cloud: false, reason: errorMessage, status, errorMessage, fallbackUsed: true }
  }

  // Guest feedback RLS contract: user_id is null; rating between 1 and 5; believable_score between 1 and 5; metadata.guestId starts with guest-.
  const guestFeedbackWithoutValidGuestId = !payload.userId && (!payload.guestId || !payload.guestId.startsWith('guest-'))
  if (guestFeedbackWithoutValidGuestId) {
    const status: FeedbackSyncStatus = 'local_fallback_rls_error'
    const errorMessage = 'Guest feedback requires metadata.guestId starting with guest- for RLS.'
    recordFeedbackDebug(makeFeedbackDebug(payload, status, true, errorMessage))
    return { cloud: false, reason: errorMessage, status, errorMessage, fallbackUsed: true }
  }

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

  try {
    const { error } = await supabase.from('feedback').insert(insertPayload)
    if (error) {
      const status = classifyFeedbackFailure(error)
      const errorMessage = getErrorMessage(error) ?? 'Supabase feedback insert failed.'
      recordFeedbackDebug(makeFeedbackDebug(payload, status, true, errorMessage))
      return { cloud: false, reason: errorMessage, status, errorMessage, fallbackUsed: true }
    }
    const status: FeedbackSyncStatus = 'cloud_saved'
    recordFeedbackDebug(makeFeedbackDebug(payload, status, false))
    return { cloud: true, status, fallbackUsed: false }
  } catch (error) {
    const status = classifyFeedbackFailure(error)
    const errorMessage = getErrorMessage(error) ?? 'Supabase feedback insert failed.'
    recordFeedbackDebug(makeFeedbackDebug(payload, status, true, errorMessage))
    return { cloud: false, reason: errorMessage, status, errorMessage, fallbackUsed: true }
  }
}
