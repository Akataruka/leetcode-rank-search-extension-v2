# Leetcode Rank Search Tool 🏁

> Because manually paging through rankings is the true boss fight of every contest.

Welcome to the browser companion that lets you triage LeetCode standings like a backend service watching its logs: fast, cached, and oddly satisfying.

---

## ⚡ TL;DR (For the caffeine-deprived)

| Use Case | What the extension does |
| --- | --- |
| Track friends/teammates | Paste a list of handles, mash **Start**, collect bragging rights. |
| Audit historical contests | Jump back in time without the “Next page… now wait” dance. |
| Monitor fresh finishes | Run it right after the contest; cached snapshots stick around for replay. |
| Save bandwidth/brain cells | Cache-first lookups mean repeated searches are basically instant. |

---

## 🧱 Feature Highlights (with opinionated commentary)

- **Multi-search input:** Throw in every username you care about—friends, rivals, that one person who always climbs 200 ranks in 10 minutes.
- **Live telemetry:** The popup spells out which page we’re on, where the data came from (cache vs network), and who’s already been found.
- **Instant caching:** Every page fetched is cached on contact and indexed for later. Even misses teach the cache new tricks.
- **Smart freshness:** Anything older than 15 minutes is stamped as stale so you can decide whether to trust or re-run.
- **Manual overrides:** `Start`, `Stop`, `Clear Cache`—because sometimes you really do want the big red button.
- **Autocomplete history:** Recent queries bubble up in a dropdown, courtesy of `chrome.storage.local` and a datalist.
- **Stay-in-place UX:** The popup never hijacks a new tab; if Chrome says otherwise you’re probably staring at DevTools instead of the contest.

---

## 🔩 Tech Specs Cheat Sheet

| Lever | Value |
| --- | --- |
| Runtime | Manifest V3, popup + content script (no background service worker) |
| Storage | `chrome.storage.local` (contest cache + lookup history) |
| Network | `https://leetcode.com/contest/api/ranking/<slug>/` with your authenticated session |
| Caching | 15-minute freshness cap, 8-contest retention, incremental writes |
| Messaging | `START_LOOKUP`, `STOP_LOOKUP`, `LOOKUP_PROGRESS`, `LOOKUP_RESULT` |

All tweakables live under `CONFIG` in `contentScript.js`. Change them there, not in ten scattered files.

---

## 🧠 Architecture Crash Course

1. **Popup (`popup.html` / `popup.js`)**
   - Owns the UI, sanitises inputs, manages lookup state, persists query history.
   - Sends `START_LOOKUP` / `STOP_LOOKUP` to the active contest tab.
   - Streams progress + results back into the user rows.

2. **Content Script (`contentScript.js`)**
   - Boots on contest pages, figures out the contest slug, and orchestrates pagination.
   - Writes freshly fetched pages into cache immediately and maintains a quick-lookup index.
   - Emits progress events so the popup can stay smugly informative.

3. **Manifest (`manifest.json`)**
   - Grants `activeTab`, `tabs`, `scripting`, `storage`.
   - Restricts the content script to `https://leetcode.com/contest/*`.

```
Popup UI ── sendMessage ──▶ Content Script
   ▲                          │
   │                          ├─ fetch() pages (AbortController guarded)
   │                          ├─ cache + index merge
   └─◀─ progress/results ─────┘
```

---

## 🛠️ Install & Fire It Up

1. Clone/download this repo.
2. Visit `chrome://extensions/`, flip the **Developer mode** toggle.
3. Click **Load unpacked** and pick the project folder.
4. Pin the extension if you want one-click glory.
5. Open a contest ranking page and click the icon to launch the popup.
6. Paste handles ➡️ hit **Start** ➡️ watch results stream in.

Need to bail out mid-run? Smash **Stop**. Want a pristine crawl? **Clear Cache** only wipes contest data—your lookup history stays for autocomplete goodness.

---

## 🔍 Implementation Details Worth Knowing

- **Single concurrency path:** An internal `AbortController` cancels any previous lookup before the next one begins.
- **Cache entries:** Keyed by `CONFIG.CACHE_PREFIX + slug + region`. Payload stores pages, metadata, and an index of known users.
- **Incremental writes:** As soon as a page lands, it’s reconciled into cache—no “found a user” prerequisite.
- **Lookup history:** Last 50 sanitized handles are deduped and stored locally; the popup keeps them alphabet soup-free.
- **Pruning policy:** 8 most recent contests plus anything younger than 15 minutes survive; the rest are humanely deleted.
- **Progress pulse:** Each `LOOKUP_PROGRESS` includes the page number, total pages (if known), the data origin, and completion state.

Debugging the pipeline? Set a breakpoint in `saveContestCache` (around `contentScript.js:340`) and watch how pages become neat little indexed blobs.

---

## 🧪 Run-Loop Checklist (aka “did it work?”)

- `Start` lights up rows with spinners, `Stop` flips them to “Stopped.” ✅
- Cache hits shout out “Cache” in the progress bar, stale ones say “Cache (stale).” ✅
- Re-running a recent search should autocomplete via the dropdown. ✅
- Hitting **Clear Cache** invalidates contest data but keeps your history list intact. ✅

---

## 🆘 Troubleshooting Matrix

| Symptom | Fix |
| --- | --- |
| “Open a LeetCode contest page” warning | Switch the active tab to a contest ranking first. |
| All users return “Not found” | Double-check usernames (display vs slug) and confirm you can see the rankings manually. |
| Results feel ancient | Tap **Clear Cache** or wait for the background refresh to finish; stale cache entries are labelled. |
| Spinner never stops | Ensure you’re logged into LeetCode. Network hiccups show up as warnings in the status badge. |

---

## 🧩 Customize to Taste

- **Region swaps:** Change `CONFIG.REGION` to `us`, `cn`, etc.
- **Cache appetite:** Tweak `CACHE_MAX_AGE_MS` and `CACHE_MAX_CONTESTS` for different retention policies.
- **UI flair:** Edit `popup.html` / `popup.js`—the event wiring is already compartmentalised.
- **Debug toasts:** Toggle `CONFIG.DEBUG_TOASTS` and use the `logDebug` helper.
- **Bulk test runs:** Keep a `.txt` list of handles nearby; the input pipeline trims, dedupes, and normalises on the fly.

---

## 🧰 Dev Console Tricks

- `chrome.storage.local.get(null, console.log)` (contest tab) to inspect cache payloads.
- Use the popup’s **Clear Cache** button between experiments; it prunes contest entries but preserves lookup history.
- Add `?page=42` to ranking URLs when testing pagination logic—the content script recalculates bounds automatically.
- Check the Network panel for `/contest/api/ranking/` requests to confirm the abort behaviour is doing its job.

---

## 📜 License

Provided as-is for personal use. If you plan to ship this beyond your friend group, slap on a proper license and keep the cache-friendly behaviour intact so everyone enjoys fast lookups (and fewer page clicks).
