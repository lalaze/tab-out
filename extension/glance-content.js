(function initGlanceContentBridge() {
  'use strict';

  const WIDGET_SOURCE = 'glance-tab-out-widget';
  const BRIDGE_SOURCE = 'glance-tab-out-bridge';

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== WIDGET_SOURCE) return;

    const { requestId, source: _source, ...request } = event.data;

    try {
      const response = await chrome.runtime.sendMessage({
        source: 'glance-tab-out-content',
        ...request,
      });

      window.postMessage({
        source: BRIDGE_SOURCE,
        requestId,
        ok: !!(response && response.ok),
        data: response && response.data,
        error: response && response.error,
      }, window.location.origin);
    } catch (error) {
      window.postMessage({
        source: BRIDGE_SOURCE,
        requestId,
        ok: false,
        error: error && error.message ? error.message : String(error),
      }, window.location.origin);
    }
  });
})();
