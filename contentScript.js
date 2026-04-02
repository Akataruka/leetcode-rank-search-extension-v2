(() => {
  if (window.__lcRankLookupLoaded) {
    console.debug('[LeetCode Rank Lookup] Content script already initialized.');
    return;
  }
  window.__lcRankLookupLoaded = true;

  const CONFIG = Object.freeze({
    REGION: 'global_v2',
    CACHE_PREFIX: 'lcContestRankingCache:',
    CACHE_MAX_AGE_MS: 15 * 60 * 1000,
    CACHE_MAX_CONTESTS: 8
  });
  const CACHE_VERSION = 1;

  let activeController = null;

  // ---------------------------------------------------------------------------
  // Basic utilities
  // ---------------------------------------------------------------------------
  const toPositiveInteger = (value) => {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : null;
  };

  const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');

  const stripWrappingQuotes = (value) => {
    const trimmed = sanitizeString(value);
    if (trimmed.length >= 2) {
      const first = trimmed[0];
      const last = trimmed[trimmed.length - 1];
      if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
        return trimmed.slice(1, -1).trim();
      }
    }
    return trimmed;
  };

  const canonicalizeValue = (value) => stripWrappingQuotes(value).toLowerCase();
  const normalizeQuery = (query) => canonicalizeValue(query);
  const cleanQueryValue = (value) => stripWrappingQuotes(value);

  // ---------------------------------------------------------------------------
  // Storage wrappers
  // ---------------------------------------------------------------------------
  const storageGetAsync = (keys = null) =>
    new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        });
      } catch (error) {
        reject(error);
      }
    });

  const storageSetAsync = (items) =>
    new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(items, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      } catch (error) {
        reject(error);
      }
    });

  const storageRemoveAsync = (keys) =>
    new Promise((resolve, reject) => {
      try {
        chrome.storage.local.remove(keys, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      } catch (error) {
        reject(error);
      }
    });

  // ---------------------------------------------------------------------------
  // Contest helpers
  // ---------------------------------------------------------------------------
  const isContestPage = () => /^\/contest\//.test(window.location.pathname);

  const getContestInfo = () => {
    if (!isContestPage()) {
      return null;
    }
    const segments = window.location.pathname.split('/').filter(Boolean);
    if (segments.length < 2 || segments[0] !== 'contest') {
      return null;
    }
    const slug = segments[1];
    const metaName = document.querySelector('meta[property="og:title"]')?.content?.trim();
    const fallbackTitle = document.title?.trim();
    const contestName = metaName || fallbackTitle || slug.replace(/-/g, ' ');
    return { slug, contestName };
  };

  const buildRankingLink = (slug, pageNo) => {
    const safePage = pageNo && pageNo !== '' ? String(pageNo) : '1';
    return `https://leetcode.com/contest/${slug}/ranking/${safePage}/?region=${CONFIG.REGION}`;
  };

  const getCacheKey = (slug) => `${CONFIG.CACHE_PREFIX}${slug}:${CONFIG.REGION}`;

  // ---------------------------------------------------------------------------
  // Normalisation helpers
  // ---------------------------------------------------------------------------
  const deriveDisplayNameFromApi = (entry, fallback) => {
    const candidates = [
      entry?.profile?.realName,
      entry?.profile?.real_name,
      entry?.profile?.userName,
      entry?.profile?.user_name,
      entry?.profile?.username,
      entry?.profile?.displayName,
      entry?.profile?.display_name,
      entry?.profile?.userSlug,
      entry?.user_display_name,
      entry?.userDisplayName,
      entry?.user_name,
      entry?.userName,
      entry?.user_slug,
      entry?.userSlug,
      entry?.real_name,
      entry?.displayName
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = sanitizeString(candidates[i]);
      if (candidate) {
        return candidate;
      }
    }
    return fallback;
  };

  const normalizeRankEntryFromApi = (entry) => {
    const userId = sanitizeString(entry?.username);
    const userName = deriveDisplayNameFromApi(entry, userId);
    const rankSource =
      entry?.rank ??
      entry?.contest_rank ??
      entry?.contest_ranking ??
      entry?.global_ranking ??
      entry?.contestRanking ??
      null;
    const rank = rankSource != null && rankSource !== '' ? String(rankSource) : '';
    return {
      user_id: userId,
      user_name: sanitizeString(userName) || userId,
      rank
    };
  };

  const normalizeRankEntryFromCache = (entry) => {
    const userId = sanitizeString(entry?.user_id);
    const userName = sanitizeString(entry?.user_name) || userId;
    const rank = entry?.rank != null && entry.rank !== '' ? String(entry.rank) : '';
    return {
      user_id: userId,
      user_name: userName,
      rank
    };
  };

  const normalizePageFromCache = (page) => {
    if (!page) {
      return { contest_id: '', page_no: '', ranks: [] };
    }
    return {
      contest_id: sanitizeString(page?.contest_id),
      page_no: page?.page_no != null && page.page_no !== '' ? String(page.page_no) : '',
      ranks: Array.isArray(page?.ranks) ? page.ranks.map(normalizeRankEntryFromCache) : []
    };
  };

  const mergePages = (existingPages, newPages) => {
    const map = new Map();
    (existingPages ?? []).forEach((page) => {
      const key = String(page?.page_no ?? '');
      if (key) {
        map.set(key, page);
      }
    });
    (newPages ?? []).forEach((page) => {
      const key = String(page?.page_no ?? '');
      if (key) {
        map.set(key, page);
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      const aNum = toPositiveInteger(a?.page_no) ?? Number.MAX_SAFE_INTEGER;
      const bNum = toPositiveInteger(b?.page_no) ?? Number.MAX_SAFE_INTEGER;
      return aNum - bNum;
    });
  };

  const extractPageMetadata = (rankingJson, ranksLength) => {
    const totalPagesCandidates = [
      rankingJson?.total_page,
      rankingJson?.totalPage,
      rankingJson?.total_pages,
      rankingJson?.page_total
    ];
    let totalPages = null;
    for (let i = 0; i < totalPagesCandidates.length; i += 1) {
      const candidate = toPositiveInteger(totalPagesCandidates[i]);
      if (candidate) {
        totalPages = candidate;
        break;
      }
    }

    const totalUsersCandidates = [
      rankingJson?.total_user_num,
      rankingJson?.total_user_count,
      rankingJson?.total_users,
      rankingJson?.user_num,
      rankingJson?.total_rank_count
    ];
    let totalUsers = null;
    for (let i = 0; i < totalUsersCandidates.length; i += 1) {
      const candidate = toPositiveInteger(totalUsersCandidates[i]);
      if (candidate) {
        totalUsers = candidate;
        break;
      }
    }

    const pageSizeCandidate =
      toPositiveInteger(rankingJson?.page_size) ??
      toPositiveInteger(rankingJson?.per_page);
    const pageSize = pageSizeCandidate ?? (ranksLength > 0 ? ranksLength : null);

    if (!totalPages && totalUsers && pageSize) {
      totalPages = Math.ceil(totalUsers / pageSize);
    }

    return { totalPages: totalPages ?? null };
  };

  // ---------------------------------------------------------------------------
  // Cache indexing
  // ---------------------------------------------------------------------------
  const buildCacheIndex = (pages, slug) => {
    const index = {};
    pages.forEach((page) => {
      const pageNo = page?.page_no ?? '';
      const link = buildRankingLink(slug, pageNo);
      (page?.ranks ?? []).forEach((entry) => {
        const userId = sanitizeString(entry?.user_id);
        const userName = sanitizeString(entry?.user_name);
        const rank = entry?.rank != null && entry.rank !== '' ? String(entry.rank) : '';
        const candidates = [userId, userName]
          .map(normalizeQuery)
          .filter((value, pos, array) => value && array.indexOf(value) === pos);
        const payload = {
          page_no: pageNo,
          rank,
          user_id: userId,
          user_name: userName,
          link
        };
        candidates.forEach((key) => {
          if (!index[key]) {
            index[key] = payload;
          }
        });
      });
    });
    return index;
  };

  const loadContestCache = async (slug) => {
    const cacheKey = getCacheKey(slug);
    try {
      const stored = await storageGetAsync(cacheKey);
      const payload = stored?.[cacheKey];
      if (!payload) {
        return null;
      }

      const fetchedAtRaw = Number(payload.fetchedAt);
      const fetchedAt = Number.isFinite(fetchedAtRaw) && fetchedAtRaw > 0 ? fetchedAtRaw : 0;
      const ageMs = fetchedAt > 0 ? Date.now() - fetchedAt : Number.POSITIVE_INFINITY;
      const cacheMaxAge = Number.isFinite(CONFIG.CACHE_MAX_AGE_MS) ? CONFIG.CACHE_MAX_AGE_MS : 0;
      const stale = cacheMaxAge > 0 && ageMs > cacheMaxAge;
      const pages = Array.isArray(payload.pages)
        ? payload.pages.map(normalizePageFromCache)
        : [];
      const inferredLastPage = pages.reduce((max, page) => {
        const pageNo = toPositiveInteger(page?.page_no);
        return pageNo ? Math.max(max, pageNo) : max;
      }, 0);
      const lastPageFetched = toPositiveInteger(payload.lastPageFetched) ?? inferredLastPage;
      const totalPages = toPositiveInteger(payload.totalPages) ?? null;
      const complete = Boolean(payload.complete) && lastPageFetched > 0;
      const version = toPositiveInteger(payload.indexVersion) ?? 0;
      let index = null;
      if (payload.index && version === CACHE_VERSION) {
        index = payload.index;
      } else {
        index = buildCacheIndex(pages, slug);
      }

      return {
        key: cacheKey,
        slug,
        contestName: sanitizeString(payload.contestName),
        pages,
        index,
        summary: {
          fetchedAt,
          totalPages,
          lastPageFetched,
          complete
        },
        stale
      };
    } catch (error) {
      console.warn('[LeetCode Rank Lookup] Failed to load cache:', error);
      return null;
    }
  };

  const saveContestCache = async (slug, payload, options = {}) => {
    const { skipPrune = false } = options;
    const cacheKey = getCacheKey(slug);
    const pages = Array.isArray(payload.pages)
      ? payload.pages.map(normalizePageFromCache)
      : [];
    const fetchedAtRaw = Number(payload.fetchedAt);
    const fetchedAt = Number.isFinite(fetchedAtRaw) && fetchedAtRaw > 0 ? fetchedAtRaw : Date.now();
    const index = buildCacheIndex(pages, slug);
    try {
      await storageSetAsync({
        [cacheKey]: {
          contest_id: sanitizeString(payload.contest_id),
          contestName: sanitizeString(payload.contestName),
          region: sanitizeString(payload.region) || CONFIG.REGION,
          fetchedAt,
          pages,
          lastPageFetched: toPositiveInteger(payload.lastPageFetched),
          complete: Boolean(payload.complete),
          totalPages: toPositiveInteger(payload.totalPages) ?? null,
          index,
          indexVersion: CACHE_VERSION
        }
      });
      if (!skipPrune) {
        await pruneContestCache(cacheKey);
      }
    } catch (error) {
      console.warn('[LeetCode Rank Lookup] Failed to persist cache:', error);
    }
  };

  const pruneContestCache = async (preserveKey) => {
    const maxContests = toPositiveInteger(CONFIG.CACHE_MAX_CONTESTS) ?? 0;
    const enforceLimit = maxContests > 0;
    const cacheMaxAge = toPositiveInteger(CONFIG.CACHE_MAX_AGE_MS) ?? 0;
    if (!enforceLimit && cacheMaxAge <= 0) {
      return;
    }
    try {
      const allEntries = await storageGetAsync(null);
      const now = Date.now();
      const entries = Object.entries(allEntries || {})
        .filter(([key]) => typeof key === 'string' && key.startsWith(CONFIG.CACHE_PREFIX) && key !== preserveKey)
        .map(([key, value]) => {
          const fetchedAtRaw = Number(value?.fetchedAt);
          const fetchedAt = Number.isFinite(fetchedAtRaw) && fetchedAtRaw > 0 ? fetchedAtRaw : 0;
          return { key, fetchedAt };
        });
      if (!entries.length) {
        return;
      }

      const keysToRemove = new Set();
      if (cacheMaxAge > 0) {
        entries.forEach((entry) => {
          if (!entry.fetchedAt || now - entry.fetchedAt > cacheMaxAge) {
            keysToRemove.add(entry.key);
          }
        });
      }

      const remaining = entries.filter((entry) => !keysToRemove.has(entry.key));
      if (enforceLimit && remaining.length + 1 > maxContests) {
        const excess = remaining.length + 1 - maxContests;
        if (excess > 0) {
          remaining
            .sort((a, b) => (a.fetchedAt ?? 0) - (b.fetchedAt ?? 0))
            .slice(0, excess)
            .forEach((entry) => keysToRemove.add(entry.key));
        }
      }

      if (keysToRemove.size > 0) {
        await storageRemoveAsync(Array.from(keysToRemove));
      }
    } catch (error) {
      console.warn('[LeetCode Rank Lookup] Failed to prune cached contests:', error);
    }
  };

  // ---------------------------------------------------------------------------
  // Query state helpers
  // ---------------------------------------------------------------------------
  const initQueryState = (queries) => {
    const infoList = queries.map((query, index) => {
      const cleaned = cleanQueryValue(query);
      return {
        original: cleaned,
        normalized: normalizeQuery(cleaned),
        index
      };
    });
    const unmatched = new Set(
      infoList.filter((info) => info.normalized.length).map((info) => info.index)
    );
    const results = new Array(infoList.length).fill(null);
    return { infoList, unmatched, results };
  };

  const applyIndexMatches = (index, queryState, slug, origin, announceMatch) => {
    if (!index || !queryState) {
      return;
    }
    const { unmatched, infoList, results } = queryState;
    if (!unmatched.size) {
      return;
    }
    Array.from(unmatched).forEach((idx) => {
      const info = infoList[idx];
      if (!info?.normalized) {
        return;
      }
      const hit = index[info.normalized];
      if (!hit) {
        return;
      }
      const result = {
        query: info.original,
        found: true,
        page_no: hit.page_no || '',
        rank: hit.rank || '',
        user_id: hit.user_id || '',
        user_name: hit.user_name || '',
        link: hit.link || buildRankingLink(slug, hit.page_no),
        origin
      };
      results[idx] = result;
      unmatched.delete(idx);
      if (typeof announceMatch === 'function') {
        announceMatch(idx, result, origin);
      }
    });
  };

  const updateMatchesFromPage = (page, queryState, slug, announceMatch, origin) => {
    if (!page || !queryState) {
      return;
    }
    const ranks = Array.isArray(page?.ranks) ? page.ranks : [];
    if (!ranks.length || !queryState.unmatched.size) {
      return;
    }
    const pageNo = page?.page_no != null ? String(page.page_no) : '';
    const link = buildRankingLink(slug, pageNo);
    ranks.forEach((entry) => {
      const userId = sanitizeString(entry?.user_id);
      const userName = sanitizeString(entry?.user_name);
      const candidates = [userId, userName]
        .map(normalizeQuery)
        .filter((value, pos, array) => value && array.indexOf(value) === pos);
      if (!candidates.length) {
        return;
      }
      const rank = entry?.rank != null && entry.rank !== '' ? String(entry.rank) : '';
      Array.from(queryState.unmatched).forEach((idx) => {
        if (queryState.results[idx]) {
          return;
        }
        const info = queryState.infoList[idx];
        if (candidates.includes(info.normalized)) {
          const result = {
            query: info.original,
            found: true,
            page_no: pageNo,
            rank,
            user_id: userId,
            user_name: userName,
            link,
            origin
          };
          queryState.results[idx] = result;
          queryState.unmatched.delete(idx);
          if (typeof announceMatch === 'function') {
            announceMatch(idx, result, origin);
          }
        }
      });
    });
  };

  const finalizeUserResults = (queryState) =>
    queryState.infoList.map((info, index) => {
      const result = queryState.results[index];
      if (result) {
        return result;
      }
      return { query: info.original, found: false };
    });

  // ---------------------------------------------------------------------------
  // Messaging helpers
  // ---------------------------------------------------------------------------
  const emitProgressUpdate = ({
    slug,
    contestName,
    pageNo,
    totalPages,
    origin,
    done,
    lookupId,
    aborted
  }) => {
    if (!lookupId) {
      return;
    }
    try {
      chrome.runtime.sendMessage(
        {
          type: 'LOOKUP_PROGRESS',
          slug,
          contestName,
          page: pageNo != null ? String(pageNo) : null,
          totalPages: totalPages != null ? String(totalPages) : null,
          origin,
          done: Boolean(done),
          aborted: Boolean(aborted),
          lookupId
        },
        () => void chrome.runtime.lastError
      );
    } catch (error) {
      console.debug('[LeetCode Rank Lookup] Progress update skipped:', error);
    }
  };

  const emitLookupResult = ({ lookupId, index, origin, slug, contestName, result }) => {
    if (!lookupId) {
      return;
    }
    try {
      chrome.runtime.sendMessage(
        {
          type: 'LOOKUP_RESULT',
          lookupId,
          index,
          origin,
          slug,
          contestName,
          ...result
        },
        () => void chrome.runtime.lastError
      );
    } catch (error) {
      console.debug('[LeetCode Rank Lookup] Failed to emit lookup result update:', error);
    }
  };

  // ---------------------------------------------------------------------------
  // Ranking API access
  // ---------------------------------------------------------------------------
  const fetchPageData = async (contestInfo, pageNo) => {
    if (!activeController) {
      return null;
    }
    const apiUrl = `https://leetcode.com/contest/api/ranking/${contestInfo.slug}/?pagination=${encodeURIComponent(
      String(pageNo)
    )}&region=${CONFIG.REGION}`;
    const response = await fetch(apiUrl, {
      signal: activeController.signal,
      credentials: 'include'
    });
    if (!response.ok) {
      throw new Error(`Ranking request failed with status ${response.status}`);
    }

    const rankingJson = await response.json();
    const ranks = Array.isArray(rankingJson?.total_rank)
      ? rankingJson.total_rank.map(normalizeRankEntryFromApi)
      : [];
    const pagePayload = {
      contest_id: contestInfo.slug,
      page_no: String(pageNo),
      ranks
    };
    const metadata = extractPageMetadata(rankingJson, ranks.length);

    return {
      page: normalizePageFromCache(pagePayload),
      totalPages: metadata.totalPages
    };
  };

  // ---------------------------------------------------------------------------
  // Lookup orchestration
  // ---------------------------------------------------------------------------
  const resetController = () => {
    if (activeController) {
      activeController.abort();
    }
    activeController = null;
  };

  const startLookup = async (users, lookupId) => {
    const contestInfo = getContestInfo();
    if (!contestInfo) {
      return { ok: false, error: 'Open a LeetCode contest page before starting the lookup.' };
    }

    const queries = Array.isArray(users)
      ? users.map((entry) => (typeof entry === 'string' ? cleanQueryValue(entry) : '')).filter(Boolean)
      : [];
    if (!queries.length) {
      return { ok: false, error: 'Provide at least one user ID or name to search.' };
    }

    resetController();

    const { slug, contestName } = contestInfo;
    const queryState = initQueryState(queries);
    const announceMatch = (index, result, origin) =>
      emitLookupResult({ lookupId, index, origin, slug, contestName, result });

    let fromCache = false;
    let cacheStale = false;
    let usedNetwork = false;
    let aborted = false;
    let errorMessage = null;
    let pagesProcessed = 0;
    let retrievedAllPages = false;
    let totalPagesKnown = null;
    let lastPageFetched = 0;

    const cached = await loadContestCache(slug);
    const cachedPages = cached?.pages ?? [];
    let currentPages = cachedPages.slice();

    if (cached) {
      fromCache = true;
      cacheStale = cached.stale;
      pagesProcessed += cached.pages.length;
      totalPagesKnown = cached.summary.totalPages ?? null;
      lastPageFetched = cached.summary.lastPageFetched ?? 0;
      retrievedAllPages = cacheStale ? false : Boolean(cached.summary.complete);
      const cacheOrigin = cacheStale ? 'cache-stale' : 'cache';

      applyIndexMatches(cached.index, queryState, slug, cacheOrigin, announceMatch);

      emitProgressUpdate({
        slug,
        contestName,
        pageNo: cached.summary.lastPageFetched ?? null,
        totalPages: totalPagesKnown,
        origin: cacheOrigin,
        done: false,
        lookupId,
        aborted: false
      });
    }

    const needRefresh = cacheStale;
    const requiresNetwork =
      needRefresh || queryState.unmatched.size > 0 || !retrievedAllPages;
    const newPages = [];

    if (requiresNetwork) {
      activeController = new AbortController();
      const startingPage = needRefresh ? 1 : Math.max(lastPageFetched + 1, 1);

      try {
        for (let pageNo = startingPage; activeController && !activeController.signal.aborted; pageNo += 1) {
          usedNetwork = true;
          const result = await fetchPageData(contestInfo, pageNo);
          if (!activeController || activeController.signal.aborted) {
            break;
          }

          const normalizedPage = result?.page;
          if (!normalizedPage || !Array.isArray(normalizedPage.ranks) || normalizedPage.ranks.length === 0) {
            retrievedAllPages = true;
            emitProgressUpdate({
              slug,
              contestName,
              pageNo,
              totalPages: totalPagesKnown,
              origin: 'network',
              done: false,
              lookupId,
              aborted: false
            });
            break;
          }

          const numericPage = toPositiveInteger(normalizedPage.page_no) ?? pageNo;
          newPages.push(normalizedPage);
          pagesProcessed += 1;
          lastPageFetched = Math.max(lastPageFetched, numericPage);
          currentPages = mergePages(currentPages, [normalizedPage]);

          if (!totalPagesKnown && result?.totalPages) {
            totalPagesKnown = toPositiveInteger(result.totalPages) ?? totalPagesKnown;
          }

          emitProgressUpdate({
            slug,
            contestName,
            pageNo: numericPage,
            totalPages: totalPagesKnown,
            origin: 'network',
            done: false,
            lookupId,
            aborted: false
          });

          updateMatchesFromPage(normalizedPage, queryState, slug, announceMatch, 'network');

          await saveContestCache(
            slug,
            {
              contest_id: slug,
              contestName,
              region: CONFIG.REGION,
              fetchedAt: Date.now(),
              pages: currentPages,
              lastPageFetched,
              complete: false,
              totalPages: totalPagesKnown
            },
            { skipPrune: true }
          );

          if (!needRefresh && queryState.unmatched.size === 0) {
            break;
          }

          if (totalPagesKnown && numericPage >= totalPagesKnown) {
            retrievedAllPages = true;
            break;
          }
        }
      } catch (error) {
        aborted = error.name === 'AbortError';
        if (!aborted) {
          console.error('[LeetCode Rank Lookup] Failed to fetch rankings:', error);
          errorMessage = error.message || 'Failed to fetch contest rankings.';
        }
      } finally {
        activeController = null;
      }
    }

    if (currentPages.length) {
      const inferredLastPage = currentPages.reduce((max, page) => {
        const numericPage = toPositiveInteger(page?.page_no);
        return numericPage ? Math.max(max, numericPage) : max;
      }, 0);
      lastPageFetched = Math.max(lastPageFetched, inferredLastPage);
    }

    let finalComplete =
      retrievedAllPages ||
      (!needRefresh && cached?.summary?.complete);

    if (!aborted && (newPages.length || needRefresh)) {
      const complete =
        retrievedAllPages ||
        (!needRefresh && cached?.summary?.complete);
      finalComplete = complete;
      await saveContestCache(slug, {
        contest_id: slug,
        contestName: contestInfo.contestName,
        region: CONFIG.REGION,
        fetchedAt: Date.now(),
        pages: currentPages,
        lastPageFetched,
        complete,
        totalPages: totalPagesKnown
      });
    }

    emitProgressUpdate({
      slug,
      contestName,
      pageNo: lastPageFetched || null,
      totalPages: totalPagesKnown,
      origin: usedNetwork ? 'network' : fromCache ? (cacheStale ? 'cache-stale' : 'cache') : 'network',
      done: true,
      lookupId,
      aborted
    });

    const userResults = finalizeUserResults(queryState);
    const response = {
      contestName,
      slug,
      userResults,
      pagesFetched: pagesProcessed,
      fromCache,
      cacheStale,
      usedNetwork,
      totalPages: totalPagesKnown ?? null,
      lastPageFetched,
      complete: finalComplete
    };

    if (aborted) {
      return { ok: false, aborted: true, ...response };
    }
    if (errorMessage) {
      return { ok: false, error: errorMessage, ...response };
    }
    return { ok: true, ...response };
  };

  const stopLookup = () => {
    if (!activeController) {
      return { ok: true, stopped: false };
    }
    activeController.abort();
    activeController = null;
    console.log('[LeetCode Rank Lookup] Fetch aborted via Stop.');
    return { ok: true, stopped: true };
  };

  // ---------------------------------------------------------------------------
  // Runtime bridge
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.type) {
      return undefined;
    }
    if (message.type === 'START_LOOKUP') {
      startLookup(message.users, message.lookupId)
        .then(sendResponse)
        .catch((error) => {
          console.error('[LeetCode Rank Lookup] Unexpected error:', error);
          sendResponse({ ok: false, error: error.message || 'Lookup failed unexpectedly.' });
        });
      return true;
    }
    if (message.type === 'STOP_LOOKUP') {
      sendResponse(stopLookup());
      return false;
    }
    return undefined;
  });
})();
