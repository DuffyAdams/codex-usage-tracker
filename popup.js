(() => {
  'use strict';
  const STALE_AFTER = 5 * 60000;
  let snapshot;
  let storageFailed = false;
  let storageChanged = false;

  function validSnapshot(value) {
    return value?.version === 1 && Number.isFinite(value.capturedAt) && Array.isArray(value.limits)
      && value.limits.length > 0 && value.limits.every(limit =>
        typeof limit.label === 'string' && Number.isFinite(limit.interval) && limit.interval > 0
        && Number.isFinite(limit.resetAt) && typeof limit.approximate === 'boolean'
        && (limit.usageRemaining === null || (Number.isFinite(limit.usageRemaining)
          && limit.usageRemaining >= 0 && limit.usageRemaining <= 100)));
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function metric(label, value, approximate, className) {
    const container = element('div', undefined, 'metric');
    const row = element('div', undefined, 'metric-label');
    row.append(element('span', label), element('span', value === null ? 'Unavailable'
      : `${approximate ? '≈' : ''}${Math.round(value)}%`, 'metric-value'));
    container.append(row);
    if (value !== null) {
      const bar = element('progress', undefined, className);
      bar.max = 100;
      bar.value = value;
      bar.setAttribute('aria-label', label);
      container.append(bar);
    }
    return container;
  }

  function render() {
    const status = document.getElementById('status');
    const limits = document.getElementById('limits');
    limits.replaceChildren();
    if (!validSnapshot(snapshot)) {
      status.textContent = storageFailed ? 'Could not load' : 'No saved usage';
      limits.append(element('p', 'Open usage to load your limits.', 'empty'));
      return;
    }
    const now = Date.now();
    const age = Math.max(0, now - snapshot.capturedAt);
    const stale = age >= STALE_AFTER;
    const ageText = age < 60000 ? 'just now' : age < 3600000 ? `${Math.floor(age / 60000)}m ago`
      : age < 86400000 ? `${Math.floor(age / 3600000)}h ago` : `${Math.floor(age / 86400000)}d ago`;
    status.textContent = `${stale ? 'Outdated' : 'Saved'} · ${ageText}`;
    status.title = `Last read from Usage Overview: ${new Date(snapshot.capturedAt).toLocaleString()}. Open or reload that page to update usage. Time remaining updates automatically.`;
    for (const limit of snapshot.limits) {
      const expired = limit.resetAt <= now;
      const remaining = Math.max(0, Math.min(100, (limit.resetAt - now) / limit.interval * 100));
      const card = element('section', undefined, 'limit');
      card.append(element('h2', limit.label));
      const advice = globalThis.CodexPace.describe(limit, now, { stale });
      if (advice) {
        const message = element('p', advice.message, 'pace-message');
        message.dataset.pace = advice.state;
        message.title = 'Based on this limit only, assuming even usage throughout the cycle. Other limits may still apply.';
        card.append(message);
      }
      card.append(metric(stale ? 'Saved usage remaining' : 'Usage remaining', expired ? null : limit.usageRemaining, false, 'usage'));
      card.append(metric('Time remaining', remaining, limit.approximate, 'time'));
      let pace;
      if (expired) pace = 'Cycle ended · refresh usage';
      else if (stale) pace = 'Refresh usage to check pace';
      else if (limit.usageRemaining === null) pace = 'Usage unavailable';
      else {
        const difference = limit.usageRemaining - remaining;
        pace = Math.abs(difference) < 1 ? 'On pace'
          : difference > 0 ? 'Room to spare' : 'Above pace';
      }
      const paceLabel = element('p', pace, 'pace');
      paceLabel.title = 'Pacing compares usage remaining with time remaining, assuming even usage throughout the cycle.';
      card.append(paceLabel);
      const reset = element('p', `${limit.approximate ? 'Estimated reset' : 'Resets'} ${new Date(limit.resetAt).toLocaleString(undefined,
        { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, 'reset');
      reset.title = 'Pacing assumes even usage throughout the cycle.';
      card.append(reset);
      limits.append(card);
    }
  }

  async function init() {
    if (!globalThis.chrome?.storage?.local) {
      storageFailed = true;
      render();
      return;
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !Object.hasOwn(changes, 'usageSnapshot')) return;
      storageChanged = true;
      snapshot = changes.usageSnapshot.newValue;
      storageFailed = false;
      render();
    });
    try {
      const saved = await chrome.storage.local.get('usageSnapshot');
      if (!storageChanged) snapshot = saved.usageSnapshot;
    } catch {
      storageFailed = true;
    }
    render();
    setInterval(render, 15000);
  }
  init();
})();
