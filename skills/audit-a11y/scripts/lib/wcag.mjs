// WCAG 2.2 success criteria with their level and the WCAG version that added them, and the
// matching EN 301 549 clause. EN 301 549 v3.2.1 (the standard the EU Web Accessibility Directive
// and the European Accessibility Act point to) takes WCAG 2.1 A and AA as clause 9.x.y.z for web
// pages, so criteria new in WCAG 2.2 have no EN clause yet.

// [sc, name, level, added]
const LIST = [
  ['1.1.1', 'Non-text Content', 'A', '2.0'],
  ['1.2.1', 'Audio-only and Video-only (Prerecorded)', 'A', '2.0'],
  ['1.2.2', 'Captions (Prerecorded)', 'A', '2.0'],
  ['1.2.3', 'Audio Description or Media Alternative (Prerecorded)', 'A', '2.0'],
  ['1.2.4', 'Captions (Live)', 'AA', '2.0'],
  ['1.2.5', 'Audio Description (Prerecorded)', 'AA', '2.0'],
  ['1.2.6', 'Sign Language (Prerecorded)', 'AAA', '2.0'],
  ['1.2.7', 'Extended Audio Description (Prerecorded)', 'AAA', '2.0'],
  ['1.2.8', 'Media Alternative (Prerecorded)', 'AAA', '2.0'],
  ['1.2.9', 'Audio-only (Live)', 'AAA', '2.0'],
  ['1.3.1', 'Info and Relationships', 'A', '2.0'],
  ['1.3.2', 'Meaningful Sequence', 'A', '2.0'],
  ['1.3.3', 'Sensory Characteristics', 'A', '2.0'],
  ['1.3.4', 'Orientation', 'AA', '2.1'],
  ['1.3.5', 'Identify Input Purpose', 'AA', '2.1'],
  ['1.3.6', 'Identify Purpose', 'AAA', '2.1'],
  ['1.4.1', 'Use of Color', 'A', '2.0'],
  ['1.4.2', 'Audio Control', 'A', '2.0'],
  ['1.4.3', 'Contrast (Minimum)', 'AA', '2.0'],
  ['1.4.4', 'Resize Text', 'AA', '2.0'],
  ['1.4.5', 'Images of Text', 'AA', '2.0'],
  ['1.4.6', 'Contrast (Enhanced)', 'AAA', '2.0'],
  ['1.4.7', 'Low or No Background Audio', 'AAA', '2.0'],
  ['1.4.8', 'Visual Presentation', 'AAA', '2.0'],
  ['1.4.9', 'Images of Text (No Exception)', 'AAA', '2.0'],
  ['1.4.10', 'Reflow', 'AA', '2.1'],
  ['1.4.11', 'Non-text Contrast', 'AA', '2.1'],
  ['1.4.12', 'Text Spacing', 'AA', '2.1'],
  ['1.4.13', 'Content on Hover or Focus', 'AA', '2.1'],
  ['2.1.1', 'Keyboard', 'A', '2.0'],
  ['2.1.2', 'No Keyboard Trap', 'A', '2.0'],
  ['2.1.3', 'Keyboard (No Exception)', 'AAA', '2.0'],
  ['2.1.4', 'Character Key Shortcuts', 'A', '2.1'],
  ['2.2.1', 'Timing Adjustable', 'A', '2.0'],
  ['2.2.2', 'Pause, Stop, Hide', 'A', '2.0'],
  ['2.2.3', 'No Timing', 'AAA', '2.0'],
  ['2.2.4', 'Interruptions', 'AAA', '2.0'],
  ['2.2.5', 'Re-authenticating', 'AAA', '2.0'],
  ['2.2.6', 'Timeouts', 'AAA', '2.1'],
  ['2.3.1', 'Three Flashes or Below Threshold', 'A', '2.0'],
  ['2.3.2', 'Three Flashes', 'AAA', '2.0'],
  ['2.3.3', 'Animation from Interactions', 'AAA', '2.1'],
  ['2.4.1', 'Bypass Blocks', 'A', '2.0'],
  ['2.4.2', 'Page Titled', 'A', '2.0'],
  ['2.4.3', 'Focus Order', 'A', '2.0'],
  ['2.4.4', 'Link Purpose (In Context)', 'A', '2.0'],
  ['2.4.5', 'Multiple Ways', 'AA', '2.0'],
  ['2.4.6', 'Headings and Labels', 'AA', '2.0'],
  ['2.4.7', 'Focus Visible', 'AA', '2.0'],
  ['2.4.8', 'Location', 'AAA', '2.0'],
  ['2.4.9', 'Link Purpose (Link Only)', 'AAA', '2.0'],
  ['2.4.10', 'Section Headings', 'AAA', '2.0'],
  ['2.4.11', 'Focus Not Obscured (Minimum)', 'AA', '2.2'],
  ['2.4.12', 'Focus Not Obscured (Enhanced)', 'AAA', '2.2'],
  ['2.4.13', 'Focus Appearance', 'AAA', '2.2'],
  ['2.5.1', 'Pointer Gestures', 'A', '2.1'],
  ['2.5.2', 'Pointer Cancellation', 'A', '2.1'],
  ['2.5.3', 'Label in Name', 'A', '2.1'],
  ['2.5.4', 'Motion Actuation', 'A', '2.1'],
  ['2.5.5', 'Target Size (Enhanced)', 'AAA', '2.1'],
  ['2.5.6', 'Concurrent Input Mechanisms', 'AAA', '2.1'],
  ['2.5.7', 'Dragging Movements', 'AA', '2.2'],
  ['2.5.8', 'Target Size (Minimum)', 'AA', '2.2'],
  ['3.1.1', 'Language of Page', 'A', '2.0'],
  ['3.1.2', 'Language of Parts', 'AA', '2.0'],
  ['3.1.3', 'Unusual Words', 'AAA', '2.0'],
  ['3.1.4', 'Abbreviations', 'AAA', '2.0'],
  ['3.1.5', 'Reading Level', 'AAA', '2.0'],
  ['3.1.6', 'Pronunciation', 'AAA', '2.0'],
  ['3.2.1', 'On Focus', 'A', '2.0'],
  ['3.2.2', 'On Input', 'A', '2.0'],
  ['3.2.3', 'Consistent Navigation', 'AA', '2.0'],
  ['3.2.4', 'Consistent Identification', 'AA', '2.0'],
  ['3.2.5', 'Change on Request', 'AAA', '2.0'],
  ['3.2.6', 'Consistent Help', 'A', '2.2'],
  ['3.3.1', 'Error Identification', 'A', '2.0'],
  ['3.3.2', 'Labels or Instructions', 'A', '2.0'],
  ['3.3.3', 'Error Suggestion', 'AA', '2.0'],
  ['3.3.4', 'Error Prevention (Legal, Financial, Data)', 'AA', '2.0'],
  ['3.3.5', 'Help', 'AAA', '2.0'],
  ['3.3.6', 'Error Prevention (All)', 'AAA', '2.0'],
  ['3.3.7', 'Redundant Entry', 'A', '2.2'],
  ['3.3.8', 'Accessible Authentication (Minimum)', 'AA', '2.2'],
  ['3.3.9', 'Accessible Authentication (Enhanced)', 'AAA', '2.2'],
  ['4.1.1', 'Parsing (obsolete in WCAG 2.2)', 'A', '2.0'],
  ['4.1.2', 'Name, Role, Value', 'A', '2.0'],
  ['4.1.3', 'Status Messages', 'AA', '2.1'],
];

