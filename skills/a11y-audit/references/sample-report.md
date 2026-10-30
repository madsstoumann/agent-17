# Accessibility audit: shop.example.dk

**Site:** https://shop.example.dk/ · **Standard:** WCAG 2.2 AA, EN 301 549 v3.2.1 · **Date:** 2026-10-30 · **Engines:** axe-core 4.14.0, HTML_CodeSniffer 2.5.1 (Pa11y's default engine), keyboard walk, reflow · a11y-audit 1.0.0

**Result:** 7 criteria failed, 7 issues (1 blocker, 5 high, 1 medium), 2 to review, 1 page

**Verdict:** Not conformant: a keyboard user can get stuck. Fix the blocker first.

> Automated checks find roughly a third of WCAG problems. "No automated failures" is not conformance: the manual checks at the end decide that.

## Issues

| # | Severity | Issue | WCAG | EN 301 549 | Pages | Elements |
|---|---|---|---|---|---|---|
| A1 | Blocker | Keyboard focus gets stuck | 2.1.2 | 9.2.1.2 | 1 | 3 |
| A2 | High | All touch targets must be 24px large, or leave sufficient space | 2.5.8 | – | 1 | 3 |
| A3 | High | Elements must meet minimum color contrast ratio thresholds | 1.4.3 | 9.1.4.3 | 1 | 1 |
| A4 | High | <html> element must have a lang attribute | 3.1.1 | 9.3.1.1 | 1 | 1 |
| A5 | High | Images must have alternative text | 1.1.1 | 9.1.1.1 | 1 | 1 |
| A6 | High | No visible focus indicator | 2.4.7 | 9.2.4.7 | 1 | 1 |
| A7 | Medium | Content scrolls sideways at 320 px width | 1.4.10 | 9.1.4.10 | 1 | 1 |

### A1. Keyboard focus gets stuck

**Blocker** · 2.1.2 No Keyboard Trap (A) · EN 301 549 9.2.1.2 · found by keyboard (`keyboard-trap`)

Tab cycles between 3 elements and never leaves them; Escape does not release it.

**Fix:** Find the script that moves focus back (a focus-trap library, a carousel or a menu that is not open) and only trap focus inside an open modal, releasing it on Escape and on close.

**Pages (1):** https://shop.example.dk/

**Examples:**

- `#t1`: "One"
  `<button id="t1">One</button>`
- `#t2`: "Two"
  `<button id="t2">Two</button>`
- `#t3`: "Three"
  `<button id="t3">Three</button>`

### A2. All touch targets must be 24px large, or leave sufficient space

**High** (axe impact: serious) · 2.5.8 Target Size (Minimum) (AA) · found by axe-core (`target-size`)

Ensure touch targets have sufficient size and space

