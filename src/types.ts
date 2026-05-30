export type CapabilityId = 'sharpness' | 'contrast' | 'peripheralAwareness' | 'visualResponse'

export type ToolId =
  | 'visualSharpness'
  | 'contrastSensitivity'
  | 'peripheralAwareness'
  | 'visualResponse'

export type EyeFatigueLevel = 'great' | 'normal' | 'slightlyTired' | 'veryTired'

export type VisionCorrectionUsage = 'glasses' | 'contacts' | 'none' | 'notApplicable'

export type AuthMode = 'apple' | 'google' | 'email' | 'guest'
export type CorrectionProfile = 'glasses' | 'contacts' | 'both' | 'none'
export type LastEyeExamRange = 'within6Months' | 'sixToTwelveMonths' | 'oneToTwoYears' | 'overTwoYears' | 'unknown'

export type TestingCondition = {
  screenSize: string
  brightness: number
  deviceModel: string
  orientation: 'portrait' | 'landscape'
  lightingConfidence: number
  dateTime: string
  timeOfDay: string
  batterySaverMode: boolean
  eyeFatigue: EyeFatigueLevel
  visionCorrection: VisionCorrectionUsage
  viewingDistanceEstimate?: string
}

export type SnapshotReadiness = {
  eyeFatigue: EyeFatigueLevel
  visionCorrection: VisionCorrectionUsage
  armLengthConfirmed: boolean
  checklistConfirmed: boolean
  startedAt: string
}

export type SharpnessEyeMode = 'both' | 'left' | 'right'

export type SharpnessRowAttempt = {
  round: number
  letters: string
  typedAnswer: string
  fontSizePx: number
  correctCount: number
  accuracy: number
  responseTimeMs: number
  passed: boolean
}

export type SharpnessThresholdPayload = {
  testType: 'visual_sharpness'
  date: string
  deviceModel: string
  screenSize: string
  brightness: number
  viewingDistanceEstimate: string
  eyeMode: SharpnessEyeMode
  rowsCompleted: number
  smallestPassedFontSize: number | null
  firstFailedFontSize: number
  finalAccuracy: number
  responseTimes: number[]
  lastFullyCorrectRow: SharpnessRowAttempt | null
  firstFailedRow: SharpnessRowAttempt
  estimatedThresholdFontSize: number
  confidence: number
}

export type ContrastDirection = 'top' | 'right' | 'bottom' | 'left'

export type ContrastTrial = {
  round: number
  contrast: number
  direction: ContrastDirection
  selectedDirection: ContrastDirection | 'miss'
  correct: boolean
  responseTimeMs: number
}

export type ContrastThresholdPayload = {
  testType: 'contrast_sensitivity'
  date: string
  threshold: number
  lowestPassed: number | null
  firstFailed: number | null
  accuracy: number
  avgResponseTime: number
  confidence: number
  deviceModel: string
  screenSize: string
  brightness: number
  ambientLightingEstimate: string
  trials: ContrastTrial[]
}


export type PeripheralDirection = 'top' | 'bottom' | 'left' | 'right' | 'upper-left' | 'upper-right' | 'lower-left' | 'lower-right'

export type PeripheralTrial = {
  round: number
  direction: PeripheralDirection
  selectedDirection: PeripheralDirection | 'miss'
  appearanceTimeMs: number
  stimulusSizePx: number
  eccentricity: number
  contrast: number
  difficulty: number
  correct: boolean
  responseTimeMs: number
}

export type PeripheralAwarenessPayload = {
  testType: 'peripheral_awareness'
  score: number
  reactionTime: number
  accuracy: number
  misses: number
  missRate: number
  threshold: number
  lastPassedDifficulty: number | null
  firstFailedDifficulty: number | null
  estimatedThreshold: number
  confidence: number
  deviceModel: string
  screenSize: string
  brightness: number
  timestamp: string
  edgeAccuracy: number
  consistency: number
  trials: PeripheralTrial[]
}

export type VisualChoiceSymbol = 'left' | 'right' | 'up' | 'down'

