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

// X記事ページをiframeに読み込むため、サブフレームロード時のフレーミング制限ヘッダーを除去する
chrome.runtime.onInstalled.addListener(setupFramingRule);
chrome.runtime.onStartup.addListener(setupFramingRule);

async function setupFramingRule() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "x-frame-options", operation: "remove" },
          { header: "content-security-policy", operation: "remove" },
        ],
      },
      condition: {
        urlFilter: "https://x.com/i/article/*",
        resourceTypes: ["sub_frame"],
      },
    }],
  });
}

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
    throw new Error("x.com/i/history を開いてページを読み込んでから再試行してください。");
  }
  if (!stored.bearerToken) {
    throw new Error("ベアラートークン未取得。ブックマークページを再読み込みして再試行してください。");
  }

  const tabs = await chrome.tabs.query({
    url: ["https://x.com/i/history*", "https://x.com/i/bookmarks*"],
  });
  if (tabs.length === 0) {
    throw new Error("ブックマークページ（x.com/i/history）を開いてください。");
  }

  const tabId = tabs[0].id;
  const msg = {
    type: "FETCH_BOOKMARKS",
    queryId: stored.bookmarkQueryId,
    features: stored.bookmarkFeatures,
    bearerToken: stored.bearerToken,
    filter,
  };

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, async (response) => {
      if (chrome.runtime.lastError) {
        const err = chrome.runtime.lastError.message ?? "";
        if (!err.includes("Receiving end does not exist")) {
          return reject(new Error(err));
        }
        // コンテンツスクリプト未注入 → 再注入してリトライ
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ["content_main.js"],
            world: "MAIN",
          });
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ["content.js"],
          });
          await new Promise((r) => setTimeout(r, 300));
          chrome.tabs.sendMessage(tabId, msg, (res2) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (res2?.success) {
              resolve(res2);
            } else {
              reject(new Error(res2?.error ?? "不明なエラー"));
            }
          });
        } catch (injectErr) {
          reject(new Error("スクリプト注入に失敗しました: " + injectErr.message));
        }
        return;
      }
      if (response?.success) {
        resolve(response);
      } else {
        reject(new Error(response?.error ?? "不明なエラー"));
      }
    });
  });
}
