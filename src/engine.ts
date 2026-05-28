import type {
  AnnualSummary,
  BaselineStability,
  CapabilityContribution,
  CapabilityId,
  CapabilityReliability,
  ReliabilityAnalysis,
  RepeatabilityRating,
  ScoreExplanation,
  SnapshotReliabilitySummary,
  SnapshotStabilityMetrics,
  TestResult,
  TypicalRange,
  VisionCheck,
  VisionSnapshot,
} from './types'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const round = (value: number) => Math.round(value)

export const CAPABILITY_LABELS: Record<CapabilityId, string> = {
  sharpness: 'Visual Sharpness',
  contrast: 'Contrast Sensitivity',
  peripheralAwareness: 'Peripheral Awareness',
  visualResponse: 'Visual Response',
}

export const CAPABILITY_WEIGHTS: Record<CapabilityId, number> = {
  sharpness: 0.6,
  contrast: 0.3,
  peripheralAwareness: 0.1,
  visualResponse: 0,
}

const capabilityOrder: CapabilityId[] = ['sharpness', 'contrast', 'peripheralAwareness']

export function scoreFromMeasurement(capability: CapabilityId, measuredValue: number): number {
  switch (capability) {
    case 'sharpness':
      // Smallest fully readable six-letter row in CSS pixels. Lower threshold is better.
      return clamp(round(118 - measuredValue * 3.1), 0, 100)
    case 'contrast':
      // Lowest detected contrast percentage. Lower threshold means better sensitivity.
      return clamp(round(100 - measuredValue * 2), 0, 100)
    case 'peripheralAwareness':
      // Peripheral threshold level from adaptive detection staircase. Higher level is better.
      return clamp(round(measuredValue * 8.4), 0, 100)
    case 'visualResponse':
      // Visual recognition threshold in ms. Lower exposure duration is better; accuracy gates the threshold.
      return clamp(round(106 - measuredValue * 0.14), 0, 100)
  }
}

export function calculateVisionScore(results: TestResult[]): number {
  if (!results.length) return 0
  const byCapability = new Map<CapabilityId, TestResult>()
  results.forEach((result) => byCapability.set(result.capability, result))

  const weighted = capabilityOrder.reduce(
    (acc, capability) => {
      const result = byCapability.get(capability)
      if (!result) return acc
      return {
        score: acc.score + result.normalizedScore * CAPABILITY_WEIGHTS[capability],
        weight: acc.weight + CAPABILITY_WEIGHTS[capability],
      }
    },
    { score: 0, weight: 0 },
  )

  return clamp(round(weighted.score / weighted.weight), 0, 100)
}

export function calculateCheckConfidence(results: TestResult[]): number {
  const scoredResults = results.filter((result) => capabilityOrder.includes(result.capability))
  if (!scoredResults.length) return 0
  const average = scoredResults.reduce((sum, result) => sum + result.confidence, 0) / scoredResults.length
  const lighting = scoredResults.reduce((sum, result) => sum + result.conditions.lightingConfidence, 0) / scoredResults.length
  return clamp(round(average * 0.68 + lighting * 0.32), 1, 99)
}

function averageCapabilityScores(checks: VisionCheck[]): Record<CapabilityId, number> | null {
  const scored = checks.filter((check) => capabilityOrder.every((capability) => check.testResults.some((result) => result.capability === capability)))
  if (scored.length < 3) return null

  return capabilityOrder.reduce((acc, capability) => {
    const scores = scored
      .map((check) => check.testResults.find((result) => result.capability === capability)?.normalizedScore)
      .filter((score): score is number => typeof score === 'number')
      .slice(-6)
    if (!scores.length) return acc
    acc[capability] = round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    return acc
  }, {} as Record<CapabilityId, number>)
}

export function calculateTypicalRange(checks: VisionCheck[]): TypicalRange | null {
  const scored = checks.filter((check) => typeof check.score === 'number').map((check) => check.score as number)
  const capabilityScores = averageCapabilityScores(checks)
  if (scored.length < 3 || !capabilityScores) return null

  const recent = scored.slice(-6)
  const average = recent.reduce((sum, score) => sum + score, 0) / recent.length
  const deltas = recent.map((score) => Math.abs(score - average))
  const averageDelta = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length
  const spread = clamp(Math.ceil(averageDelta + 1), 1, 4)

  return {
    low: clamp(round(average - spread), 0, 100),
    high: clamp(round(average + spread), 0, 100),
    capabilityScores,
  }
}

