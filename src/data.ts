import type { BaselineCalibration, BetaSuccessMetrics, CapabilityId, EyeFatigueLevel, SnapshotAnalytics, SnapshotQualitySignal, SnapshotReadiness, SightlyState, StandaloneTestResult, TestResult, ToolId, VisionCheck, VisionCorrectionUsage, VisionProfileItem, VisionTool } from './types'
import {
  buildAnnualSummary,
  buildScoreExplanation,
  calculateCheckConfidence,
  calculateReliabilityAnalysis,
  calculateSnapshotStability,
  calculateTypicalRange,
  calculateVisionScore,
  confidenceFromConditions,
  getCheckStatus,
  makeSnapshot,
  scoreFromMeasurement,
} from './engine'

export const SIGHTLY_STORAGE_KEY = 'sightly-v2-explainable-state'

export function calculateBaselineCalibration(checks: VisionCheck[], typicalRange: SightlyState['typicalRange']): BaselineCalibration {
  const calibrationChecks = checks.slice(0, 3).filter((check) => typeof check.score === 'number')
  const scores = calibrationChecks.map((check) => check.score as number)
  const completedSnapshots = Math.min(scores.length, 3)

  if (completedSnapshots < 3) {
    return {
      requiredSnapshots: 3,
      completedSnapshots,
      average: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
      variance: null,
      repeatability: null,
      confidence: 0,
      typicalRange: null,
      consistency: 'building',
      message: 'Build your baseline with 3 full snapshots spaced at least 12 hours apart.',
      optionalFourthSnapshotRecommended: false,
    }
  }

  const averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length
  const variance = scores.reduce((sum, score) => sum + Math.pow(score - averageScore, 2), 0) / scores.length
  const standardDeviation = Math.sqrt(variance)
  const consistencyScore = Math.max(0, Math.min(100, Math.round(100 - standardDeviation * 7)))
  const consistency: BaselineCalibration['consistency'] = consistencyScore >= 88 ? 'high' : 'needs-more-data'
  const averageConfidence = Math.round(calibrationChecks.reduce((sum, check) => sum + check.confidence, 0) / calibrationChecks.length)

  return {
    requiredSnapshots: 3,
    completedSnapshots: 3,
    average: Math.round(averageScore),
    variance: Math.round(variance * 10) / 10,
    repeatability: consistencyScore >= 92 ? 'Excellent' : consistencyScore >= 82 ? 'Good' : consistencyScore >= 68 ? 'Fair' : 'Poor',
    confidence: Math.min(99, Math.round(averageConfidence * 0.72 + consistencyScore * 0.28)),
    typicalRange,
    consistency,
    message: consistency === 'high' ? 'Baseline Established' : 'Additional calibration may improve accuracy.',
    optionalFourthSnapshotRecommended: consistency === 'needs-more-data',
  }
}

export const visionTools: VisionTool[] = [
  {
    id: 'visualSharpness',
    capability: 'sharpness',
    title: 'Sharpness',
    description: 'Finds the smallest six-letter row you can type correctly without multiple choice.',
    metricLabel: 'Smallest readable row',
    unit: 'px',
    betterDirection: 'lower',
    lastResultLabel: '10px',
    historyLabel: 'Personal acuity baseline',
  },
  {
    id: 'contrastSensitivity',
    capability: 'contrast',
    title: 'Contrast',
    description: 'Finds the faintest Landolt-C opening direction you can reliably identify.',
    metricLabel: 'Contrast threshold',
    unit: '%',
    betterDirection: 'lower',
    lastResultLabel: '0.6%',
    historyLabel: 'Low contrast threshold',
  },
  {
    id: 'peripheralAwareness',
    capability: 'peripheralAwareness',
    title: 'Peripheral Awareness',
    description: 'Measures edge stimulus detection while you keep focus on a center dot.',
    metricLabel: 'Peripheral threshold',
    unit: '',
    betterDirection: 'higher',
    lastResultLabel: 'Level 6',
    historyLabel: 'Peripheral threshold',
  },
]

export const advancedVisionTools: VisionTool[] = [
  {
    id: 'visualResponse',
    capability: 'visualResponse',
    title: 'Recognition Threshold',
    description: 'Advanced visual-processing assessment. Not included in the monthly Vision Score.',
    metricLabel: 'Recognition threshold',
    unit: 'ms',
    betterDirection: 'lower',
    lastResultLabel: '150ms',
    historyLabel: 'Advanced recognition threshold',
  },
]


