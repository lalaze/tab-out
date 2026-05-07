const test = require('node:test');
const assert = require('node:assert/strict');

const { createGlanceBridge } = require('./bridge');

function createChromeStub(tabs) {
  const calls = [];

  return {
    calls,
    tabs: {
      async query() {
        return tabs;
      },
      async remove(tabIds) {
        calls.push(['tabs.remove', tabIds]);
      },
      async discard(tabId) {
        calls.push(['tabs.discard', tabId]);
      },
      async update(tabId, updateInfo) {
        calls.push(['tabs.update', tabId, updateInfo]);
      },
    },
    windows: {
      async update(windowId, updateInfo) {
        calls.push(['windows.update', windowId, updateInfo]);
      },
    },
  };
}

test('getTabs returns normalized tab snapshots with duplicate and domain metadata', async () => {
  const chromeStub = createChromeStub([
    { id: 1, windowId: 10, index: 0, active: false, pinned: false, discarded: false, audible: false, title: 'Alpha', url: 'https://example.com/a', favIconUrl: 'https://example.com/favicon.ico' },
    { id: 2, windowId: 10, index: 1, active: true, pinned: false, discarded: false, audible: false, title: 'Alpha copy', url: 'https://example.com/a' },
    { id: 3, windowId: 11, index: 0, active: false, pinned: true, discarded: true, audible: true, title: 'Local app', url: 'http://localhost:8080/' },
    { id: 4, windowId: 11, index: 1, active: false, pinned: false, discarded: false, audible: false, title: 'Chrome settings', url: 'chrome://settings' },
  ]);

  const result = await createGlanceBridge(chromeStub).handle({ action: 'getTabs' });

  assert.equal(result.stats.totalTabs, 4);
  assert.equal(result.stats.webTabs, 3);
  assert.equal(result.tabs[0].domain, 'example.com');
  assert.equal(result.tabs[0].duplicateCount, 2);
  assert.equal(result.tabs[2].domain, 'localhost:8080');
  assert.equal(result.tabs[3].isInternal, true);
});

test('closeTabs validates ids and delegates to chrome.tabs.remove', async () => {
  const chromeStub = createChromeStub([]);
  const bridge = createGlanceBridge(chromeStub);

  await assert.rejects(
    () => bridge.handle({ action: 'closeTabs', tabIds: [] }),
    /tabIds is required/
  );

  const result = await bridge.handle({ action: 'closeTabs', tabIds: [3, 4] });

  assert.deepEqual(result, { closed: 2 });
  assert.deepEqual(chromeStub.calls, [['tabs.remove', [3, 4]]]);
});

test('discardTabs discards tabs one at a time and reports the count', async () => {
  const chromeStub = createChromeStub([]);

  const result = await createGlanceBridge(chromeStub).handle({ action: 'discardTabs', tabIds: [7, 8] });

  assert.deepEqual(result, { discarded: 2 });
  assert.deepEqual(chromeStub.calls, [
    ['tabs.discard', 7],
    ['tabs.discard', 8],
  ]);
});

test('focusTab activates the tab and focuses its window', async () => {
  const chromeStub = createChromeStub([]);

  const result = await createGlanceBridge(chromeStub).handle({ action: 'focusTab', tabId: 12, windowId: 34 });

  assert.deepEqual(result, { focused: true });
  assert.deepEqual(chromeStub.calls, [
    ['tabs.update', 12, { active: true }],
    ['windows.update', 34, { focused: true }],
  ]);
});
