/** Shared, local-only pacing copy for the popup and Usage Overview. */
(() => {
  'use strict';

  const messages = {
    plenty: [
      'Plenty to spare. Burn some tokens.',
      'Room for that bigger project.',
      'Well below pace. Explore more.',
      'Lots left before reset. Keep building.'
    ],
    spare: [
      'Room for another task.',
      'Breathing room. Keep going.',
      'Below pace. Pick it up a little.',
      'Tokens to spare. Try another iteration.'
    ],
    balanced: [
      'On pace. Keep this rhythm.',
      'Usage and time are balanced.',
      'Steady pace. Looking good.',
      'Right on track until reset.'
    ],
    fast: [
      'Using faster than pace. Ease up.',
      'Could run out early. Pace yourself.',
      'Ahead of the clock. Slow a little.',
      'Save some for your next priority.'
    ],
    sprinting: [
      'Burning fast. Time to slow down.',
      'Likely to hit this limit early.',
      'Way above pace. Prioritize what matters.',
      'Stretch what’s left until reset.'
    ]
  };

  function describe(limit, now = Date.now(), { stale = false } = {}) {
    if (limit.resetAt <= now) return null;
    if (stale || !Number.isFinite(limit.usageRemaining) || !Number.isFinite(limit.resetAt)
      || !Number.isFinite(limit.interval) || limit.interval <= 0
      || limit.usageRemaining < 0 || limit.usageRemaining > 100) return null;
    if (limit.usageRemaining === 0) {
      return { state: 'exhausted', message: 'Allowance used up. Wait for reset.' };
    }
    const time = Math.max(0, Math.min(100, (limit.resetAt - now) / limit.interval * 100));
    // Avoid projecting a whole cycle from its opening moments.
    if (time > 95) {
      return { state: 'starting', message: 'New cycle. Too early to judge pace.' };
    }
    const difference = limit.usageRemaining - time;
    const state = difference >= 20 ? 'plenty' : difference >= 5 ? 'spare'
      : difference <= -20 ? 'sprinting' : difference <= -5 ? 'fast' : 'balanced';
    // Stable across both surfaces; rotate every 15 minutes, not every render.
    const seed = `${limit.label}:${limit.resetAt}:${Math.floor(now / 900000)}`;
    let hash = 0;
    for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return { state, message: messages[state][hash % messages[state].length] };
  }

  const api = { describe, messages };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.CodexPace = api;
})();
