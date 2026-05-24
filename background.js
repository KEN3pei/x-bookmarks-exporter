// ブックマーク API の URL を監視して queryId を自動保存
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const match = details.url.match(/\/graphql\/([^/]+)\/Bookmarks/);
    if (!match) return;
    const queryId = match[1];
    try {
      const features = new URL(details.url).searchParams.get("features");
      chrome.storage.local.set({ bookmarkQueryId: queryId, bookmarkFeatures: features });
    } catch (_) {
      chrome.storage.local.set({ bookmarkQueryId: queryId });
    }
  },
  { urls: ["https://x.com/i/api/graphql/*/Bookmarks*"] }
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

// content.js（x.com ページ上）に fetch を委譲する
// ページコンテキストで動くので Origin=https://x.com・クッキー自動付与で認証が通る
async function exportViaContentScript(filter) {
  const stored = await chrome.storage.local.get(["bookmarkQueryId", "bookmarkFeatures"]);
  if (!stored.bookmarkQueryId) {
    throw new Error("x.com/i/bookmarks を開いてページを読み込んでから再試行してください。");
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
