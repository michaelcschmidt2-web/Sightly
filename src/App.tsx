import { useEffect, useMemo, useRef, useState, type CSSProperties, type TouchEvent } from 'react'
import './App.css'
import type { AuthMode, BetaFeedbackTag, CapabilityId, ContrastDirection, ContrastThresholdPayload, ContrastTrial, CorrectionProfile, EyeFatigueLevel, LastEyeExamRange, PeripheralAwarenessPayload, PeripheralDirection, PeripheralTrial, SharpnessEyeMode, SharpnessRowAttempt, SharpnessThresholdPayload, SnapshotAnalytics, SightlyState, SnapshotReadiness, TestResult, ToolId, VisionCorrectionUsage, VisionTool, VisualChoicePayload, VisualChoiceSymbol, VisualChoiceTrial } from './types'
import {
  advancedVisionTools,
  createCheckFromMeasurements,
  createStandaloneResult,
  createDemoState,
  emptyState,
  formatMeasurement,
  loadState,
  rebuildDerivedState,
  saveState,
  visionTools,
} from './data'
import { getCurrentUserId, saveCloudFeedback, saveCloudProfile, saveCloudSnapshot, signInWithEmail, type SyncResult } from './lib/supabase'

const SIGHTLY_ACTIVE_SESSION_KEY = 'sightly-active-session-v1'
const SIGHTLY_ONBOARDING_DRAFT_KEY = 'sightly-onboarding-draft-v1'
const SIGHTLY_GUEST_ID_KEY = 'sightly-guest-id-v1'
const CALIBRATION_REQUIRED_SNAPSHOTS = 3
const CALIBRATION_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000
type ActiveRunMode = 'monthly-snapshot' | 'standalone-test'
type ActiveSession = {
  activeRunMode: ActiveRunMode
  activeToolId: ToolId | null
  testStep: number
  pendingMeasurements: Partial<Record<ToolId, number>>
  pendingResultDetails: Partial<Record<ToolId, Partial<TestResult>>>
  snapshotReadiness: SnapshotReadiness | null
  showSnapshotPrep: boolean
}

type OnboardingDraft = {
  introComplete: boolean
  step: number
  profile: OnboardingProfile
}

type SyncStatus = {
  cloud: boolean
  target: 'profile' | 'snapshot' | 'feedback' | 'auth' | 'guest'
  reason?: string
  updatedAt: string
} | null

function getOrCreateGuestId() {
  try {
    const existing = localStorage.getItem(SIGHTLY_GUEST_ID_KEY)
    if (existing) return existing
    const guestId = `guest-${crypto.randomUUID()}`
    localStorage.setItem(SIGHTLY_GUEST_ID_KEY, guestId)
    return guestId
  } catch {
    return `guest-${Date.now()}`
  }
}

function syncStatusFor(target: NonNullable<SyncStatus>['target'], result: SyncResult): SyncStatus {
  return {
    target,
    cloud: result.cloud,
    reason: result.reason,
    updatedAt: new Date().toISOString(),
  }
}

function loadActiveSession(): ActiveSession | null {
  try {
    const stored = localStorage.getItem(SIGHTLY_ACTIVE_SESSION_KEY)
    return stored ? JSON.parse(stored) as ActiveSession : null
  } catch {
    return null
  }
}

function saveActiveSession(session: ActiveSession | null) {
  try {
    if (session) localStorage.setItem(SIGHTLY_ACTIVE_SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SIGHTLY_ACTIVE_SESSION_KEY)
  } catch {
    // Recovery is best-effort; completed snapshots remain in primary state storage.
  }
}

function loadOnboardingDraft(): OnboardingDraft | null {
  try {
    const stored = localStorage.getItem(SIGHTLY_ONBOARDING_DRAFT_KEY)
    return stored ? JSON.parse(stored) as OnboardingDraft : null
  } catch {
    return null
  }
}

function saveOnboardingDraft(draft: OnboardingDraft | null) {
  try {
    if (draft) localStorage.setItem(SIGHTLY_ONBOARDING_DRAFT_KEY, JSON.stringify(draft))
    else localStorage.removeItem(SIGHTLY_ONBOARDING_DRAFT_KEY)
  } catch {
    // Onboarding can still complete in memory if draft persistence is unavailable.
  }
}

const assessmentDesign: Record<ToolId, {
  title: string
  measuredBy: string
  prompt: string
  options: Array<{ label: string; helper: string; value: number }>
  visual: string
}> = {
  visualSharpness: {
    title: 'Smallest readable row',
    measuredBy: 'Minimum readable optotype size. Lower is better.',
    prompt: 'Type the smallest row that remains crisp, not guessed.',
    visual: 'E F P T O Z',
    options: [],
  },
  contrastSensitivity: {
    title: 'Lowest contrast seen',
    measuredBy: 'Contrast threshold percentage. Lower threshold means stronger contrast sensitivity.',
    prompt: 'Select the direction of the opening in each ring.',
    visual: '◌',
    options: [],
  },
  peripheralAwareness: {
    title: 'Peripheral Awareness',
    measuredBy: 'Edge stimulus detection while maintaining central focus. Higher is better.',
    prompt: 'Keep your eyes on the center dot, then answer whether the peripheral cue appeared.',
    visual: '•',
    options: [],
  },
  visualResponse: {
    title: 'Recognition Threshold',
    measuredBy: 'Shortest exposure duration where a directional symbol is recognized reliably. Lower milliseconds are better when accuracy remains high.',
    prompt: 'Identify the direction that briefly appeared.',
    visual: '← → ↑ ↓',
    options: [],
  },
}

