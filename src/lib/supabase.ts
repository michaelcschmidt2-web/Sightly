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

export type SyncResult = {
  cloud: boolean
  reason?: string
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

function quietFailure(error: unknown): SyncResult {
  const message = error instanceof Error ? error.message : 'Supabase unavailable; localStorage fallback used.'
  return { cloud: false, reason: message }
}

export async function getCurrentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user?.id ?? null
}

export async function signInWithEmail(email: string): Promise<SyncResult> {
  if (!supabase) return { cloud: false, reason: 'Supabase unavailable; localStorage fallback used.' }
  const normalizedEmail = email.trim()
  if (!normalizedEmail) return { cloud: false, reason: 'Email missing.' }

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: window.location.origin,
      },
    })
    if (error) return quietFailure(error)
    return { cloud: true }
  } catch (error) {
    return quietFailure(error)
  }
}

export async function saveCloudProfile(payload: BetaProfilePayload): Promise<SyncResult> {
  if (!supabase || !payload.userId) return { cloud: false, reason: 'Supabase unavailable; localStorage fallback used.' }

  try {
    const { error } = await supabase.from('profiles').upsert({
      user_id: payload.userId,
      first_name: payload.firstName,
      age_range: payload.ageRange ?? null,
      correction_type: payload.correctionType ?? null,
      last_eye_exam: payload.lastEyeExam ?? null,
    }, { onConflict: 'user_id' })
    if (error) return quietFailure(error)
    return { cloud: true }
  } catch (error) {
    return quietFailure(error)
  }
}

function scoreForCapability(check: VisionCheck, capability: TestResult['capability']) {
  return check.testResults.find((result) => result.capability === capability)?.normalizedScore ?? null
}

export async function saveCloudSnapshot(payload: BetaSnapshotPayload): Promise<SyncResult> {
  if (!supabase || !payload.userId) return { cloud: false, reason: 'Supabase unavailable; localStorage fallback used.' }

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
    return { cloud: true }
  } catch (error) {
    return quietFailure(error)
  }
}

export async function saveCloudFeedback(payload: BetaFeedbackPayload): Promise<SyncResult> {
  if (!supabase) return { cloud: false, reason: 'Supabase unavailable; localStorage fallback used.' }

  try {
    const { error } = await supabase.from('feedback').insert({
      user_id: payload.userId,
      rating: payload.believabilityRating,
      believable_score: payload.believabilityRating,
      feedback_text: payload.comment || null,
      metadata: {
        guestId: payload.guestId,
        snapshotId: payload.snapshotId,
        tags: payload.tags,
        localStorageFallback: true,
      },
    })
    if (error) return quietFailure(error)
    return { cloud: true }
  } catch (error) {
    return quietFailure(error)
  }
}
