# Leetcode Rank Search Tool 🏁

Stop playing “click next page” whack‑a‑mole on LeetCode rankings. This extension drops a tiny agent into contest pages, streams the good bits back to a popup, and caches every page it touches so your subsequent lookups are instant. Think of it as your personal standings CLI, but in browser form. Also think of it as a glorified `curl | jq` pipeline with nicer buttons and zero bash scripts to maintain.

---

## Why You Might Want It (a.k.a. the TL;DR table)

| Use Case | What the extension does for you |
| --- | --- |
| Track friends/teammates | Enter a pile of handles, hit Start, watch the bragging rights sort themselves out. |
| Audit historical contests | Jump to an old contest and search without paging through 50 slow ranking screens. |
| Monitor fresh results | Run it seconds after the contest ends; the agent pulls new data and caches it for replays. |
| Avoid repeated API calls | Cache-first lookups means your second search is basically free (and fast). |

---

## Feature Tour (with commentary)

- **Multi-user search:** Paste every handle from your team Slack channel. We fan out, page by page, until everyone is accounted for or the contest runs dry.
- **Live progress bars:** Want to know if we’re hitting cache or the network? The popup tells you which page we’re on and where the data came from.
- **Instant caching:** As soon as we touch a page, it’s cached, indexed, and ready for the next lookup—even if the user you wanted wasn’t on it yet.
- **Smart refresh:** Cached data older than 15 minutes is marked as stale; we still reuse it instantly and quietly refresh pages in the background.
- **Manual override:** `Start`, `Stop`, `Clear Cache`. Buttons you already know, with the behaviours you expect.
- **Actionable results:** Every hit shows rank, page number, and a handy `View` link that dumps you into the right LeetCode page in a new tab.
- **Zero-extension gymnastics:** Everything runs in-page; no mystery tabs, portals, or new windows. If Chrome blocks the popup, you’re probably in DevTools by accident.
- **Autocomplete history:** Every lookup seeds a local history list so you get dropdown suggestions for frequent handles as you type.

---

## Tech Specs at a Glance

| Lever | Value |
| --- | --- |
| Runtime | Manifest V3, backgroundless popup/content duo |
| Storage | `chrome.storage.local` with JSON payloads (contest cache + index) |
| Network | Fetches `https://leetcode.com/contest/api/ranking/<slug>/` with your session cookies |
| Caching | 15-minute freshness budget, 8-contest LRU-ish trimming |
| Messaging | `START_LOOKUP`, `STOP_LOOKUP`, `LOOKUP_PROGRESS`, `LOOKUP_RESULT` |

When in doubt, search `CONFIG` inside `contentScript.js`; all the tweakable bits live in one place.

---

## How It Works (Architecture, no whiteboard required)

1. **Popup (`popup.html` / `popup.js`)**  
   - Renders the UI, collects user inputs, and displays progress/results.  
   - Sends `START_LOOKUP` and `STOP_LOOKUP` messages to the active contest tab.  
   - Receives `LOOKUP_PROGRESS` and `LOOKUP_RESULT` messages and updates the UI in real time.

2. **Content Script (`contentScript.js`)**  
   - Runs inside contest pages.  
   - Derives the contest slug, orchestrates page fetches, and caches every page it touches.  
   - Maintains an index keyed by normalized user identifiers so cached lookups don’t rescan pages.  
   - Emits progress + result messages back to the popup.

 3. **Manifest (`manifest.json`)**  
    - Declares permissions (`activeTab`, `tabs`, `scripting`, `storage`) and wires the popup/content script.  
    - Targets `https://leetcode.com/contest/*` so the helper only runs on contest pages.

If you prefer a pseudo-diagram:

```
Popup UI ── sendMessage ──▶ Content Script
   ▲                          │
   │                          ├─ fetch() contest pages (with AbortController)
   │                          ├─ merge pages into cache + index
   └─◀─ receive progress/results ───┘
```

---

## Getting Started (Developers’ edition)

1. **Install Locally**
   1. Clone or download this repository.
   2. Open Chrome (or any Chromium-based browser) and visit `chrome://extensions/`.
   3. Enable **Developer mode** (top-right toggle).
   4. Click **Load unpacked** and select the project directory.
   5. Pin the extension for faster access if desired.