**Fix:** Make touch targets at least 24×24 CSS px, or space them so a 24px circle around each does not overlap its neighbours. ([rule](https://dequeuniversity.com/rules/axe/4.14/target-size?application=axeAPI))

**Pages (1):** https://shop.example.dk/

**Examples:**

- `#t1`: Target has insufficient size (41.2px by 21px, should be at least 24px by 24px) / Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 21px instead of at least 24px.
  `<button id="t1">One</button>`
- `#t2`: Target has insufficient size (40.5px by 21px, should be at least 24px by 24px) / Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 21px instead of at least 24px.
  `<button id="t2">Two</button>`
- `a[href$="after"]`: Target has insufficient size (86.2px by 17px, should be at least 24px by 24px) / Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 17px instead of at least 24px.
  `<a href="/after">After the trap</a>`

### A3. Elements must meet minimum color contrast ratio thresholds

**High** (axe impact: serious) · 1.4.3 Contrast (Minimum) (AA) · EN 301 549 9.1.4.3 · found by axe-core (`color-contrast`)

Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

**Fix:** Raise the contrast of the listed text to at least 4.5:1 (3:1 for 24px+ or 19px+ bold text). Fix it in the design tokens or the shared CSS rather than per element, and check hover, focus and disabled states too. ([rule](https://dequeuniversity.com/rules/axe/4.14/color-contrast?application=axeAPI))

**Pages (1):** https://shop.example.dk/

**Examples:**

- `p`: Element has insufficient color contrast of 1.91 (foreground color: #bbbbbb, background color: #ffffff, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1
  `<p class="faint">Low contrast text</p>`

### A4. <html> element must have a lang attribute

**High** (axe impact: serious) · 3.1.1 Language of Page (A) · EN 301 549 9.3.1.1 · found by axe-core (`html-has-lang`)

Ensure every HTML document has a lang attribute

**Fix:** Set lang on <html> to the page language (lang="da", lang="en"). ([rule](https://dequeuniversity.com/rules/axe/4.14/html-has-lang?application=axeAPI))

**Pages (1):** https://shop.example.dk/

**Examples:**

- `html`: The <html> element does not have a lang attribute
  `<html>`

### A5. Images must have alternative text

**High** (axe impact: critical) · 1.1.1 Non-text Content (A) · EN 301 549 9.1.1.1 · found by axe-core (`image-alt`)

Ensure <img> elements have alternative text or a role of none or presentation

**Fix:** Give each image an alt that says what it shows or does; decorative images get alt="". Check that CMS image fields require alt text. ([rule](https://dequeuniversity.com/rules/axe/4.14/image-alt?application=axeAPI))

**Pages (1):** https://shop.example.dk/

**Examples:**

- `img`: Element does not have an alt attribute / aria-label attribute does not exist or is empty / aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty
  `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`

### A6. No visible focus indicator

**High** · 2.4.7 Focus Visible (AA) · EN 301 549 9.2.4.7 · found by keyboard (`focus-not-visible`)

These elements look the same focused as unfocused: no outline, shadow, border or colour change.

**Fix:** Remove outline: none / outline: 0 without a replacement, and add a :focus-visible style (for example outline: 2px solid currentColor; outline-offset: 2px) in the shared CSS.

**Pages (1):** https://shop.example.dk/

**Examples:**

- `html > body > main > button.plain`: "No focus style"
  `<button class="plain">No focus style</button>`

### A7. Content scrolls sideways at 320 px width

**Medium** · 1.4.10 Reflow (AA) · EN 301 549 9.1.4.10 · found by layout (`reflow-320`)

At 320 CSS px (400% zoom on a 1280 px screen) the page is 608px wide.

**Fix:** Find the fixed-width or non-wrapping elements listed (min-width, white-space: nowrap, wide images, 100vw plus padding) and let them shrink or wrap; tables and code may scroll inside their own container.

**Pages (1):** https://shop.example.dk/

**Examples:**

- `html > body > main > div.wide:nth-of-type(1)`: 600px wide, ends at 608px

## Keyboard

| Page | Tab stops | Ends | Skip link | No focus style | Hidden | Covered |
|---|---|---|---|---|---|---|
| https://shop.example.dk/ | 5 of ~6 | **Trapped** | No | 1 | 0 | 0 |

The walk presses Tab from the top of the page with no mouse, like a keyboard user, and records every stop. "No focus style" compares each element focused and blurred; check those in a browser, since a style that only changes on `:focus-visible` for real keyboard input can be missed.

## Reflow and text spacing

| Page | Width at 320 px | Clipped with text spacing |
|---|---|---|
| https://shop.example.dk/ | **608px** (scrolls sideways) | 0 |

## Needs review

| Item | WCAG | Pages | Why |
|---|---|---|---|
| First Tab stop is not a skip link | 2.4.1 | 1 | landmarks can satisfy 2.4.1, but a skip link is what keyboard users expect |
| No link to an accessibility statement on the start page | – | 1 | required for Danish public bodies (was.digst.dk) and expected under the European Accessibility Act |

## WCAG 2.2 AA criteria

EN 301 549 v3.2.1 clause 9 is WCAG 2.1 A and AA for web pages, so criteria new in 2.2 have no EN clause yet. "Manual check" means no automated rule covers the criterion.

| Criterion | Level | EN 301 549 | Status | Issues |
|---|---|---|---|---|
| [1.1.1 Non-text Content](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content) | A | 9.1.1.1 | **Fails** | A5 |
| [1.2.1 Audio-only and Video-only (Prerecorded)](https://www.w3.org/WAI/WCAG22/Understanding/audio-only-and-video-only-prerecorded) | A | 9.1.2.1 | No automated failures |  |
| [1.2.2 Captions (Prerecorded)](https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded) | A | 9.1.2.2 | No automated failures |  |
| [1.2.3 Audio Description or Media Alternative (Prerecorded)](https://www.w3.org/WAI/WCAG22/Understanding/audio-description-or-media-alternative-prerecorded) | A | 9.1.2.3 | Manual check |  |
| [1.2.4 Captions (Live)](https://www.w3.org/WAI/WCAG22/Understanding/captions-live) | AA | 9.1.2.4 | Manual check |  |
| [1.2.5 Audio Description (Prerecorded)](https://www.w3.org/WAI/WCAG22/Understanding/audio-description-prerecorded) | AA | 9.1.2.5 | Manual check |  |
| [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships) | A | 9.1.3.1 | No automated failures |  |
| [1.3.2 Meaningful Sequence](https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence) | A | 9.1.3.2 | Manual check |  |
| [1.3.3 Sensory Characteristics](https://www.w3.org/WAI/WCAG22/Understanding/sensory-characteristics) | A | 9.1.3.3 | Manual check |  |
| [1.3.4 Orientation](https://www.w3.org/WAI/WCAG22/Understanding/orientation) | AA | 9.1.3.4 | No automated failures |  |
| [1.3.5 Identify Input Purpose](https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose) | AA | 9.1.3.5 | No automated failures |  |
| [1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color) | A | 9.1.4.1 | No automated failures |  |
| [1.4.2 Audio Control](https://www.w3.org/WAI/WCAG22/Understanding/audio-control) | A | 9.1.4.2 | No automated failures |  |
| [1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) | AA | 9.1.4.3 | **Fails** | A3 |
| [1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text) | AA | 9.1.4.4 | No automated failures |  |
| [1.4.5 Images of Text](https://www.w3.org/WAI/WCAG22/Understanding/images-of-text) | AA | 9.1.4.5 | Manual check |  |
| [1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow) | AA | 9.1.4.10 | **Fails** | A7 |
| [1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast) | AA | 9.1.4.11 | Manual check |  |
| [1.4.12 Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing) | AA | 9.1.4.12 | No automated failures |  |
| [1.4.13 Content on Hover or Focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus) | AA | 9.1.4.13 | Manual check |  |
| [2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard) | A | 9.2.1.1 | No automated failures |  |
| [2.1.2 No Keyboard Trap](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap) | A | 9.2.1.2 | **Fails** | A1 |
| [2.1.4 Character Key Shortcuts](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts) | A | 9.2.1.4 | Manual check |  |
| [2.2.1 Timing Adjustable](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable) | A | 9.2.2.1 | No automated failures |  |
| [2.2.2 Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide) | A | 9.2.2.2 | No automated failures |  |
| [2.3.1 Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold) | A | 9.2.3.1 | Manual check |  |
| [2.4.1 Bypass Blocks](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks) | A | 9.2.4.1 | Review |  |
| [2.4.2 Page Titled](https://www.w3.org/WAI/WCAG22/Understanding/page-titled) | A | 9.2.4.2 | No automated failures |  |
| [2.4.3 Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order) | A | 9.2.4.3 | Manual check |  |
| [2.4.4 Link Purpose (In Context)](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context) | A | 9.2.4.4 | No automated failures |  |
| [2.4.5 Multiple Ways](https://www.w3.org/WAI/WCAG22/Understanding/multiple-ways) | AA | 9.2.4.5 | Manual check |  |
| [2.4.6 Headings and Labels](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels) | AA | 9.2.4.6 | Manual check |  |
| [2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible) | AA | 9.2.4.7 | **Fails** | A6 |
| [2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum) | AA | – | No automated failures |  |
| [2.5.1 Pointer Gestures](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures) | A | 9.2.5.1 | Manual check |  |
| [2.5.2 Pointer Cancellation](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation) | A | 9.2.5.2 | Manual check |  |
| [2.5.3 Label in Name](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name) | A | 9.2.5.3 | No automated failures |  |
| [2.5.4 Motion Actuation](https://www.w3.org/WAI/WCAG22/Understanding/motion-actuation) | A | 9.2.5.4 | Manual check |  |
| [2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements) | AA | – | Manual check |  |
| [2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) | AA | – | **Fails** | A2 |
| [3.1.1 Language of Page](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page) | A | 9.3.1.1 | **Fails** | A4 |
| [3.1.2 Language of Parts](https://www.w3.org/WAI/WCAG22/Understanding/language-of-parts) | AA | 9.3.1.2 | No automated failures |  |
| [3.2.1 On Focus](https://www.w3.org/WAI/WCAG22/Understanding/on-focus) | A | 9.3.2.1 | Manual check |  |
| [3.2.2 On Input](https://www.w3.org/WAI/WCAG22/Understanding/on-input) | A | 9.3.2.2 | Manual check |  |
| [3.2.3 Consistent Navigation](https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation) | AA | 9.3.2.3 | Manual check |  |
| [3.2.4 Consistent Identification](https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification) | AA | 9.3.2.4 | Manual check |  |
| [3.2.6 Consistent Help](https://www.w3.org/WAI/WCAG22/Understanding/consistent-help) | A | – | Manual check |  |
| [3.3.1 Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification) | A | 9.3.3.1 | Manual check |  |
| [3.3.2 Labels or Instructions](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions) | A | 9.3.3.2 | No automated failures |  |
| [3.3.3 Error Suggestion](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion) | AA | 9.3.3.3 | Manual check |  |
| [3.3.4 Error Prevention (Legal, Financial, Data)](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data) | AA | 9.3.3.4 | Manual check |  |
| [3.3.7 Redundant Entry](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry) | A | – | Manual check |  |
| [3.3.8 Accessible Authentication (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum) | AA | – | Manual check |  |
| [4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value) | A | 9.4.1.2 | No automated failures |  |
| [4.1.3 Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages) | AA | 9.4.1.3 | Manual check |  |

## Manual checks

Automated rules cannot judge these. Do them on the start page, one content page, one form and the main user flow (search, checkout, sign-up) before claiming conformance.

- **Screen reader** (VoiceOver on macOS and iOS, NVDA on Windows, TalkBack on Android): headings outline the page, links and buttons make sense out of context, images are described the way a sighted reader would understand them, form errors are announced. 1.1.1, 1.3.1, 2.4.4, 2.4.6, 4.1.2, 4.1.3.
- **Keyboard through the flows**: every action works with Tab, Shift+Tab, Enter, Space, arrows and Escape; menus, dialogs, accordions and carousels open, close and return focus where they came from; nothing appears only on hover. 2.1.1, 2.4.3, 1.4.13, 3.2.1.
- **Forms**: visible labels, required fields marked in text, errors described in text next to the field and in a summary, nothing lost on error, no re-entering data already given, login without a memory or puzzle test (allow paste and password managers). 3.3.1–3.3.4, 3.3.7, 3.3.8.
- **Zoom to 200 % and 400 %** in a real browser: text grows, nothing is cut off or overlaps, no sideways scroll at 400 %. 1.4.4, 1.4.10.
- **Contrast in every state**: hover, focus, active, disabled, placeholder, text on images and gradients, and the focus outline itself against its background (3:1). Automated contrast checks only see the resting state over flat colours. 1.4.3, 1.4.11.
- **Colour alone**: links in body text are underlined or otherwise marked, errors and status do not rely on red and green. 1.4.1.
- **Media**: captions on video with speech, a transcript for audio, audio description or a text alternative where the picture carries information, no autoplaying sound. 1.2.x, 1.4.2.
- **Motion**: carousels and animations can be paused, nothing flashes more than three times a second, motion stops with "reduce motion" on. 2.2.2, 2.3.1, 2.3.3.
- **Pointer**: drag-only actions (sliders, sortable lists, maps) also work with single clicks; actions fire on release, not press. 2.5.1, 2.5.2, 2.5.7.
- **Consistency**: navigation, search and the help or contact link sit in the same place on every page. 3.2.3, 3.2.4, 3.2.6.
- **Time limits**: session timeouts warn and can be extended. 2.2.1.
- **Language of parts**: passages in another language carry `lang`. 3.1.2.
- **Accessibility statement**: Danish public bodies publish one through Digitaliseringsstyrelsen's WAS-Tool (was.digst.dk) and link it from every page; businesses covered by the European Accessibility Act (in force since 28 June 2025) describe how the service meets the requirements.

## Pages

| Page | Status | axe | HTML_CodeSniffer errors |
|---|---|---|---|
| https://shop.example.dk/ | 200 | 6 in 4 rules | 3 |
