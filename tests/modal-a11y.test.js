/**
 * Guards the dialog semantics and keyboard behaviour of the 10 modals.
 *
 * These are static source assertions, in the same spirit as
 * csp-inline-handlers.test.js: the app has no DOM test harness, and the failures
 * being guarded here are all silent ones that look fine on screen.
 *
 * What this file does NOT prove: that a real Tab keypress is contained inside an
 * open dialog. Synthetic KeyboardEvents do not perform default focus movement,
 * and the automated browser used during development could not deliver real key
 * events to the page, so the containment branches below are asserted by
 * construction rather than by observation. Verify Tab/Shift+Tab by hand.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripJsComments, stripCssComments } = require('./helpers/source-text');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// Comments here quote the very patterns these tests forbid (rAF, role="dialog"),
// so scan code only or the explanations trip their own assertions.
const UI_CORE = stripJsComments(fs.readFileSync(path.join(ROOT, 'js', 'ui-core.js'), 'utf8'));
// Stripped for the same reason as UI_CORE: the comment justifying
// `visibility: hidden` contains that exact string, and matching it made the
// assertion below pass even with the real declaration deleted.
const STYLE_CSS = stripCssComments(fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8'));

const MODAL_IDS = [...INDEX_HTML.matchAll(/<div class="modal-overlay" id="(\w+)">/g)].map((m) => m[1]);

test('every modal overlay wraps a labelled, modal dialog', () => {
  assert.ok(MODAL_IDS.length >= 10, `expected the app's modals, found ${MODAL_IDS.length}`);

  const htmlIds = new Set([...INDEX_HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const problems = [];

  MODAL_IDS.forEach((id) => {
    // Slice from this overlay to the next one so each assertion is scoped.
    const start = INDEX_HTML.indexOf(`<div class="modal-overlay" id="${id}">`);
    const nextIdx = INDEX_HTML.indexOf('<div class="modal-overlay"', start + 1);
    const block = INDEX_HTML.slice(start, nextIdx === -1 ? undefined : nextIdx);

    if (!/role="dialog"/.test(block)) problems.push(`${id}: no role="dialog"`);
    if (!/aria-modal="true"/.test(block)) problems.push(`${id}: no aria-modal="true"`);

    const labelled = block.match(/aria-labelledby="([^"]+)"/);
    if (!labelled) {
      problems.push(`${id}: no aria-labelledby`);
    } else if (!htmlIds.has(labelled[1])) {
      // A dangling reference leaves the dialog with no accessible name at all,
      // which is indistinguishable from having no label in the first place.
      problems.push(`${id}: aria-labelledby="${labelled[1]}" matches no element`);
    }
  });

  assert.deepStrictEqual(problems, [], problems.join('; '));
});

test('every modal close button has an accessible name', () => {
  // These buttons contain only an <svg>, so without aria-label a screen reader
  // announces an unnamed button. All 10 were unnamed before this was added.
  const buttons = [...INDEX_HTML.matchAll(/<button class="modal-close-btn"([^>]*)>/g)].map((m) => m[1]);
  assert.ok(buttons.length >= 10, `expected 10 close buttons, found ${buttons.length}`);
  const unnamed = buttons.filter((attrs) => !/aria-label="[^"]+"/.test(attrs));
  assert.strictEqual(unnamed.length, 0, `close buttons with no aria-label: ${unnamed.length}`);
});

test('closed modals are removed from the tab order, not just hidden from the mouse', () => {
  const overlay = STYLE_CSS.match(/\.modal-overlay \{[\s\S]*?\}/);
  const active = STYLE_CSS.match(/\.modal-overlay\.active \{[\s\S]*?\}/);
  assert.ok(overlay && active, 'modal overlay rules not found in css/style.css');

  // pointer-events:none alone blocks the mouse but not the keyboard: with
  // opacity only, 80 controls across the closed modals stayed focusable and
  // tabbing walked invisibly through every hidden form.
  assert.match(overlay[0], /visibility:\s*hidden/, '.modal-overlay must set visibility:hidden');
  assert.match(active[0], /visibility:\s*visible/, '.modal-overlay.active must restore visibility');
});

test('openModal moves focus into the dialog without depending on rAF', () => {
  const fn = UI_CORE.slice(UI_CORE.indexOf('function openModal'), UI_CORE.indexOf('function closeModal'));

  assert.match(fn, /\.focus\(\)/, 'openModal must move focus into the dialog');
  assert.match(fn, /offsetHeight/, 'openModal must flush layout before focusing a just-shown element');
  // requestAnimationFrame does not fire while the document is hidden, so a
  // modal opened in a backgrounded tab never got focus. Observed directly.
  assert.doesNotMatch(fn, /requestAnimationFrame/, 'rAF does not fire in a hidden document — use a layout flush');
});

test('closeModal returns focus to whatever opened the dialog', () => {
  const fn = UI_CORE.slice(UI_CORE.indexOf('function closeModal'), UI_CORE.indexOf('function setupModalKeyboard'));
  assert.match(fn, /modalReturnFocusTo/, 'closeModal must restore focus to the opener');
  assert.match(fn, /\.focus\(\)/, 'closeModal must actually call focus()');
});

test('the keyboard handler closes on Escape and wraps Tab at both ends', () => {
  const fn = UI_CORE.slice(UI_CORE.indexOf('function setupModalKeyboard'));

  assert.match(fn, /'Escape'/, 'no Escape handling');
  assert.match(fn, /closeModal\(/, 'Escape must close the dialog');
  assert.match(fn, /'Tab'/, 'no Tab handling');
  assert.match(fn, /shiftKey/, 'Shift+Tab must wrap backwards');

  // openModal focuses the dialog container itself, so the backwards-wrap check
  // has to treat that container as the start of the dialog. Without it the
  // handler matches neither branch, skips preventDefault, and the browser's own
  // Shift+Tab carries focus out of the dialog from its opening position.
  //
  // Assert the comparison, not merely the selector: an earlier version of this
  // test looked for `role="dialog"` anywhere in the function, which the
  // querySelector line satisfies on its own — deleting the comparison left the
  // test green. Verified by mutation.
  assert.match(
    fn,
    /activeElement === dialogEl/,
    'backwards wrap must compare activeElement against the dialog container'
  );
  assert.match(fn, /preventDefault/, 'wrapping requires suppressing the default Tab movement');
});
