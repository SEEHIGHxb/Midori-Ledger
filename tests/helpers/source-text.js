/**
 * Helpers for tests that assert on source text rather than behaviour.
 *
 * Several invariants in this project are only checkable by reading the source:
 * the CSP forbids inline handler attributes, and the modal dialogs' focus
 * behaviour has no DOM harness to exercise it. Those tests scan files as
 * strings, which walks straight into one trap — the comments explaining why a
 * pattern is forbidden necessarily contain that pattern, so a naive scan
 * matches the explanation and fails. Strip comments first.
 */

/**
 * Remove block and line comments from JavaScript source.
 *
 * Deliberately simple: it does not track string literals, so a `//` inside a
 * quoted string would be stripped too. That is acceptable for the assertions
 * here, which only need code-vs-comment separation. The `[^:]` guard is what
 * keeps `https://` in a URL from being read as the start of a line comment.
 */
function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Remove /* … *​/ comments from CSS source.
 *
 * Same hazard as the JS stripper, and it bites harder here. A CSS assertion
 * that a rule declares `visibility: hidden` matched the words "visibility:hidden"
 * inside the comment explaining why that declaration exists — so deleting the
 * real declaration still passed. A test that cannot fail is worse than no test.
 */
function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

module.exports = { stripJsComments, stripCssComments };
