/** Adds local pacing information to the limits actually displayed by ChatGPT. */
(() => {
  'use strict';

  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const WIDGET = '.codex-time-progress';
  const MESSAGE = '.codex-time-progress__message';
  const LIMIT = /^(weekly|daily|\d+(?:[ -]hour|[ -]day))\s+(?:usage\s+)?limit$/i;
  const LABELS = 'div, span, p, h2, h3, h4';

  function isUsagePage(url) {
    const { pathname, searchParams } = new URL(url);
    return /^\/(?:codex\/(?:cloud\/)?)?settings\/(?:usage|analytics)\/?$/.test(pathname)
      && (!searchParams.has('tab') || searchParams.get('tab') === 'overview');
  }

  function intervalFor(label) {
    if (!LIMIT.test(label)) return null;
    if (/^weekly/i.test(label)) return 7 * DAY;
    if (/^daily/i.test(label)) return DAY;
    const match = label.match(/^(\d+)[ -](hour|day)/i);
    const duration = Number(match[1]) * (match[2].toLowerCase() === 'hour' ? HOUR : DAY);
    return duration > 0 ? duration : null;
  }

  function absoluteReset(value) {
    if (!value) return null;
    // The current tooltip includes a weekday, "at", and an explicit timezone.
    const normalized = value.replace(/^Resets\s+(?:on\s+)?/i, '')
      .replace(/^[A-Za-z]+,\s*/, '').replace(/\s+at\s+/i, ' ').trim();
    if (!/\b\d{4}\b/.test(normalized)) return null;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function relativeReset(text, now) {
    const match = text.match(/^Resets\s+in\s+(.+)$/i);
    if (!match) return null;
    const units = { d: DAY, h: HOUR, m: 60000, s: 1000 };
    let duration = 0;
    const rest = match[1].replace(/(\d+)\s*(days?|d|hours?|h|minutes?|m|seconds?|s)\b/gi,
      (_, amount, unit) => {
        duration += Number(amount) * units[unit[0].toLowerCase()];
        return '';
      });
    return !rest.trim() && duration > 0 ? now + duration : null;
  }

  function timeRemaining(reset, interval, now) {
    return Math.max(0, Math.min(100, (reset - now) / interval * 100));
  }

  // No runtime dependency is bundled into the extension; exports support Node tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isUsagePage, intervalFor, absoluteReset, relativeReset, timeRemaining };
  }
  if (typeof document === 'undefined') return;

  const relativeDates = new WeakMap();
  let scheduled;
  let observer;
  let lastSavedSignature;
  let lastSavedAt = 0;

  function saveSnapshot(limits, now) {
    if (!limits.length || !globalThis.chrome?.storage?.local) return;
    const signature = JSON.stringify(limits);
    if (signature === lastSavedSignature && now - lastSavedAt < 30000) return;
    lastSavedSignature = signature;
    lastSavedAt = now;
    // Save only the small summary needed by the popup, never the page or account details.
    chrome.storage.local.set({ usageSnapshot: { version: 1, capturedAt: now, limits } }).catch(() => {
      lastSavedSignature = undefined; // Retry on the next observation if storage is unavailable.
    });
  }

  function textOf(element) {
    return element.textContent.replace(/\s+/g, ' ').trim();
  }

  function limitLabels(root) {
    return [...root.querySelectorAll(LABELS)].filter(element =>
      !element.closest(WIDGET) && LIMIT.test(textOf(element))
      && ![...element.children].some(child => LIMIT.test(textOf(child))));
  }

  function resetElement(card) {
    return [...card.querySelectorAll('span, div, p, time')].find(element =>
      !element.closest(WIDGET) && /^Resets\s/i.test(textOf(element))
      && ![...element.children].some(child => /^Resets\s/i.test(textOf(child))));
  }

  function findCard(label) {
    // Stop before a container holding multiple limits; never attach to the page shell.
    for (let card = label.parentElement; card && card !== document.body; card = card.parentElement) {
      if (limitLabels(card).length > 1) return null;
      if (resetElement(card)) return card;
    }
    return null;
  }

  function resetFor(element, now) {
    const text = textOf(element);
    const exact = absoluteReset(element.getAttribute('datetime'))
      ?? absoluteReset(element.getAttribute('title'))
      ?? absoluteReset(element.closest('[title]')?.getAttribute('title'))
      ?? absoluteReset(text);
    if (exact !== null) return { time: exact, approximate: false };
    // Anchor a rounded countdown once, rather than moving its deadline every tick.
    const cached = relativeDates.get(element);
    if (cached?.text === text) return cached.reset;
    const time = relativeReset(text, now);
    const reset = time === null ? null : { time, approximate: true };
    relativeDates.set(element, { text, reset });
    return reset;
  }

  function usageRemaining(card) {
    const progress = card.querySelector('progress[aria-label="Usage remaining"], [role="progressbar"][aria-label="Usage remaining"]');
    if (progress) {
      const value = progress.getAttribute('value') ?? progress.getAttribute('aria-valuenow');
      const max = Number(progress.getAttribute('max') ?? progress.getAttribute('aria-valuemax') ?? 100);
      const min = Number(progress.getAttribute('aria-valuemin') ?? 0);
      const percent = (Number(value) - min) / (max - min) * 100;
      if (value !== null && max > min && Number.isFinite(percent) && percent >= 0 && percent <= 100) return percent;
    }
    const match = [...card.querySelectorAll('span, div, p')]
      .filter(element => !element.closest(WIDGET))
      .map(textOf).map(text => text.match(/^(\d+(?:\.\d+)?)\s*%\s*(?:left|remaining)$/i)).find(Boolean);
    return match && Number(match[1]) <= 100 ? Number(match[1]) : null;
  }

  function createWidget() {
    const widget = document.createElement('section');
    widget.className = 'codex-time-progress';
    widget.setAttribute('aria-label', 'Usage pacing');
    const row = document.createElement('div');
    row.className = 'codex-time-progress__row';
    const label = document.createElement('span');
    label.textContent = 'Time remaining';
    const value = document.createElement('span');
    value.className = 'codex-time-progress__value';
    const bar = document.createElement('progress');
    bar.className = 'codex-time-progress__bar';
    bar.max = 100;
    bar.setAttribute('aria-label', 'Time remaining in usage cycle');
    const pace = document.createElement('p');
    pace.className = 'codex-time-progress__pace';
    row.append(label, value);
    widget.append(row, bar, pace);
    return widget;
  }

  function update() {
    scheduled = undefined;
    observer.disconnect();
    try {
      const active = new Set();
      if (isUsagePage(location.href)) {
        const now = Date.now();
        const limits = [];
        for (const label of limitLabels(document)) {
          const interval = intervalFor(textOf(label));
          const card = findCard(label);
          if (!card || !interval) continue;
          const reset = resetFor(resetElement(card), now);
          if (!reset) continue;
          const remaining = timeRemaining(reset.time, interval, now);
          const usage = usageRemaining(card);
          const limit = { label: textOf(label), interval, resetAt: reset.time,
            approximate: reset.approximate, usageRemaining: usage };
          limits.push(limit);
          const widget = card.querySelector(WIDGET) ?? createWidget();
          widget.querySelector('.codex-time-progress__value').textContent = `${reset.approximate ? '≈' : ''}${Math.round(remaining)}% left`;
          widget.querySelector('progress').value = remaining;
          widget.title = `${reset.approximate ? 'Estimated reset' : 'Resets'}: ${new Date(reset.time).toLocaleString()}. Pacing assumes even usage throughout the cycle.`;
          const pace = widget.querySelector('.codex-time-progress__pace');
          if (reset.time <= now) {
            pace.textContent = 'Waiting for usage to refresh';
          } else if (usage === null) {
            pace.textContent = 'Compare with your usage remaining above';
          } else {
            const difference = usage - remaining;
            const points = Math.abs(difference).toFixed(1);
            pace.textContent = Math.abs(difference) < 1 ? 'About even with your time remaining'
              : difference > 0 ? `Below even pace · ${points} percentage points to spare`
                : `Above even pace · ${points} percentage points ahead of time`;
          }
          const advice = globalThis.CodexPace.describe(limit, now);
          const message = card.querySelector(MESSAGE) ?? document.createElement('p');
          message.className = 'codex-time-progress__message';
          message.hidden = !advice;
          message.textContent = advice?.message ?? '';
          if (advice) message.dataset.pace = advice.state;
          else delete message.dataset.pace;
          message.title = 'Based on this limit only, assuming even usage throughout the cycle. Other limits may still apply.';
          if (card.firstElementChild !== message) card.prepend(message);
          active.add(message);
          if (!widget.isConnected) card.append(widget);
          active.add(widget);
        }
        saveSnapshot(limits, now);
      }
      document.querySelectorAll(`${WIDGET}, ${MESSAGE}`).forEach(widget => {
        if (!active.has(widget)) widget.remove();
      });
    } finally {
      observer.observe(document.body, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['title', 'datetime', 'value', 'max', 'aria-valuenow', 'aria-valuemax', 'aria-valuemin']
      });
    }
  }

  function schedule() {
    if (scheduled === undefined) scheduled = setTimeout(update, 100);
  }

  observer = new MutationObserver(schedule);
  update(); // Also handles an already-rendered page.
  setInterval(schedule, 30000); // Refresh while idle and catch client-side route changes.
  addEventListener('popstate', schedule);
  document.addEventListener('visibilitychange', schedule);
})();
