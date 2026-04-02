# Leetcode Rank Search Tool

Leetcode Rank Search Tool is a Chrome extension that lets you look up multiple users’ standings on any LeetCode contest page without leaving the tab you’re reading. It injects a lightweight helper into contest ranking pages, streams the results back to the popup UI, and caches every page it touches so repeat lookups feel instant.

---

## Why You Might Want It

| Use Case | What the extension does for you |
| --- | --- |
| Track friends/teammates | Enter several user IDs or display names and see who placed where across the contest. |
| Audit historical contests | Sit on an older contest page and quickly search without manually paging the rank list. |
| Monitor fresh results | Run the search right after a contest ends; the tool will fetch new pages and keep them cached. |
| Avoid repeated API calls | Subsequent searches reuse cached pages automatically; stale caches refresh only when needed. |

---

## Feature Tour

- **Multi-user search:** Add as many LeetCode IDs or display names as you like; the extension searches each contest page until everyone is found or the data runs out.
- **Live progress:** The popup reports which page is being scanned, how many pages are known, and whether data comes from cache or the network.
- **Persistent caching:** Every downloaded page is cached immediately. Cached entries expire after 15 minutes and older contests are pruned so storage stays small.
- **Smart refresh:** Stale caches trigger a background refresh but still return existing results instantly. New pages are merged and re-indexed on the fly.
- **Manual controls:** `Start`, `Stop`, and `Clear Cache` buttons let you kick off lookups, abort them mid-flight, or force-refresh the entire dataset.
- **Result actions:** Each match shows the user’s display name, rank, page, and a `View` link that opens the contest ranking page in a new tab.

---

## How It Works (High Level Architecture)

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

---

## Getting Started

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
- **Cache Policy** – Cache entries are keyed by contest slug + region (`global_v2`). By default the cache keeps the last 15 minutes of results and trims to the eight most recent contests. Tune `CACHE_MAX_AGE_MS` or `CACHE_MAX_CONTESTS` in `contentScript.js` to adjust behaviour.
- **Messaging** – The popup and content script communicate via `chrome.runtime.sendMessage`. Progress messages include page numbers, known totals, origin (`cache`, `cache-stale`, or `network`), and completion state.
- **Network Calls** – Fetches hit the public contest ranking API (`/contest/api/ranking/<slug>/`). Because requests rely on your logged-in session, make sure you can view rankings in the browser.

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

---

## License

This project is provided as-is for personal use. Add a formal license if you plan to distribute or commercialise the tool. Contributions and forks are welcome—just keep the cache-friendly behaviour intact so everyone enjoys fast lookups!
