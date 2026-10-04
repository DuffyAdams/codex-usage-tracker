const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(`${__dirname}/../popup.html`, 'utf8');
const script = fs.readFileSync(`${__dirname}/../popup.js`, 'utf8');
const content = fs.readFileSync(`${__dirname}/../content.js`, 'utf8');
const paceScript = fs.readFileSync(require.resolve('../pace.js'), 'utf8');
const fixture = fs.readFileSync(`${__dirname}/fixtures/overview.html`, 'utf8');
const NOW = Date.parse('2026-10-04T17:55:27Z');
const DAY = 86400000;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const sample = () => ({ version: 1, capturedAt: NOW, limits: [
  { label: 'Weekly limit', interval: 7 * DAY, resetAt: NOW + 5 * DAY, approximate: false, usageRemaining: 80 }
] });

function storage(initial) {
  let value = initial;
  const listeners = [];
  const writes = [];
  const api = {
    local: {
      get: async () => ({ usageSnapshot: value }),
      set: async data => {
        value = data.usageSnapshot;
        writes.push(value);
        listeners.forEach(listener => listener({ usageSnapshot: { newValue: value } }, 'local'));
      }
    },
    onChanged: { addListener: listener => listeners.push(listener) }
  };
  return { api, writes };
}

async function setup(t, saved, customStore) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const store = customStore ?? storage(saved);
  dom.window.chrome = { storage: store.api };
  dom.window.Date.now = () => NOW;
  dom.window.eval(paceScript);
  dom.window.eval(script);
  t.after(() => dom.window.close());
  await flush();
  return { window: dom.window, document: dom.window.document, store };
}

test('popup loads saved usage with accessible bars, reset time, and a safe dashboard link', async t => {
  const { document } = await setup(t, sample());
  assert.equal(document.querySelector('h2').textContent, 'Weekly limit');
  assert.equal(document.querySelector('[aria-label="Usage remaining"]').value, 80);
  assert.equal(Math.round(document.querySelector('[aria-label="Time remaining"]').value), 71);
  assert.match(document.querySelector('.pace').textContent, /Room to spare/);
  assert.equal(document.querySelector('.pace-message').dataset.pace, 'spare');
  assert.match(document.querySelector('#status').textContent, /just now/);
  assert.equal(document.querySelector('a').href, 'https://chatgpt.com/settings/usage?tab=overview');
});

test('first-run and malformed snapshots show an actionable empty state', async t => {
  const { document, store } = await setup(t);
  assert.match(document.querySelector('#status').textContent, /No saved usage/);
  assert.equal(document.querySelectorAll('progress').length, 0);
  await store.api.local.set({ usageSnapshot: { version: 1, capturedAt: NOW, limits: [{ interval: -1 }] } });
  assert.match(document.querySelector('.empty').textContent, /Open usage/);
});

test('storage errors produce a usable fallback rather than leaving the popup loading', async t => {
  const store = storage();
  store.api.local.get = async () => { throw new Error('unavailable'); };
  const { document } = await setup(t, undefined, store);
  assert.match(document.querySelector('#status').textContent, /Could not load/);
  assert.ok(document.querySelector('a'));
});

test('stale snapshots retain saved usage but suppress current pacing claims', async t => {
  const value = sample();
  value.capturedAt -= 3600000;
  const { document } = await setup(t, value);
  assert.match(document.querySelector('#status').textContent, /Outdated · 1h ago/);
  assert.equal(document.querySelector('[aria-label="Saved usage remaining"]').value, 80);
  assert.match(document.querySelector('.pace').textContent, /Refresh usage to check pace/);
  assert.equal(document.querySelector('.pace-message'), null);
});

test('expired cycles hide the old usage balance without inventing a new reset', async t => {
  const value = sample();
  value.limits[0].resetAt = NOW - 1;
  const { document } = await setup(t, value);
  assert.equal(document.querySelector('[aria-label="Usage remaining"]'), null);
  assert.equal(document.querySelector('[aria-label="Time remaining"]').value, 0);
  assert.match(document.querySelector('.pace').textContent, /Cycle ended/);
  assert.equal(document.querySelector('.pace-message'), null);
});

test('popup receives live storage changes, handles missing percentages, and renders labels as text', async t => {
  const { document, store } = await setup(t, sample());
  const value = sample();
  value.limits.push({ ...value.limits[0], label: '<img src=x onerror=alert(1)>', interval: 18000000,
    resetAt: NOW + 9000000, usageRemaining: null, approximate: true });
  await store.api.local.set({ usageSnapshot: value });
  assert.equal(document.querySelectorAll('.limit').length, 2);
  assert.equal(document.querySelector('img'), null);
  assert.match(document.querySelectorAll('.limit')[1].textContent, /≈50%/);
  assert.match(document.querySelectorAll('.pace')[1].textContent, /unavailable/);
  assert.equal(document.querySelectorAll('.limit')[1].querySelector('.pace-message'), null);
  await store.api.local.set({ usageSnapshot: undefined });
  assert.equal(document.querySelectorAll('.limit').length, 0);
});

test('a storage event arriving during initial load is not replaced by an older read', async t => {
  const store = storage();
  let resolve;
  store.api.local.get = () => new Promise(done => { resolve = done; });
  const { document } = await setup(t, undefined, store);
  await store.api.local.set({ usageSnapshot: sample() });
  resolve({ usageSnapshot: undefined });
  await flush();
  assert.equal(document.querySelectorAll('.limit').length, 1);
});

test('content script to local storage to popup integration; writes are throttled and contain only summaries', async t => {
  const store = storage();
  const { document } = await setup(t, undefined, store);
  const page = new JSDOM(fixture, { url: 'https://chatgpt.com/settings/usage?tab=overview', runScripts: 'outside-only' });
  t.after(() => page.window.close());
  page.window.chrome = { storage: store.api };
  page.window.Date.now = () => NOW;
  page.window.eval(paceScript);
  page.window.eval(content);
  await flush();
  assert.equal(document.querySelector('[aria-label="Usage remaining"]').value, 70);
  assert.equal(document.querySelector('.pace-message').textContent,
    page.window.document.querySelector('.codex-time-progress__message').textContent);
  assert.equal(store.writes.length, 1);
  assert.deepEqual(Object.keys(store.writes[0]).sort(), ['capturedAt', 'limits', 'version']);
  assert.deepEqual(Object.keys(store.writes[0].limits[0]).sort(), ['approximate', 'interval', 'label', 'resetAt', 'usageRemaining']);
  page.window.document.body.append(page.window.document.createElement('div'));
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(store.writes.length, 1);
  page.window.document.querySelector('[aria-label="Usage remaining"]').value = 60;
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(store.writes.length, 2);
  assert.equal(document.querySelector('[aria-label="Usage remaining"]').value, 60);
  assert.equal(document.querySelector('.pace-message').dataset.pace, 'fast');
  assert.equal(document.querySelector('.pace-message').textContent,
    page.window.document.querySelector('.codex-time-progress__message').textContent);
});

test('manifest declares the popup and all its assets are packaged locally', () => {
  const manifest = require('../manifest.json');
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.content_scripts[0].js, ['pace.js', 'content.js']);
  const dom = new JSDOM(html);
  for (const node of dom.window.document.querySelectorAll('script[src], link[href]')) {
    fs.accessSync(`${__dirname}/../${node.getAttribute('src') ?? node.getAttribute('href')}`);
  }
  assert.equal(dom.window.document.querySelector('script:not([src])'), null);
  dom.window.close();
});
