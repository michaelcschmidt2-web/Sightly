import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

test('first-run onboarding is a premium three-card carousel before setup details', () => {
  assert.match(app, /function SightlyIntroExperience/)
  assert.match(app, /const introSlides = \[/)
  assert.match(app, /Sightly/)
  assert.match(app, /Build Your Vision Baseline/)
  assert.match(app, /Your Vision Journey Starts Here/)
  assert.match(app, /intro-carousel/)
  assert.match(app, /onTouchStart/)
  assert.match(app, /onTouchEnd/)
  assert.match(app, /setIntroComplete\(true\)/)
  assert.match(app, /setStep\(1\)/)
  assert.match(app, /if \(!introComplete \|\| effectiveAuthStage === 'intro'\)/)
})

test('intro copy explains purpose, baseline, and journey without adding setup text or exam language', () => {
  assert.match(app, /See what eyes miss\./)
  assert.match(app, /Vision often changes gradually enough that you don’t notice it happening\./)
  assert.match(app, /Sightly helps you track changes over time with simple vision snapshots\./)
  assert.match(app, /Sightly learns what is normal for you through a few quick snapshots\./)
  assert.match(app, /Track your vision over time with simple check-ins designed to help you notice gradual changes\./)
  assert.doesNotMatch(app.slice(app.indexOf('const introSlides'), app.indexOf('function FirstRunOnboarding')), /Create an account to begin building your baseline\./)
  assert.doesNotMatch(app.slice(app.indexOf('const introSlides'), app.indexOf('function FirstRunOnboarding')), /assessment|evaluation|diagnosis|exam-like/i)
})

test('first-run setup is consolidated into one profile screen and one baseline readiness screen', () => {
  const onboarding = app.slice(app.indexOf('function FirstRunOnboarding'), app.indexOf('const readinessChecklist'))
  assert.match(onboarding, /setStep\(1\)/)
  assert.match(onboarding, /Math\.min\(current \+ 1, 2\)/)
  assert.match(onboarding, /<p className="eyebrow">Profile Setup<\/p>/)
  assert.match(onboarding, /First name/)
  assert.match(onboarding, /Age range/)
  assert.match(onboarding, /Glasses \/ Contacts/)
  assert.match(onboarding, /Last eye exam/)
  assert.match(onboarding, /Vision correction today/)
  assert.match(onboarding, /<p className="eyebrow">Build Your Baseline<\/p>/)
  assert.match(onboarding, /Snapshot 1 of 3/)
  assert.match(onboarding, /Three snapshots help Sightly learn what is normal for you\./)
  assert.match(onboarding, /Start First Snapshot/)
  assert.doesNotMatch(onboarding, /step === 3|step === 4|Begin Snapshot/)
})

test('onboarding readiness begins the first snapshot instead of remounting setup', () => {
  assert.match(app, /const introCompleted = state\.onboarded \|\| loadOnboardingDraft\(\)\?\.introComplete === true/)
  assert.match(app, /function initializeSnapshot\(readiness: SnapshotReadiness\)/)
  assert.match(app, /function prepareSnapshotReadiness/)
  assert.match(app, /initializeSnapshot\(prepareSnapshotReadiness\(\{\s*eyeFatigue: 'normal',[\s\S]*visionCorrection: profile\.usualCorrectionToday,[\s\S]*armLengthConfirmed: true,/)
  assert.doesNotMatch(app.slice(app.indexOf('function completeOnboarding'), app.indexOf('function startCheck')), /setShowSnapshotPrep\(true\)/)
})

test('visual sharpness starts on the first target with compact inline instructions', () => {
  const sharpness = app.slice(app.indexOf('function SharpnessThresholdTest'), app.indexOf('function formatExamRange'))
  assert.match(sharpness, /useState\(true\)/)
  assert.match(sharpness, /Hold phone at arm’s length\./)
  assert.match(sharpness, /Type the 6 letters you see\./)
  assert.match(sharpness, /You can use dictation if typing is difficult\./)
  assert.doesNotMatch(sharpness, /Before you start|Begin sharpness check/)
})

test('third slide carries explicit email and guest account actions as large native-feeling buttons', () => {
  assert.match(app, /const authActions/)
  assert.match(app, /Continue with Email/)
  assert.match(app, /Continue as Guest/)
  assert.doesNotMatch(app, /Continue with Apple/)
  assert.doesNotMatch(app, /Continue with Google/)
  assert.match(app, /intro-auth-actions/)
})

test('email auth path is explicit and does not silently continue as guest', () => {
  const onboarding = app.slice(app.indexOf('function FirstRunOnboarding'), app.indexOf('const readinessChecklist'))
  assert.match(onboarding, /authStage/)
  assert.match(onboarding, /Create your Sightly account/)
  assert.match(onboarding, /Use your email to save snapshots and feedback across devices\./)
  assert.match(onboarding, /Email address/)
  assert.match(onboarding, /Send Sign-In Link/)
  assert.match(onboarding, /Check your email/)
  assert.match(onboarding, /We sent a sign-in link to/)
  assert.match(onboarding, /Email sign-in is unavailable right now\. You can continue as guest\./)
  assert.match(onboarding, /beginGuestOnboarding/)
  assert.match(onboarding, /sendEmailLink/)
  assert.match(onboarding, /signInWithEmail/)
  assert.doesNotMatch(onboarding.slice(onboarding.indexOf('async function sendEmailLink'), onboarding.indexOf('function completeSetup')), /getOrCreateGuestId/)
})

test('carousel includes liquid-glass visuals, paging, safe-area layout, and compact phone guards', () => {
  assert.match(css, /\.intro-carousel/)
  assert.match(css, /\.intro-slide-card/)
  assert.match(css, /\.intro-orb/)
  assert.match(css, /\.milestone-card/)
  assert.match(css, /\.timeline-card/)
  assert.match(css, /env\(safe-area-inset-top\)/)
  assert.match(css, /@media \(max-height: 780px\)/)
  assert.match(css, /@keyframes introOrbFloat/)
  assert.match(css, /@keyframes introOrbTurn/)
  assert.match(css, /@keyframes ambientGlassDrift/)
  assert.match(css, /@keyframes journeyFade/)
})