2. **Run a Lookup**
   1. Open a LeetCode contest ranking page, e.g. `https://leetcode.com/contest/weekly-contest-xyz/ranking/`.
   2. Click the extension icon to open the popup.
   3. Add user IDs or display names. Quotes and extra whitespace are stripped automatically.
   4. Hit **Start**. Progress updates appear as each page is scanned.
   5. Results show the page number, rank, the matched name/ID, and a link to open the contest page in a new tab.
   6. Use **Stop** to cancel mid-search or **Clear Cache** to force a fresh crawl.

---

## Behind the Scenes

- **Single Lookup at a Time** – An internal `AbortController` ensures only one lookup runs per contest tab; starting a new lookup cancels the previous one.
- **Immediate Cache Writes** – As soon as a page is fetched, the extension merges it into the cached contest data so future searches reuse it even if no match was found yet.
- **Lookup History** – The popup keeps the last 50 sanitized handles in `chrome.storage.local`, serving them back as autocomplete options without retyping.
- **Cache Policy** – Cache entries are keyed by contest slug + region (`global_v2`). By default the cache keeps the last 15 minutes of results and trims to the eight most recent contests. Tune `CACHE_MAX_AGE_MS` or `CACHE_MAX_CONTESTS` in `contentScript.js` to adjust behaviour.
- **Messaging** – The popup and content script communicate via `chrome.runtime.sendMessage`. Progress messages include page numbers, known totals, origin (`cache`, `cache-stale`, or `network`), and completion state.
- **Network Calls** – Fetches hit the public contest ranking API (`/contest/api/ranking/<slug>/`). Because requests rely on your logged-in session, make sure you can view rankings in the browser.

Need to trace the cache logic quickly? Drop a breakpoint in `saveContestCache` (around `contentScript.js:340`) and watch the merge pipeline turn raw API payloads into indexed snapshots.

---

## Troubleshooting Tips

| Symptom | Try this |
| --- | --- |
| “Open a LeetCode contest page” error | Make sure the active tab is a contest ranking page before starting the lookup. |
| Users show as “Not found” | Verify the exact LeetCode username/display name. Try both the slug (e.g. `john-doe`) and display name capitalization. |
| Results feel stale | Click **Clear Cache** in the popup to wipe local storage and re-fetch the latest rankings. |
| Lookup stalls or fails | Ensure you’re logged into LeetCode and have access to the contest rankings. Network hiccups will surface as errors in the status bar. |

---

## Customising & Extending

- **Regions** – Change `CONFIG.REGION` in `contentScript.js` (`global_v2` by default) to target other LeetCode regions.
- **Cache Policy** – Adjust `CACHE_MAX_AGE_MS` and `CACHE_MAX_CONTESTS` in `CONFIG` to keep data longer or trim more aggressively.
- **UI Tweaks** – Update `popup.html` / `popup.js` for styling or new controls. The popup listens for progress and result events; augment handlers in `popup.js` to add new behaviours.
- **Code Structure** – `contentScript.js` is organised by responsibilities (utilities, storage, caching, messaging, lookup). Each section can be modified independently without cross-cutting changes.
- **Logging Hooks** – Flip `CONFIG.DEBUG_TOASTS` (look for the `logDebug` helper) to surface toasts in the popup while you hack.
- **Testing in Bulk** – Keep a list of handles in a `.txt` file and paste them in one go; the input pipeline trims whitespace, dedupes, and lowercases display names for consistent matching.

---

## Dev Debug Cheatsheet

- Run `chrome.storage.local.get(null, console.log)` in the contest tab console to peek at the cache payload.
- Use the popup’s **Clear Cache** button between test runs; it wipes storage and resets the in-memory index.
- Inspect network waterfall for `/contest/api/ranking/` requests to confirm the abort behaviour and caching hits.
- Add `?page=42` to ranking URLs while testing— the content script recomputes pagination boundaries automatically.

---

## License

This project is provided as-is for personal use. Add a formal license if you plan to distribute or commercialise the tool. Contributions and forks are welcome—just keep the cache-friendly behaviour intact so everyone enjoys fast lookups!