export function getCheckStatus(checkIndex: number): VisionCheck['status'] {
  if (checkIndex === 0) return 'baseline-started'
  if (checkIndex === 1) return 'baseline-building'
  if (checkIndex === 2) return 'baseline-established'
  return 'scored'
}

export function buildScoreExplanation(
  check: Pick<VisionCheck, 'testResults' | 'score'>,
  previousCheck: VisionCheck | null,
  typicalRange: TypicalRange | null,
): ScoreExplanation | null {
  if (check.score === null) return null
  const previousScore = previousCheck?.score ?? null
  const delta = previousScore === null ? 0 : check.score - previousScore

  const draftContributions = capabilityOrder.map((capability) => {
    const result = check.testResults.find((item) => item.capability === capability)
    const previousResult = previousCheck?.testResults.find((item) => item.capability === capability)
    const typicalScore = typicalRange?.capabilityScores[capability] ?? previousResult?.normalizedScore ?? null
    const componentDelta = typicalScore === null || !result ? 0 : result.normalizedScore - typicalScore
    const exactPoints = componentDelta * CAPABILITY_WEIGHTS[capability]
    const label = CAPABILITY_LABELS[capability]
    const status: CapabilityContribution['status'] = typicalScore === null ? 'baseline' : componentDelta < -1 ? 'below' : componentDelta > 1 ? 'above' : 'within'
    const confidenceWeight = result ? clamp((result.confidence * result.conditions.lightingConfidence) / 10000, 0.45, 1) : 0

    return {
      capability,
      label,
      score: result?.normalizedScore ?? 0,
      typicalScore,
      delta: round(componentDelta),
      rawPoints: exactPoints,
      exactPoints,
      weight: CAPABILITY_WEIGHTS[capability],
      weightPercent: round(CAPABILITY_WEIGHTS[capability] * 100),
      confidence: result?.confidence ?? 0,
      confidenceWeight,
      status,
      measurementLabel: result
        ? `${result.metricLabel}: ${result.measuredValue}${result.unit}`
        : 'No measurement recorded',
      explanation: result
        ? `${label}: ${componentDelta === 0 ? 'Normal' : `${componentDelta > 0 ? '↑' : '↓'} ${Math.abs(round(componentDelta))}%`} (${round(CAPABILITY_WEIGHTS[capability] * 100)}% weight).`
        : `${label} was not measured.`,
    }
  })

  const targetDelta = previousScore === null ? 0 : delta
  const basePoints = draftContributions.map((item) => Math.trunc(item.rawPoints))
  let remainder = targetDelta - basePoints.reduce((sum, points) => sum + points, 0)
  const direction = remainder === 0 ? 0 : remainder > 0 ? 1 : -1
  const adjustmentOrder = draftContributions
    .map((item, index) => ({ index, magnitude: Math.abs(item.rawPoints), signedMagnitude: item.rawPoints * direction, status: item.status }))
    .filter((item) => item.signedMagnitude > 0 && (direction < 0 ? item.status === 'below' : item.status === 'above'))
    .sort((a, b) => b.magnitude - a.magnitude)

  if (!adjustmentOrder.length && remainder !== 0) {
    adjustmentOrder.push(
      ...draftContributions
        .map((item, index) => ({ index, magnitude: Math.abs(item.rawPoints), signedMagnitude: item.rawPoints * direction, status: item.status }))
        .filter((item) => item.signedMagnitude > 0)
        .sort((a, b) => b.magnitude - a.magnitude),
    )
  }

  let cursor = 0
  while (remainder !== 0 && adjustmentOrder.length) {
    const target = adjustmentOrder[cursor % adjustmentOrder.length]
    basePoints[target.index] += direction
    remainder -= direction
    cursor += 1
  }

  const contributions: CapabilityContribution[] = draftContributions.map((item, index) => ({
    ...item,
    points: basePoints[index],
  }))

  const drivers = contributions
    .filter((item) => (delta < 0 ? item.points < 0 : item.points > 0))
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 2)

  let summary = 'This score is building your personal baseline.'
  if (previousScore !== null) {
    if (delta === 0) {
      summary = 'Your score stayed level because the measured capabilities stayed within your typical range.'
    } else if (drivers.length) {
      const names = drivers.map((item) => item.label.toLowerCase()).join(' and ')
      summary = `${names} measured ${delta > 0 ? 'above' : 'below'} your typical range, moving this snapshot ${Math.abs(delta)} points ${delta > 0 ? 'higher' : 'lower'} than the last one.`
    } else {
      summary = `This snapshot measured ${Math.abs(delta)} points ${delta > 0 ? 'higher' : 'lower'} from small changes across multiple capabilities.`
    }
  }

  return { score: check.score, previousScore, delta, summary, contributions }
}

