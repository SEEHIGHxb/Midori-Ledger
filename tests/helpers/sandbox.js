/**
 * Loads js/state.js + js/scheduler.js into a vm sandbox with minimal
 * browser-global stubs, so their pure logic can be unit tested under
 * `node --test` without a DOM and without changing the app's no-build-step
 * <script>-tag setup (these files are loaded verbatim, unmodified).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createSandbox() {
  const store = new Map();
  const listeners = {};

  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };

  class CustomEvent {
    constructor(type, opts) {
      this.type = type;
      this.detail = opts && opts.detail;
    }
  }

  const windowStub = {
    addEventListener: (type, fn) => {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    dispatchEvent: (evt) => {
      (listeners[evt.type] || []).forEach((fn) => fn(evt));
    },
    CustomEvent,
  };

  // state.js draws record IDs and sync credentials from crypto.getRandomValues /
  // crypto.randomUUID (never Math.random), so the sandbox must expose the same
  // WebCrypto surface the browser does. Node's global webcrypto is API-identical.
  windowStub.crypto = globalThis.crypto;

  const sandbox = {
    console,
    localStorage,
    window: windowStub,
    crypto: globalThis.crypto,
    CustomEvent,
    setTimeout,
    clearTimeout,
    fetch: () => Promise.reject(new Error('fetch is not available in the test sandbox')),
    TextEncoder,
    TextDecoder,
    Uint8Array,
    btoa,
    atob,
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);

  // merge.js first: state.js runs loadState() as it loads, which reaches
  // TOMBSTONE_TTL_MS. Declared later it would be in the temporal dead zone,
  // and the load would throw instead of falling back.
  const mergeSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'merge.js'), 'utf8');
  const stateSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'state.js'), 'utf8');
  const schedulerSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'scheduler.js'), 'utf8');
  // Loaded in the same order index.html does: ml-features before ml-forecast
  // (which calls its helpers), and both after scheduler (ml-forecast reuses
  // get30DayForecast).
  const mlFeaturesSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'ml-features.js'), 'utf8');
  const mlForecastSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'ml-forecast.js'), 'utf8');

  vm.runInContext(mergeSrc, sandbox, { filename: 'merge.js' });
  vm.runInContext(stateSrc, sandbox, { filename: 'state.js' });
  vm.runInContext(schedulerSrc, sandbox, { filename: 'scheduler.js' });
  vm.runInContext(mlFeaturesSrc, sandbox, { filename: 'ml-features.js' });
  vm.runInContext(mlForecastSrc, sandbox, { filename: 'ml-forecast.js' });

  // state.js declares `MidoriState`/`CURRENCIES` with let/const, so they are
  // not properties of the sandbox object — expose tiny accessors (themselves
  // plain function declarations, which DO become sandbox properties) so
  // tests can read/replace state between assertions.
  vm.runInContext(
    `function __getState() { return MidoriState; }
     function __setState(newState) { MidoriState = newState; }
     function __getCurrencies() { return CURRENCIES; }`,
    sandbox,
    { filename: 'test-exposers.js' }
  );

  return sandbox;
}

module.exports = { createSandbox };
