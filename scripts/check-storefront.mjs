// Run after the Astro build: node scripts/check-storefront.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Script } from 'node:vm';

const origin = 'https://radios.ansman.io';
const root = resolve(import.meta.dirname, '..');
const kits = [
  { count: 2, id: 'two-radio-kit', price: '125', paypal: 'ZZL7S6UZS5VKN', image: 'two-kit-open.jpg', model: 'Baofeng Mini-5' },
  { count: 4, id: 'four-radio-kit', price: '200', paypal: '7L264VEBTJMMQ', image: 'four-kit-open.jpg', model: 'Baofeng UV-5R Mini' },
  { count: 5, id: 'five-radio-kit', price: '300', paypal: 'Z5NELZMQT6M24', image: 'five-kit-radios-open-v2.jpg', model: 'Baofeng Mini-5' },
];
const routes = ['/', ...kits.map(kit => `/kits/${kit.count}-radio-kit/`)];
const pages = new Map(routes.map(route => [route, readFileSync(resolve(root, `dist${route}index.html`), 'utf8')]));
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map(match => match[0]);
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const ids = html => [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const meta = (html, name) => tags(html, 'meta').find(tag => attr(tag, 'property') === name || attr(tag, 'name') === name);

for (const [route, html] of pages) {
  assert.equal(tags(html, 'h1').length, 1, `${route}: one main heading`);
  const pageIds = ids(html);
  assert.equal(pageIds.length, new Set(pageIds).size, `${route}: IDs must be unique`);
  assert.equal(attr(tags(html, 'link').find(tag => attr(tag, 'rel') === 'canonical'), 'href'), `${origin}${route}`);
  assert.equal(tags(html, 'script').filter(tag => attr(tag, 'src') === 'https://www.paypalobjects.com/ncp/cart/cart.js').length, 1);
  assert.equal(tags(html, 'paypal-cart-button').length, 1, `${route}: one shared cart`);
  assert(!/printed channel guide|30.day return|case.only product|\bSteven\b/i.test(html));

  for (const tag of tags(html, 'a')) {
    const href = attr(tag, 'href');
    assert(href, `${route}: link needs a destination`);
    if (href.startsWith('mailto:')) continue;
    const url = new URL(href, `${origin}${route}`);
    assert.equal(url.origin, origin, `${route}: unexpected external link ${href}`);
    assert(pages.has(url.pathname), `${route}: unknown route ${href}`);
    if (url.hash) assert(ids(pages.get(url.pathname)).includes(decodeURIComponent(url.hash.slice(1))), `${route}: broken shortcut ${href}`);
  }
  for (const tag of tags(html, 'img')) {
    const src = attr(tag, 'src');
    if (!src) {
      assert(tag.includes('data-viewer-image'), 'Only the closed photo viewer may have no source');
      continue;
    }
    assert(existsSync(resolve(root, `dist${src}`)), `${route}: missing image ${src}`);
    assert.notEqual(attr(tag, 'alt'), undefined, `${route}: image alt attribute required`);
  }
  for (const tag of tags(html, 'button').filter(tag => tag.includes('data-open-paypal'))) {
    assert(pageIds.includes(attr(tag, 'data-dialog-id')), `${route}: missing purchase dialog`);
  }
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (script[1].includes('application/ld+json')) JSON.parse(script[2]);
    else if (!script[1].includes('src=')) new Script(script[2]);
  }
}

for (const kit of kits) {
  const path = `/kits/${kit.count}-radio-kit/`;
  const html = pages.get(path);
  const name = `${kit.count}-Radio Field Kit`;
  assert(html.includes(`<h1 id="kit-title">${name}</h1>`));
  assert.equal(tags(html, 'paypal-add-to-cart-button').length, 1);
  assert.equal(attr(tags(html, 'paypal-add-to-cart-button')[0], 'data-id'), kit.paypal);
  assert.equal(attr(meta(html, 'og:image'), 'content'), `${origin}/images/${kit.image}`);
  assert.equal(attr(meta(html, 'twitter:image'), 'content'), `${origin}/images/${kit.image}`);
  assert(attr(meta(html, 'og:title'), 'content').includes(`${name} — ${kit.model}`));
  const schema = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1])).find(item => item['@type'] === 'Product');
  assert.equal(schema.name, name);
  assert.equal(schema.offers.price, kit.price);
  assert.equal(schema.offers.url, `${origin}${path}`);
  assert.equal(tags(html, 'button').filter(tag => tag.includes('data-gallery-button')).length, kit.count === 5 ? 4 : 3);
  assert(pages.get('/').includes(`id="${kit.id}"`), 'Preserve existing product shortcuts');
  assert(pages.get('/').includes(`href="${path}"`), 'Link product pages from homepage');
}
assert.equal(attr(meta(pages.get('/'), 'og:image'), 'content'), `${origin}/og-v2.png`, 'Preserve home sharing artwork');
console.log('All 4 pages passed: routes, shortcuts, checkout targets, galleries, metadata, schemas, and script syntax.');
