// onSendHeaders で実際にネットワークに送られるリクエストヘッダーを観測し
// queryId・bearerToken・features を保存する。
// extraHeaders が必要な Authorization ヘッダーも取得できる。
chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    const match = details.url.match(/\/graphql\/([^/]+)\/Bookmarks/);
    if (!match) return;

    const toStore = { bookmarkQueryId: match[1] };

    const authHeader = details.requestHeaders?.find(
      (h) => h.name.toLowerCase() === "authorization"
    );
    if (authHeader?.value) toStore.bearerToken = authHeader.value;

    try {
      const features = new URL(details.url).searchParams.get("features");
      if (features) toStore.bookmarkFeatures = features;
    } catch (_) {}

    chrome.storage.local.set(toStore);
  },
  { urls: ["https://x.com/i/api/graphql/*/Bookmarks*"] },
  ["requestHeaders", "extraHeaders"]
);

// popup.js からのメッセージを処理
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_STATUS") {
    chrome.storage.local.get(["bookmarkQueryId"], (data) => {
      sendResponse({ ready: !!data.bookmarkQueryId });
    });
    return true;
  }

  if (message.type === "EXPORT_BOOKMARKS") {
    exportViaContentScript(message.filter ?? { mode: "today" })
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  return false;
});

async function exportViaContentScript(filter) {
  const stored = await chrome.storage.local.get([
    "bookmarkQueryId",
    "bookmarkFeatures",
    "bearerToken",
  ]);
  if (!stored.bookmarkQueryId) {
    throw new Error("x.com/i/bookmarks を開いてページを読み込んでから再試行してください。");
  }
  if (!stored.bearerToken) {
    throw new Error("ベアラートークン未取得。ブックマークページを再読み込みして再試行してください。");
  }

  const tabs = await chrome.tabs.query({ url: "https://x.com/i/bookmarks*" });
  if (tabs.length === 0) {
    throw new Error("ブックマークページ（x.com/i/bookmarks）を開いてください。");
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabs[0].id,
      {
        type: "FETCH_BOOKMARKS",
        queryId: stored.bookmarkQueryId,
        features: stored.bookmarkFeatures,
        bearerToken: stored.bearerToken,
        filter,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.success) {
          resolve(response);
        } else {
          reject(new Error(response?.error ?? "不明なエラー"));
        }
      }
    );
  });
}