const reliabilityEmptyCapability = (capability: CapabilityId): CapabilityReliability => ({
  capability,
  label: CAPABILITY_LABELS[capability],
  average: null,
  standardDeviation: null,
  variance: null,
  consistencyScore: 0,
  repeatability: 'Poor',
  confidence: 0,
  samples: 0,
  varianceLabel: 'High',
  noisy: false,
  likelyChanged: false,
  conditionImpact: 'Low',
  conditionNotes: ['Complete 3 snapshots before creating a personal baseline.'],
  message: 'Baseline not ready. Sightly needs 3 completed snapshots before judging repeatability.',
})

function ratingFromConsistency(consistencyScore: number): RepeatabilityRating {
  if (consistencyScore >= 92) return 'Excellent'
  if (consistencyScore >= 82) return 'Good'
  if (consistencyScore >= 68) return 'Fair'
  return 'Poor'
}

function varianceLabelFromConsistency(consistencyScore: number): CapabilityReliability['varianceLabel'] {
  if (consistencyScore >= 82) return 'Low'
  if (consistencyScore >= 68) return 'Moderate'
  return 'High'
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0
  const mean = average(values)
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length
  return Math.sqrt(variance)
}

function conditionNotesForCapability(results: TestResult[]) {
  const notes: string[] = []
  const brightnessValues = results.map((result) => result.conditions.brightness)
  const devices = new Set(results.map((result) => result.conditions.deviceModel))
  const screenSizes = new Set(results.map((result) => result.conditions.screenSize))
  const fatigued = results.filter((result) => result.conditions.eyeFatigue === 'veryTired' || result.conditions.eyeFatigue === 'slightlyTired').length
  const batterySaver = results.some((result) => result.conditions.batterySaverMode)
  const times = new Set(results.map((result) => result.conditions.timeOfDay.split(':')[0]))
  const brightnessSpread = Math.max(...brightnessValues) - Math.min(...brightnessValues)

  if (brightnessSpread > 0.18) notes.push('Brightness changed meaningfully between snapshots.')
  if (devices.size > 1) notes.push('Device model changed between measurements.')
  if (screenSizes.size > 1) notes.push('Screen size changed between measurements.')
  if (fatigued) notes.push('One or more snapshots were taken when eyes felt tired.')
  if (batterySaver) notes.push('Battery saver was active for at least one snapshot.')
  if (times.size > 2) notes.push('Time of day varied across snapshots.')
  return notes
}

function conditionImpactFromNotes(notes: string[]): CapabilityReliability['conditionImpact'] {
  if (notes.length >= 3) return 'High'
  if (notes.length >= 1) return 'Moderate'
  return 'Low'
}

function stableBaselineFrom(reliabilities: CapabilityReliability[], overallScore: number, baselineReady: boolean): BaselineStability {
  if (!baselineReady) return 'Not Ready'
  if (overallScore >= 82 && reliabilities.every((item) => !item.noisy)) return 'Stable'
  if (overallScore >= 68) return 'Building'
  return 'Watch'
}

