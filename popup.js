const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const addUserBtn = document.getElementById('addUserBtn');
const closeBtn = document.getElementById('closeBtn');
const userListEl = document.getElementById('userList');
const statusEl = document.getElementById('status');
const progressEl = document.getElementById('progress');

let isRunning = false;
let currentTabId = null;
let activeLookupId = null;
let currentActiveRows = [];

function stripWrappingQuotes(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function sanitizeQueryInput(value) {
  return stripWrappingQuotes((value ?? '').trim());
}

function formatOriginLabel(value) {
  if (!value) {
    return '';
  }
  const cleaned = String(value)
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!cleaned) {
    return '';
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function setStatus(message) {
  if (!statusEl) {
    return;
  }
  const text = (message ?? '').trim() || 'Idle';
  statusEl.textContent = text;
  const lower = text.toLowerCase();
  let state = 'idle';
  if (lower.includes('fail') || lower.includes('error')) {
    state = 'error';
  } else if (lower.includes('stop') || lower.includes('abort')) {
    state = 'warning';
  } else if (lower.includes('found') || lower.includes('complete') || lower.includes('cleared')) {
    state = 'success';
  }
  statusEl.dataset.state = state;
}

function setProgress(page, total, origin, { done = false, aborted = false } = {}) {
  if (!progressEl) {
    return;
  }
  if (page == null) {
    if (done) {
      progressEl.textContent = aborted ? 'Stopped' : 'Done';
    } else {
      progressEl.textContent = 'Idle';
    }
    return;
  }
  const totalText = total ? `${page}/${total}` : `${page}/?`;
  const prefix = done ? (aborted ? 'Stopped' : 'Done') : 'Page';
  const originLabel = formatOriginLabel(origin);
  const originSuffix = originLabel ? ` · ${originLabel}` : '';
  progressEl.textContent = `${prefix} ${totalText}${originSuffix}`;
}

function setUiState(running) {
  isRunning = running;
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  addUserBtn.disabled = running;
  clearCacheBtn.disabled = running;
  if (userListEl) {
    userListEl.querySelectorAll('.user-input').forEach((input) => {
      input.disabled = running;
    });
  }
  updateRemoveButtonStates();
}

function getErrorMessage(error) {
  if (!error) {
    return 'Unknown error.';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error.message) {
    return error.message;
  }
  return 'Unexpected error occurred.';
}

function getUserRows() {
  if (!userListEl) {
    return [];
  }
  return Array.from(userListEl.querySelectorAll('.user-row')).map((row) => {
    const input = row.querySelector('.user-input');
    const status = row.querySelector('.user-status');
    return {
      row,
      input,
      status,
      value: (input?.value ?? '').trim()
    };
  });
}

function updateRemoveButtonStates() {
  if (!userListEl) {
    return;
  }
  const rows = Array.from(userListEl.querySelectorAll('.user-row'));
  const disableAll = rows.length <= 1 || isRunning;
  rows.forEach((row) => {
    const btn = row.querySelector('.remove-btn');
    if (btn) {
      btn.disabled = disableAll;
    }
  });
}

function resetRowStatus(rowObj) {
  if (!rowObj?.status) {
    return;
  }
  rowObj.status.classList.remove('not-found', 'found', 'error');
  rowObj.status.innerHTML = '';
  if (rowObj.row) {
    rowObj.row.removeAttribute('data-state');
  }
}

function setRowSearching(rowObj) {
  resetRowStatus(rowObj);
  if (!rowObj?.status) {
    return;
  }
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  rowObj.status.appendChild(spinner);
  const text = document.createElement('span');
  text.className = 'status-meta';
  text.textContent = 'Searching...';
  rowObj.status.appendChild(text);
  if (rowObj.row) {
    rowObj.row.dataset.state = 'searching';
  }
}

function setRowFound(rowObj, result) {
  resetRowStatus(rowObj);
  if (!rowObj?.status) {
    return;
  }
  rowObj.status.classList.add('found');
  const pageLabel = result.page_no || '?';
  const displayId = result.user_id || '';
  const displayName = result.user_name || '';
  let identity = displayName;
  if (!identity || (displayId && identity.toLowerCase() === displayId.toLowerCase())) {
    identity = displayId;
  }
  if (!identity) {
    identity = result.query;
  }
  if (!identity) {
    identity = rowObj.value || '';
  }

  const pill = document.createElement('span');
  pill.className = 'status-pill';
  pill.textContent = identity;
  rowObj.status.appendChild(pill);

  const meta = document.createElement('span');
  meta.className = 'status-meta';
  const details = [`Page ${pageLabel}`];
  if (result.rank) {
    details.push(`Rank #${result.rank}`);
  }
  if (result.origin) {
    const originLabel = formatOriginLabel(result.origin);
    if (originLabel) {
      details.push(originLabel);
    }
  }
  meta.textContent = details.join(' • ');
  rowObj.status.appendChild(meta);

  if (result.link) {
    const link = document.createElement('a');
    link.href = result.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'View';
    rowObj.status.appendChild(link);
  }
  if (rowObj.row) {
    rowObj.row.dataset.state = 'done';
  }
}

function setRowNotFound(rowObj, label) {
  resetRowStatus(rowObj);
  if (!rowObj?.status) {
    return;
  }
  rowObj.status.classList.add('not-found');
  const pill = document.createElement('span');
  pill.className = 'status-pill';
  pill.textContent = label || rowObj.value || 'User';
  rowObj.status.appendChild(pill);

  const text = document.createElement('span');
  text.className = 'status-meta';
  text.textContent = 'Not found';
  rowObj.status.appendChild(text);
  if (rowObj.row) {
    rowObj.row.dataset.state = 'done';
  }
}

function setRowError(rowObj, message) {
  resetRowStatus(rowObj);
  if (!rowObj?.status) {
    return;
  }
  rowObj.status.classList.add('error');
  const pill = document.createElement('span');
  pill.className = 'status-pill';
  pill.textContent = rowObj.value || 'User';
  rowObj.status.appendChild(pill);

  const text = document.createElement('span');
  text.className = 'status-meta';
  text.textContent = message;
  rowObj.status.appendChild(text);
  if (rowObj.row) {
    rowObj.row.dataset.state = 'done';
  }
}

function addUserRow(value = '', focus = false) {
  if (!userListEl) {
    return;
  }
  const row = document.createElement('div');
  row.className = 'user-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'user-input';
  input.placeholder = 'User ID or Name';
  input.value = value;
  row.appendChild(input);

  const status = document.createElement('span');
  status.className = 'user-status';
  row.appendChild(status);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-btn';
  removeBtn.setAttribute('aria-label', 'Remove user');
  removeBtn.textContent = '×';
  row.appendChild(removeBtn);

  removeBtn.addEventListener('click', () => {
    if (isRunning) {
      return;
    }
    if (userListEl.children.length > 1) {
      row.remove();
      updateRemoveButtonStates();
    } else {
      input.value = '';
      resetRowStatus({ row, status });
    }
  });

  input.addEventListener('input', () => {
    if (!isRunning) {
      resetRowStatus({ row, status });
    }
  });

  userListEl.appendChild(row);
  if (focus) {
    input.focus();
  }
  updateRemoveButtonStates();
}

function ensureAtLeastOneRow() {
  if (!userListEl) {
    return;
  }
  if (userListEl.children.length === 0) {
    addUserRow();
  }
}

function applyResultsToRows(rows, results) {
  const list = Array.isArray(results) ? results : [];
  rows.forEach((rowObj, index) => {
    const result = list[index];
    if (!result) {
      setRowError(rowObj, 'No result.');
      return;
    }
    if (result.found) {
      setRowFound(rowObj, result);
    } else {
      setRowNotFound(rowObj);
    }
  });
}

function markSearchingRows(message) {
  const rows = getUserRows();
  rows.forEach((rowObj) => {
    if (rowObj.row?.dataset.state === 'searching') {
      setRowError(rowObj, message);
    }
  });
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['contentScript.js']
    });
  } catch (error) {
    const message = chrome.runtime.lastError?.message || getErrorMessage(error);
    throw new Error(`Failed to inject contest helper: ${message}`);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function sendMessageToTab(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    const message = chrome.runtime.lastError?.message || getErrorMessage(error);
    throw new Error(message);
  }
}

