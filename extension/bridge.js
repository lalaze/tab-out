(function initBridge(globalScope) {
  'use strict';

  function isInternalUrl(url) {
    return /^(chrome|chrome-extension|edge|brave|about):/i.test(url || '');
  }

  function domainForUrl(url) {
    if (!url) return 'unknown';
    if (isInternalUrl(url)) return 'Browser';

    try {
      const parsed = new URL(url);

      if (parsed.protocol === 'file:') return 'file';
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
      }

      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return 'unknown';
    }
  }

  function toTabIdList(tabIds) {
    if (!Array.isArray(tabIds) || tabIds.length === 0) {
      throw new Error('tabIds is required');
    }

    const normalized = tabIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id >= 0);

    if (normalized.length === 0) {
      throw new Error('tabIds is required');
    }

    return normalized;
  }

  function callChrome(chromeApi, fn, args) {
    return new Promise((resolve, reject) => {
      let settled = false;

      function finish(error, value) {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value);
      }

      function callback(value) {
        const lastError = chromeApi.runtime && chromeApi.runtime.lastError;
        finish(lastError ? new Error(lastError.message) : null, value);
      }

      try {
        const value = fn(...args, callback);

        if (value && typeof value.then === 'function') {
          value.then((result) => finish(null, result), finish);
        } else if (fn.length <= args.length) {
          finish(null, value);
        }
      } catch (error) {
        finish(error);
      }
    });
  }

  async function getProcessIdForTab(chromeApi, tabId) {
    if (!chromeApi.processes || !chromeApi.processes.getProcessIdForTab) return null;

    try {
      return await callChrome(chromeApi, chromeApi.processes.getProcessIdForTab, [tabId]);
    } catch {
      return null;
    }
  }

  async function getProcessInfo(chromeApi, processIds) {
    if (!chromeApi.processes || !chromeApi.processes.getProcessInfo || processIds.length === 0) {
      return {};
    }

    try {
      return await callChrome(chromeApi, chromeApi.processes.getProcessInfo, [processIds, true]);
    } catch {
      return {};
    }
  }

  async function getTabMemory(chromeApi, tabs) {
    const pairs = [];

    for (const tab of tabs) {
      if (!Number.isInteger(tab.id)) continue;
      const processId = await getProcessIdForTab(chromeApi, tab.id);
      if (processId !== null && processId !== undefined) pairs.push([tab.id, processId]);
    }

    const processIds = [...new Set(pairs.map(([, processId]) => processId))];
    const processInfo = await getProcessInfo(chromeApi, processIds);
    const memoryByTabId = new Map();

    for (const [tabId, processId] of pairs) {
      const info = processInfo[String(processId)] || processInfo[processId];
      if (!info) continue;

      memoryByTabId.set(tabId, {
        processId,
        privateMemory: info.privateMemory ?? null,
        jsMemoryAllocated: info.jsMemoryAllocated ?? null,
        jsMemoryUsed: info.jsMemoryUsed ?? null,
        sharedProcessTabIds: Array.isArray(info.tabs) ? info.tabs : [],
      });
    }

    return memoryByTabId;
  }

  async function getTabs(chromeApi) {
    const tabs = await chromeApi.tabs.query({});
    const duplicateCounts = new Map();

    for (const tab of tabs) {
      if (!tab.url || isInternalUrl(tab.url)) continue;
      duplicateCounts.set(tab.url, (duplicateCounts.get(tab.url) || 0) + 1);
    }

    const memoryByTabId = await getTabMemory(chromeApi, tabs);
    const normalizedTabs = tabs.map((tab) => {
      const url = tab.url || '';

      return {
        id: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        title: tab.title || url || 'Untitled',
        url,
        favIconUrl: tab.favIconUrl || '',
        active: !!tab.active,
        pinned: !!tab.pinned,
        discarded: !!tab.discarded,
        audible: !!tab.audible,
        domain: domainForUrl(url),
        duplicateCount: duplicateCounts.get(url) || 1,
        isInternal: isInternalUrl(url),
        memory: memoryByTabId.get(tab.id) || null,
      };
    });

    return {
      tabs: normalizedTabs,
      stats: {
        totalTabs: tabs.length,
        webTabs: normalizedTabs.filter((tab) => !tab.isInternal).length,
        duplicateUrls: [...duplicateCounts.values()].filter((count) => count > 1).length,
        hasProcessMemory: memoryByTabId.size > 0,
      },
    };
  }

  function createGlanceBridge(chromeApi) {
    return {
      async handle(message) {
        switch (message && message.action) {
          case 'getTabs':
            return getTabs(chromeApi);

          case 'closeTabs': {
            const tabIds = toTabIdList(message.tabIds);
            await chromeApi.tabs.remove(tabIds);
            return { closed: tabIds.length };
          }

          case 'discardTabs': {
            const tabIds = toTabIdList(message.tabIds);
            for (const tabId of tabIds) {
              await chromeApi.tabs.discard(tabId);
            }
            return { discarded: tabIds.length };
          }

          case 'focusTab': {
            const tabId = Number(message.tabId);
            const windowId = Number(message.windowId);
            if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) {
              throw new Error('tabId and windowId are required');
            }

            await chromeApi.tabs.update(tabId, { active: true });
            await chromeApi.windows.update(windowId, { focused: true });
            return { focused: true };
          }

          default:
            throw new Error(`Unsupported action: ${message && message.action}`);
        }
      },
    };
  }

  const api = { createGlanceBridge };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.createGlanceBridge = createGlanceBridge;
})(typeof globalThis !== 'undefined' ? globalThis : self);
