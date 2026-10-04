# Codex Usage Tracker 📊⏳

A small Chrome extension that compares **usage remaining** with **time remaining** in your Codex and ChatGPT Work usage cycle.

## Current usage page

Version 1.2 supports [Settings → Usage → Overview](https://chatgpt.com/settings/usage?tab=overview), including the October 2026 layout. It also recognizes the older Codex usage and analytics URLs.

The extension adds a blue time-remaining bar beneath each supported limit displayed by the page:

- Weekly and daily limits, plus numbered hour/day limits such as **5-hour limit**.
- Exact reset timestamps from the countdown's tooltip when available.
- Relative countdowns such as **Resets in 5d 4h** as a fallback, marked with **≈**.
- A comparison against even usage throughout the cycle. If usage remaining exceeds time remaining, you have room to spare; if it is lower, you are using the allowance faster than an even pace.

Only limits present on your account are shown. This tracks the shared Codex/Work allowance, not ordinary ChatGPT chat message counts. The comparison is a pacing estimate, not a prediction of how many tasks you can run. Unknown cycles or reset formats are skipped rather than guessed.

## Toolbar popup

Click the extension icon to see usage remaining, time remaining, pacing, and the reset time without keeping Usage Overview in front. Pin **Codex Usage Tracker** from Chrome's extensions menu for quick access.

Visit or reload Usage Overview once after installing or updating to populate the popup. The extension saves the most recently read limits locally, so they remain available when the usage tab is closed. It does not fetch account data in the background. Use **Open usage page** and reload that page when you need fresh usage.

The popup shows when the page was last read. After five minutes it marks saved values as potentially out of date and stops making current pacing claims. After a reset deadline, it hides the expired usage balance until fresh data arrives. Time remaining continues to count down while the popup is open. The saved summary belongs to the last usage page read, so revisit Usage Overview after changing accounts or workspaces.

## Install or update

1. Download or clone this repository.
2. Open `chrome://extensions/` and enable **Developer mode**.
3. Choose **Load unpacked** and select this folder (the one containing `manifest.json`).
4. For an existing unpacked installation, click its **Reload** button after updating the files.
5. Reload any already-open ChatGPT tabs and visit [Usage Overview](https://chatgpt.com/settings/usage?tab=overview).

No build or npm installation is required to use the extension. Chrome Web Store distribution is not yet available.

## How it works

The content script recognizes limit labels and their reset text without depending on ChatGPT's CSS utility classes or the old `article` layout. It renders immediately, observes page changes, and refreshes the calculation every 30 seconds. Navigation, changed reset times, and rerendered cards are handled without duplicating the added bar. Extension styles are scoped to its own elements.

Time remaining is `(reset time − current time) / cycle duration`, clamped to 0–100%. Rounded countdown fallbacks are anchored until their source text changes. After a reset deadline passes, the tracker waits for fresh page data; it does not invent the next reset.

Both the popup and usage page show friendly pacing advice from a shared set of 20 messages. Five states have four variations each: plenty of room (20+ percentage points to spare), some room (5+), roughly balanced (within 5), faster usage (5+ points ahead), and much faster usage (20+). Wording rotates every 15 minutes and stays consistent between views for the same limit. Advice applies to each limit separately and assumes usage continues at a similar pace; other limits may still apply. New cycles and exhausted allowances get specific messages, and unavailable, expired, or outdated popup data never triggers encouragement to spend more.

## Permissions and privacy

The extension requests `storage` permission to keep a small usage summary in `chrome.storage.local`: limit names, percentages, cycle durations, reset timestamps, and the time the page was read. This is local to your browser profile and is not synced through the extension. Its content script matches `https://chatgpt.com/*` so it can work when you navigate to Usage from another ChatGPT page without a full reload. It only examines limit cards and displays its UI on supported usage overview routes. It does not read chat content, store account identifiers or credentials, collect analytics, or send requests. Removing the extension clears its locally saved summary.

See [privacy-policy.txt](./privacy-policy.txt).

## Development checks

With Node.js 18 or newer:

```sh
npm ci
npm test
```

Tests cover the observed card structure, legacy markup, exact and relative reset parsing, multiple limits, changing values, delayed rendering, route changes, expired resets, duplicate/observer-loop prevention, popup rendering, stale and expired summaries, storage failures, and the content-script-to-popup data flow. `jsdom` is a development-only dependency and is not shipped with the extension.

`test/fixtures/overview.html` is a sanitized local layout fixture with sample data. The older `Screenshot.png` illustrates the previous page design.