export type VisualChoiceTrial = {
  round: number
  symbol: VisualChoiceSymbol
  selectedSymbol: VisualChoiceSymbol | 'miss'
  exposureDurationMs: number
  correct: boolean
  responseTimeMs: number
}

export type VisualChoicePayload = {
  testType: 'visual_response'
  thresholdMs: number
  accuracy: number
  avgResponseTimeMs: number
  roundsCompleted: number
  shortestPassedExposureMs: number | null
  firstFailedExposureMs: number | null
  confidence: number
  consistency: number
  deviceModel: string
  screenSize: string
  brightness: number
  timestamp: string
  trials: VisualChoiceTrial[]
}

export type CapabilityContribution = {
  capability: CapabilityId
  label: string
  score: number
  typicalScore: number | null
  delta: number
  points: number
  exactPoints: number
  weight: number
  weightPercent: number
  confidence: number
  confidenceWeight: number
  status: 'above' | 'within' | 'below' | 'baseline'
  measurementLabel: string
  explanation: string
}

export type ScoreExplanation = {
  score: number
  previousScore: number | null
  delta: number
  summary: string
  contributions: CapabilityContribution[]
}

export type TestResult = {
  id: string
  toolId: ToolId
  capability: CapabilityId
  date: string
  measuredValue: number
  unit: string
  metricLabel: string
  betterDirection: 'higher' | 'lower'
  rawValue: number
  normalizedScore: number
  confidence: number
  durationMs?: number
  retryCount?: number
  qualitySignals?: SnapshotQualitySignal[]
  conditions: TestingCondition
  note: string
  resultType?: 'snapshot' | 'standalone'
  sharpnessThreshold?: SharpnessThresholdPayload
  contrastThreshold?: ContrastThresholdPayload
  peripheralAwareness?: PeripheralAwarenessPayload
  visualChoiceReaction?: VisualChoicePayload
}

export type SnapshotResult = TestResult & {
  resultType: 'snapshot'
}

export type StandaloneTestResult = TestResult & {
  resultType: 'standalone'
}

export type SnapshotQualitySignal = 'inconsistent' | 'rapid-guessing' | 'impossible-pattern' | 'incomplete-convergence'

export type TestAnalytics = {
  toolId: ToolId
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  retryCount: number
  abandoned: boolean
  resumed: boolean
}

export type SnapshotAnalytics = {
  startedAt: string
  completedAt: string
  totalDurationMs: number
  perTestDurations: Partial<Record<ToolId, number>>
  abandonedTests: ToolId[]
  resumedSnapshot: boolean
  retryFrequency: number
  interruptionCount: number
}

export type SnapshotStabilityMetrics = {
  snapshotToSnapshotVariance: number | null
  varianceScore: number
  stabilityScore: number
  confidenceTrend: number | null
  calibrationConsistency: number | null
  repeatabilityConfidence: number
  qualitySignals: SnapshotQualitySignal[]
}

export type BetaFeedbackTag = 'consistent' | 'surprising' | 'inaccurate' | 'difficult-to-complete'

export type BetaSnapshotFeedback = {
  snapshotId: string
  createdAt: string
  believabilityRating: 1 | 2 | 3 | 4 | 5
  comment: string
  tags: BetaFeedbackTag[]
}

export type BetaSuccessMetrics = {
  calibrationCompletionRate: number
  monthlyReturnRate: number
  averageVariance: number | null
  averageConfidence: number | null
  snapshotCompletionRate: number
  averageSessionDurationMs: number | null
  feedbackBelievabilityScore: number | null
}

export type VisionCheck = {
  id: string
  date: string
  testResults: TestResult[]
  score: number | null
  confidence: number
  measurementConfidence: number
  readiness: SnapshotReadiness | null
  status: 'baseline-started' | 'baseline-building' | 'baseline-established' | 'scored'
  explanation: ScoreExplanation | null
  analytics: SnapshotAnalytics | null
  stabilityMetrics: SnapshotStabilityMetrics | null
}