function App() {
  const [state, setState] = useState<SightlyState>(() => loadState())
  const [tab, setTab] = useState<'home' | 'explore' | 'settings' | 'reliability' | 'betaDiagnostics'>('home')
  const [savedSession, setSavedSession] = useState<ActiveSession | null>(() => loadActiveSession())
  const [activeRunMode, setActiveRunMode] = useState<ActiveRunMode>('monthly-snapshot')
  const [activeTool, setActiveTool] = useState<VisionTool | null>(null)
  const [testStep, setTestStep] = useState(0)
  const [pendingMeasurements, setPendingMeasurements] = useState<Partial<Record<ToolId, number>>>({})
  const [pendingResultDetails, setPendingResultDetails] = useState<Partial<Record<ToolId, Partial<TestResult>>>>({})
  const [snapshotReadiness, setSnapshotReadiness] = useState<SnapshotReadiness | null>(null)
  const [showSnapshotPrep, setShowSnapshotPrep] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [testStartedAt, setTestStartedAt] = useState(() => Date.now())
  const [snapshotResumed, setSnapshotResumed] = useState(false)
  const [snapshotInterruptions, setSnapshotInterruptions] = useState(0)
  const [pendingCompletedSnapshot, setPendingCompletedSnapshot] = useState<{ check: SightlyState['checks'][number]; snapshotNumber: number } | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [guestId, setGuestId] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(null)
  const introCompleted = state.onboarded || loadOnboardingDraft()?.introComplete === true

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    let cancelled = false
    void getCurrentUserId().then((id) => {
      if (!cancelled) setUserId(id)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    saveState(state)
  }, [state])

  useEffect(() => {
    if (!userId || !state.onboarded) return
    void saveCloudProfile({
      userId,
      firstName: state.profile.name.trim(),
      ageRange: state.profile.ageRange,
      correctionType: state.profile.correctionProfile,
      lastEyeExam: state.profile.lastEyeExam,
    }).then((result) => setSyncStatus(syncStatusFor('profile', result)))
  }, [state.onboarded, state.profile.ageRange, state.profile.correctionProfile, state.profile.lastEyeExam, state.profile.name, userId])

  useEffect(() => {
    if (!syncStatus) return
    try {
      sessionStorage.setItem('sightly-sync-status', JSON.stringify(syncStatus))
    } catch {
      // Lightweight sync status is internal only; localStorage fallback continues either way.
    }
  }, [syncStatus])

  useEffect(() => {
    if (savedSession && !activeTool && !showSnapshotPrep) return
    const session: ActiveSession | null = activeTool || showSnapshotPrep || Object.keys(pendingMeasurements).length
      ? { activeRunMode, activeToolId: activeTool?.id ?? null, testStep, pendingMeasurements, pendingResultDetails, snapshotReadiness, showSnapshotPrep }
      : null
    saveActiveSession(session)
  }, [activeRunMode, activeTool, testStep, pendingMeasurements, pendingResultDetails, snapshotReadiness, showSnapshotPrep, savedSession])

  const completedChecks = state.checks.length
  const latestCheck = state.checks.at(-1)
  const baselineReady = state.baselineCalibration.completedSnapshots >= CALIBRATION_REQUIRED_SNAPSHOTS && Boolean(state.typicalRange)
  const calibrationInProgress = !baselineReady && completedChecks < CALIBRATION_REQUIRED_SNAPSHOTS
  const nextCalibrationSnapshotAt = calibrationInProgress && latestCheck
    ? new Date(new Date(latestCheck.date).getTime() + CALIBRATION_MIN_INTERVAL_MS)
    : null
  const calibrationWaitMs = nextCalibrationSnapshotAt ? Math.max(0, nextCalibrationSnapshotAt.getTime() - now) : 0
  const baselineCtaDisabled = calibrationInProgress && completedChecks > 0 && calibrationWaitMs > 0
  const nextSnapshotLabel = baselineCtaDisabled ? formatDuration(calibrationWaitMs) : 'Ready now'
  const typicalRangeLabel = state.typicalRange
    ? `${state.typicalRange.low}–${state.typicalRange.high}`
    : 'After 3 snapshots'
  const profileName = state.profile.name.trim()

  const homeStatus = useMemo(() => {
    if (!baselineReady) return {
      title: 'Welcome to Sightly',
      detail: 'Sightly helps you track changes in your visual performance over time.',
    }
    return {
      title: state.baselineCalibration.message,
      detail: state.baselineCalibration.optionalFourthSnapshotRecommended
        ? 'Your first 3 snapshots varied more than expected. An optional 4th calibration snapshot can improve consistency.'
        : 'Your baseline is ready. Sightly can now compare future snapshots against your normal range.',
    }
  }, [baselineReady, state.baselineCalibration.message, state.baselineCalibration.optionalFourthSnapshotRecommended])

  useEffect(() => {
    if (!state.profile.notificationsEnabled || !calibrationInProgress || calibrationWaitMs > 0 || completedChecks === 0) return undefined
    const reminder = completedChecks === 1 ? 'Snapshot 2 ready' : completedChecks === 2 ? 'Final baseline snapshot ready' : null
    if (!reminder || state.lastNotification === reminder) return undefined
    const reminderTimer = window.setTimeout(() => {
      setState((current) => current.lastNotification === reminder ? current : { ...current, lastNotification: reminder })
    }, 0)
    return () => window.clearTimeout(reminderTimer)
  }, [calibrationInProgress, calibrationWaitMs, completedChecks, state.lastNotification, state.profile.notificationsEnabled])

  function initializeSnapshot(readiness: SnapshotReadiness) {
    setActiveRunMode('monthly-snapshot')
    setSnapshotReadiness(readiness)
    setShowSnapshotPrep(false)
    setActiveTool(visionTools[0])
    setTestStep(0)
    setPendingMeasurements({})
    setPendingResultDetails({})
    setTestStartedAt(Date.now())
    setSnapshotResumed(false)
    setSnapshotInterruptions(0)
  }

  function prepareSnapshotReadiness(readiness: Omit<SnapshotReadiness, 'startedAt' | 'checklistConfirmed'>): SnapshotReadiness {
    return {
      ...readiness,
      checklistConfirmed: true,
      startedAt: new Date().toISOString(),
    }
  }

  function completeOnboarding(profile: OnboardingProfile) {
    const nextGuestId = profile.authMode === 'guest' ? getOrCreateGuestId() : null
    if (nextGuestId) {
      setGuestId(nextGuestId)
      setSyncStatus(syncStatusFor('guest', { cloud: false, reason: 'Guest beta mode uses local identity with localStorage fallback.' }))
    }

    setState(() => ({
      ...emptyState,
      onboarded: true,
      profile: {
        ...emptyState.profile,
        name: profile.name.trim(),
        authMode: profile.authMode,
        ageRange: profile.ageRange,
        correctionProfile: profile.correctionProfile,
        lastEyeExam: profile.lastEyeExam,
        usualCorrectionToday: profile.usualCorrectionToday,
      },
    }))
    if (profile.authMode === 'email') {
      void signInWithEmail(profile.email ?? '').then((result) => setSyncStatus(syncStatusFor('auth', result)))
    }
    if (userId) {
      void saveCloudProfile({
        userId,
        firstName: profile.name.trim(),
        ageRange: profile.ageRange,
        correctionType: profile.correctionProfile,
        lastEyeExam: profile.lastEyeExam,
      }).then((result) => setSyncStatus(syncStatusFor('profile', result)))
    }
    initializeSnapshot(prepareSnapshotReadiness({
      eyeFatigue: 'normal',
      visionCorrection: profile.usualCorrectionToday,
      armLengthConfirmed: true,
    }))
  }

  function startCheck() {
    if (baselineCtaDisabled) return
    setShowSnapshotPrep(true)
  }

  function beginSnapshot(readiness: Omit<SnapshotReadiness, 'startedAt' | 'checklistConfirmed'>) {
    initializeSnapshot(prepareSnapshotReadiness(readiness))
  }

  function recordMeasurement(value: number, details: Partial<TestResult> = {}) {
    if (!activeTool) return
    const fatigueAdjustment = snapshotReadiness?.eyeFatigue === 'veryTired' ? -8 : snapshotReadiness?.eyeFatigue === 'slightlyTired' ? -4 : 0
    const correctionAdjustment = snapshotReadiness?.visionCorrection === 'none' ? -2 : 0
    const completedAt = Date.now()
    const durationMs = completedAt - testStartedAt
    const contextualDetails: Partial<TestResult> = {
      ...details,
      durationMs,
      retryCount: details.retryCount ?? 0,
      confidence: Math.max(55, Math.min(99, (details.confidence ?? 94) + fatigueAdjustment + correctionAdjustment)),
      conditions: {
        ...captureTestConditions(),
        ...details.conditions,
        eyeFatigue: snapshotReadiness?.eyeFatigue ?? 'normal',
        visionCorrection: snapshotReadiness?.visionCorrection ?? 'notApplicable',
        viewingDistanceEstimate: snapshotReadiness?.armLengthConfirmed ? 'confirmed arm length' : 'comfortable consistent distance',
      },
    }

    if (activeRunMode === 'standalone-test') {
      const standalone = createStandaloneResult(activeTool, value, new Date(), contextualDetails)
      setState((current) => ({
        ...current,
        standaloneResults: [...current.standaloneResults, standalone],
        lastNotification: `${activeTool.title} standalone result saved for reference.`,
      }))
      setActiveTool(null)
      setSnapshotReadiness(null)
      setPendingMeasurements({})
      setPendingResultDetails({})
      setTestStep(0)
      setTab('explore')
      setSavedSession(null)
      return
    }

    const nextMeasurements = { ...pendingMeasurements, [activeTool.id]: value }
    const nextDetails = { ...pendingResultDetails, [activeTool.id]: contextualDetails }
    const currentIndex = visionTools.findIndex((tool) => tool.id === activeTool.id)

    if (currentIndex === -1) {
      setActiveTool(null)
      setPendingMeasurements({})
      setPendingResultDetails({})
      setTestStep(0)
      setTab('explore')
      return
    }

    const nextIndex = currentIndex + 1

    if (nextIndex >= visionTools.length) {
      const date = new Date()
      const perTestDurations = visionTools.reduce((acc, tool) => {
        const toolDuration = (nextDetails[tool.id] as Partial<TestResult> | undefined)?.durationMs
        if (typeof toolDuration === 'number') acc[tool.id] = toolDuration
        return acc
      }, {} as Partial<Record<ToolId, number>>)
      const retryFrequency = visionTools.reduce((sum, tool) => sum + ((nextDetails[tool.id] as Partial<TestResult> | undefined)?.retryCount ?? 0), 0)
      const startedAtMs = snapshotReadiness?.startedAt ? new Date(snapshotReadiness.startedAt).getTime() : date.getTime()
      const analytics: SnapshotAnalytics = {
        startedAt: snapshotReadiness?.startedAt ?? date.toISOString(),
        completedAt: date.toISOString(),
        totalDurationMs: Math.max(0, date.getTime() - startedAtMs),
        perTestDurations,
        abandonedTests: [],
        resumedSnapshot: snapshotResumed,
        retryFrequency,
        interruptionCount: snapshotInterruptions,
      }
      const check = createCheckFromMeasurements(nextMeasurements, date, nextDetails, snapshotReadiness, analytics)
      if (userId) {
        void saveCloudSnapshot({ userId, check }).then((result) => setSyncStatus(syncStatusFor('snapshot', result)))
      }
      const nextCompleted = completedChecks + 1
      const calibrationNotification = nextCompleted <= 3
        ? `Baseline snapshot ${nextCompleted} of 3 saved${nextCompleted === 1 ? '. Snapshot 2 ready in 12 hours.' : nextCompleted === 2 ? '. Final baseline snapshot ready in 12 hours.' : '. Baseline unlocked.'}`
        : 'Your Monthly Vision Snapshot is ready.'
      setState((current) =>
        rebuildDerivedState({
          ...current,
          checks: [...current.checks, check],
          lastNotification: calibrationNotification,
        }),
      )
      setActiveTool(null)
      setSnapshotReadiness(null)
      setPendingMeasurements({})
      setPendingResultDetails({})
      setTestStep(0)
      setPendingCompletedSnapshot({ check, snapshotNumber: nextCompleted })
      setTab('home')
      setSavedSession(null)
      return
    }

    setPendingMeasurements(nextMeasurements)
    setPendingResultDetails(nextDetails)
    setActiveTool(visionTools[nextIndex])
    setTestStartedAt(Date.now())
    setTestStep(nextIndex)
  }

  function recordBetaFeedback(snapshotId: string, believabilityRating: 1 | 2 | 3 | 4 | 5, comment: string, tags: BetaFeedbackTag[]) {
    const feedbackGuestId = userId ? null : (guestId ?? getOrCreateGuestId())
    if (feedbackGuestId && !guestId) setGuestId(feedbackGuestId)
    void saveCloudFeedback({
      userId,
      guestId: feedbackGuestId,
      snapshotId,
      believabilityRating,
      comment,
      tags,
    }).then((result) => setSyncStatus(syncStatusFor('feedback', result)))
    setState((current) => rebuildDerivedState({
      ...current,
      betaFeedback: [
        ...current.betaFeedback.filter((item) => item.snapshotId !== snapshotId),
        { snapshotId, createdAt: new Date().toISOString(), believabilityRating, comment, tags },
      ],
    }))
  }

  function startToolFromExplore(tool: VisionTool) {
    setActiveRunMode('standalone-test')
    setSnapshotReadiness(null)
    setPendingMeasurements({})
    setPendingResultDetails({})
    setTestStep(0)
    setTestStartedAt(Date.now())
    setActiveTool(tool)
  }

  function resumeSavedSession() {
    if (!savedSession) return
    setActiveRunMode(savedSession.activeRunMode)
    setPendingMeasurements(savedSession.pendingMeasurements)
    setPendingResultDetails(savedSession.pendingResultDetails)
    setSnapshotReadiness(savedSession.snapshotReadiness)
    setTestStep(savedSession.testStep)
    setShowSnapshotPrep(savedSession.showSnapshotPrep)
    setSnapshotResumed(true)
    setSnapshotInterruptions((current) => current + 1)
    setTestStartedAt(Date.now())
    setActiveTool([...visionTools, ...advancedVisionTools].find((tool) => tool.id === savedSession.activeToolId) ?? null)
    setSavedSession(null)
  }

  function discardSavedSession() {
    saveActiveSession(null)
    setSavedSession(null)
    setActiveTool(null)
    setSnapshotReadiness(null)
    setPendingMeasurements({})
    setPendingResultDetails({})
    setShowSnapshotPrep(false)
    setTestStep(0)
  }

  function resetToFreshBaseline() {
    setState({ ...emptyState, onboarded: true })
    setTab('home')
  }

  function restoreDemo() {
    setState(createDemoState())
    setTab('home')
  }

  if (!introCompleted || !state.onboarded) {
    return <FirstRunOnboarding onComplete={completeOnboarding} />
  }

  if (savedSession && !activeTool && !showSnapshotPrep) {
    return <RecoveryScreen onContinue={resumeSavedSession} onDiscard={discardSavedSession} />
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <section className="phone-frame">
        {showSnapshotPrep ? (
          <SnapshotReadinessScreen onBegin={beginSnapshot} onCancel={() => setShowSnapshotPrep(false)} />
        ) : activeTool ? (
          <VisionTest
            step={testStep}
            total={activeRunMode === 'monthly-snapshot' ? visionTools.length : 1}
            tool={activeTool}
            onRecord={recordMeasurement}
            onCancel={() => { setActiveTool(null); setPendingMeasurements({}); setPendingResultDetails({}); setSavedSession(null) }}
          />
        ) : pendingCompletedSnapshot ? (
          <SnapshotCompleteScreen
            baselineReady={baselineReady}
            check={pendingCompletedSnapshot.check}
            onContinue={() => { setPendingCompletedSnapshot(null); setTab('home') }}
            snapshotNumber={pendingCompletedSnapshot.snapshotNumber}
            typicalRangeLabel={typicalRangeLabel}
          />
        ) : (
          <>
            {tab === 'home' && (
              <HomeScreen
                baselineCtaDisabled={baselineCtaDisabled}
                baselineReady={baselineReady}
                calibration={state.baselineCalibration}
                completedChecks={completedChecks}
                profileName={profileName}
                homeStatus={homeStatus}
                latestCheck={latestCheck}
                onFeedback={recordBetaFeedback}
                existingFeedback={state.betaFeedback.find((item) => item.snapshotId === latestCheck?.id)}
                nextSnapshotLabel={nextSnapshotLabel}
                snapshots={state.snapshots}
                startCheck={startCheck}
                typicalRangeLabel={typicalRangeLabel}
              />
            )}
            {tab === 'explore' && <ExploreScreen checks={state.checks} startTool={startToolFromExplore} />}
            {tab === 'settings' && (
              <SettingsScreen
                state={state}
                restoreDemo={restoreDemo}
                resetToFreshBaseline={resetToFreshBaseline}
                openReliability={() => setTab('reliability')}
                openBetaDiagnostics={() => setTab('betaDiagnostics')}
                toggleNotifications={() =>
                  setState((current) => ({
                    ...current,
                    profile: { ...current.profile, notificationsEnabled: !current.profile.notificationsEnabled },
                  }))
                }
              />
            )}
            {tab === 'reliability' && <ReliabilityDashboard state={state} onBack={() => setTab('settings')} />}
            {tab === 'betaDiagnostics' && <BetaDiagnosticsScreen state={state} onBack={() => setTab('settings')} />}
            <BottomNav tab={tab === 'betaDiagnostics' ? 'settings' : tab} setTab={setTab} />
          </>
        )}
      </section>
    </main>
  )
}


type OnboardingProfile = {
  authMode: AuthMode
  name: string
  email?: string
  ageRange: string
  correctionProfile: CorrectionProfile
  lastEyeExam: LastEyeExamRange
  usualCorrectionToday: VisionCorrectionUsage
}

function RecoveryScreen({ onContinue, onDiscard }: { onContinue: () => void; onDiscard: () => void }) {
  return (
    <main className="app-shell welcome-shell onboarding-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <section className="phone-frame onboarding-frame">
        <div className="screen onboarding-screen baseline-step">
          <p className="eyebrow">Interrupted Snapshot</p>
          <h1>Resume Snapshot?</h1>
          <p className="onboarding-subtitle">Your snapshot is saved on this device. Continue when you’re ready.</p>
          <button className="glass-button primary setup-next" onClick={onContinue}>Continue</button>
          <button className="glass-button quiet setup-next" onClick={onDiscard}>Discard</button>
        </div>
      </section>
    </main>
  )
}

const ageRangeOptions = ['Under 18', '18–29', '30–44', '45–59', '60+']
const correctionProfileOptions: Array<{ value: CorrectionProfile; label: string }> = [
  { value: 'glasses', label: 'Glasses' },
  { value: 'contacts', label: 'Contacts' },
  { value: 'both', label: 'Both' },
  { value: 'none', label: 'No' },
]
const lastExamOptions: Array<{ value: LastEyeExamRange; label: string }> = [
  { value: 'within6Months', label: 'Within 6 months' },
  { value: 'sixToTwelveMonths', label: '6–12 months' },
  { value: 'oneToTwoYears', label: '1–2 years' },
  { value: 'overTwoYears', label: 'Over 2 years' },
  { value: 'unknown', label: 'I don’t remember' },
]

const introSlides = [
  {
    title: 'Sightly',
    subtitle: 'See what eyes miss.',
    body: [
      'Vision often changes gradually enough that you don’t notice it happening.',
      'Sightly helps you track changes over time with simple vision snapshots.',
    ],
    visual: 'orb',
    cta: 'Swipe to continue →',
  },
  {
    title: 'Build Your Vision Baseline',
    body: [
      'Sightly learns what is normal for you through a few quick snapshots.',
      'Over time, you’ll be able to spot trends, changes, and patterns that might otherwise go unnoticed.',
    ],
    visual: 'baseline',
    cta: 'Next',
  },
  {
    title: 'Your Vision Journey Starts Here',
    body: [
      'Track your vision over time with simple check-ins designed to help you notice gradual changes.',
    ],
    visual: 'timeline',
    cta: 'Next',
  },
]

const authActions: Array<{ mode: AuthMode; label: string; primary?: boolean }> = [
  { mode: 'apple', label: 'Continue with Apple', primary: true },
  { mode: 'google', label: 'Continue with Google' },
  { mode: 'email', label: 'Continue with Email' },
  { mode: 'guest', label: 'Continue as Guest' },
]

