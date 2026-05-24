window.addEventListener("message", function (event) {
  if (
    event.source === window &&
    event.data?.source === "x-bookmarks-exporter" &&
    event.data?.type === "BOOKMARK_API_DETECTED"
  ) {
    chrome.runtime.sendMessage({
      type: "BOOKMARK_API_DETECTED",
      queryId: event.data.queryId,
      features: event.data.features,
    });
  }
});
