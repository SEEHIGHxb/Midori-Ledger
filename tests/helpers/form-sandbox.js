/**
 * Extends the base sandbox with a minimal hand-rolled `document` stub (no
 * jsdom dependency, consistent with the project's no-build-step / minimal-deps
 * approach) so form submit handlers in js/schedules.js and js/wallets.js can
 * be unit tested under `node --test`. These handlers read field values
 * directly via document.getElementById(id).value rather than taking
 * parameters, so a real DOM call shape is needed — this stub only implements
 * the small subset of DOM behavior those handlers actually touch.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createSandbox } = require('./sandbox');

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.style = {};
    this.children = [];
    const classes = new Set();
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    };
  }
  get firstChild() {
    return this.children[0] || null;
  }
  appendChild(el) {
    this.children.push(el);
    return el;
  }
  insertBefore(el) {
    this.children.unshift(el);
    return el;
  }
  // Only '.form-error' is ever queried by the app — recursive class search
  // over this element's own children is enough to support that.
  querySelectorAll(selector) {
    const className = selector.replace('.', '');
    const found = [];
    const visit = (el) => {
      if (el.className === className) found.push(el);
      el.children.forEach(visit);
    };
    this.children.forEach(visit);
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function createFormSandbox() {
  const sandbox = createSandbox();

  const elements = new Map();
  const documentStub = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    },
    createElement: (tag) => new FakeElement(),
    addEventListener: () => {},
    // Color-chip pickers query document-wide (e.g. '#editWalletColorPicker
    // .color-option'); no chips are seeded in these tests, so an empty match
    // list is the correct, real behavior, not a stub shortcut.
    querySelectorAll: () => [],
    body: new FakeElement('body'),
  };
  sandbox.document = documentStub;

  const filesToLoad = ['ui-core.js', 'schedules.js', 'wallets.js'];
  filesToLoad.forEach((file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', file), 'utf8');
    vm.runInContext(src, sandbox, { filename: file });
  });

  return { sandbox, elements };
}

module.exports = { createFormSandbox, FakeElement };
