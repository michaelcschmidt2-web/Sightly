import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

test('mobile beta keeps all primary touch targets at iPhone-friendly size', () => {
  assert.match(css, /\.glass-button[\s\S]*min-height:\s*52px/)
  assert.match(css, /\.text-button[\s\S]*min-height:\s*44px/)
  assert.match(css, /\.setup-grid button, \.setup-list button[\s\S]*min-height:\s*48px/)
  assert.match(css, /\.choice-grid button[\s\S]*min-height:\s*48px/)
  assert.match(css, /\.bottom-nav button[\s\S]*min-height:\s*52px/)
})

test('small iPhone screens have compact, scroll-safe test layouts', () => {
  assert.match(css, /@media \(max-height:\s*700px\)/)
  assert.match(css, /\.test-screen[\s\S]*padding-bottom:\s*16px/)
  assert.match(css, /\.sharpness-row-stage[\s\S]*min-height:\s*190px/)
  assert.match(css, /\.contrast-stage\.glass-card[\s\S]*min-height:\s*214px/)
  assert.match(css, /\.peripheral-stage[\s\S]*min-height:\s*260px/)
})

test('sharpness input is configured for mobile keyboards without zoom or autocorrect friction', () => {
  assert.match(app, /enterKeyHint="done"/)
  assert.match(app, /spellCheck=\{false\}/)
  assert.match(css, /\.sharpness-answer input[\s\S]*font-size:\s*max\(18px, 26px\)/)
})

