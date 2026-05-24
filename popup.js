const exportBtn = document.getElementById("export-btn");
const statusBox = document.getElementById("status-box");
const statusText = document.getElementById("status-text");
const hintEl = document.getElementById("hint");
const progressEl = document.getElementById("progress");
const progressText = document.getElementById("progress-text");
const resultBox = document.getElementById("result-box");
const resultText = document.getElementById("result-text");

function formatJst(dateStr) {
  try {
    return new Date(dateStr).toLocaleString("ja-JP", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      timeZone: "Asia/Tokyo",
    });
  } catch { return dateStr; }
}

function tweetsToMarkdown(tweets) {
  const today = new Date().toLocaleDateString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tokyo",
  });

  const lines = [`# X Bookmarks - ${today}`, "", `> 合計 **${tweets.length}** 件`, "", "---", ""];

  for (let i = 0; i < tweets.length; i++) {
    const t = tweets[i];
    const url = `https://x.com/${t.screenName}/status/${t.id}`;
    lines.push(`## ${i + 1}. ${t.displayName} (@${t.screenName})`, "");
    lines.push(`- **投稿日時**: ${formatJst(t.createdAt)}`);
    lines.push(`- **URL**: <${url}>`, "");
    lines.push(t.text, "", "---", "");
  }

  return lines.join("\n");
}

function triggerDownload(content, filename) {
  const dataUrl = "data:text/markdown;charset=utf-8," + encodeURIComponent(content);
  chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
}

function setStatus(ready) {
  if (ready) {
    statusBox.className = "status-box ready";
    statusText.textContent = "準備完了。エクスポートできます。";
    hintEl.style.display = "none";
    exportBtn.disabled = false;
  } else {
    statusBox.className = "status-box";
    statusText.textContent = "x.com/i/bookmarks を開いてください。";
    hintEl.style.display = "";
    exportBtn.disabled = true;
  }
}

function showProgress(text) {
  progressEl.classList.remove("hidden");
  progressText.textContent = text;
  resultBox.classList.add("hidden");
}

function showResult(text, isError = false) {
  progressEl.classList.add("hidden");
  resultBox.className = isError ? "result-box error" : "result-box";
  document.getElementById("result-icon").textContent = isError ? "❌" : "✅";
  resultText.textContent = text;
  resultBox.classList.remove("hidden");
}

function checkStatus() {
  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
    setStatus(res?.ready ?? false);
  });
}

exportBtn.addEventListener("click", () => {
  exportBtn.disabled = true;
  showProgress("ブックマークを取得中...");

  chrome.runtime.sendMessage({ type: "EXPORT_BOOKMARKS" }, (res) => {
    if (res?.success) {
      const md = tweetsToMarkdown(res.tweets);
      const date = new Date().toISOString().slice(0, 10);
      triggerDownload(md, `x-bookmarks-${date}.md`);
      showResult(`${res.tweets.length} 件をエクスポートしました！`);
    } else {
      showResult(res?.error ?? "不明なエラーが発生しました。", true);
    }
    exportBtn.disabled = false;
  });
});

checkStatus();