export type VisionSnapshot = {
  id: string
  monthLabel: string
  date: string
  score: number | null
  confidence: number
  measurementConfidence: number
  message: string
  recommendation: string
  explanation: string
  interpretationLevel: 'baseline' | 'within-range' | 'single-below-range' | 'consecutive-below-range' | 'above-range' | 'trend-detected'
  observedCapability: string | null
  reliability: SnapshotReliabilitySummary | null
  storedData: SnapshotStoredData | null
}

export type SnapshotStoredData = {
  timestamp: string
  deviceModel: string
  screenSize: string
  brightness: number
  batterySaver: boolean
  eyeFatigue: EyeFatigueLevel
  visionCorrection: VisionCorrectionUsage
  sharpness: number | null
  contrast: number | null
  peripheral: number | null
  confidence: number
}

export type RepeatabilityRating = 'Excellent' | 'Good' | 'Fair' | 'Poor'

export type BaselineStability = 'Not Ready' | 'Building' | 'Stable' | 'Watch'

export type CapabilityReliability = {
  capability: CapabilityId
  label: string
  average: number | null
  standardDeviation: number | null
  variance: number | null
  consistencyScore: number
  repeatability: RepeatabilityRating
  confidence: number
  samples: number
  varianceLabel: 'Low' | 'Moderate' | 'High'
  noisy: boolean
  likelyChanged: boolean
  conditionImpact: 'Low' | 'Moderate' | 'High'
  conditionNotes: string[]
  message: string
}

export type SnapshotReliabilitySummary = {
  repeatability: RepeatabilityRating
  reliabilityScore: number
  confidence: number
  baselineStability: BaselineStability
  baselineReady: boolean
  enoughDataForBaseline: boolean
  message: string
}

export type ReliabilityAnalysis = {
  baselineReady: boolean
  baselineStability: BaselineStability
  baselineSnapshotCount: number
  overallSnapshotReliability: SnapshotReliabilitySummary
  capabilities: Record<CapabilityId, CapabilityReliability>
  likelyVisionChanged: boolean
  conditionWarnings: string[]
  recommendation: string
}

export type TypicalRange = {
  low: number
  high: number
  capabilityScores: Record<CapabilityId, number>
}

export type AnnualSummary = {
  year: number
  averageScore: number
  checksCompleted: number
  typicalRange: TypicalRange
  mostConsistentMonth: string
  largestVariation: string
  notification: string
}

export type BaselineCalibration = {
  requiredSnapshots: 3
  completedSnapshots: number
  average: number | null
  variance: number | null
  repeatability: RepeatabilityRating | null
  confidence: number
  typicalRange: TypicalRange | null
  consistency: 'high' | 'needs-more-data' | 'building'
  message: string
  optionalFourthSnapshotRecommended: boolean
}

export type VisionProfileItem = {
  id: 'recognitionThreshold' | 'colorVision' | 'amslerGrid' | 'eyeDominance' | 'astigmatism' | 'nightVision'
  label: string
  result: string
  description: string
  affectsVisionScore: false
}

export type SightlyProfile = {
  name: string
  notificationsEnabled: boolean
  reduceMotion: boolean
  highContrast: boolean
  authMode?: AuthMode
  ageRange?: string
  dateOfBirth?: string
  correctionProfile?: CorrectionProfile
  lastEyeExam?: LastEyeExamRange
  usualCorrectionToday?: VisionCorrectionUsage
}

export type SightlyState = {
  onboarded: boolean
  profile: SightlyProfile
  checks: VisionCheck[]
  standaloneResults: StandaloneTestResult[]
  snapshots: VisionSnapshot[]
  typicalRange: TypicalRange | null
  baselineCalibration: BaselineCalibration
  annualSummary: AnnualSummary | null
  reliability: ReliabilityAnalysis | null
  betaFeedback: BetaSnapshotFeedback[]
  betaSuccessMetrics: BetaSuccessMetrics
  visionProfile: VisionProfileItem[]
  lastNotification: string | null
}

export type VisionTool = {
  id: ToolId
  capability: CapabilityId
  title: string
  description: string
  metricLabel: string
  unit: string
  betterDirection: 'higher' | 'lower'
  lastResultLabel: string
  historyLabel: string
}
