// Exercise slow, failed, and partially available checkout without placing orders.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/components/StorefrontScripts.astro', import.meta.url), 'utf8')
  .match(/<script is:inline>([\s\S]*?)<\/script>/)[1];

class Element {
  hidden = false;
  textContent = '';
  dataset = {};
  attributes = new Map();
  listeners = new Map();
  children = new Map();
  addEventListener(type, callback) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), callback]);
  }
  fire(type) { for (const callback of this.listeners.get(type) || []) callback({ target: this }); }
  click() { this.fire('click'); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(selector) { return this.children.get(selector) || null; }
  querySelectorAll() { return []; }
}
class Dialog extends Element {
  open = false;
  showModal() { this.open = true; }
  close() { this.open = false; }
}
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

function fixture({ cached = false, failProduct = false, failCart = false, delayed = false } = {}) {
  const sdk = new Element();
  const cart = new Element();
  cart.hidden = true;
  const cartLoading = new Element();
  const cartFallback = new Element();
  cartFallback.hidden = true;
  const calls = [];
  const pending = [];
  const timers = new Map();
  const dialogs = ['two-radio-kit', 'four-radio-kit', 'five-radio-kit'].map((id, index) => {
    const dialog = new Dialog();
    dialog.id = id;
    const widget = new Element();
    widget.setAttribute('data-id', ['ZZL7S6UZS5VKN', '7L264VEBTJMMQ', 'Z5NELZMQT6M24'][index]);
    widget.setAttribute('aria-busy', 'true');
    const status = new Element();
    const message = new Element();
    message.textContent = 'Loading secure PayPal checkout…';
    const help = new Element();
    help.hidden = true;
    dialog.children = new Map([
      ['paypal-add-to-cart-button', widget], ['[data-paypal-status]', status],
      ['[data-paypal-message]', message], ['[data-paypal-help]', help],
    ]);
    return dialog;
  });
  const buttons = dialogs.map(dialog => {
    const button = new Element();
    button.dataset.dialogId = dialog.id;
    return button;
  });
  const render = (widget, fail) => {
    const complete = () => { if (!fail) widget.children.set('button', new Element()); };
    if (!delayed) { complete(); return Promise.resolve(); }
    return new Promise(resolve => pending.push(() => { complete(); resolve(); }));
  };
  const provider = {
    Cart({ id }) { calls.push(id); return render(cart, failCart); },
    AddToCart({ id }) {
      calls.push(id);
      const widget = dialogs.map(dialog => dialog.querySelector('paypal-add-to-cart-button'))
        .find(element => element.getAttribute('data-id') === id);
      return render(widget, failProduct && id === '7L264VEBTJMMQ');
    },
  };
  const window = new Element();
  Object.assign(window, {
    location: { hash: '' },
    setTimeout(callback) { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    ...(cached ? { cartPaypal: provider } : {}),
  });
  const document = {
    getElementById: id => id === 'paypal-cart-sdk' ? sdk : dialogs.find(dialog => dialog.id === id) || null,
    querySelector: selector => new Map([
      ['paypal-cart-button', cart], ['[data-cart-loading]', cartLoading], ['[data-cart-fallback]', cartFallback],
    ]).get(selector) || null,
    querySelectorAll: selector => selector === '[data-paypal-dialog]' ? dialogs : selector === '[data-open-paypal]' ? buttons : [],
  };
  runInNewContext(source, {
    window, document, HTMLElement: Element, HTMLDialogElement: Dialog,
    HTMLDetailsElement: Element, HTMLImageElement: Element, requestAnimationFrame() {},
  });
  return {
    sdk, cart, cartLoading, cartFallback, calls, dialogs, buttons, timers,
    load() { window.cartPaypal = provider; sdk.fire('load'); },
    settle() { for (const complete of pending.splice(0)) complete(); },
    timeout() { for (const callback of [...timers.values()]) callback(); },
  };
}

const loading = fixture({ delayed: true });
loading.buttons[0].click();
assert(loading.dialogs[0].open, 'The selected kit opens while PayPal is still downloading');
assert(loading.dialogs[0].querySelector('[data-paypal-help]').hidden);
loading.load();
await flush();
loading.timeout();
assert(!loading.dialogs[0].querySelector('[data-paypal-help]').hidden, 'Slow checkout offers email help');
loading.settle();
await flush();
assert(loading.dialogs.every(dialog => dialog.querySelector('[data-paypal-status]').hidden), 'A late successful load removes loading/error messages');
assert(!loading.cart.hidden && loading.cartFallback.hidden, 'A late load restores the shared cart');
assert(loading.dialogs.every(dialog => dialog.querySelector('paypal-add-to-cart-button').getAttribute('aria-busy') === 'false'));
loading.sdk.fire('load');
await flush();
assert.deepEqual(loading.calls, ['pp-view-cart', 'ZZL7S6UZS5VKN', '7L264VEBTJMMQ', 'Z5NELZMQT6M24'], 'Initialize each real checkout exactly once');

const partial = fixture({ cached: true, failProduct: true, failCart: true });
await flush();
assert(partial.dialogs[0].querySelector('[data-paypal-status]').hidden);
assert(!partial.dialogs[1].querySelector('[data-paypal-status]').hidden, 'One failed kit does not block other kits');
assert(!partial.cartFallback.hidden, 'A failed cart offers email ordering');
const failureMessage = partial.dialogs[1].querySelector('[data-paypal-message]').textContent;
partial.timeout();
assert.equal(partial.dialogs[1].querySelector('[data-paypal-message]').textContent, failureMessage, 'A timeout must not overwrite a confirmed failure');

const unavailable = fixture();
unavailable.sdk.fire('error');
unavailable.buttons[2].click();
assert(unavailable.dialogs[2].open, 'Checkout failure still leaves a useful dialog');
assert(unavailable.dialogs.every(dialog => !dialog.querySelector('[data-paypal-help]').hidden));
assert.equal(unavailable.timers.size, 0);
assert.equal(unavailable.calls.length, 0, 'Never initialize or submit payment when the provider is unavailable');

console.log('Checkout passed: immediate controls, slow-load recovery, independent kit failures, cached SDK, and unavailable-provider help.');
