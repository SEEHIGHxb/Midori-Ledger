/**
 * Guards the app's offline-first, no-third-party-requests property.
 *
 * Midori is a personal finance ledger that must work with no network, and that
 * should not announce every page load to anyone. Two mechanisms enforce it: the
 * CSP allow-list in index.html, and the rule that every asset is vendored.
 *
 * This test exists because that property was quietly broken and the obvious
 * check missed it. The fonts were referenced TWICE — a visible <link> in
 * index.html and an @import at the top of css/style.css. Removing the <link>
 * looked like a complete fix; the @import kept fetching from fonts.googleapis.com
 * (and pulled a CJK family for a rule no markup uses). Only measuring real
 * network requests in a browser revealed it.
 *
 * Grepping for a family name would not have caught it either: the <link> spells
 * it "Noto Serif JP" and the @import spells it "Noto+Serif+JP".
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const CSS_FILES = fs.readdirSync(path.join(ROOT, 'css'))
  .filter((f) => f.endsWith('.css'))
  .map((f) => ({ name: `css/${f}`, source: fs.readFileSync(path.join(ROOT, 'css', f), 'utf8') }));

// Strip comments before scanning: the comments in these files deliberately name
// the CDN they replaced, and matching those would fail the suite for explaining
// itself.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
}

test('no stylesheet reaches out to a third-party host', () => {
  const offenders = [];

  CSS_FILES.forEach(({ name, source }) => {
    const code = stripComments(source);
    // @import is the invisible one — it sits inside a CSS file rather than in
    // the document head, so it survives an audit of index.html.
    [...code.matchAll(/@import\s+url\(\s*['"]?(https?:)?\/\/[^)]+\)/gi)]
      .forEach((m) => offenders.push(`${name}: ${m[0].slice(0, 80)}`));
    // url() pointing at an absolute remote host (fonts, images, anything).
    [...code.matchAll(/url\(\s*['"]?https?:\/\/[^)]+\)/gi)]
      .forEach((m) => offenders.push(`${name}: ${m[0].slice(0, 80)}`));
  });

  assert.deepStrictEqual(
    offenders, [],
    `Stylesheets must not fetch from another origin — vendor the asset instead. Found: ${offenders.join(' | ')}`
  );
});

test('index.html loads no remote stylesheets, scripts, or fonts', () => {
  const html = stripComments(INDEX_HTML);
  const offenders = [];

  [...html.matchAll(/<link\b[^>]*href=["']https?:\/\/[^"']+["'][^>]*>/gi)]
    .forEach((m) => offenders.push(`link: ${m[0].slice(0, 90)}`));
  [...html.matchAll(/<script\b[^>]*src=["']https?:\/\/[^"']+["'][^>]*>/gi)]
    .forEach((m) => offenders.push(`script: ${m[0].slice(0, 90)}`));

  assert.deepStrictEqual(
    offenders, [],
    `index.html must not load remote assets. Found: ${offenders.join(' | ')}`
  );
});

test('the CSP does not allow the font CDNs it no longer needs', () => {
  // Leaving the allow-list wider than the app needs would let a reintroduced
  // reference work silently instead of being blocked and noticed.
  const csp = INDEX_HTML.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([\s\S]*?)"/);
  assert.ok(csp, 'no CSP meta tag found in index.html');

  assert.doesNotMatch(csp[1], /fonts\.googleapis\.com/, 'CSP still allows fonts.googleapis.com');
  assert.doesNotMatch(csp[1], /fonts\.gstatic\.com/, 'CSP still allows fonts.gstatic.com');
});

test('the self-hosted font files exist and are real woff2', () => {
  const declared = [...fs.readFileSync(path.join(ROOT, 'css', 'fonts.css'), 'utf8')
    .matchAll(/url\(\s*['"]\.\.\/([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(declared.length >= 2, `expected the vendored font files, found ${declared.length}`);

  declared.forEach((rel) => {
    const file = path.join(ROOT, rel);
    assert.ok(fs.existsSync(file), `css/fonts.css references ${rel}, which does not exist`);
    // 'wOF2' magic number. A truncated download or an HTML error page saved to
    // disk would still be a file of plausible size, so check the signature.
    const magic = fs.readFileSync(file).subarray(0, 4).toString('latin1');
    assert.strictEqual(magic, 'wOF2', `${rel} is not a valid woff2 file (magic: ${magic})`);
  });
});

test('the service worker precaches the fonts it must serve offline', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const list = sw.slice(sw.indexOf('ASSETS_TO_CACHE'), sw.indexOf('];'));
  assert.match(list, /fonts\.css/, 'css/fonts.css is not precached');
  assert.match(list, /\.woff2/, 'no font files are precached — they would 404 offline');
});
