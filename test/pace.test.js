const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describe, messages } = require('../pace.js');
const NOW = Date.parse('2026-10-04T17:55:27Z');
const DAY = 86400000;
const limit = (usageRemaining, time = 50) => ({
  label: 'Daily limit', interval: DAY, resetAt: NOW + DAY * time / 100, usageRemaining
});

test('20 distinct messages cover five pace states with four variations each', () => {
  assert.equal(Object.keys(messages).length, 5);
  assert.equal(new Set(Object.values(messages).flat()).size, 20);
  for (const group of Object.values(messages)) assert.equal(group.length, 4);
});

test('pace uses remaining usage versus remaining time, including thresholds', () => {
  for (const [usage, state] of [[100, 'plenty'], [70, 'plenty'], [69.9, 'spare'],
    [55, 'spare'], [54.9, 'balanced'], [50, 'balanced'], [45.1, 'balanced'],
    [45, 'fast'], [30.1, 'fast'], [30, 'sprinting'], [1, 'sprinting']]) {
    const advice = describe(limit(usage), NOW);
    assert.equal(advice.state, state, `usage=${usage}, time=50`);
    assert.ok(messages[state].includes(advice.message));
  }
  assert.equal(describe(limit(30, 10), NOW).state, 'plenty');
  assert.equal(describe(limit(30, 80), NOW).state, 'sprinting');
});

test('unusable data does not offer spending advice', () => {
  for (const usage of [null, undefined, NaN, -1, 101]) {
    assert.equal(describe(limit(usage), NOW), null);
  }
  assert.equal(describe(limit(90), NOW, { stale: true }), null);
  assert.equal(describe(limit(90, 0), NOW), null);
  assert.equal(describe(limit(90, -10), NOW), null);
  assert.equal(describe({ ...limit(90), interval: 0 }, NOW), null);
  assert.equal(describe({ ...limit(90), resetAt: NaN }, NOW), null);
});

test('new and exhausted cycles receive specific advice', () => {
  assert.equal(describe(limit(100, 100), NOW).state, 'starting');
  assert.equal(describe(limit(100, 96), NOW).state, 'starting');
  assert.equal(describe(limit(0, 99), NOW).state, 'exhausted');
  assert.equal(describe(limit(0, 1), NOW).state, 'exhausted');
});

test('copy stays stable within a rotation window and all variations are reachable', () => {
  const start = Math.floor(NOW / 900000) * 900000;
  const value = { ...limit(100), interval: 7 * DAY, resetAt: start + 3 * DAY };
  assert.deepEqual(describe(value, start), describe(value, start + 899999));
  const seen = new Set();
  for (let i = 0; i < 16; i++) seen.add(describe(value, start + i * 900000).message);
  assert.deepEqual(seen, new Set(messages.plenty));
});