test('sharpness letter row uses per-row inline font size without mobile clamp override', () => {
  assert.match(app, /const sharpnessFontSizes = \[36, 30, 24, 20, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4\]/)
  assert.match(app, /style=\{\{ fontSize: `\$\{fontSize\}px` \}\}/)
  assert.match(app, /data-intended-font-size=\{`\$\{fontSize\}px`\}/)
  assert.match(app, /getComputedStyle\(target\)\.fontSize/)
  assert.match(app, /Debug · row \{rowIndex \+ 1\} · intended \{fontSize\}px · computed \{debugFontSize\}/)
  const letterRowBlocks = css.match(/\.letter-row\s*\{[\s\S]*?\}/g) ?? []
  assert.ok(letterRowBlocks.length > 0)
  for (const block of letterRowBlocks) {
    assert.doesNotMatch(block, /font-size\s*:/)
    assert.doesNotMatch(block, /clamp\(/)
    assert.doesNotMatch(block, /!important/)
    assert.doesNotMatch(block, /scale\(/)
  }
  assert.match(css, /\.letter-row\s*\{[\s\S]*font-optical-sizing:\s*none/)
  assert.match(css, /\.letter-row\s*\{[\s\S]*font-size-adjust:\s*none/)
  assert.match(css, /\.letter-row\s*\{[\s\S]*block-size:\s*1em/)
})

test('contrast test uses a flat high-readability field and no cramped directional pad on mobile', () => {
  assert.match(css, /\.contrast-screen[\s\S]*background:\s*#f7f8fb/)
  assert.match(css, /\.landolt-ring[\s\S]*width:\s*clamp\(96px, 30vw, 118px\)/)
  assert.match(css, /@media \(max-width:\s*380px\)[\s\S]*\.direction-pad[\s\S]*gap:\s*8px/)
  assert.match(css, /@media \(max-width:\s*380px\)[\s\S]*\.direction-pad \.direction[\s\S]*min-height:\s*52px/)
})

test('contrast stimulus stays isolated below HUD labels for all Landolt orientations', () => {
  assert.match(app, /const contrastDirections: ContrastDirection\[\] = \['top', 'right', 'bottom', 'left'\]/)
  assert.match(app, /className="contrast-hud"/)
  assert.match(app, /className="contrast-stimulus-layer"/)
  assert.match(app, /className=\{`landolt-ring gap-\$\{direction\}`\}/)
  assert.match(css, /\.contrast-stage\.glass-card\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0, 1fr\)/)
  assert.match(css, /\.contrast-stage\.glass-card\s*\{[\s\S]*isolation:\s*isolate/)
  assert.match(css, /\.contrast-hud\s*\{[\s\S]*z-index:\s*3/)
  assert.match(css, /\.contrast-stimulus-layer\s*\{[\s\S]*box-sizing:\s*border-box/)
  assert.match(css, /\.contrast-stimulus-layer\s*\{[\s\S]*z-index:\s*1/)
  assert.match(css, /\.contrast-stimulus-layer\s*\{[\s\S]*inline-size:\s*100%/)
  assert.match(css, /\.contrast-stimulus-layer\s*\{[\s\S]*max-inline-size:\s*100%/)
  assert.match(css, /\.contrast-stimulus-layer\s*\{[\s\S]*display:\s*grid/)
  assert.match(css, /\.contrast-stimulus-layer\s*\{[\s\S]*place-items:\s*center/)
  assert.match(css, /\.contrast-stimulus-layer\s*\{[\s\S]*overflow:\s*hidden/)
  assert.match(css, /\.contrast-stimulus-layer\s*\{[\s\S]*padding:\s*32px clamp\(30px, 10%, 44px\)/)
  assert.match(css, /\.contrast-stimulus-layer\s*\{[\s\S]*min-height:\s*clamp\(150px, 24svh, 190px\)/)
  assert.match(css, /\.landolt-ring\s*\{[\s\S]*z-index:\s*1/)
  assert.match(css, /\.landolt-ring\.gap-top::after/)
  assert.match(css, /\.landolt-ring\.gap-right::after/)
  assert.match(css, /\.landolt-ring\.gap-bottom::after/)
  assert.match(css, /\.landolt-ring\.gap-left::after/)
  assert.doesNotMatch(css, /Final Dan feedback override[\s\S]*min-height:\s*clamp\(92px, 18svh, 132px\)/)
})

test('beta feedback placeholder asks whether the result was believable without submitting externally', () => {
  assert.match(app, /function BetaFeedbackCard/)
  assert.match(app, /Was this result believable\?/)
  assert.match(app, /\[1, 2, 3, 4, 5\]/)
  assert.match(app, /Optional feedback/)
  assert.doesNotMatch(app, /fetch\(|mailto:|https:\/\//)
})

test('mobile UI avoids red alarm treatment in beta surfaces', () => {
  assert.doesNotMatch(css, /#[a-fA-F0-9]{6}[^\n]*(red|danger|error)/)
  assert.doesNotMatch(css, /rgb\(\s*255\s*,\s*0\s*,\s*0\s*\)/)
  assert.doesNotMatch(css, /\b(alert|error|danger)-red\b/)
})

test('selected states use shared neutral glass with behind-button amber aura and reduced-motion support', () => {
  assert.match(css, /--selected-amber:\s*rgba\(245, 166, 72, 0\.38\)/)
  assert.match(css, /\.is-selected,\s*\n\.option-selected,\s*\n\.btn-selected/)
  assert.match(css, /button\.selected[\s\S]*background:\s*rgba\(255,255,255,\.48\)/)
  assert.match(css, /button\.selected[\s\S]*box-shadow:[\s\S]*rgba\(245, 166, 72, \.16\)/)
  assert.match(css, /button\.selected::before[\s\S]*inset:\s*-8px/)
  assert.match(css, /button\.selected::before[\s\S]*filter:\s*blur\(12px\)/)
  assert.match(css, /button\.selected::before[\s\S]*animation:\s*selectedAuraDrift 9s ease-in-out infinite alternate/)
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*button\.selected::before[\s\S]*animation:\s*none/)
  assert.doesNotMatch(css, /button\.selected[\s\S]{0,260}rgba\(255,246,228/)
  assert.doesNotMatch(css, /button\.selected[\s\S]{0,260}rgba\(236, 174, 79, \.5\)/)
  assert.match(css, /\.contrast-answer-grid \.direction:active[\s\S]*background:\s*rgba\(255,255,255,\.5\)/)
})