function clearStorage() {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.clear(() => {
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
}

function createLookupId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `lookup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function handleStartClick() {
  if (isRunning) {
    return;
  }

  ensureAtLeastOneRow();
  const rows = getUserRows();
  rows.forEach((row) => {
    const sanitized = sanitizeQueryInput(row.input?.value ?? '');
    if (row.input) {
      row.input.value = sanitized;
    }
    row.value = sanitized;
    if (!sanitized) {
      resetRowStatus(row);
    }
  });

  const activeRows = rows.filter((row) => row.value);
  currentActiveRows = activeRows;
  if (!activeRows.length) {
    currentActiveRows = [];
    setStatus('Enter at least one user ID or name.');
    setProgress(null, null);
    return;
  }

  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus('No active tab found.');
    return;
  }

  currentTabId = tab.id;
  setUiState(true);
  const lookupId = createLookupId();
  activeLookupId = lookupId;
  setStatus(`Searching for ${activeRows.length} user(s)...`);
  setProgress(0, null, 'starting');
  activeRows.forEach(setRowSearching);

  try {
    await ensureContentScript(tab.id);
    const queries = activeRows.map((row) => row.value);
    const response = await sendMessageToTab(tab.id, {
      type: 'START_LOOKUP',
      users: queries,
      lookupId
    });

    if (!response) {
      throw new Error('No response from contest page.');
    }

    activeLookupId = null;

    if (response.ok) {
      const userResults = response.userResults ?? [];
      applyResultsToRows(activeRows, userResults);

      const cacheSource = response.cacheStale ? 'cache (stale)' : 'cache';
      const sourceLabel = response.fromCache && response.usedNetwork
        ? `${cacheSource} + network`
        : response.fromCache
        ? cacheSource
        : 'network';
      const pagesFetched = typeof response.pagesFetched === 'number' ? response.pagesFetched : null;
      const totalPages = typeof response.totalPages === 'number' ? response.totalPages : null;
      const lastPage = typeof response.lastPageFetched === 'number' ? response.lastPageFetched : null;
      const completeNote = response.complete ? 'All pages cached.' : '';
      const pageInfoParts = [];
      if (pagesFetched !== null) {
        pageInfoParts.push(`Processed ${pagesFetched} page(s)`);
      }
      if (totalPages) {
        pageInfoParts.push(`Total known pages: ${totalPages}`);
      }
      if (lastPage && (!totalPages || lastPage !== totalPages)) {
        pageInfoParts.push(`Last fetched page: ${lastPage}`);
      }
      const pageInfo = pageInfoParts.join(' • ');
      const statusDetails = [pageInfo, completeNote].filter(Boolean).join(' • ');

      setStatus(
        [
          `Found ${userResults.filter((entry) => entry.found).length}/${userResults.length} user(s) via ${sourceLabel}`,
          statusDetails
        ]
          .filter(Boolean)
          .join(' • ')
      );
      const finalPageForProgress = lastPage ?? pagesFetched ?? null;
      if (finalPageForProgress != null) {
        setProgress(finalPageForProgress, totalPages, sourceLabel, { done: true, aborted: false });
      } else {
        setProgress(null, null);
      }
    } else if (response.aborted) {
      setStatus('Lookup aborted.');
      markSearchingRows('Aborted.');
      setProgress(null, null, null, { done: true, aborted: true });
    } else {
      const message = response.error || 'Lookup failed.';
      setStatus(message);
      markSearchingRows('Failed.');
      setProgress(null, null);
    }
  } catch (error) {
    activeLookupId = null;
    const message = getErrorMessage(error);
    setStatus(message);
    markSearchingRows('Failed.');
    setProgress(null, null);
  } finally {
    setUiState(false);
    currentActiveRows = [];
  }
}

async function handleStopClick() {
  if (!currentTabId) {
    const activeTab = await getActiveTab();
    currentTabId = activeTab?.id ?? null;
  }

  if (!currentTabId) {
    setStatus('No contest tab to stop.');
    return;
  }

  try {
    await ensureContentScript(currentTabId);
    const response = await sendMessageToTab(currentTabId, { type: 'STOP_LOOKUP' });
    activeLookupId = null;
    if (response?.stopped) {
      setStatus('Lookup stopped.');
      markSearchingRows('Stopped.');
      setProgress(null, null, null, { done: true, aborted: true });
    } else {
      setStatus('Nothing to stop.');
    }
  } catch (error) {
    setStatus(getErrorMessage(error));
  } finally {
    setUiState(false);
    currentActiveRows = [];
  }
}

async function handleClearCacheClick() {
  if (isRunning) {
    return;
  }

  try {
    clearCacheBtn.disabled = true;
    setStatus('Clearing cache...');
    await clearStorage();
    setStatus('Cache cleared.');
    setProgress(null, null);
  } catch (error) {
    const message = `Failed to clear cache: ${getErrorMessage(error)}`;
    setStatus(message);
  } finally {
    clearCacheBtn.disabled = false;
  }
}

function handleLookupProgress(message) {
  if (!message || message.lookupId !== activeLookupId) {
    return;
  }
  const page = message.page != null ? Number(message.page) : null;
  const total = message.totalPages != null ? Number(message.totalPages) : null;
  const origin = message.origin || null;
  const done = Boolean(message.done);
  const aborted = Boolean(message.aborted);

  if (!done && isRunning) {
    if (page != null) {
      const totalText = total ? `${page} / ${total}` : `${page} / ?`;
      const originLabel = formatOriginLabel(origin);
      const originSuffix = originLabel ? ` (${originLabel})` : '';
      setStatus(`Searching page ${totalText}${originSuffix}...`);
    }
  }

  if (page != null) {
    setProgress(page, total, origin, { done, aborted });
  }
}

function handleLookupResult(message) {
  if (!message || message.lookupId !== activeLookupId) {
    return;
  }
  const index = Number(message.index);
  if (!Number.isInteger(index) || index < 0) {
    return;
  }
  const rowObj = currentActiveRows[index];
  if (!rowObj || rowObj.row?.dataset.state === 'done') {
    return;
  }
  const result = {
    query: message.query,
    found: message.found !== false,
    page_no: message.page_no,
    rank: message.rank,
    user_id: message.user_id,
    user_name: message.user_name,
    link: message.link,
    origin: message.origin || ''
  };
  if (result.found) {
    setRowFound(rowObj, result);
  } else {
    setRowNotFound(rowObj, message.query);
  }
}

startBtn.addEventListener('click', () => {
  handleStartClick().catch((error) => {
    activeLookupId = null;
    setStatus(getErrorMessage(error));
    setUiState(false);
    markSearchingRows('Failed.');
    setProgress(null, null);
    currentActiveRows = [];
  });
});

stopBtn.addEventListener('click', () => {
  handleStopClick().catch((error) => {
    setStatus(getErrorMessage(error));
    setUiState(false);
    currentActiveRows = [];
  });
});

clearCacheBtn.addEventListener('click', () => {
  handleClearCacheClick().catch((error) => {
    const message = getErrorMessage(error);
    setStatus(message);
  });
});

addUserBtn.addEventListener('click', () => {
  if (!isRunning) {
    addUserRow('', true);
  }
});

if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    window.close();
  });
}

ensureAtLeastOneRow();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'LOOKUP_PROGRESS') {
    handleLookupProgress(message);
  }
  if (message?.type === 'LOOKUP_RESULT') {
    handleLookupResult(message);
  }
  return undefined;
});