export function calculateReliabilityAnalysis(checks: VisionCheck[]): ReliabilityAnalysis | null {
  if (!checks.length) return null
  const completed = checks.filter((check) => capabilityOrder.every((capability) => check.testResults.some((result) => result.capability === capability)))
  const baselineReady = completed.length >= 3

  const capabilities = capabilityOrder.reduce((acc, capability) => {
    const results = completed
      .map((check) => check.testResults.find((result) => result.capability === capability))
      .filter((result): result is TestResult => Boolean(result))
      .slice(-12)

    if (!baselineReady || results.length < 3) {
      acc[capability] = reliabilityEmptyCapability(capability)
      return acc
    }

    const values = results.map((result) => result.normalizedScore)
    const mean = average(values)
    const deviation = standardDeviation(values)
    const variance = deviation * deviation
    const consistencyScore = clamp(round(100 - deviation * 6.2), 0, 100)
    const repeatability = ratingFromConsistency(consistencyScore)
    const confidence = clamp(round(results.reduce((sum, result) => sum + result.confidence, 0) / results.length), 1, 99)
    const recent = values.slice(-2)
    const baseline = values.slice(0, Math.max(3, values.length - 2))
    const baselineMean = average(baseline)
    const recentBelow = recent.length === 2 && recent.every((value) => value < baselineMean - Math.max(4, deviation * 1.35))
    const notes = conditionNotesForCapability(results)
    const conditionImpact = conditionImpactFromNotes(notes)
    const noisy = repeatability === 'Poor' || (repeatability === 'Fair' && conditionImpact !== 'Low')
    const likelyChanged = recentBelow && confidence >= 82 && !noisy

    acc[capability] = {
      capability,
      label: CAPABILITY_LABELS[capability],
      average: round(mean),
      standardDeviation: Math.round(deviation * 10) / 10,
      variance: Math.round(variance * 10) / 10,
      consistencyScore,
      repeatability,
      confidence,
      samples: results.length,
      varianceLabel: varianceLabelFromConsistency(consistencyScore),
      noisy,
      likelyChanged,
      conditionImpact,
      conditionNotes: notes.length ? notes : ['Testing conditions were similar across recent snapshots.'],
      message: noisy
        ? 'Potential measurement noise detected. Confirm under similar conditions before interpreting a score change.'
        : likelyChanged
          ? 'Multiple consistent measurements support a possible real change.'
          : 'Results are repeatable enough to prioritize stability over isolated score movement.',
    }
    return acc
  }, {} as Record<CapabilityId, CapabilityReliability>)

  const reliabilityItems = Object.values(capabilities)
  const overallScore = baselineReady
    ? round(reliabilityItems.reduce((sum, item) => sum + item.consistencyScore * CAPABILITY_WEIGHTS[item.capability], 0))
    : 0
  const overallConfidence = baselineReady
    ? round(reliabilityItems.reduce((sum, item) => sum + item.confidence * CAPABILITY_WEIGHTS[item.capability], 0))
    : 0
  const baselineStability = stableBaselineFrom(reliabilityItems, overallScore, baselineReady)
  const conditionWarnings = [...new Set(reliabilityItems.flatMap((item) => item.conditionNotes).filter((note) => !note.startsWith('Testing conditions')))]
  const likelyVisionChanged = reliabilityItems.some((item) => item.likelyChanged)
  const overallSnapshotReliability: SnapshotReliabilitySummary = {
    repeatability: ratingFromConsistency(overallScore),
    reliabilityScore: overallScore,
    confidence: overallConfidence,
    baselineStability,
    baselineReady,
    enoughDataForBaseline: baselineReady,
    message: baselineReady
      ? likelyVisionChanged
        ? 'A change is possible because repeated, high-confidence measurements moved together.'
        : 'Sightly is prioritizing stable, repeatable measurements over dramatic score movement.'
      : `Complete ${Math.max(0, 3 - completed.length)} more snapshot${3 - completed.length === 1 ? '' : 's'} before creating a baseline.`,
  }

  return {
    baselineReady,
    baselineStability,
    baselineSnapshotCount: Math.min(completed.length, 3),
    overallSnapshotReliability,
    capabilities,
    likelyVisionChanged,
    conditionWarnings,
    recommendation: likelyVisionChanged
      ? 'Retest under similar conditions and watch for consecutive high-confidence measurements before interpreting a trend.'
      : baselineReady
        ? 'Continue monthly snapshots under similar brightness, device, correction, and fatigue conditions.'
        : 'Complete 3 snapshots to establish a stable personal baseline.',
  }
}

