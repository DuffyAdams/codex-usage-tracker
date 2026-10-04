const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { isUsagePage, intervalFor, absoluteReset, relativeReset, timeRemaining } = require('../content.js');
const script = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const paceScript = fs.readFileSync(require.resolve('../pace.js'), 'utf8');
const fixture = fs.readFileSync(`${__dirname}/fixtures/overview.html`, 'utf8');
const NOW = Date.parse('2026-10-04T17:55:27Z');
const DAY = 86400000;
const tick = () => new Promise(resolve => setTimeout(resolve, 180));

function setup(t, html = fixture, path = '/settings/usage?tab=overview') {
  const dom = new JSDOM(html, { url: `https://chatgpt.com${path}`, runScripts: 'outside-only' });
  dom.window.Date.now = () => NOW;
  dom.window.eval(paceScript);
  dom.window.eval(script);
  t.after(() => dom.window.close());
  return dom.window;
}

test('current and legacy routes are accepted; unrelated pages and Analytics are excluded', () => {
  for (const path of ['/settings/usage?tab=overview', '/settings/usage', '/codex/settings/usage', '/codex/cloud/settings/analytics']) {
    assert.equal(isUsagePage(`https://chatgpt.com${path}`), true);
  }
  for (const path of ['/settings/usage?tab=analytics', '/', '/settings/billing', '/settings/usage-extra']) {
    assert.equal(isUsagePage(`https://chatgpt.com${path}`), false);
  }
});

test('recognized cycles do not invent a weekly duration for unknown limits', () => {
  assert.equal(intervalFor('Weekly limit'), 7 * DAY);
  assert.equal(intervalFor('Weekly usage limit'), 7 * DAY);
  assert.equal(intervalFor('5-hour limit'), 5 * 3600000);
  assert.equal(intervalFor('3 day usage limit'), 3 * DAY);
  assert.equal(intervalFor('Daily limit'), DAY);
  assert.equal(intervalFor('Monthly limit'), null);
  assert.equal(intervalFor('0-hour limit'), null);
});

test('exact tooltip date preserves timezone and legacy timestamps still work', () => {
  const expected = Date.parse('2026-10-09T21:55:27Z');
  assert.equal(absoluteReset('Friday, October 9, 2026 at 2:55:27 PM PDT'), expected);
  assert.equal(absoluteReset('Resets Oct 9, 2026 2:55:27 PM PDT'), expected);
  assert.equal(absoluteReset('2026-10-09T21:55:27Z'), expected);
  assert.equal(absoluteReset('Resets in 5d 4h'), null);
  assert.equal(absoluteReset('unavailable'), null);
});

test('relative countdown parsing and time clamping', () => {
  assert.equal(relativeReset('Resets in 5d 4h', NOW), NOW + 5 * DAY + 4 * 3600000);
  assert.equal(relativeReset('Resets in 2 hours 15 minutes', NOW), NOW + 8100000);
  assert.equal(relativeReset('Resets in unknown', NOW), null);
  assert.equal(relativeReset('Resets in 4 months', NOW), null);
  assert.equal(timeRemaining(NOW - 1, DAY, NOW), 0);
  assert.equal(timeRemaining(NOW + 2 * DAY, DAY, NOW), 100);
});

test('renders immediately against current DOM, using exact title and preserving the native bar', t => {
  const { document } = setup(t);
  assert.equal(document.querySelectorAll('.codex-time-progress').length, 1);
  assert.equal(document.querySelector('.codex-time-progress').parentElement.id, 'weekly');
  assert.equal(document.querySelector('.codex-time-progress__value').textContent, '74% left');
  assert.match(document.querySelector('.codex-time-progress__pace').textContent, /Above even pace/);
  assert.equal(document.querySelector('[aria-label="Usage remaining"]').value, 70);
});