export const visionProfileItems: VisionProfileItem[] = [
  {
    id: 'recognitionThreshold',
    label: 'Recognition Threshold',
    result: 'Advanced visual processing',
    description: 'Measures symbol recognition and attention separately from the monthly Vision Score.',
    affectsVisionScore: false,
  },
  {
    id: 'colorVision',
    label: 'Color Vision',
    result: 'Ishihara profile',
    description: 'Informational color-pattern screening. Stored in Vision Profile only.',
    affectsVisionScore: false,
  },
  {
    id: 'eyeDominance',
    label: 'Eye Dominance',
    result: 'Dominant-eye note',
    description: 'Useful context for aiming and framing tasks. Not part of monthly score.',
    affectsVisionScore: false,
  },
  {
    id: 'amslerGrid',
    label: 'Amsler Grid',
    result: 'Advanced grid screening',
    description: 'Informational central-grid screen. Stored outside the monthly Vision Score.',
    affectsVisionScore: false,
  },
  {
    id: 'astigmatism',
    label: 'Astigmatism Screening',
    result: 'Line-distortion screen',
    description: 'An informational profile flag for follow-up context. Not scored.',
    affectsVisionScore: false,
  },
  {
    id: 'nightVision',
    label: 'Night Vision',
    result: 'Low-light profile',
    description: 'Tracks subjective low-light context separately from Vision Score.',
    affectsVisionScore: false,
  },
]

const emptyBetaSuccessMetrics: BetaSuccessMetrics = {
  calibrationCompletionRate: 0,
  monthlyReturnRate: 0,
  averageVariance: null,
  averageConfidence: null,
  snapshotCompletionRate: 0,
  averageSessionDurationMs: null,
  feedbackBelievabilityScore: null,
}

export const emptyState: SightlyState = {
  onboarded: false,
  profile: {
    name: 'Mike',
    notificationsEnabled: true,
    reduceMotion: false,
    highContrast: false,
  },
  checks: [],
  standaloneResults: [],
  snapshots: [],
  typicalRange: null,
  baselineCalibration: calculateBaselineCalibration([], null),
  annualSummary: null,
  reliability: null,
  betaFeedback: [],
  betaSuccessMetrics: emptyBetaSuccessMetrics,
  visionProfile: visionProfileItems,
  lastNotification: null,
}

const demoMeasurementSets: Partial<Record<ToolId, number>>[] = [
  { visualSharpness: 10, contrastSensitivity: 0.8, peripheralAwareness: 6.2 },
  { visualSharpness: 10, contrastSensitivity: 0.7, peripheralAwareness: 6.4 },
  { visualSharpness: 12, contrastSensitivity: 0.9, peripheralAwareness: 5.7 },
]

export function captureConditions(readiness?: Partial<SnapshotReadiness>) {
  const width = window.screen?.width || window.innerWidth
  const height = window.screen?.height || window.innerHeight
  const orientation = window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait'
  const now = new Date()
  const brightness = 0.82
  const eyeFatigue: EyeFatigueLevel = readiness?.eyeFatigue ?? 'normal'
  const visionCorrection: VisionCorrectionUsage = readiness?.visionCorrection ?? 'notApplicable'
  const batterySaverMode = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData)
  const deviceModel = navigator.userAgent.includes('iPhone')
    ? 'iPhone'
    : navigator.userAgent.includes('Mac')
      ? 'Apple device'
      : 'Current device'

  return {
    screenSize: `${width} × ${height}`,
    brightness,
    deviceModel,
    orientation: orientation as 'portrait' | 'landscape',
    lightingConfidence: orientation === 'portrait' ? 96 : 90,
    dateTime: now.toISOString(),
    timeOfDay: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    batterySaverMode,
    eyeFatigue,
    visionCorrection,
    viewingDistanceEstimate: 'comfortable consistent distance',
  }
}

function makeResult(
  tool: VisionTool,
  measuredValue: number,
  date: Date,
  index: number,
  details: Partial<TestResult> = {},
): TestResult {
  const conditions = { ...captureConditions(), ...details.conditions }
  const confidence = details.confidence ?? confidenceFromConditions(96 - (index % 2), conditions.lightingConfidence)
  const normalizedScore = scoreFromMeasurement(tool.capability, measuredValue)

  return {
    id: `${tool.id}-${date.toISOString()}-${index}`,
    toolId: tool.id,
    capability: tool.capability,
    date: date.toISOString(),
    measuredValue,
    unit: tool.unit,
    metricLabel: tool.metricLabel,
    betterDirection: tool.betterDirection,
    rawValue: measuredValue,
    normalizedScore,
    confidence,
    conditions,
    note: 'Measured capability score. Compared only against your own baseline.',
    ...details,
  }
}