export function calculateSnapshotStability(check: VisionCheck, previousChecks: VisionCheck[]): SnapshotStabilityMetrics {
  const previousScored = previousChecks.filter((item): item is VisionCheck & { score: number } => typeof item.score === 'number')
  const previous = previousScored.at(-1) ?? null
  const score = check.score ?? 0
  const snapshotToSnapshotVariance = previous ? Math.abs(score - previous.score) : null
  const confidenceTrend = previous ? check.confidence - previous.confidence : null
  const calibrationScores = [...previousScored, check]
    .slice(0, 3)
    .filter((item): item is VisionCheck & { score: number } => typeof item.score === 'number')
    .map((item) => item.score)
  const calibrationDeviation = calibrationScores.length >= 2 ? standardDeviation(calibrationScores) : null
  const calibrationConsistency = calibrationDeviation === null ? null : clamp(round(100 - calibrationDeviation * 7), 0, 100)
  const varianceScore = snapshotToSnapshotVariance === null ? 100 : clamp(round(100 - snapshotToSnapshotVariance * 8), 0, 100)
  const qualitySignals = [...new Set(check.testResults.flatMap((result) => result.qualitySignals ?? []))]
  const qualityPenalty = qualitySignals.length * 8
  const stabilityScore = clamp(round((varianceScore * 0.55) + ((calibrationConsistency ?? varianceScore) * 0.25) + (check.confidence * 0.2) - qualityPenalty), 0, 100)
  const repeatabilityConfidence = clamp(round((check.confidence * 0.58) + (stabilityScore * 0.42)), 1, 99)

  return {
    snapshotToSnapshotVariance,
    varianceScore,
    stabilityScore,
    confidenceTrend,
    calibrationConsistency,
    repeatabilityConfidence,
    qualitySignals,
  }
}

function strongestBelowRangeCapability(check: VisionCheck) {
  const below = check.explanation?.contributions
    .filter((item) => item.status === 'below')
    .sort((a, b) => Math.abs(a.points) === Math.abs(b.points) ? b.weight - a.weight : Math.abs(b.points) - Math.abs(a.points))
  return below?.[0] ?? null
}

function hasMeaningfulLongTermDecline(checks: VisionCheck[], typicalRange: TypicalRange | null) {
  const scored = checks.filter((check): check is VisionCheck & { score: number } => typeof check.score === 'number')
  if (!typicalRange || scored.length < 5) return false
  const recent = scored.slice(-5)
  const firstHalf = recent.slice(0, 2).reduce((sum, check) => sum + check.score, 0) / 2
  const lastHalf = recent.slice(-2).reduce((sum, check) => sum + check.score, 0) / 2
  const belowCount = recent.filter((check) => check.score < typicalRange.low).length
  return firstHalf - lastHalf >= 4 && belowCount >= 3
}