function IntroVisual({ type }: { type: string }) {
  if (type === 'baseline') {
    return (
      <div className="intro-visual intro-baseline-path" aria-hidden="true">
        {['Snapshot 1', 'Snapshot 2', 'Snapshot 3', 'Your Baseline'].map((label, index) => (
          <div className="snapshot-node milestone-card" key={label} style={{ '--delay': `${index * 0.12}s` } as CSSProperties}>
            <span>{label}</span>
          </div>
        ))}
        <span className="node-connection baseline-connection" />
      </div>
    )
  }

  if (type === 'timeline') {
    return (
      <div className="intro-visual intro-journey-timeline" aria-hidden="true">
        {['Today', 'Baseline', 'Journey', 'Snapshot'].map((label, index) => (
          <div className="journey-marker timeline-card" key={label} style={{ '--delay': `${index * 0.14}s` } as CSSProperties}>
            <span />
            <strong>{label}</strong>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="intro-visual intro-orb-wrap" aria-hidden="true">
      <div className="intro-orb"><span /></div>
    </div>
  )
}

function SightlyIntroExperience({ onBeginSetup }: { onBeginSetup: (authMode: AuthMode) => void }) {
  const [introStep, setIntroStep] = useState(0)
  const touchStartX = useRef<number | null>(null)

  const goToSlide = (index: number) => setIntroStep(Math.max(0, Math.min(index, introSlides.length - 1)))
  const nextSlide = () => goToSlide(introStep + 1)
  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    touchStartX.current = event.touches[0]?.clientX ?? null
  }
  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (touchStartX.current === null) return
    const delta = touchStartX.current - (event.changedTouches[0]?.clientX ?? touchStartX.current)
    touchStartX.current = null
    if (Math.abs(delta) < 38) return
    if (delta > 0) nextSlide()
    else goToSlide(introStep - 1)
  }

  return (
    <main className="app-shell welcome-shell onboarding-shell intro-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <section className="phone-frame onboarding-frame intro-frame">
        <div className="screen intro-screen carousel-screen">
          <div className="intro-topline">
            <span>{introStep + 1} / {introSlides.length}</span>
          </div>
          <div
            className="intro-carousel"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            style={{ '--intro-step': introStep } as CSSProperties}
            aria-live="polite"
          >
            {introSlides.map((slide, index) => (
              <article className={`intro-slide-card intro-slide-${slide.visual} glass-card`} key={slide.title} aria-hidden={index !== introStep}>
                <IntroVisual type={slide.visual} />
                <div className="intro-copy">
                  <h1>{slide.title}</h1>
                  {slide.subtitle && <p className="intro-subtitle">{slide.subtitle}</p>}
                  <div className="intro-body-copy">
                    {slide.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  </div>
                </div>
                {index === 2 && (
                  <div className="onboarding-actions intro-auth-actions">
                    {authActions.map((action) => (
                      <button
                        className={action.primary ? 'glass-button primary' : 'glass-button'}
                        key={action.mode}
                        onClick={() => onBeginSetup(action.mode)}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
          <div className="intro-progress" aria-label="Intro progress">
            {introSlides.map((item, index) => (
              <button
                aria-label={`Go to slide ${index + 1}`}
                className={index === introStep ? 'active' : ''}
                key={item.title}
                onClick={() => goToSlide(index)}
              />
            ))}
          </div>
          {introStep < introSlides.length - 1 && (
            <button className="glass-button primary setup-next intro-next" onClick={nextSlide}>
              {introSlides[introStep].cta}
            </button>
          )}
        </div>
      </section>
    </main>
  )
}

function FirstRunOnboarding({ onComplete }: { onComplete: (profile: OnboardingProfile) => void }) {
  const draft = loadOnboardingDraft()
  const [introComplete, setIntroComplete] = useState(() => draft?.introComplete ?? false)
  const [step, setStep] = useState(() => Math.min(Math.max(draft?.step ?? 1, 1), 2))
  const [profile, setProfile] = useState<OnboardingProfile>(() => draft?.profile ?? {
    authMode: 'guest',
    name: '',
    ageRange: '30–44',
    correctionProfile: 'glasses',
    lastEyeExam: 'unknown',
    usualCorrectionToday: 'glasses',
  })

  useEffect(() => {
    saveOnboardingDraft({ introComplete, step, profile })
  }, [introComplete, step, profile])

  const updateProfile = (patch: Partial<OnboardingProfile>) => setProfile((current) => ({ ...current, ...patch }))
  const next = () => setStep((current) => Math.min(current + 1, 2))
  const completeSetup = () => {
    saveOnboardingDraft(null)
    onComplete(profile)
  }

  if (!introComplete) {
    return <SightlyIntroExperience onBeginSetup={(authMode) => {
      updateProfile({ authMode })
      setStep(1)
      setIntroComplete(true)
    }} />
  }

  return (
    <main className="app-shell welcome-shell onboarding-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <section className="phone-frame onboarding-frame">
        {step === 1 && (
          <div className="screen onboarding-screen profile-step consolidated-profile-step">
            <p className="eyebrow">Profile Setup</p>
            <h1>A few details.</h1>
            <label className="soft-field">First name<input autoComplete="given-name" enterKeyHint="next" value={profile.name} onChange={(event) => updateProfile({ name: event.target.value })} onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'center' })} placeholder="First name" /></label>
            {profile.authMode === 'email' && (
              <label className="soft-field">Email<input autoComplete="email" enterKeyHint="next" inputMode="email" value={profile.email ?? ''} onChange={(event) => updateProfile({ email: event.target.value })} onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'center' })} placeholder="you@example.com" /></label>
            )}
            <div className="onboarding-group">
              <p>Age range</p>
              <div className="choice-grid setup-grid compact-setup-grid">
                {ageRangeOptions.map((ageRange) => <button className={profile.ageRange === ageRange ? 'selected' : ''} key={ageRange} onClick={() => updateProfile({ ageRange })}>{ageRange}</button>)}
              </div>
            </div>
            <div className="onboarding-group">
              <p>Glasses / Contacts</p>
              <div className="choice-grid setup-grid compact-setup-grid">
                {correctionProfileOptions.map((option) => <button className={profile.correctionProfile === option.value ? 'selected' : ''} key={option.value} onClick={() => updateProfile({ correctionProfile: option.value })}>{option.label}</button>)}
              </div>
            </div>
            <div className="onboarding-group">
              <p>Last eye exam</p>
              <div className="choice-list setup-list compact-setup-list">
                {lastExamOptions.map((option) => <button className={profile.lastEyeExam === option.value ? 'selected' : ''} key={option.value} onClick={() => updateProfile({ lastEyeExam: option.value })}>{option.label}</button>)}
              </div>
            </div>
            <div className="onboarding-group">
              <p>Vision correction today</p>
              <div className="choice-grid setup-grid compact-setup-grid">
                {correctionOptions.map((option) => <button className={profile.usualCorrectionToday === option.value ? 'selected' : ''} key={option.value} onClick={() => updateProfile({ usualCorrectionToday: option.value })}>{option.label}</button>)}
              </div>
            </div>
            <button className="glass-button primary setup-next" onClick={next}>Continue</button>
          </div>
        )}

        {step === 2 && (
          <div className="screen onboarding-screen baseline-step consolidated-baseline-step">
            <p className="eyebrow">Build Your Baseline</p>
            <h1>Start with Snapshot 1.</h1>
            <p className="onboarding-subtitle">Three snapshots help Sightly learn what is normal for you.</p>
            <div className="baseline-pill glass-card"><span>Snapshot 1 of 3</span><strong>Ready now</strong></div>
            <div className="readiness-list onboarding-readiness">
              {readinessChecklist.map((item) => <div key={item}><span>✓</span>{item}</div>)}
            </div>
            <button className="glass-button primary setup-next" onClick={completeSetup}>Start First Snapshot</button>
            <p className="disclaimer">Your Vision Score unlocks after 3 snapshots.</p>
          </div>
        )}
      </section>
    </main>
  )
}

const readinessChecklist = [
  'Brightness high',
  'Steady lighting',
  'Similar viewing distance',
  'Wear your usual correction',
]

const peripheralAnswerOptions: Array<{ value: PeripheralDirection; label: string }> = [
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'upper-left', label: 'Top Left' },
  { value: 'upper-right', label: 'Top Right' },
  { value: 'lower-left', label: 'Bottom Left' },
  { value: 'lower-right', label: 'Bottom Right' },
]

function testProgressLabel(step: number, total: number) {
  if (total <= 1) return 'Finding your threshold'
  if (step === total - 1) return 'Last step'
  if (step === total - 2) return 'Almost there'
  return `Snapshot step ${step + 1} of ${total}`
}

const fatigueOptions: Array<{ value: EyeFatigueLevel; label: string }> = [
  { value: 'great', label: 'Great' },
  { value: 'normal', label: 'Normal' },
  { value: 'slightlyTired', label: 'Slightly Tired' },
  { value: 'veryTired', label: 'Very Tired' },
]

const correctionOptions: Array<{ value: VisionCorrectionUsage; label: string }> = [
  { value: 'glasses', label: 'Glasses' },
  { value: 'contacts', label: 'Contacts' },
  { value: 'none', label: 'None' },
  { value: 'notApplicable', label: 'Not Applicable' },
]

function SnapshotReadinessScreen({
  onBegin,
  onCancel,
}: {
  onBegin: (readiness: Omit<SnapshotReadiness, 'startedAt' | 'checklistConfirmed'>) => void
  onCancel: () => void
}) {
  const [eyeFatigue, setEyeFatigue] = useState<EyeFatigueLevel>('normal')
  const [visionCorrection, setVisionCorrection] = useState<VisionCorrectionUsage>('notApplicable')
  const [armLengthConfirmed, setArmLengthConfirmed] = useState(false)

  return (
    <div className="screen snapshot-prep-screen">
      <button className="text-button" onClick={onCancel}>Cancel</button>
      <header className="top-header compact snapshot-readiness-header">
        <h1>Let’s check in.</h1>
        <p>Use similar conditions for the most reliable results.</p>
      </header>

      <section className="prep-card glass-card preparation-card">
        <h2>Before you begin</h2>
        <div className="readiness-list" aria-label="Snapshot readiness checklist">
          {readinessChecklist.map((item) => (
            <div key={item}><span>✓</span>{item}</div>
          ))}
        </div>
        <label className="distance-confirm">
          <input checked={armLengthConfirmed} onChange={(event) => setArmLengthConfirmed(event.target.checked)} type="checkbox" />
          <span>I can keep the phone at a consistent distance</span>
        </label>
      </section>

      <section className="prep-section prep-questions">
        <fieldset>
          <legend>Today’s conditions</legend>
          <p>How do your eyes feel?</p>
          <div className="choice-grid generous">
            {fatigueOptions.map((option) => (
              <button
                className={eyeFatigue === option.value ? 'selected' : ''}
                key={option.value}
                onClick={() => setEyeFatigue(option.value)}
                type="button"
              >
                <span>{eyeFatigue === option.value ? '●' : '○'}</span>{option.label}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="prep-section prep-questions">
        <fieldset>
          <legend>Vision correction</legend>
          <p>Using your usual correction?</p>
          <div className="choice-grid generous">
            {correctionOptions.map((option) => (
              <button
                className={visionCorrection === option.value ? 'selected' : ''}
                key={option.value}
                onClick={() => setVisionCorrection(option.value)}
                type="button"
              >
                <span>{visionCorrection === option.value ? '●' : '○'}</span>{option.label}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="prep-confidence glass-card">
        <p className="eyebrow">Snapshot Confidence</p>
        <h2>Captured quietly</h2>
        <strong>98%</strong>
        <p>Device, light, and setup context help make trends easier to trust.</p>
      </section>

      <section className="arm-length-reminder glass-card" aria-label="Final distance reminder">
        <strong>Hold your phone at arm’s length.</strong>
        <span>Use the same distance each time.</span>
      </section>

      <button className="glass-button primary begin-snapshot" onClick={() => onBegin({ eyeFatigue, visionCorrection, armLengthConfirmed })}>
        <span className="button-label">Begin Snapshot</span>
        <span className="button-arrow" aria-hidden="true">→</span>
      </button>
    </div>
  )
}

function SnapshotCompleteScreen({
  baselineReady,
  check,
  onContinue,
  snapshotNumber,
  typicalRangeLabel,
}: {
  baselineReady: boolean
  check: SightlyState['checks'][number]
  onContinue: () => void
  snapshotNumber: number
  typicalRangeLabel: string
}) {
  const visibleResults = check.testResults.filter((result) => result.capability !== 'visualResponse')
  const resultLabels: Record<CapabilityId, string> = {
    sharpness: 'Visual Sharpness',
    contrast: 'Contrast Sensitivity',
    peripheralAwareness: 'Peripheral Awareness',
    visualResponse: 'Recognition Threshold',
  }
  const confidenceLabel = `${check.confidence}%`
  const mainInsight = check.explanation?.summary
    ?? (baselineReady
      ? 'Your baseline is ready. Future snapshots can now compare against your typical range.'
      : 'Sightly is learning your normal visual range.')

  return (
    <div className="screen post-snapshot-results-screen">
      <header className="snapshot-complete-hero glass-card">
        <p className="section-kicker">Snapshot Complete</p>
        <h1>Snapshot Complete</h1>
        {!baselineReady ? (
          <>
            <strong>Snapshot {snapshotNumber} of 3 complete</strong>
            <p>Sightly is learning your normal visual range.</p>
          </>
        ) : (
          <>
            <strong>{check.score ?? '—'}</strong>
            <p>Vision Score</p>
          </>
        )}
      </header>

      {!baselineReady ? (
        <section className="snapshot-complete-card glass-card" aria-label="Early Results">
          <p className="section-kicker">Early Results</p>
          <h2>Early snapshot results</h2>
          <div className="snapshot-result-list">
            {visibleResults.map((result) => (
              <div key={result.id}>
                <span>{resultLabels[result.capability]}</span>
                <b>{formatMeasurement(result)}</b>
              </div>
            ))}
            <div>
              <span>Confidence</span>
              <b>{confidenceLabel}</b>
            </div>
          </div>
          <p className="snapshot-unlock-copy">Your Vision Score unlocks after 3 baseline snapshots.</p>
        </section>
      ) : (
        <section className="snapshot-complete-card glass-card" aria-label="Snapshot Summary">
          <div className="snapshot-summary-grid">
            <Metric label="Vision Score" value={check.score ?? '—'} />
            <Metric label="Typical Range" value={typicalRangeLabel} />
            <Metric label="Confidence" value={confidenceLabel} />
          </div>
          <div className="snapshot-breakdown">
            <p className="section-kicker">Test breakdown</p>
            <div className="snapshot-result-list">
              {visibleResults.map((result) => (
                <div key={result.id}>
                  <span>{resultLabels[result.capability]}</span>
                  <b>{formatMeasurement(result)}</b>
                </div>
              ))}
            </div>
          </div>
          <div className="snapshot-main-insight">
            <p className="section-kicker">Main insight</p>
            <h2>{mainInsight}</h2>
          </div>
        </section>
      )}

      <button className="glass-button primary snapshot-complete-cta" onClick={onContinue}>
        {baselineReady ? 'View Home' : 'Continue'}
      </button>
    </div>
  )
}

function HomeScreen({
  baselineCtaDisabled,
  baselineReady,
  calibration,
  completedChecks,
  profileName,
  homeStatus,
  latestCheck,
  onFeedback,
  existingFeedback,
  nextSnapshotLabel,
  snapshots,
  startCheck,
  typicalRangeLabel,
}: {
  baselineCtaDisabled: boolean
  baselineReady: boolean
  calibration: SightlyState['baselineCalibration']
  completedChecks: number
  profileName: string
  homeStatus: { title: string; detail: string }
  latestCheck: SightlyState['checks'][number] | undefined
  onFeedback: (snapshotId: string, believabilityRating: 1 | 2 | 3 | 4 | 5, comment: string, tags: BetaFeedbackTag[]) => void
  existingFeedback: SightlyState['betaFeedback'][number] | undefined
  nextSnapshotLabel: string
  snapshots: SightlyState['snapshots']
  startCheck: () => void
  typicalRangeLabel: string
}) {
  const latestScore = baselineReady ? latestCheck?.score ?? null : null
  const latestSnapshot = snapshots.at(-1)
  const scoreClass = baselineReady && (latestSnapshot?.interpretationLevel === 'single-below-range' || latestSnapshot?.interpretationLevel === 'consecutive-below-range' || latestSnapshot?.interpretationLevel === 'trend-detected')
    ? 'below'
    : baselineReady && latestSnapshot?.interpretationLevel === 'above-range'
      ? 'above'
      : 'within'
  const latestSnapshots = snapshots.slice(-3)
  const currentVisionStatus = !baselineReady
    ? baselineStepLabel(completedChecks)
    : scoreClass === 'below'
      ? 'Below Typical Range'
      : scoreClass === 'above'
        ? 'Above Typical Range'
        : 'Within Typical Range'
  const storyTitle = scoreClass === 'below' ? 'Vision Insight' : 'Vision Story'
  const [showBaselineInfo, setShowBaselineInfo] = useState(false)
  const primaryChange = latestCheck?.explanation?.contributions.find((item) => item.points !== 0)

  return (
    <div className="screen home-screen liquid-home">
      <div className="ios-status" aria-hidden="true">
        <span>9:41</span>
        <div className="dynamic-island" />
        <span className="status-glyphs">▮▮▮ ϟ ▰</span>
      </div>

      <header className="home-hero-header">
        <div>
          {profileName ? <p>Good evening,</p> : <p className="neutral-home-kicker">Welcome to Sightly</p>}
          <h1>{profileName || 'Welcome to Sightly'}</h1>
        </div>
        <button className="profile-bubble" aria-label="Profile">
          <span />
        </button>
      </header>

      <section className={`current-vision-panel ${scoreClass}`} aria-label="Current Vision">
        <p className="current-vision-kicker">{baselineReady ? 'Current Vision' : 'Welcome to Sightly'}</p>
        <strong>{latestScore ?? (baselineReady ? '—' : `${Math.min(completedChecks, 3)} of 3`)}</strong>
        <h2>{baselineReady ? currentVisionStatus : 'Baseline Progress'}</h2>
        <p className="current-vision-range">{baselineReady ? `Typical Range · ${typicalRangeLabel}` : 'Baseline Progress'}</p>
      </section>

      <section className="vision-story-section" aria-label="Vision Story">
        <p className="section-kicker">{baselineReady ? storyTitle : 'What Sightly Does'}</p>
        <h2>{homeStatus.title}</h2>
        <p>{homeStatus.detail}</p>
        {!baselineReady && <p>Start by completing 3 baseline snapshots across separate sessions. This helps Sightly learn your normal range so future changes can be compared to you — not everyone else.</p>}
        {!baselineReady && <button className="text-button baseline-info-link" onClick={() => setShowBaselineInfo(true)}>What is a baseline?</button>}
        {scoreClass === 'below' && <p className="quiet-recommendation">Retest in 7 days to confirm.</p>}
      </section>

      {latestCheck && (
        <section className="home-feedback-section" aria-label="Beta Feedback">
          <BetaFeedbackCard snapshotId={latestCheck.id} existingFeedback={existingFeedback} onSubmit={onFeedback} />
        </section>
      )}

      {!baselineReady && (
        <section className="baseline-progress-section" aria-label="Baseline calibration progress">
          <div>
            <p className="section-kicker">Baseline Progress</p>
            <h2>{Math.min(completedChecks, CALIBRATION_REQUIRED_SNAPSHOTS)} of 3 snapshots complete</h2>
            <p>Next: {completedChecks === 0 ? 'Complete Snapshot 1 when ready' : completedChecks === 1 ? 'Complete Snapshot 2 when available' : 'Complete Snapshot 3 when available'}</p>
          </div>
          <div className="next-snapshot-card glass-card">
            <span>Next:</span>
            <strong>{baselineCtaDisabled ? nextSnapshotLabel : completedChecks === 0 ? 'Complete Snapshot 1' : completedChecks === 1 ? 'Complete Snapshot 2' : 'Complete Snapshot 3'}</strong>
          </div>
        </section>
      )}

      {baselineReady && (
        <section className="baseline-progress-section baseline-complete-section" aria-label="Baseline established">
          <div>
            <p className="section-kicker">Baseline Calibration</p>
            <h2>{calibration.message}</h2>
            <p>{calibration.consistency === 'high' ? 'Your first 3 snapshots were consistent.' : 'Additional calibration may improve accuracy.'}</p>
          </div>
          <div className="baseline-metrics-grid">
            <Metric label="Average" value={calibration.average ?? '—'} />
            <Metric label="Variance" value={calibration.variance ?? '—'} />
            <Metric label="Repeatability" value={calibration.repeatability ?? '—'} />
            <Metric label="Confidence" value={`${calibration.confidence}%`} />
          </div>
          {calibration.optionalFourthSnapshotRecommended && (
            <button className="glass-button quiet optional-calibration-button" onClick={startCheck}>Take Optional Calibration Snapshot</button>
          )}
        </section>
      )}

      {baselineReady && completedChecks > CALIBRATION_REQUIRED_SNAPSHOTS && latestCheck?.explanation && (
        <section className="what-changed-section" aria-label="What changed and why">
          <div>
            <p className="section-kicker">What Changed</p>
            <h2>{primaryChange ? primaryChange.label.replace('Visual ', '') : 'No major component shift'}</h2>
          </div>
          <p>{latestCheck.explanation.summary}</p>
          <div className="quiet-contribution-list">
            {latestCheck.explanation.contributions.filter((item) => item.points !== 0).slice(0, 2).map((item) => (
              <div className={`quiet-contribution-row ${item.status}`} key={item.capability}>
                <span>{item.label.replace('Visual ', '')}</span>
                <b>{item.points > 0 ? '+' : ''}{item.points} pts</b>
              </div>
            ))}
          </div>
        </section>
      )}

      <button className="glass-button check-button reference-check quiet-check" disabled={baselineCtaDisabled} onClick={startCheck}>
        <strong>{baselineReady ? (calibration.optionalFourthSnapshotRecommended ? 'Add Calibration Snapshot' : 'Check In') : 'Continue Baseline'}</strong>
      </button>

      {!baselineReady && latestCheck && (
        <section className="early-results-section" aria-label="Early Results">
          <p className="section-kicker">Early Results</p>
          <h2>Snapshot {completedChecks} of 3 complete.</h2>
          <p>{Math.max(0, 3 - completedChecks)} more snapshot{3 - completedChecks === 1 ? '' : 's'} until Sightly learns your typical range.</p>
          <div className="early-result-list">
            {latestCheck.testResults.filter((result) => result.capability !== 'visualResponse').map((result) => (
              <div key={result.id}><span>{result.metricLabel}</span><b>{formatMeasurement(result)}</b></div>
            ))}
          </div>
        </section>
      )}

      {baselineReady && (
        <section className="supporting-details-section" aria-label="Supporting Details">
        <div className="simple-section-heading">
          <p className="section-kicker">Supporting Details</p>
          <h2>Vision History</h2>
        </div>
        <div className="memory-card-strip">
          {latestSnapshots.map((snapshot, index) => {
            const current = index === latestSnapshots.length - 1
            const status = current && scoreClass === 'below' ? 'Below Baseline' : 'In Range'
            return (
              <button className={`memory-card ${current ? 'current' : ''}`} key={snapshot.id}>
                <span>{snapshot.monthLabel.split(' ')[0]}</span>
                <strong>{snapshot.score ?? '—'}</strong>
                <small>{status}</small>
              </button>
            )
          })}
        </div>

        <div className="vision-events-list" aria-label="Vision Events">
          <div className="vision-event-row"><span>👓</span><p>New Prescription</p></div>
          <div className="vision-event-row"><span>🏥</span><p>Eye Exam</p></div>
          <div className="vision-event-row"><span>⚠️</span><p>Eye Injury</p></div>
        </div>
        </section>
      )}

      {showBaselineInfo && (
        <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="What is a baseline?">
          <section className="glass-card baseline-info-modal">
            <h2>What is a baseline?</h2>
            <p>A baseline is your personal normal range. Sightly uses it to compare future snapshots against your own history.</p>
            <button className="glass-button primary" onClick={() => setShowBaselineInfo(false)}>Got it</button>
          </section>
        </div>
      )}
    </div>
  )
}

function BetaFeedbackCard({
  snapshotId,
  existingFeedback,
  onSubmit,
}: {
  snapshotId?: string
  existingFeedback?: SightlyState['betaFeedback'][number]
  onSubmit?: (snapshotId: string, believabilityRating: 1 | 2 | 3 | 4 | 5, comment: string, tags: BetaFeedbackTag[]) => void
}) {
  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5 | null>(existingFeedback?.believabilityRating ?? null)
  const [comment, setComment] = useState(existingFeedback?.comment ?? '')
  const [tags, setTags] = useState<BetaFeedbackTag[]>(existingFeedback?.tags ?? [])
  const [saved, setSaved] = useState(Boolean(existingFeedback))
  const options: Array<{ value: BetaFeedbackTag; label: string }> = [
    { value: 'consistent', label: 'consistent' },
    { value: 'surprising', label: 'surprising' },
    { value: 'inaccurate', label: 'inaccurate' },
    { value: 'difficult-to-complete', label: 'difficult to complete' },
  ]
  const toggleTag = (value: BetaFeedbackTag) => setTags((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  const saveFeedback = () => {
    if (!snapshotId || !rating || !onSubmit) return
    onSubmit(snapshotId, rating, comment.trim(), tags)
    setSaved(true)
  }

  return (
    <section className="beta-feedback-card glass-card" aria-label="Beta tester feedback">
      <div>
        <p className="section-kicker">Beta Feedback</p>
        <h2>Was this result believable?</h2>
        <p>Stored locally on this device for beta validation.</p>
      </div>
      <div className="beta-rating-row" aria-label="Believability rating from 1 to 5">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            aria-pressed={rating === value}
            className={rating === value ? 'selected' : ''}
            key={value}
            onClick={() => { setRating(value as 1 | 2 | 3 | 4 | 5); setSaved(false) }}
            type="button"
          >
            {value}
          </button>
        ))}
      </div>
      <label className="beta-feedback-field">
        <span>Optional feedback</span>
        <textarea value={comment} onChange={(event) => { setComment(event.target.value); setSaved(false) }} placeholder="What felt inaccurate or confusing?" rows={3} />
      </label>
      <div className="beta-feedback-tags" aria-label="Result feeling tags">
        {options.map((option) => (
          <button className={tags.includes(option.value) ? 'selected' : ''} key={option.value} onClick={() => { toggleTag(option.value); setSaved(false) }} type="button">
            {option.label}
          </button>
        ))}
      </div>
      {snapshotId && onSubmit && (
        <button className="glass-button quiet beta-save-button" disabled={!rating} onClick={saveFeedback}>Save Beta Feedback</button>
      )}
      {saved && <p className="feedback-saved-note">Saved locally for beta review.</p>}
    </section>
  )
}

function ExploreScreen({ checks, startTool }: { checks: SightlyState['checks']; startTool: (tool: VisionTool) => void }) {
  return (
    <div className="screen explore-screen">
      <header className="top-header compact">
        <p className="small-muted">Explore</p>
        <h1>Explore</h1>
      </header>
      <div className="tool-grid">
        {visionTools.map((tool) => {
          const history = checks.flatMap((check) => check.testResults).filter((result) => result.toolId === tool.id)
          const last = history.at(-1)
          return (
            <button className="tool-card glass-card" key={tool.id} onClick={() => startTool(tool)}>
              <div className="tool-icon">{iconFor(tool.capability)}</div>
              <div>
                <h2>{tool.title}</h2>
                <p>{tool.description}</p>
                <dl>
                  <div><dt>Measures</dt><dd>{tool.metricLabel}</dd></div>
                  <div><dt>Last Result</dt><dd>{last ? `${formatMeasurement(last)} · ${last.normalizedScore}` : tool.lastResultLabel}</dd></div>
                </dl>
              </div>
            </button>
          )
        })}
      </div>
      <section className="advanced-tests-section" aria-label="Advanced Tests">
        <p className="section-kicker">Advanced Tests</p>
        <h2>Not included in Vision Score</h2>
        <p>Standalone checks for learning more. They do not affect your monthly score.</p>
        <div className="tool-grid advanced-tool-grid">
          {advancedVisionTools.map((tool) => (
            <button className="tool-card glass-card advanced-tool-card" key={tool.id} onClick={() => startTool(tool)}>
              <div className="tool-icon">{iconFor(tool.capability)}</div>
              <div>
                <h2>{tool.title}</h2>
                <p>{tool.description}</p>
                <dl>
                  <div><dt>Category</dt><dd>Advanced Tests</dd></div>
                  <div><dt>Score Impact</dt><dd>Not scored</dd></div>
                </dl>
              </div>
            </button>
          ))}
        </div>
      </section>
      <BetaFeedbackCard />
    </div>
  )
}

function SettingsScreen({
  state,
  toggleNotifications,
  resetToFreshBaseline,
  restoreDemo,
  openReliability,
  openBetaDiagnostics,
}: {
  state: SightlyState
  toggleNotifications: () => void
  resetToFreshBaseline: () => void
  restoreDemo: () => void
  openReliability: () => void
  openBetaDiagnostics: () => void
}) {
  const logoPressTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const clearLogoPressTimer = () => {
    if (logoPressTimer.current) window.clearTimeout(logoPressTimer.current)
    logoPressTimer.current = null
  }
  const rows = [
    ['Profile', state.profile.name],
    ['Notifications', state.profile.notificationsEnabled ? 'On' : 'Off'],
    ['Accessibility', state.profile.reduceMotion ? 'Reduce Motion' : 'Standard'],
    ['Privacy', 'Local on this device'],
    ['Score Formula', '60 / 30 / 10'],
    ['About Sightly', 'See what eyes miss.'],
  ]

  return (
    <div className="screen settings-screen">
      <header className="top-header compact">
        <p className="small-muted">Settings</p>
        <h1
          onPointerDown={() => { logoPressTimer.current = window.setTimeout(openBetaDiagnostics, 900) }}
          onPointerLeave={clearLogoPressTimer}
          onPointerUp={clearLogoPressTimer}
        >Sightly</h1>
      </header>
      <section className="settings-list glass-card">
        {rows.map(([label, value]) => (
          <button key={label} onClick={label === 'Notifications' ? toggleNotifications : label === 'Score Formula' ? openReliability : undefined}>
            <span>{label}</span>
            <strong>{value}</strong>
          </button>
        ))}
      </section>
      <section className="vision-profile-card glass-card" aria-label="Vision Profile">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Vision Profile</p>
            <h2>Vision context</h2>
          </div>
          <span>Not scored</span>
        </div>
        <p className="profile-note">These items add context. They do not affect your monthly score.</p>
        <div className="profile-grid">
          {state.visionProfile.map((item) => (
            <article key={item.id} className="profile-item">
              <strong>{item.label}</strong>
              <span>{item.result}</span>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>
      {state.annualSummary && (
        <section className="summary-card glass-card">
          <p className="eyebrow">{state.annualSummary.year} Vision Summary</p>
          <div className="summary-grid">
            <Metric label="Average Score" value={state.annualSummary.averageScore} />
            <Metric label="Checks Completed" value={state.annualSummary.checksCompleted} />
            <Metric label="Typical Range" value={`${state.annualSummary.typicalRange.low}–${state.annualSummary.typicalRange.high}`} />
            <Metric label="Sharpness Typical" value={state.annualSummary.typicalRange.capabilityScores.sharpness} />
            <Metric label="Peripheral Typical" value={state.annualSummary.typicalRange.capabilityScores.peripheralAwareness} />
            <Metric label="Contrast Typical" value={state.annualSummary.typicalRange.capabilityScores.contrast} />
          </div>
          <p>{state.annualSummary.notification}</p>
        </section>
      )}
      <div className="settings-actions">
        <button className="glass-button" onClick={restoreDemo}>Restore Demo Baseline</button>
        <button className="glass-button quiet" onClick={resetToFreshBaseline}>Reset to Fresh Baseline</button>
      </div>
    </div>
  )
}

function BetaDiagnosticsScreen({ state, onBack }: { state: SightlyState; onBack: () => void }) {
  const checks = state.checks.slice().reverse()
  const metricRows: Array<[string, string | number]> = [
    ['Calibration completion', `${state.betaSuccessMetrics.calibrationCompletionRate}%`],
    ['Monthly return', `${state.betaSuccessMetrics.monthlyReturnRate}%`],
    ['Average variance', state.betaSuccessMetrics.averageVariance ?? '—'],
    ['Average confidence', state.betaSuccessMetrics.averageConfidence ? `${state.betaSuccessMetrics.averageConfidence}%` : '—'],
    ['Snapshot completion', `${state.betaSuccessMetrics.snapshotCompletionRate}%`],
    ['Avg session', state.betaSuccessMetrics.averageSessionDurationMs ? `${Math.round(state.betaSuccessMetrics.averageSessionDurationMs / 1000)}s` : '—'],
    ['Believability', state.betaSuccessMetrics.feedbackBelievabilityScore ?? '—'],
  ]

  return (
    <div className="screen beta-diagnostics-screen">
      <button className="text-button" onClick={onBack}>Back</button>
      <header className="top-header compact">
        <p className="small-muted">Internal Beta Diagnostics</p>
        <h1>Stability Log</h1>
      </header>
      <section className="beta-debug-grid glass-card" aria-label="Beta success metrics">
        {metricRows.map(([label, value]) => <Metric key={label} label={label} value={value} />)}
      </section>
      <section className="beta-debug-list" aria-label="Snapshot history diagnostics">
        {checks.map((check) => {
          const primary = check.testResults[0]
          return (
            <article className="beta-debug-card glass-card" key={check.id}>
              <div className="beta-debug-card-head">
                <div>
                  <p className="eyebrow">{new Date(check.date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                  <h2>{check.score ?? '—'} · {check.confidence}% confidence</h2>
                </div>
                <strong>{check.stabilityMetrics?.stabilityScore ?? '—'} stability</strong>
              </div>
              <div className="validation-grid">
                <Metric label="Variance" value={check.stabilityMetrics?.snapshotToSnapshotVariance ?? '—'} />
                <Metric label="Variance Score" value={check.stabilityMetrics?.varianceScore ?? '—'} />
                <Metric label="Repeatability" value={check.stabilityMetrics?.repeatabilityConfidence ? `${check.stabilityMetrics.repeatabilityConfidence}%` : '—'} />
                <Metric label="Baseline Consistency" value={check.stabilityMetrics?.calibrationConsistency ?? '—'} />
                <Metric label="Duration" value={check.analytics?.totalDurationMs ? `${Math.round(check.analytics.totalDurationMs / 1000)}s` : '—'} />
                <Metric label="Retries" value={check.analytics?.retryFrequency ?? 0} />
              </div>
              <div className="raw-score-list">
                {check.testResults.map((result) => (
                  <div key={result.id}><span>{result.metricLabel}</span><b>{formatMeasurement(result)} · {result.normalizedScore} · {result.confidence}%</b></div>
                ))}
              </div>
              <p className="debug-muted">Device: {primary?.conditions.deviceModel ?? '—'} · {primary?.conditions.screenSize ?? '—'} · brightness {primary ? Math.round(primary.conditions.brightness * 100) : '—'}% · interruptions {check.analytics?.interruptionCount ?? 0}</p>
              {Boolean(check.stabilityMetrics?.qualitySignals.length) && <p className="debug-muted">Quality signals: {check.stabilityMetrics?.qualitySignals.join(', ')}</p>}
            </article>
          )
        })}
      </section>
    </div>
  )
}

function ReliabilityDashboard({ state, onBack }: { state: SightlyState; onBack: () => void }) {
  const reliability = state.reliability
  const capabilities = reliability ? Object.values(reliability.capabilities) : []
  const baselineMessage = reliability?.baselineReady
    ? `${reliability.baselineSnapshotCount} snapshots used to establish baseline.`
    : `${Math.max(0, 3 - state.checks.length)} more snapshot${3 - state.checks.length === 1 ? '' : 's'} needed before baseline creation.`

  return (
    <div className="screen reliability-screen">
      <button className="text-button" onClick={onBack}>Back</button>
      <header className="top-header compact">
        <p className="small-muted">Developer Mode</p>
        <h1>Reliability Dashboard</h1>
      </header>

      <section className="reliability-hero glass-card">
        <p className="eyebrow">Overall Snapshot Reliability</p>
        <strong>{reliability?.overallSnapshotReliability.reliabilityScore ?? '—'}</strong>
        <span>{reliability?.overallSnapshotReliability.repeatability ?? 'Baseline Pending'}</span>
        <p>{reliability?.overallSnapshotReliability.message ?? 'Complete 3 snapshots before Sightly creates a baseline.'}</p>
        <p className="formula-note">Vision Score formula is fixed: Sharpness 60%, Contrast 30%, Peripheral 10%. Recognition Threshold and other advanced tests do not affect the score.</p>
      </section>

      <section className="reliability-baseline glass-card">
        <div>
          <p className="eyebrow">Baseline Stability</p>
          <h2>{reliability?.baselineStability ?? 'Not Ready'}</h2>
          <p>{baselineMessage}</p>
        </div>
        <b>{reliability?.overallSnapshotReliability.confidence ?? 0}% Confidence</b>
      </section>

      <div className="reliability-list">
        {capabilities.map((item) => (
          <article className={`reliability-card glass-card ${item.noisy ? 'noisy' : ''}`} key={item.capability}>
            <div className="reliability-card-head">
              <div>
                <h2>{item.label}</h2>
                <p>Repeatability Score</p>
              </div>
              <strong>{item.repeatability}</strong>
            </div>
            <div className="reliability-meter" aria-label={`${item.label} repeatability ${item.consistencyScore}%`}><span style={{ width: `${item.consistencyScore}%` }} /></div>
            <div className="validation-grid">
              <Metric label="Consistency" value={`${item.consistencyScore}%`} />
              <Metric label="Confidence" value={`${item.confidence}%`} />
              <Metric label="Average" value={item.average ?? '—'} />
              <Metric label="Std Dev" value={item.standardDeviation ?? '—'} />
              <Metric label="Variance" value={item.varianceLabel} />
              <Metric label="Samples" value={item.samples} />
            </div>
            <p className="reliability-message">{item.message}</p>
            <ul>
              {item.conditionNotes.slice(0, 3).map((note) => <li key={note}>{note}</li>)}
            </ul>
          </article>
        ))}
      </div>

      <section className="reliability-baseline glass-card">
        <div>
          <p className="eyebrow">Likely Vision Change?</p>
          <h2>{reliability?.likelyVisionChanged ? 'Possibly — confirm trend' : 'Not from one score change'}</h2>
          <p>{reliability?.recommendation ?? 'Sightly prioritizes trust, repeatability, and long-term trend detection.'}</p>
        </div>
      </section>
    </div>
  )
}

function VisionTest({
  tool,
  step,
  total,
  onRecord,
  onCancel,
}: {
  tool: VisionTool
  step: number
  total: number
  onRecord: (value: number, details?: Partial<TestResult>) => void
  onCancel: () => void
}) {
  const copy = assessmentDesign[tool.id]

  if (tool.id === 'visualSharpness') {
    return <SharpnessThresholdTest step={step} total={total} onRecord={onRecord} onCancel={onCancel} />
  }

  if (tool.id === 'contrastSensitivity') {
    return <ContrastThresholdTest step={step} total={total} onRecord={onRecord} onCancel={onCancel} />
  }

  if (tool.id === 'peripheralAwareness') {
    return <PeripheralAwarenessTest step={step} total={total} onRecord={onRecord} onCancel={onCancel} />
  }

  if (tool.id === 'visualResponse') {
    return <VisualChoiceReactionTest step={step} total={total} onRecord={onRecord} onCancel={onCancel} />
  }

  return (
    <div className="screen test-screen">
      <button className="text-button" onClick={onCancel}>Cancel</button>
      <p className="small-muted">{step + 1} of {total} · {tool.metricLabel}</p>
      <h1>{copy.title}</h1>
      <div className={`test-stage ${tool.capability}`}>
        <div className="test-calibration">
          <span>{tool.betterDirection === 'lower' ? 'lower is better' : 'higher is better'}</span>
          <b>{tool.unit}</b>
        </div>
        <div className="focus-mark">{copy.visual}</div>
        <div className="measurement-ruler" />
        <div className="pulse-ring" />
      </div>
      <h2>{copy.prompt}</h2>
      <p>{copy.measuredBy}</p>
      <div className="test-actions measured-actions">
        {copy.options.map((option) => (
          <button className="glass-button measurement-button" key={option.label} onClick={() => onRecord(option.value)}>
            <span>{option.label}</span>
            <strong>{option.helper}</strong>
          </button>
        ))}
      </div>
    </div>
  )
}

function normalizeAnswer(value: string) {
  return value.toUpperCase().replace(/[^A-Z]/g, '')
}

const sharpnessFontSizes = [36, 30, 24, 20, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4]
const SHARPNESS_MIN_ROWS = 5
const SHARPNESS_TARGET_REVERSALS = 2
const SHARPNESS_MAX_ROWS = sharpnessFontSizes.length
const SHARPNESS_MAX_ATTEMPTS = 30
const sharpnessLetters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

function randomSharpnessRow() {
  return Array.from({ length: 6 }, () => sharpnessLetters[Math.floor(Math.random() * sharpnessLetters.length)]).join('')
}

const contrastLevels = [20, 15, 10, 8, 6, 4, 3, 2, 1, 0.8, 0.6, 0.5, 0.4, 0.35, 0.325, 0.3, 0.25, 0.2, 0.15, 0.1]
const CONTRAST_MIN_TRIALS = 10
const CONTRAST_TARGET_REVERSALS = 4
const CONTRAST_MAX_TRIALS = 40
const contrastDirections: ContrastDirection[] = ['top', 'right', 'bottom', 'left']

function randomContrastDirection() {
  return contrastDirections[Math.floor(Math.random() * contrastDirections.length)]
}

function countResultReversals<T extends { correct: boolean }>(trials: T[]) {
  return trials.reduce((count, trial, index) => index > 0 && trial.correct !== trials[index - 1].correct ? count + 1 : count, 0)
}

function hasThresholdBracket<T extends { correct: boolean }>(trials: T[]) {
  return trials.some((trial) => trial.correct) && trials.some((trial) => !trial.correct)
}

function thresholdReady<T extends { correct: boolean }>(trials: T[], minimumTrials: number, targetReversals: number) {
  return trials.length >= minimumTrials && hasThresholdBracket(trials) && countResultReversals(trials) >= targetReversals
}

const LOW_CONFIDENCE_THRESHOLD_NOTE = 'Unable to confidently estimate threshold. Please try again.'

function repeatedBoundaryResult<T extends { correct?: boolean; passed?: boolean }>(trials: T[], atHardest: boolean, atEasiest: boolean) {
  const recent = trials.slice(-5)
  if (recent.length < 5) return false
  const succeeded = (trial: T) => trial.correct ?? trial.passed ?? false
  return (atHardest && recent.every((trial) => succeeded(trial))) || (atEasiest && recent.every((trial) => !succeeded(trial)))
}

function captureTestConditions() {
  const orientation = window.innerWidth >= window.innerHeight ? 'landscape' as const : 'portrait' as const
  const now = new Date()
  const batterySaverMode = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData)
  return {
    screenSize: `${window.screen?.width || window.innerWidth} × ${window.screen?.height || window.innerHeight}`,
    brightness: 0.82,
    deviceModel: navigator.userAgent.includes('iPhone')
      ? 'iPhone'
      : navigator.userAgent.includes('Mac')
        ? 'Apple device'
        : 'Current device',
    orientation,
    lightingConfidence: orientation === 'portrait' ? 96 : 90,
    dateTime: now.toISOString(),
    timeOfDay: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    batterySaverMode,
    eyeFatigue: 'normal' as EyeFatigueLevel,
    visionCorrection: 'notApplicable' as VisionCorrectionUsage,
    viewingDistanceEstimate: 'comfortable consistent distance',
  }
}

const peripheralDirections: PeripheralDirection[] = ['top', 'bottom', 'left', 'right', 'upper-left', 'upper-right', 'lower-left', 'lower-right']
const PERIPHERAL_MIN_TRIALS = 16
const PERIPHERAL_TARGET_REVERSALS = 3
const PERIPHERAL_MAX_TRIALS = 40
const peripheralDifficulty = [
  { difficulty: 1, duration: 650, size: 34, contrast: 0.95, eccentricity: 28 },
  { difficulty: 2, duration: 600, size: 31, contrast: 0.9, eccentricity: 31 },
  { difficulty: 3, duration: 540, size: 28, contrast: 0.84, eccentricity: 34 },
  { difficulty: 4, duration: 480, size: 25, contrast: 0.78, eccentricity: 37 },
  { difficulty: 5, duration: 420, size: 23, contrast: 0.7, eccentricity: 40 },
  { difficulty: 6, duration: 360, size: 21, contrast: 0.62, eccentricity: 43 },
  { difficulty: 7, duration: 300, size: 19, contrast: 0.54, eccentricity: 46 },
  { difficulty: 8, duration: 250, size: 17, contrast: 0.46, eccentricity: 48 },
  { difficulty: 9, duration: 200, size: 15, contrast: 0.38, eccentricity: 50 },
  { difficulty: 10, duration: 160, size: 13, contrast: 0.32, eccentricity: 52 },
  { difficulty: 11, duration: 125, size: 12, contrast: 0.26, eccentricity: 54 },
  { difficulty: 12, duration: 100, size: 10, contrast: 0.22, eccentricity: 56 },
]

function randomPeripheralDirection(previous?: PeripheralDirection) {
  const pool = peripheralDirections.filter((direction) => direction !== previous)
  return pool[Math.floor(Math.random() * pool.length)]
}

function peripheralPosition(direction: PeripheralDirection, eccentricity: number) {
  const center = 50
  const map: Record<PeripheralDirection, [number, number]> = {
    top: [50, center - eccentricity],
    bottom: [50, center + eccentricity],
    left: [center - eccentricity, 50],
    right: [center + eccentricity, 50],
    'upper-left': [center - eccentricity * 0.72, center - eccentricity * 0.72],
    'upper-right': [center + eccentricity * 0.72, center - eccentricity * 0.72],
    'lower-left': [center - eccentricity * 0.72, center + eccentricity * 0.72],
    'lower-right': [center + eccentricity * 0.72, center + eccentricity * 0.72],
  }
  return map[direction]
}

function PeripheralAwarenessTest({
  step,
  total,
  onRecord,
  onCancel,
}: {
  step: number
  total: number
  onRecord: (value: number, details?: Partial<TestResult>) => void
  onCancel: () => void
}) {
  const [started, setStarted] = useState(false)
  const [difficultyIndex, setDifficultyIndex] = useState(0)
  const [direction, setDirection] = useState<PeripheralDirection>(() => randomPeripheralDirection())
  const [stimulusVisible, setStimulusVisible] = useState(false)
  const [canAnswer, setCanAnswer] = useState(false)
  const answerOpenRef = useRef(false)
  const [roundStartedAt, setRoundStartedAt] = useState(() => performance.now())
  const [trials, setTrials] = useState<PeripheralTrial[]>([])
  const [feedback, setFeedback] = useState('')

  const profile = peripheralDifficulty[difficultyIndex]
  const currentPosition = peripheralPosition(direction, profile.eccentricity)
  const correctTrials = trials.filter((trial) => trial.correct)
  const failedTrials = trials.filter((trial) => !trial.correct)
  const reversals = countResultReversals(trials)
  const confidencePreview = Math.min(98, Math.max(58, 58 + trials.length * 2.8 + reversals * 7 + (correctTrials.length && failedTrials.length ? 12 : 0)))
  const progress = Math.min(100, Math.round((confidencePreview / 94) * 100))

  useEffect(() => {
    if (!started) return undefined
    answerOpenRef.current = false
    const revealTimer = window.setTimeout(() => {
      setRoundStartedAt(performance.now())
      setStimulusVisible(true)
      setCanAnswer(true)
      answerOpenRef.current = true
    }, 360)
    const hideTimer = window.setTimeout(() => setStimulusVisible(false), 360 + profile.duration)
    return () => {
      answerOpenRef.current = false
      window.clearTimeout(revealTimer)
      window.clearTimeout(hideTimer)
    }
  }, [started, direction, profile.duration])

  function finish(nextTrials: PeripheralTrial[], forcedLowConfidence = false) {
    const correct = nextTrials.filter((trial) => trial.correct)
    const misses = nextTrials.filter((trial) => trial.selectedDirection === 'miss').length
    const accuracy = Math.round((correct.length / nextTrials.length) * 100)
    const missRate = Math.round((misses / nextTrials.length) * 100)
    const answeredTimes = nextTrials.filter((trial) => trial.selectedDirection !== 'miss').map((trial) => trial.responseTimeMs)
    const reactionTime = answeredTimes.length ? Math.round(answeredTimes.reduce((sum, value) => sum + value, 0) / answeredTimes.length) : 0
    const mean = reactionTime || 1
    const variance = answeredTimes.length ? answeredTimes.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / answeredTimes.length : 0
    const consistency = Math.max(0, Math.round(100 - Math.sqrt(variance) / 4))
    const lastPassedDifficulty = correct.length ? Math.max(...correct.map((trial) => trial.difficulty)) : null
    const failedDifficulties = nextTrials.filter((trial) => !trial.correct).map((trial) => trial.difficulty)
    const firstFailedDifficulty = lastPassedDifficulty === null
      ? (failedDifficulties.length ? Math.min(...failedDifficulties) : null)
      : (failedDifficulties.filter((difficulty) => difficulty >= lastPassedDifficulty).sort((a, b) => a - b)[0] ?? failedDifficulties.sort((a, b) => Math.abs(a - lastPassedDifficulty) - Math.abs(b - lastPassedDifficulty))[0] ?? null)
    const estimatedThreshold = lastPassedDifficulty !== null && firstFailedDifficulty !== null
      ? Math.round(((lastPassedDifficulty + firstFailedDifficulty) / 2) * 10) / 10
      : lastPassedDifficulty ?? firstFailedDifficulty ?? profile.difficulty
    const finalReversals = countResultReversals(nextTrials)
    const thresholdScore = Math.max(0, Math.min(100, Math.round(estimatedThreshold * 8.4)))
    const score = Math.max(0, Math.min(100, Math.round(thresholdScore * 0.74 + accuracy * 0.22 - missRate * 0.08 + consistency * 0.04)))
    const confidence = forcedLowConfidence ? 55 : Math.max(72, Math.min(98, Math.round(64 + nextTrials.length * 2.3 + finalReversals * 5 + (lastPassedDifficulty !== null && firstFailedDifficulty !== null ? 10 : 0) - misses)))
    const conditions = captureTestConditions()
    const payload: PeripheralAwarenessPayload = {
      testType: 'peripheral_awareness',
      score,
      reactionTime,
      accuracy,
      misses,
      missRate,
      threshold: estimatedThreshold,
      lastPassedDifficulty,
      firstFailedDifficulty,
      estimatedThreshold,
      confidence,
      deviceModel: conditions.deviceModel,
      screenSize: conditions.screenSize,
      brightness: Math.round(conditions.brightness * 100),
      timestamp: conditions.dateTime,
      edgeAccuracy: accuracy,
      consistency,
      trials: nextTrials,
    }

    onRecord(estimatedThreshold, {
      confidence,
      conditions,
      note: forcedLowConfidence ? LOW_CONFIDENCE_THRESHOLD_NOTE : `Peripheral Awareness ${score}. Threshold ${estimatedThreshold}/10, accuracy ${accuracy}%, miss rate ${missRate}%, average reaction ${reactionTime}ms.`,
      peripheralAwareness: payload,
    })
  }

  function recordTap(selectedDirection: PeripheralDirection, eventTimeStamp: number) {
    if (!answerOpenRef.current) return
    answerOpenRef.current = false
    setCanAnswer(false)
    setStimulusVisible(false)
    const responseTimeMs = Math.round(eventTimeStamp - roundStartedAt)
    const correct = selectedDirection === direction
    const trial: PeripheralTrial = {
      round: trials.length + 1,
      direction,
      selectedDirection,
      appearanceTimeMs: profile.duration,
      stimulusSizePx: profile.size,
      eccentricity: profile.eccentricity,
      contrast: profile.contrast,
      difficulty: profile.difficulty,
      correct,
      responseTimeMs,
    }
    const nextTrials = [...trials, trial]
    const thresholdFound = thresholdReady(nextTrials, PERIPHERAL_MIN_TRIALS, PERIPHERAL_TARGET_REVERSALS)
    const safetyLimitReached = nextTrials.length >= PERIPHERAL_MAX_TRIALS || repeatedBoundaryResult(nextTrials, difficultyIndex === peripheralDifficulty.length - 1, difficultyIndex === 0)

    if (thresholdFound || safetyLimitReached) {
      finish(nextTrials, safetyLimitReached && !thresholdFound)
      return
    }

    setTrials(nextTrials)
    setFeedback(correct ? 'Finding your threshold.' : 'Adjusting the next round.')
    setDifficultyIndex((current) => correct ? Math.min(current + 1, peripheralDifficulty.length - 1) : Math.max(current - 1, 0))
    setDirection(randomPeripheralDirection(direction))
  }

  if (!started) {
    return (
      <div className="screen test-screen peripheral-screen">
        <button className="text-button" onClick={onCancel}>Cancel</button>
        <p className="small-muted">{testProgressLabel(step, total)} · Peripheral awareness threshold</p>
        <h1>Peripheral Awareness</h1>
        <section className="sharpness-instructions peripheral-instructions glass-card">
          <p className="eyebrow">Before you start</p>
          <ul>
            <li>Keep your eyes gently on the center dot.</li>
            <li>One soft cue appears near the edge.</li>
            <li>Tap the location where it appeared.</li>
            <li>Sightly adjusts quietly as it learns your threshold.</li>
          </ul>
        </section>
        <button className="glass-button primary sharpness-start" onClick={() => setStarted(true)}>Begin peripheral check</button>
      </div>
    )
  }

  return (
    <div className="screen test-screen peripheral-screen">
      <button className="text-button" onClick={onCancel}>Cancel</button>
      <p className="small-muted">{testProgressLabel(step, total)} · Finding your threshold</p>
      <div className="difficulty-track peripheral-track" aria-label={`Peripheral confidence ${confidencePreview}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <section className="peripheral-stage glass-card" aria-label="Watch for one peripheral cue while focusing on the center dot">
        <div className="peripheral-field" />
        <div className="center-dot" aria-label="Center focus dot">•</div>
        {stimulusVisible && (
          <span
            className="peripheral-stimulus"
            style={{
              left: `${currentPosition[0]}%`,
              top: `${currentPosition[1]}%`,
              width: profile.size,
              height: profile.size,
              '--stimulus-alpha': profile.contrast,
            } as CSSProperties & Record<'--stimulus-alpha', number>}
          />
        )}
      </section>
      <h2>Where did the dot appear?</h2>
      <p>Keep your eyes centered. One dot appears each round.</p>
      <div className="peripheral-location-grid spatial-pad" aria-label="Choose where the dot appeared">
        {peripheralAnswerOptions.map((option) => (
          <button className={`glass-button peripheral-choice peripheral-${option.value}`} disabled={!canAnswer} key={option.value} onClick={(event) => recordTap(option.value, event.timeStamp)}>{option.label}</button>
        ))}
      </div>
      {feedback && <p className="sharpness-feedback peripheral-feedback">{feedback}</p>}
      <div className="sharpness-stats">
        <span>Trials: {trials.length}</span>
        <span>Cue: {profile.duration}ms</span>
        <span>Confidence: {confidencePreview}%</span>
      </div>
      <p className="calm-note">Personal baseline only — best compared month-to-month on this device.</p>
    </div>
  )
}

const visualDurations = [500, 350, 250, 200, 150, 125, 100, 75, 50]
const VISUAL_RESPONSE_MIN_TRIALS = 12
const VISUAL_RESPONSE_TARGET_REVERSALS = 3
const VISUAL_RESPONSE_MAX_TRIALS = 40
const visualSymbols: Record<VisualChoiceSymbol, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
}
const visualAnswerLabels: Record<VisualChoiceSymbol, string> = {
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
}
const visualSymbolOrder: VisualChoiceSymbol[] = ['left', 'right', 'up', 'down']

type VisualRoundPhase = 'fixation' | 'symbol' | 'answer'

type VisualResponseResult = {
  thresholdMs: number
  accuracy: number
  avgResponseTimeMs: number
  roundsCompleted: number
  shortestPassedExposureMs: number | null
  firstFailedExposureMs: number | null
  confidence: number
  consistency: number
  conditions: ReturnType<typeof captureTestConditions>
  payload: VisualChoicePayload
}

function randomVisualSymbol(previous?: VisualChoiceSymbol) {
  const pool = visualSymbolOrder.filter((symbol) => symbol !== previous)
  return pool[Math.floor(Math.random() * pool.length)]
}

function computeVisualThreshold(trials: VisualChoiceTrial[], fallbackDuration: number) {
  const correctTrials = trials.filter((trial) => trial.correct)
  const failedTrials = trials.filter((trial) => !trial.correct)
  const shortestPassedExposureMs = correctTrials.length ? Math.min(...correctTrials.map((trial) => trial.exposureDurationMs)) : null
  const firstFailedExposureMs = failedTrials[0]?.exposureDurationMs ?? null

  const reliableDurations = [...new Set(trials.map((trial) => trial.exposureDurationMs))]
    .sort((a, b) => a - b)
    .filter((duration) => {
      const atDuration = trials.filter((trial) => trial.exposureDurationMs === duration)
      if (atDuration.length < 2) return false
      const accuracy = atDuration.filter((trial) => trial.correct).length / atDuration.length
      return accuracy >= 0.67
    })

  const thresholdMs = reliableDurations[0]
    ?? (shortestPassedExposureMs !== null && firstFailedExposureMs !== null
      ? Math.max(shortestPassedExposureMs, firstFailedExposureMs)
      : shortestPassedExposureMs ?? firstFailedExposureMs ?? fallbackDuration)

  return { thresholdMs, shortestPassedExposureMs, firstFailedExposureMs }
}

function VisualChoiceReactionTest({
  step,
  total,
  onRecord,
  onCancel,
}: {
  step: number
  total: number
  onRecord: (value: number, details?: Partial<TestResult>) => void
  onCancel: () => void
}) {
  const [started, setStarted] = useState(false)
  const [durationIndex, setDurationIndex] = useState(0)
  const [symbol, setSymbol] = useState<VisualChoiceSymbol>(() => randomVisualSymbol())
  const [phase, setPhase] = useState<VisualRoundPhase>('fixation')
  const [roundKey, setRoundKey] = useState(0)
  const [answerStartedAt, setAnswerStartedAt] = useState(() => performance.now())
  const [trials, setTrials] = useState<VisualChoiceTrial[]>([])
  const [feedback, setFeedback] = useState('')
  const [result, setResult] = useState<VisualResponseResult | null>(null)

  const exposureDurationMs = visualDurations[durationIndex]
  const correctTrials = trials.filter((trial) => trial.correct)
  const failedTrials = trials.filter((trial) => !trial.correct)
  const reversals = countResultReversals(trials)
  const confidencePreview = Math.min(98, Math.max(58, 55 + trials.length * 2.2 + reversals * 6 + (correctTrials.length && failedTrials.length ? 10 : 0)))
  const progress = Math.min(100, Math.round((confidencePreview / 94) * 100))

  useEffect(() => {
    if (!started || result) return undefined
    const delay = 500 + Math.round(Math.random() * 1000)
    const revealTimer = window.setTimeout(() => {
      setPhase('symbol')
    }, delay)
    const hideTimer = window.setTimeout(() => {
      setPhase('answer')
      setAnswerStartedAt(performance.now())
    }, delay + exposureDurationMs)
    return () => {
      window.clearTimeout(revealTimer)
      window.clearTimeout(hideTimer)
    }
  }, [started, roundKey, exposureDurationMs, result])

  function buildResult(nextTrials: VisualChoiceTrial[], forcedLowConfidence = false): VisualResponseResult {
    const nextCorrect = nextTrials.filter((trial) => trial.correct)
    const responseTimes = nextTrials.filter((trial) => trial.selectedSymbol !== 'miss').map((trial) => trial.responseTimeMs)
    const avgResponseTimeMs = responseTimes.length ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length) : 0
    const mean = avgResponseTimeMs || 1
    const variance = responseTimes.length ? responseTimes.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / responseTimes.length : 0
    const consistency = Math.max(0, Math.round(100 - Math.sqrt(variance) / 4))
    const accuracy = Math.round((nextCorrect.length / nextTrials.length) * 100)
    const { thresholdMs: rawThresholdMs, shortestPassedExposureMs, firstFailedExposureMs } = computeVisualThreshold(nextTrials, exposureDurationMs)
    const thresholdMs = accuracy < 70
      ? Math.max(rawThresholdMs, firstFailedExposureMs ?? rawThresholdMs, visualDurations[0])
      : accuracy < 85
        ? Math.max(rawThresholdMs, firstFailedExposureMs ?? rawThresholdMs)
        : rawThresholdMs
    const finalReversals = countResultReversals(nextTrials)
    const accuracyPenalty = Math.max(0, 85 - accuracy) * 0.9
    const confidence = forcedLowConfidence ? 55 : Math.max(55, Math.min(98, Math.round(58 + nextTrials.length * 1.7 + finalReversals * 5 + (shortestPassedExposureMs !== null && firstFailedExposureMs !== null ? 12 : 0) + Math.max(0, accuracy - 75) * 0.22 - accuracyPenalty)))
    const conditions = captureTestConditions()
    const payload: VisualChoicePayload = {
      testType: 'visual_response',
      thresholdMs,
      accuracy,
      avgResponseTimeMs,
      roundsCompleted: nextTrials.length,
      shortestPassedExposureMs,
      firstFailedExposureMs,
      confidence,
      consistency,
      deviceModel: conditions.deviceModel,
      screenSize: conditions.screenSize,
      brightness: Math.round(conditions.brightness * 100),
      timestamp: conditions.dateTime,
      trials: nextTrials,
    }
    return {
      thresholdMs,
      accuracy,
      avgResponseTimeMs,
      roundsCompleted: nextTrials.length,
      shortestPassedExposureMs,
      firstFailedExposureMs,
      confidence,
      consistency,
      conditions,
      payload,
    }
  }

  function completeWithResult(nextTrials: VisualChoiceTrial[], forcedLowConfidence = false) {
    setTrials(nextTrials)
    setPhase('answer')
    setResult(buildResult(nextTrials, forcedLowConfidence))
  }

  function continueFromResult() {
    if (!result) return
    onRecord(result.thresholdMs, {
      confidence: result.confidence,
      conditions: result.conditions,
      note: result.confidence <= 55 ? LOW_CONFIDENCE_THRESHOLD_NOTE : `Visual Response threshold ${result.thresholdMs}ms. Accuracy ${result.accuracy}%, average response time ${result.avgResponseTimeMs}ms, confidence ${result.confidence}%.`,
      visualChoiceReaction: result.payload,
    })
  }

  function chooseSymbol(selectedSymbol: VisualChoiceSymbol, eventTimeStamp: number) {
    if (phase !== 'answer' || result) return
    const correct = selectedSymbol === symbol
    const responseTimeMs = Math.min(2500, Math.max(0, Math.round(eventTimeStamp - answerStartedAt)))
    const trial: VisualChoiceTrial = {
      round: trials.length + 1,
      symbol,
      selectedSymbol,
      exposureDurationMs,
      correct,
      responseTimeMs,
    }
    const nextTrials = [...trials, trial]
    const thresholdFound = thresholdReady(nextTrials, VISUAL_RESPONSE_MIN_TRIALS, VISUAL_RESPONSE_TARGET_REVERSALS)
    const safetyLimitReached = nextTrials.length >= VISUAL_RESPONSE_MAX_TRIALS || repeatedBoundaryResult(nextTrials, durationIndex === visualDurations.length - 1, durationIndex === 0)

    if (thresholdFound || safetyLimitReached) {
      completeWithResult(nextTrials, safetyLimitReached && !thresholdFound)
      return
    }

    setTrials(nextTrials)
    setFeedback(correct ? 'Correct. The next symbol may appear more briefly.' : 'Not quite. Sightly will make the next exposure slightly easier.')
    setDurationIndex((current) => correct ? Math.min(current + 1, visualDurations.length - 1) : Math.max(current - 1, 0))
    setSymbol(randomVisualSymbol(symbol))
    setPhase('fixation')
    setRoundKey((current) => current + 1)
  }

  if (!started) {
    return (
      <div className="screen test-screen visual-response-screen">
        <button className="text-button" onClick={onCancel}>Cancel</button>
        <p className="small-muted">{step + 1} of {total} · Recognition threshold</p>
        <h1>Recognition Threshold</h1>
        <section className="sharpness-instructions glass-card visual-response-instructions">
          <h2>How quickly can you recognize what you see?</h2>
          <ul>
            <li>A symbol will appear briefly.</li>
            <li>Choose what you saw.</li>
            <li>Accuracy matters more than speed.</li>
            <li>Keep your eyes near the center.</li>
          </ul>
        </section>
        <button className="glass-button primary sharpness-start" onClick={() => setStarted(true)}>Begin check</button>
      </div>
    )
  }

  if (result) {
    const typicalLow = 140
    const typicalHigh = 170
    const rangeMessage = result.thresholdMs > typicalHigh
      ? 'Slower than your typical range. Retest in 7 days to confirm.'
      : result.thresholdMs < typicalLow
        ? 'Measured above your typical range.'
        : 'Within your normal range.'

    return (
      <div className="screen test-screen visual-response-screen visual-response-result-screen">
        <button className="text-button" onClick={onCancel}>Cancel</button>
        <p className="small-muted">{step + 1} of {total} · Recognition threshold result</p>
        <section className="visual-response-result glass-card">
          <p className="eyebrow">Recognition Threshold</p>
          <strong>{result.thresholdMs}ms</strong>
          <span>Recognition Threshold</span>
          <div className="result-range">Typical Range <b>{typicalLow}ms–{typicalHigh}ms</b></div>
          <p>{rangeMessage}</p>
        </section>
        <div className="visual-result-grid">
          <Metric label="Accuracy" value={`${result.accuracy}%`} />
          <Metric label="Confidence" value={`${result.confidence}%`} />
          <Metric label="Rounds Completed" value={result.roundsCompleted} />
          <Metric label="Avg Response" value={`${result.avgResponseTimeMs}ms`} />
        </div>
        <button className="glass-button primary sharpness-start" onClick={continueFromResult}>Continue</button>
      </div>
    )
  }

  return (
    <div className="screen test-screen visual-response-screen">
      <button className="text-button" onClick={onCancel}>Cancel</button>
      <p className="small-muted">{step + 1} of {total} · Recognition threshold</p>
      <div className="difficulty-track visual-response-track" aria-label={`Visual response confidence ${confidencePreview}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <section className="visual-response-stage glass-card">
        <p className="eyebrow">Round {trials.length + 1} · {exposureDurationMs}ms exposure</p>
        <div className={`visual-symbol ${phase === 'symbol' ? 'visible' : ''}`}>{phase === 'symbol' ? visualSymbols[symbol] : '•'}</div>
      </section>
      <h2>{phase === 'answer' ? 'Which direction appeared?' : 'Keep your eyes near the center.'}</h2>
      <p>{phase === 'answer' ? 'Choose what you saw.' : 'A direction symbol will appear once.'}</p>
      {feedback && <p className="sharpness-feedback visual-response-feedback">{feedback}</p>}
      <div className="symbol-choice-pad visual-direction-pad" aria-label="Visual response choices">
        {visualSymbolOrder.map((choice) => (
          <button className="glass-button symbol-choice direction-choice" disabled={phase !== 'answer'} key={choice} onClick={(event) => chooseSymbol(choice, event.timeStamp)}>
            <span>{visualSymbols[choice]}</span>
            <small>{visualAnswerLabels[choice]}</small>
          </button>
        ))}
      </div>
      <div className="sharpness-stats">
        <span>Rounds: {trials.length}</span>
        <span>Exposure: {exposureDurationMs}ms</span>
        <span>Confidence: {confidencePreview}%</span>
      </div>
      <p className="calm-note">Sightly is learning your reliable recognition threshold.</p>
    </div>
  )
}

function ContrastThresholdTest({
  step,
  total,
  onRecord,
  onCancel,
}: {
  step: number
  total: number
  onRecord: (value: number, details?: Partial<TestResult>) => void
  onCancel: () => void
}) {
  const [started, setStarted] = useState(false)
  const [levelIndex, setLevelIndex] = useState(0)
  const [direction, setDirection] = useState<ContrastDirection>(() => randomContrastDirection())
  const [trials, setTrials] = useState<ContrastTrial[]>([])
  const [roundStartedAt, setRoundStartedAt] = useState(() => performance.now())
  const [feedback, setFeedback] = useState('')

  const contrast = contrastLevels[levelIndex]
  const correctTrials = trials.filter((trial) => trial.correct)
  const failedTrials = trials.filter((trial) => !trial.correct)
  const reversals = countResultReversals(trials)
  const confidencePreview = Math.min(98, Math.max(62, 58 + trials.length * 3 + reversals * 7 + (correctTrials.length && failedTrials.length ? 10 : 0)))
  const progress = Math.min(100, Math.round((confidencePreview / 94) * 100))

  function finish(nextTrials: ContrastTrial[], forcedLowConfidence = false) {
    const nextCorrect = nextTrials.filter((trial) => trial.correct)
    const nextFailed = nextTrials.filter((trial) => !trial.correct)
    const lowestPassed = nextCorrect.length ? Math.min(...nextCorrect.map((trial) => trial.contrast)) : null
    const firstFailed = nextFailed[0]?.contrast ?? null
    const threshold = lowestPassed !== null && firstFailed !== null
      ? Math.round(((lowestPassed + firstFailed) / 2) * 1000) / 1000
      : lowestPassed ?? firstFailed ?? contrast
    const accuracy = Math.round((nextCorrect.length / nextTrials.length) * 100)
    const avgResponseTimeMs = Math.round(nextTrials.reduce((sum, trial) => sum + trial.responseTimeMs, 0) / nextTrials.length)
    const avgResponseTime = Math.round((avgResponseTimeMs / 1000) * 10) / 10
    const nextReversals = countResultReversals(nextTrials)
    const confidence = forcedLowConfidence ? 55 : Math.min(98, Math.max(74, 62 + nextTrials.length * 3 + nextReversals * 7 + (lowestPassed !== null && firstFailed !== null ? 10 : 0)))
    const conditions = captureTestConditions()
    const payload: ContrastThresholdPayload = {
      testType: 'contrast_sensitivity',
      date: conditions.dateTime,
      threshold,
      lowestPassed,
      firstFailed,
      accuracy,
      avgResponseTime,
      confidence,
      deviceModel: conditions.deviceModel,
      screenSize: conditions.screenSize,
      brightness: Math.round(conditions.brightness * 100),
      ambientLightingEstimate: conditions.lightingConfidence >= 94 ? 'normal steady lighting' : 'moderate lighting confidence',
      trials: nextTrials,
    }

    onRecord(threshold, {
      confidence,
      conditions,
      note: forcedLowConfidence ? LOW_CONFIDENCE_THRESHOLD_NOTE : `Contrast threshold measured at ${threshold}%. Lowest passed: ${lowestPassed ?? '—'}%. First failed: ${firstFailed ?? '—'}%.`,
      contrastThreshold: payload,
    })
  }

  function answer(selectedDirection: ContrastDirection | 'miss') {
    const correct = selectedDirection !== 'miss' && selectedDirection === direction
    const trial: ContrastTrial = {
      round: trials.length + 1,
      contrast,
      direction,
      selectedDirection,
      correct,
      responseTimeMs: Math.round(performance.now() - roundStartedAt),
    }
    const nextTrials = [...trials, trial]
    const thresholdFound = thresholdReady(nextTrials, CONTRAST_MIN_TRIALS, CONTRAST_TARGET_REVERSALS)
    const safetyLimitReached = nextTrials.length >= CONTRAST_MAX_TRIALS || repeatedBoundaryResult(nextTrials, levelIndex === contrastLevels.length - 1, levelIndex === 0)

    if (thresholdFound || safetyLimitReached) {
      finish(nextTrials, safetyLimitReached && !thresholdFound)
      return
    }

    setTrials(nextTrials)
    setLevelIndex((current) => correct ? Math.min(current + 1, contrastLevels.length - 1) : Math.max(current - 1, 0))
    setDirection(randomContrastDirection())
    setFeedback(correct ? 'Correct. Lowering the contrast.' : 'Not quite. Raising contrast slightly to narrow your threshold.')
    setRoundStartedAt(performance.now())
  }

  if (!started) {
    return (
      <div className="screen test-screen contrast-screen">
        <button className="text-button" onClick={onCancel}>Cancel</button>
        <p className="small-muted">{step + 1} of {total} · Contrast threshold</p>
        <h1>Contrast Sensitivity</h1>
        <section className="sharpness-instructions contrast-instructions glass-card">
          <p className="eyebrow">Before you start</p>
          <ul>
            <li>Hold your device at a comfortable distance.</li>
            <li>Complete this test in normal lighting.</li>
            <li>Choose where the ring opens.</li>
            <li>Continue as the ring becomes faint.</li>
          </ul>
        </section>
        <button className="glass-button primary sharpness-start" onClick={() => {
          setStarted(true)
          setRoundStartedAt(performance.now())
        }}>Begin contrast check</button>
      </div>
    )
  }

  return (
    <div className="screen test-screen contrast-screen">
      <button className="text-button" onClick={onCancel}>Cancel</button>
      <p className="small-muted">{step + 1} of {total} · Adaptive staircase</p>
      <div className="difficulty-track contrast-track" aria-label={`Threshold confidence ${confidencePreview}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <section className="contrast-stage glass-card">
        <p className="eyebrow">Round {trials.length + 1} · {contrast}% contrast</p>
        <div className={`landolt-ring gap-${direction}`} style={{ '--ring-contrast': contrast / 100 } as CSSProperties & Record<'--ring-contrast', number>} aria-label="Landolt C ring" />
      </section>
      <h2>Where is the opening?</h2>
      <p>Choose where the ring opens. If you cannot see it, use Not visible.</p>
      {feedback && <p className="sharpness-feedback contrast-feedback">{feedback}</p>}
      <div className="direction-pad" aria-label="Opening direction answers">
        <button className="glass-button direction top" onClick={() => answer('top')}>Top</button>
        <button className="glass-button direction left" onClick={() => answer('left')}>Left</button>
        <button className="glass-button direction right" onClick={() => answer('right')}>Right</button>
        <button className="glass-button direction bottom" onClick={() => answer('bottom')}>Bottom</button>
      </div>
      <button className="glass-button quiet not-visible-button" onClick={() => answer('miss')}>Not visible</button>
      <div className="sharpness-stats">
        <span>Accuracy: {trials.length ? Math.round((correctTrials.length / trials.length) * 100) : '—'}%</span>
        <span>Confidence: {confidencePreview}%</span>
      </div>
      <p className="calm-note">Compared only with your personal baseline — not other users.</p>
    </div>
  )
}

function countSharpnessReversals(attempts: SharpnessRowAttempt[]) {
  return attempts.reduce((count, attempt, index) => index > 0 && attempt.passed !== attempts[index - 1].passed ? count + 1 : count, 0)
}

function sharpnessThresholdReady(attempts: SharpnessRowAttempt[]) {
  return attempts.length >= SHARPNESS_MIN_ROWS
    && attempts.some((attempt) => attempt.passed)
    && attempts.some((attempt) => !attempt.passed)
    && countSharpnessReversals(attempts) >= SHARPNESS_TARGET_REVERSALS
}

function SharpnessThresholdTest({
  step,
  total,
  onRecord,
  onCancel,
}: {
  step: number
  total: number
  onRecord: (value: number, details?: Partial<TestResult>) => void
  onCancel: () => void
}) {
  const [started] = useState(true)
  const [eyeMode, setEyeMode] = useState<SharpnessEyeMode>('both')
  const [rowIndex, setRowIndex] = useState(0)
  const [letters, setLetters] = useState(() => randomSharpnessRow())
  const [answer, setAnswer] = useState('')
  const [attempts, setAttempts] = useState<SharpnessRowAttempt[]>([])
  const [roundStartedAt, setRoundStartedAt] = useState(() => performance.now())
  const [feedback, setFeedback] = useState('')

  const fontSize = sharpnessFontSizes[rowIndex]
  const progress = Math.round(((rowIndex + 1) / SHARPNESS_MAX_ROWS) * 100)
  function submitRow() {
    const typedAnswer = normalizeAnswer(answer)
    const correctCount = letters.split('').reduce((count, letter, index) => count + (typedAnswer[index] === letter ? 1 : 0), 0)
    const accuracy = Math.round((correctCount / letters.length) * 100)
    const passed = correctCount === letters.length
    const attempt: SharpnessRowAttempt = {
      round: rowIndex + 1,
      letters,
      typedAnswer,
      fontSizePx: fontSize,
      correctCount,
      accuracy,
      responseTimeMs: Math.round(performance.now() - roundStartedAt),
      passed,
    }
    const nextAttempts = [...attempts, attempt]

    const thresholdFound = sharpnessThresholdReady(nextAttempts)
    const safetyLimitReached = nextAttempts.length >= SHARPNESS_MAX_ATTEMPTS || repeatedBoundaryResult(nextAttempts, rowIndex === SHARPNESS_MAX_ROWS - 1, rowIndex === 0)

    if (!thresholdFound && !safetyLimitReached) {
      setAttempts(nextAttempts)
      setRowIndex((current) => passed ? Math.min(current + 1, SHARPNESS_MAX_ROWS - 1) : Math.max(current - 1, 0))
      setLetters(randomSharpnessRow())
      setAnswer('')
      setFeedback(passed ? 'Almost there.' : 'Finding your threshold.')
      setRoundStartedAt(performance.now())
      return
    }

    const lastPassed = [...nextAttempts].reverse().find((item) => item.passed) ?? null
    const firstFailed = nextAttempts.find((item) => !item.passed) ?? attempt
    const smallestPassedFontSize = nextAttempts.filter((item) => item.passed).reduce<number | null>((smallest, item) => smallest === null ? item.fontSizePx : Math.min(smallest, item.fontSizePx), null)
    const estimatedThresholdFontSize = smallestPassedFontSize !== null
      ? Math.round(((smallestPassedFontSize + firstFailed.fontSizePx) / 2) * 10) / 10
      : firstFailed.fontSizePx
    const responseTimes = nextAttempts.map((item) => item.responseTimeMs)
    const conditions = captureTestConditions()
    const confidence = safetyLimitReached && !thresholdFound ? 55 : Math.min(98, Math.max(72, 70 + (nextAttempts.length * 1.8) + countSharpnessReversals(nextAttempts) * 6 - Math.max(0, 6 - correctCount) * 2))
    const payload: SharpnessThresholdPayload = {
      testType: 'visual_sharpness',
      date: conditions.dateTime,
      deviceModel: conditions.deviceModel,
      screenSize: conditions.screenSize,
      brightness: conditions.brightness,
      viewingDistanceEstimate: conditions.viewingDistanceEstimate,
      eyeMode,
      rowsCompleted: nextAttempts.length,
      smallestPassedFontSize,
      firstFailedFontSize: firstFailed.fontSizePx,
      finalAccuracy: firstFailed.accuracy,
      responseTimes,
      lastFullyCorrectRow: lastPassed,
      firstFailedRow: firstFailed,
      estimatedThresholdFontSize,
      confidence,
    }

    onRecord(estimatedThresholdFontSize, {
      confidence,
      conditions,
      note: safetyLimitReached && !thresholdFound ? LOW_CONFIDENCE_THRESHOLD_NOTE : `Sharpness threshold estimated at ${estimatedThresholdFontSize}px between smallest passed row ${smallestPassedFontSize ?? '—'}px and first failed row ${firstFailed.fontSizePx}px. Confidence ${confidence}%.`,
      sharpnessThreshold: payload,
    })
  }

  if (!started) return null

  return (
    <div className="screen test-screen sharpness-screen">
      <button className="text-button" onClick={onCancel}>Cancel</button>
      <p className="small-muted">{testProgressLabel(step, total)} · Finding your threshold</p>
      <h1>Visual Sharpness</h1>
      <section className="sharpness-instructions sharpness-helper-inline glass-card" aria-label="Sharpness instructions">
        <p>Hold phone at arm’s length.</p>
        <p>Type the 6 letters you see.</p>
        <small>You can use dictation if typing is difficult.</small>
      </section>
      <div className="eye-mode-picker" aria-label="Choose eye mode">
        {(['both', 'left', 'right'] as SharpnessEyeMode[]).map((mode) => (
          <button className={eyeMode === mode ? 'active' : ''} key={mode} onClick={() => setEyeMode(mode)}>
            {mode === 'both' ? 'Both eyes' : mode === 'left' ? 'Left eye' : 'Right eye'}
          </button>
        ))}
      </div>
      <div className="difficulty-track" aria-label={`Difficulty ${progress}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <section className="sharpness-row-stage glass-card">
        <p className="eyebrow">Row {rowIndex + 1} · {fontSize}px</p>
        <div className="letter-row" style={{ fontSize }}>{letters.split('').join(' ')}</div>
      </section>
      <label className="sharpness-answer">
        <span>Enter the 6 letters above.</span>
        <input
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          autoFocus
          enterKeyHint="done"
          inputMode="text"
          maxLength={6}
          spellCheck={false}
          value={answer}
          onChange={(event) => setAnswer(normalizeAnswer(event.target.value).slice(0, 6))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && answer.length > 0) submitRow()
          }}
          placeholder="Type what you see"
          aria-describedby="sharpness-helper"
        />
        <small id="sharpness-helper">Spaces and lowercase are okay. You can use your phone’s dictation if typing is difficult.</small>
      </label>
      {feedback && <p className="sharpness-feedback">{feedback}</p>}
      <div className="sharpness-stats">
        <span>Rows completed: {attempts.length}</span>
        <span>Last passed: {attempts.filter((item) => item.passed).at(-1)?.fontSizePx ?? '—'}px</span>
      </div>
      <button className="glass-button primary" disabled={answer.length === 0} onClick={submitRow}>Submit row</button>
      <p className="calm-note">Tracks your readable threshold over time on this device.</p>
    </div>
  )
}

function BottomNav({ tab, setTab }: { tab: string; setTab: (tab: 'home' | 'explore' | 'settings' | 'reliability' | 'betaDiagnostics') => void }) {
  const items = [
    { id: 'home', label: 'Home', icon: '⌂' },
    { id: 'explore', label: 'Explore', icon: '◉' },
    { id: 'settings', label: 'Settings', icon: '⚙' },
  ] as const

  return (
    <nav className="bottom-nav glass-card" aria-label="Bottom navigation">
      {items.map((item) => (
        <button className={tab === item.id ? 'active' : ''} key={item.id} onClick={() => setTab(item.id)}>
          <span>{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function formatDuration(milliseconds: number) {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

function baselineStepLabel(count: number) {
  if (count === 0) return 'Baseline Starting'
  if (count === 1) return 'Snapshot 1 Complete'
  return 'Snapshot 2 Complete'
}

function iconFor(id: CapabilityId) {
  const icons: Record<CapabilityId, string> = {
    sharpness: 'A',
    contrast: '◐',
    peripheralAwareness: '◠',
    visualResponse: '↯',
  }
  return icons[id]
}

export default App