test('updates percentage and reset attributes without duplicate bars or observer loops', async t => {
  const window = setup(t);
  const document = window.document;
  let mutations = 0;
  const monitor = new window.MutationObserver(() => mutations++);
  monitor.observe(document.body, { childList: true, subtree: true, attributes: true });
  t.after(() => monitor.disconnect());
  document.querySelector('[aria-label="Usage remaining"]').value = 90;
  document.querySelector('.usage-row [title]').title = 'Tuesday, October 6, 2026 at 10:55:27 AM PDT';
  await tick();
  assert.equal(document.querySelector('.codex-time-progress__value').textContent, '29% left');
  assert.match(document.querySelector('.codex-time-progress__pace').textContent, /Below even pace/);
  assert.equal(document.querySelector('.codex-time-progress__message').dataset.pace, 'plenty');
  const afterUpdate = mutations;
  await tick();
  assert.equal(mutations, afterUpdate);
  assert.equal(document.querySelectorAll('.codex-time-progress').length, 1);
});

test('handles delayed rendering, SPA entry, tab changes, and replaced cards', async t => {
  const window = setup(t, '<body></body>', '/');
  window.document.body.innerHTML = fixture;
  await tick();
  assert.equal(window.document.querySelectorAll('.codex-time-progress').length, 0);
  window.history.pushState({}, '', '/settings/usage?tab=overview');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await tick();
  assert.equal(window.document.querySelectorAll('.codex-time-progress').length, 1);
  window.document.querySelector('#weekly').outerHTML = '<div id="weekly"><p>Weekly limit</p><span>Resets in 3d</span><span>80% left</span></div>';
  await tick();
  assert.equal(window.document.querySelectorAll('.codex-time-progress').length, 1);
  assert.equal(window.document.querySelector('.codex-time-progress__value').textContent, '≈43% left');
  window.history.pushState({}, '', '/settings/usage?tab=analytics');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await tick();
  assert.equal(window.document.querySelectorAll('.codex-time-progress').length, 0);
});

test('renders separate weekly and five-hour limits, including legacy articles', t => {
  const { document } = setup(t, `<article><p>Weekly usage limit</p><span>60% remaining</span><div>Resets Oct 9, 2026 2:55:27 PM PDT</div></article>
    <article><p>5-hour limit</p><span>90% left</span><div>Resets in 2h 30m</div></article>`);
  assert.equal(document.querySelectorAll('.codex-time-progress').length, 2);
  assert.deepEqual([...document.querySelectorAll('.codex-time-progress__value')].map(el => el.textContent), ['74% left', '≈50% left']);
});

test('relative countdown remains anchored on clock ticks, and expires without a stale pace claim', async t => {
  const window = setup(t, '<article><p>5-hour limit</p><span>Resets in 2h 30m</span><span>80% left</span></article>');
  window.Date.now = () => NOW + 3600000;
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await tick();
  assert.equal(window.document.querySelector('.codex-time-progress__value').textContent, '≈30% left');
  window.Date.now = () => NOW + DAY;
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await tick();
  assert.equal(window.document.querySelector('.codex-time-progress__value').textContent, '≈0% left');
  assert.equal(window.document.querySelector('.codex-time-progress__pace').textContent, 'Waiting for usage to refresh');
  assert.equal(window.document.querySelector('.codex-time-progress__message').hidden, true);
  assert.equal(window.document.querySelector('.codex-time-progress__message').textContent, '');
});

test('invalid resets remove stale widgets and unsupported limits are skipped', async t => {
  const window = setup(t);
  const reset = window.document.querySelector('.usage-row [title]');
  reset.removeAttribute('title');
  reset.textContent = 'Resets later';
  await tick();
  assert.equal(window.document.querySelectorAll('.codex-time-progress').length, 0);
  window.document.body.innerHTML = '<article><p>Monthly limit</p><span>Resets in 3d</span></article>';
  await tick();
  assert.equal(window.document.querySelectorAll('.codex-time-progress').length, 0);
});