export const CRITERIA = Object.fromEntries(LIST.map(([sc, name, level, added]) => [sc, { sc, name, level, added }]));
const LEVELS = ['A', 'AA', 'AAA'];

/** Criteria a target level covers, in document order: `AA` means A and AA. */
export const criteriaFor = (level = 'AA') => LIST.filter(([sc, , l]) => sc !== '4.1.1' && LEVELS.indexOf(l) <= LEVELS.indexOf(level)).map(([sc]) => CRITERIA[sc]);

/** EN 301 549 v3.2.1 clause for a web criterion, or null (AAA, or new in WCAG 2.2). */
export function enClause(sc) {
  const c = CRITERIA[sc];
  if (!c || c.level === 'AAA' || c.added === '2.2') return null;
  return `9.${sc}`;
}

/** axe tags ("wcag143", "wcag1410") -> ["1.4.3", "1.4.10"]. */
export function scFromAxeTags(tags = []) {
  const out = [];
  for (const t of tags) {
    const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(t);
    if (m) {
      const sc = `${m[1]}.${m[2]}.${m[3]}`;
      if (!out.includes(sc)) out.push(sc);
    }
  }
  return out;
}

/** HTML_CodeSniffer code ("WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail") -> "1.4.3". */
export function scFromHtmlcsCode(code) {
  const m = /\.(\d)_(\d)_(\d{1,2})\./.exec(String(code));
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** axe tags for a target level; best-practice rules are run but reported apart from failures. */
export function axeTags(level = 'AA') {
  const tags = ['wcag2a', 'wcag21a', 'wcag22a'];
  if (level !== 'A') tags.push('wcag2aa', 'wcag21aa', 'wcag22aa');
  if (level === 'AAA') tags.push('wcag2aaa', 'wcag21aaa', 'wcag22aaa');
  return [...tags, 'best-practice'];
}

export const htmlcsStandard = (level = 'AA') => `WCAG2${level}`;

/** "1.4.3 Contrast (Minimum) (AA)" */
export const scLabel = (sc) => (CRITERIA[sc] ? `${sc} ${CRITERIA[sc].name} (${CRITERIA[sc].level})` : sc);