function assertCompleteSnapshotMeasurements(measurements: Partial<Record<ToolId, number>>) {
  const missing = visionTools.filter((tool) => typeof measurements[tool.id] !== 'number')
  if (missing.length) {
    throw new Error(`Missing ${missing.map((tool) => tool.title).join(', ')} measurement for monthly snapshot.`)
  }
}

export function createStandaloneResult(
  tool: VisionTool,
  measuredValue: number,
  date: Date,
  details: Partial<TestResult> = {},
): StandaloneTestResult {
  return {
    ...makeResult(tool, measuredValue, date, 0, details),
    resultType: 'standalone',
  }
}

function qualitySignalsForResult(result: TestResult): SnapshotQualitySignal[] {
  const signals: SnapshotQualitySignal[] = []
  const avgResponseMs = result.sharpnessThreshold?.responseTimes.length
    ? result.sharpnessThreshold.responseTimes.reduce((sum, value) => sum + value, 0) / result.sharpnessThreshold.responseTimes.length
    : result.contrastThreshold?.avgResponseTime
      ?? result.peripheralAwareness?.reactionTime
      ?? result.visualChoiceReaction?.avgResponseTimeMs
      ?? null
  const accuracy = result.sharpnessThreshold?.finalAccuracy
    ?? result.contrastThreshold?.accuracy
    ?? result.peripheralAwareness?.accuracy
    ?? result.visualChoiceReaction?.accuracy
    ?? null
  const confidence = result.sharpnessThreshold?.confidence
    ?? result.contrastThreshold?.confidence
    ?? result.peripheralAwareness?.confidence
    ?? result.visualChoiceReaction?.confidence
    ?? result.confidence

  if (avgResponseMs !== null && avgResponseMs < 260) signals.push('rapid-guessing')
  if (accuracy !== null && accuracy < 0.42) signals.push('impossible-pattern')
  if (confidence < 70) signals.push('incomplete-convergence')
  if ((result.retryCount ?? 0) >= 2) signals.push('inconsistent')
  return [...new Set(signals)]
}

function applyQualityAdjustment(result: TestResult): TestResult {
  const qualitySignals = [...new Set([...(result.qualitySignals ?? []), ...qualitySignalsForResult(result)])]
  const confidence = Math.max(45, result.confidence - qualitySignals.length * 7)
  return { ...result, confidence, qualitySignals }
}

export function createCheckFromMeasurements(
  measurements: Partial<Record<ToolId, number>>,
  date: Date,
  resultDetails: Partial<Record<ToolId, Partial<TestResult>>> = {},
  readiness: SnapshotReadiness | null = null,
  analytics: SnapshotAnalytics | null = null,
): VisionCheck {
  assertCompleteSnapshotMeasurements(measurements)
  const results = visionTools.map((tool, index) => applyQualityAdjustment({
    ...makeResult(tool, measurements[tool.id] as number, date, index, resultDetails[tool.id]),
    resultType: 'snapshot' as const,
  }))
  const score = calculateVisionScore(results)
  const confidence = calculateCheckConfidence(results)

  return {
    id: `check-${date.toISOString()}`,
    date: date.toISOString(),
    testResults: results,
    score,
    confidence,
    measurementConfidence: confidence,
    readiness,
    status: 'scored',
    explanation: null,
    analytics,
    stabilityMetrics: null,
  }
}

export function createCheckFromValues(values: number[], date: Date): VisionCheck {
  const measurements = visionTools.reduce((acc, tool, index) => {
    acc[tool.id] = values[index] ?? demoMeasurementSets[2][tool.id]
    return acc
  }, {} as Partial<Record<ToolId, number>>)
  return createCheckFromMeasurements(measurements, date)
}

export function createDemoState(): SightlyState {
  const now = new Date()
  const monthsAgo = [2, 1, 0]
  const checksWithoutDerived = monthsAgo.map((offset, index) => {
    const date = new Date(now)
    date.setMonth(now.getMonth() - offset)
    date.setDate(12)
    return createCheckFromMeasurements(demoMeasurementSets[index], date)
  })

  return rebuildDerivedState({
    ...emptyState,
    onboarded: true,
    checks: checksWithoutDerived,
    lastNotification: "It's time for your monthly vision check.",
  })
}

