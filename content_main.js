(function () {
  const originalFetch = window.fetch;

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input?.url;

    if (url && /\/graphql\/[^/]+\/Bookmarks/.test(url)) {
      try {
        const urlObj = new URL(url);
        const match = url.match(/\/graphql\/([^/]+)\/Bookmarks/);
        const queryId = match ? match[1] : null;
        const features = urlObj.searchParams.get("features");

        if (queryId) {
          window.postMessage(
            {
              source: "x-bookmarks-exporter",
              type: "BOOKMARK_API_DETECTED",
              queryId,
              features,
            },
            "*"
          );
        }
      } catch (_) {
        // ignore
      }
    }

    return originalFetch.apply(this, arguments);
  };
})();
