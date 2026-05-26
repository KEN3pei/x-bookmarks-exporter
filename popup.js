const exportBtn = document.getElementById("export-btn");
const statusBox = document.getElementById("status-box");
const statusText = document.getElementById("status-text");
const hintEl = document.getElementById("hint");
const progressEl = document.getElementById("progress");
const progressText = document.getElementById("progress-text");
const resultBox = document.getElementById("result-box");
const resultText = document.getElementById("result-text");
const filterDateInput = document.getElementById("filter-date");
const filterDaysInput = document.getElementById("filter-days");

// デフォルトの日付を JST の今日に設定
filterDateInput.value = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

// サブ入力にフォーカスしたら対応するラジオを自動選択
filterDateInput.addEventListener("focus", () => {
  document.querySelector('input[name="filter-mode"][value="date"]').checked = true;
});
filterDaysInput.addEventListener("focus", () => {
  document.querySelector('input[name="filter-mode"][value="days"]').checked = true;
});

function getFilter() {
  const mode = document.querySelector('input[name="filter-mode"]:checked')?.value ?? "today";
  if (mode === "date") {
    const date = filterDateInput.value;
    return date ? { mode, date } : { mode: "today" };
  }
  if (mode === "days") {
    const days = parseInt(filterDaysInput.value, 10);
    return { mode, days: isNaN(days) || days < 1 ? 7 : days };
  }
  return { mode };
}

function filterLabel(filter) {
  const todayJst = new Date().toLocaleDateString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tokyo",
  });
  if (filter.mode === "today") return `今日 (${todayJst})`;
  if (filter.mode === "date") {
    const d = new Date(filter.date + "T00:00:00+09:00").toLocaleDateString("ja-JP", {
      year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tokyo",
    });
    return d;
  }
  if (filter.mode === "days") return `直近 ${filter.days} 日間`;
  return "すべて";
}

function formatJst(dateStr) {
  try {
    return new Date(dateStr).toLocaleString("ja-JP", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      timeZone: "Asia/Tokyo",
    });
  } catch { return dateStr; }
}

function tweetsToMarkdown(tweets, filter) {
  const now = new Date();
  const todayJst = now.toLocaleDateString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tokyo",
  });

  let title = "# X Bookmarks";
  if (filter.mode === "today") title += ` - ${todayJst}`;
  else if (filter.mode === "date") {
    const d = new Date(filter.date + "T00:00:00+09:00").toLocaleDateString("ja-JP", {
      year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tokyo",
    });
    title += ` - ${d}`;
  } else if (filter.mode === "days") {
    title += ` - 直近 ${filter.days} 日間`;
  }

  const lines = [title, "", `> 合計 **${tweets.length}** 件`, "", "---", ""];

  for (let i = 0; i < tweets.length; i++) {
    const t = tweets[i];
    const url = `https://x.com/i/web/status/${t.id}`;
    lines.push(`## ${i + 1}.`);
    lines.push(`- **投稿日時**: ${formatJst(t.createdAt)}`);
    lines.push(`- **URL**: <${url}>`, "");
    lines.push(t.text, "");
    if (t.quotedText) {
      lines.push(t.quotedText.split("\n").map(l => `> ${l}`).join("\n"), "");
    }
    lines.push("---", "");
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
  const filter = getFilter();
  exportBtn.disabled = true;
  showProgress(`取得中... (${filterLabel(filter)})`);

  chrome.runtime.sendMessage({ type: "EXPORT_BOOKMARKS", filter }, (res) => {
    if (res?.success) {
      const md = tweetsToMarkdown(res.tweets, filter);
      const date = new Date().toISOString().slice(0, 10);
      const suffix = filter.mode === "today" ? date
        : filter.mode === "date" ? filter.date
        : filter.mode === "days" ? `${date}_last${filter.days}days`
        : date + "_all";
      triggerDownload(md, `x-bookmarks-${suffix}.md`);
      showResult(`${res.tweets.length} 件をエクスポートしました！`);
    } else {
      showResult(res?.error ?? "不明なエラーが発生しました。", true);
    }
    exportBtn.disabled = false;
  });
});

checkStatus();