export function loadState(): SightlyState {
  try {
    const stored = localStorage.getItem(SIGHTLY_STORAGE_KEY)
    if (!stored) return emptyState
    return rebuildDerivedState({ ...emptyState, ...JSON.parse(stored) })
  } catch {
    return emptyState
  }
}

export function saveState(state: SightlyState) {
  localStorage.setItem(SIGHTLY_STORAGE_KEY, JSON.stringify(state))
}

export function calculateBetaSuccessMetrics(state: Pick<SightlyState, 'checks' | 'betaFeedback'>): BetaSuccessMetrics {
  const completed = state.checks.length
  const calibrationCompletionRate = Math.min(100, Math.round((Math.min(completed, 3) / 3) * 100))
  const scoredChecks = state.checks.filter((check) => typeof check.score === 'number')
  const variances = scoredChecks
    .map((check) => check.stabilityMetrics?.snapshotToSnapshotVariance)
    .filter((value): value is number => typeof value === 'number')
  const confidences = scoredChecks.map((check) => check.confidence)
  const durations = scoredChecks
    .map((check) => check.analytics?.totalDurationMs)
    .filter((value): value is number => typeof value === 'number')
  const feedbackRatings = state.betaFeedback.map((item) => item.believabilityRating)
  const uniqueMonths = new Set(scoredChecks.map((check) => new Date(check.date).toISOString().slice(0, 7))).size
  const snapshotCompletionRate = completed
    ? Math.round((state.checks.filter((check) => check.testResults.length >= visionTools.length).length / completed) * 100)
    : 0

  return {
    calibrationCompletionRate,
    monthlyReturnRate: completed > 1 ? Math.min(100, Math.round((uniqueMonths / completed) * 100)) : 0,
    averageVariance: variances.length ? Math.round((variances.reduce((sum, value) => sum + value, 0) / variances.length) * 10) / 10 : null,
    averageConfidence: confidences.length ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length) : null,
    snapshotCompletionRate,
    averageSessionDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    feedbackBelievabilityScore: feedbackRatings.length ? Math.round((feedbackRatings.reduce((sum, value) => sum + value, 0) / feedbackRatings.length) * 10) / 10 : null,
  }
}

export function rebuildDerivedState(state: SightlyState): SightlyState {
  let runningChecks: VisionCheck[] = []
  const snapshots: SightlyState['snapshots'] = []

  const checks = state.checks.map((check, index) => {
    const status = getCheckStatus(index)
    const score = calculateVisionScore(check.testResults)
    const confidence = calculateCheckConfidence(check.testResults)
    const typicalBefore = calculateTypicalRange(runningChecks)
    const reliabilityBefore = calculateReliabilityAnalysis(runningChecks)
    const previousCheck = runningChecks.at(-1) ?? null
    const nextCheck: VisionCheck = {
      ...check,
      score,
      confidence,
      measurementConfidence: check.measurementConfidence ?? confidence,
      readiness: check.readiness ?? null,
      status,
      explanation: null,
      analytics: check.analytics ?? null,
      stabilityMetrics: null,
    }
    const explanation = buildScoreExplanation(nextCheck, previousCheck, typicalBefore)
    const derived = { ...nextCheck, explanation, stabilityMetrics: calculateSnapshotStability(nextCheck, runningChecks) }
    snapshots.push(makeSnapshot(derived, typicalBefore, [...runningChecks, derived], reliabilityBefore?.overallSnapshotReliability ?? null))
    runningChecks = [...runningChecks, derived]
    return derived
  })

  const baselineChecks = checks.slice(0, 3)
  const typicalRange = calculateTypicalRange(baselineChecks)
  const baselineCalibration = calculateBaselineCalibration(checks, typicalRange)
  const reliability = calculateReliabilityAnalysis(checks)
  const annualSummary = buildAnnualSummary(checks, typicalRange)

  return {
    ...state,
    betaFeedback: state.betaFeedback ?? [],
    betaSuccessMetrics: calculateBetaSuccessMetrics({ checks, betaFeedback: state.betaFeedback ?? [] }),
    visionProfile: state.visionProfile?.length ? state.visionProfile : visionProfileItems,
    standaloneResults: state.standaloneResults ?? [],
    checks,
    typicalRange,
    baselineCalibration,
    snapshots,
    annualSummary,
    reliability,
  }
}

export function formatMeasurement(result: TestResult) {
  return `${result.measuredValue}${result.unit}`
}

export function capabilityLabel(capability: CapabilityId) {
  return visionTools.find((tool) => tool.capability === capability)?.title ?? capability
}