export function makeSnapshot(check: VisionCheck, typicalRange: TypicalRange | null, allChecks: VisionCheck[] = [], reliability: SnapshotReliabilitySummary | null = null): VisionSnapshot {
  const date = new Date(check.date)
  const monthLabel = date.toLocaleString('en-US', { month: 'short', day: 'numeric' })
  const score = check.score
  const primaryConditions = check.testResults[0]?.conditions ?? null
  const valueFor = (capability: CapabilityId) => check.testResults.find((result) => result.capability === capability)?.measuredValue ?? null
  const storedData = primaryConditions
    ? {
        timestamp: check.date,
        deviceModel: primaryConditions.deviceModel,
        screenSize: primaryConditions.screenSize,
        brightness: Math.round(primaryConditions.brightness * 100),
        batterySaver: primaryConditions.batterySaverMode,
        eyeFatigue: primaryConditions.eyeFatigue,
        visionCorrection: primaryConditions.visionCorrection,
        sharpness: valueFor('sharpness'),
        contrast: valueFor('contrast'),
        peripheral: valueFor('peripheralAwareness'),
        confidence: check.confidence,
      }
    : null
  const strongestBelow = strongestBelowRangeCapability(check)
  const observedCapability = strongestBelow?.label ?? null
  let message = 'Baseline in progress.'
  let recommendation = 'Complete three snapshots to unlock personal range interpretation.'
  let interpretationLevel: VisionSnapshot['interpretationLevel'] = 'baseline'
  let explanation = check.explanation?.summary ?? 'No capability explanation available yet.'

  if (score !== null && typicalRange) {
    const currentIndex = allChecks.findIndex((item) => item.id === check.id)
    const previousCheck = currentIndex > 0 ? allChecks[currentIndex - 1] : null
    const previousBelow = Boolean(previousCheck?.score !== null && previousCheck?.score !== undefined && previousCheck.score < typicalRange.low)
    const trendDetected = hasMeaningfulLongTermDecline(allChecks.slice(0, currentIndex + 1), typicalRange)
      && Boolean(reliability?.baselineReady)
      && (reliability?.confidence ?? 0) >= 82
      && (reliability?.reliabilityScore ?? 0) >= 68

    if (trendDetected && strongestBelow) {
      interpretationLevel = 'trend-detected'
      message = 'Vision Trend'
      explanation = 'Over the last 12 months, visual sharpness has gradually measured below your historical baseline.'
      recommendation = 'Focus on patterns. Not individual scores.'
    } else if (score < typicalRange.low && previousBelow && strongestBelow) {
      interpretationLevel = 'consecutive-below-range'
      message = 'Vision Score'
      explanation = `${strongestBelow.label} has measured below your typical range in 2 consecutive snapshots.`
      recommendation = 'Consider scheduling a professional eye exam if this trend continues.'
    } else if (score < typicalRange.low && strongestBelow) {
      interpretationLevel = 'single-below-range'
      message = 'Vision Score'
      explanation = `${strongestBelow.label} measured below your typical range.`
      recommendation = 'Retest in 7 days to confirm.'
    } else if (score > typicalRange.high) {
      interpretationLevel = 'above-range'
      message = 'Measured above your typical range.'
      recommendation = 'Continue your monthly snapshot rhythm.'
    } else {
      interpretationLevel = 'within-range'
      message = 'Measured within your typical range.'
      recommendation = 'Continue your monthly snapshot rhythm.'
    }
  }

  return {
    id: `snapshot-${check.id}`,
    monthLabel,
    date: check.date,
    score,
    confidence: check.confidence,
    measurementConfidence: check.measurementConfidence ?? check.confidence,
    message,
    recommendation,
    explanation,
    interpretationLevel,
    observedCapability,
    reliability,
    storedData,
  }
}

export function buildAnnualSummary(checks: VisionCheck[], typicalRange: TypicalRange | null): AnnualSummary | null {
  const scored = checks.filter((check) => check.score !== null) as Array<VisionCheck & { score: number }>
  if (scored.length < 3 || !typicalRange) return null

  const averageScore = round(scored.reduce((sum, check) => sum + check.score, 0) / scored.length)
  const monthGroups = new Map<string, number[]>()

  scored.forEach((check) => {
    const month = new Date(check.date).toLocaleString('en-US', { month: 'long' })
    monthGroups.set(month, [...(monthGroups.get(month) ?? []), check.score])
  })

  const variations = [...monthGroups.entries()].map(([month, scores]) => {
    const max = Math.max(...scores)
    const min = Math.min(...scores)
    return { month, variation: max - min }
  })

  const mostConsistentMonth = variations.reduce((best, current) =>
    current.variation < best.variation ? current : best,
  ).month
  const largestVariation = variations.reduce((best, current) =>
    current.variation > best.variation ? current : best,
  ).month

  return {
    year: new Date().getFullYear(),
    averageScore,
    checksCompleted: scored.length,
    typicalRange,
    mostConsistentMonth,
    largestVariation,
    notification: 'Your annual vision summary is ready.',
  }
}

export function confidenceFromConditions(base: number, lightingConfidence: number): number {
  return clamp(round(base * 0.65 + lightingConfidence * 0.35), 55, 99)
}
