/**
 * Guards the invariant that the Content-Security-Policy imposes on markup.
 *
 * index.html sets a CSP without 'unsafe-inline' in script-src, which makes the
 * browser refuse to compile EVERY inline handler attribute — not just onclick.
 * The failure is silent: the attribute stays in the HTML while the DOM property
 * is null, so a form looks wired and does nothing.
 *
 * That is exactly how this regression shipped. The CSP landed together with an
 * onclick -> data-action conversion, the check afterwards counted onclick only,
 * and 26 onsubmit/onchange/oninput attributes were left behind. Every form in
 * the app silently stopped saving.
 *
 * These are static source assertions on purpose: no DOM, no browser, and they
 * fail on the markup itself rather than waiting for someone to click submit.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Comments in these files legitimately quote the forbidden pattern while
// explaining why it is forbidden, so scan code only.
const { stripJsComments } = require('./helpers/source-text');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const UI_CORE = fs.readFileSync(path.join(ROOT, 'js', 'ui-core.js'), 'utf8');

// An attribute that starts a tag-level "on…" handler: whitespace, then `on`,
// then letters, then `=`. Written this way so it catches handlers nobody has
// thought of yet (onfocus, onblur, ondrop…) rather than a fixed allowlist.
// `data-action=` and `content=` do not match: neither has `on` right after
// whitespace.
const INLINE_HANDLER_RE = /\son[a-z]+\s*=\s*["']/gi;

function findInlineHandlers(source) {
  return (source.match(INLINE_HANDLER_RE) || []).map((s) => s.trim());
}

test('index.html carries no inline event-handler attributes', () => {
  const found = findInlineHandlers(INDEX_HTML);
  assert.deepStrictEqual(
    found, [],
    `CSP forbids inline handlers, and they fail silently. Move these into ` +
    `INLINE_EVENT_BINDINGS (non-click) or data-action (click) in js/ui-core.js. Found: ${found.join(', ')}`
  );
});

test('renderers do not emit inline event-handler attributes', () => {
  // The row renderers build HTML strings, so a handler smuggled into a
  // template literal is subject to exactly the same CSP block.
  const renderers = ['transactions.js', 'wallets.js', 'schedules.js', 'categories-budgets.js', 'dashboard.js', 'charts.js', 'sync.js', 'ui-core.js'];
  const offenders = [];
  renderers.forEach((file) => {
    const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js', file), 'utf8'));
    findInlineHandlers(src).forEach((hit) => offenders.push(`${file}: ${hit}`));
  });
  assert.deepStrictEqual(offenders, [], `Inline handlers in generated markup: ${offenders.join(', ')}`);
});

test('every id bound in INLINE_EVENT_BINDINGS exists in index.html', () => {
  const table = UI_CORE.split('const INLINE_EVENT_BINDINGS')[1];
  assert.ok(table, 'INLINE_EVENT_BINDINGS table not found in js/ui-core.js');
  const body = table.split('];')[0];

  const boundIds = [...body.matchAll(/\[\s*'([^']+)'\s*,\s*'([^']+)'/g)].map((m) => ({ id: m[1], type: m[2] }));
  assert.ok(boundIds.length > 0, 'parsed no bindings out of INLINE_EVENT_BINDINGS');

  const htmlIds = new Set([...INDEX_HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const missing = boundIds.filter((b) => !htmlIds.has(b.id)).map((b) => b.id);
  assert.deepStrictEqual(missing, [], `bound to ids that do not exist: ${missing.join(', ')}`);
});

test('every form in index.html has a submit binding', () => {
  // A form with no binding cannot save anything — the exact shape of the bug.
  const formIds = [...INDEX_HTML.matchAll(/<form[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(formIds.length > 0, 'no forms found in index.html');

  const table = UI_CORE.split('const INLINE_EVENT_BINDINGS')[1].split('];')[0];
  const submitBound = new Set(
    [...table.matchAll(/\[\s*'([^']+)'\s*,\s*'submit'/g)].map((m) => m[1])
  );

  const unbound = formIds.filter((id) => !submitBound.has(id));
  assert.deepStrictEqual(unbound, [], `forms with no submit handler: ${unbound.join(', ')}`);
});
