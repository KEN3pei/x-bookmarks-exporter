// ISOLATED world。chrome.runtime と MAIN world の橋渡し役。
// background → (chrome.runtime.sendMessage) → ここ → (window.postMessage) → content_main.js
// content_main.js が fetch して結果を postMessage で返す → ここ → background

const pendingRequests = {};

// MAIN world からの応答を受け取る
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  if (event.data?.source !== "xbe-main") return;

  const { requestId, success, tweets, error } = event.data;
  const resolve = pendingRequests[requestId];
  if (!resolve) return;

  delete pendingRequests[requestId];
  resolve({ success, tweets, error });
});

// background からのリクエストを受け取り MAIN world に転送
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "FETCH_BOOKMARKS") return false;

  const requestId = `${Date.now()}-${Math.random()}`;

  // 先にリスナーを登録してから MAIN world にリクエストを送る（競合なし）
  pendingRequests[requestId] = (result) => sendResponse(result);

  window.postMessage(
    {
      source: "xbe-isolated",
      type: "FETCH_BOOKMARKS",
      requestId,
      queryId: message.queryId,
      features: message.features,
      bearerToken: message.bearerToken,
      filter: message.filter,
      articleQueryId: message.articleQueryId,
      articleOperationName: message.articleOperationName,
    },
    location.origin
  );

  return true; // 非同期応答
});
