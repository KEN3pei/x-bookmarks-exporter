const BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I6xMTjSjGA%3DumZgRCITtgRblFes65J8c7zOkjnA4bQ8d1-40Zs";

const DEFAULT_FEATURES = JSON.stringify({
  graphql_timeline_v2_bookmark_timeline: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: false,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_media_download_video_enabled: false,
  responsive_web_enhance_cards_enabled: false,
  rweb_tipjar_consumption_enabled: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  longform_notetweets_rich_text_read_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  interactive_text_enabled: true,
  responsive_web_text_conversations_enabled: false,
  vibe_api_enabled: false,
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "BOOKMARK_API_DETECTED") {
    chrome.storage.local.set({
      bookmarkQueryId: message.queryId,
      bookmarkFeatures: message.features,
    });
    return false;
  }

  if (message.type === "GET_STATUS") {
    chrome.storage.local.get(["bookmarkQueryId"], (data) => {
      sendResponse({ ready: !!data.bookmarkQueryId });
    });
    return true;
  }

  if (message.type === "EXPORT_BOOKMARKS") {
    const filter = message.filter ?? { mode: "today" };
    exportBookmarks(filter)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  return false;
});

// --- 日付範囲計算 ---

function getFilterRange(filter) {
  if (filter.mode === "all") return { start: null, end: null };

  // JST の今日の日付文字列 "YYYY-MM-DD"
  const todayJst = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  if (filter.mode === "today") {
    return {
      start: new Date(todayJst + "T00:00:00+09:00"),
      end: new Date(todayJst + "T23:59:59.999+09:00"),
    };
  }

  if (filter.mode === "date") {
    return {
      start: new Date(filter.date + "T00:00:00+09:00"),
      end: new Date(filter.date + "T23:59:59.999+09:00"),
    };
  }

  if (filter.mode === "days") {
    const days = Math.max(1, filter.days ?? 7);
    const end = new Date(todayJst + "T23:59:59.999+09:00");
    const start = new Date(todayJst + "T00:00:00+09:00");
    start.setDate(start.getDate() - (days - 1));
    return { start, end };
  }

  return { start: null, end: null };
}

// --- ツイート抽出（日付フィルタ付き） ---

function extractTweetsWithFilter(data, range) {
  const tweets = [];
  let hasOlderTweets = false; // start より古いツイートを検出したら早期終了フラグ
  let entryCount = 0;

  const instructions =
    data?.data?.bookmark_timeline_v2?.timeline?.instructions ?? [];

  for (const instruction of instructions) {
    if (instruction.type !== "TimelineAddEntries") continue;

    for (const entry of instruction.entries ?? []) {
      // カーソルエントリはスキップ
      if (entry.content?.entryType === "TimelineTimelineCursor") continue;

      const tweetResult =
        entry?.content?.itemContent?.tweet_results?.result ??
        entry?.content?.itemContent?.tweet_results?.result?.tweet;
      if (!tweetResult) continue;

      entryCount++;

      const legacy = tweetResult.legacy ?? tweetResult.tweet?.legacy;
      const userLegacy =
        tweetResult.core?.user_results?.result?.legacy ??
        tweetResult.tweet?.core?.user_results?.result?.legacy;
      if (!legacy || !userLegacy) continue;

      // リツイートを除外
      if (legacy.retweeted_status_id_str || legacy.full_text?.startsWith("RT @")) continue;

      const tweetDate = new Date(legacy.created_at);

      // start より古い → 以降のページも不要
      if (range.start && tweetDate < range.start) {
        hasOlderTweets = true;
        continue;
      }

      // end より新しい → このページはスキップ、次ページに範囲内のものがある可能性あり
      if (range.end && tweetDate > range.end) continue;

      tweets.push({
        id: legacy.id_str,
        text: legacy.full_text,
        createdAt: legacy.created_at,
        screenName: userLegacy.screen_name,
        displayName: userLegacy.name,
      });
    }
  }

  return { tweets, hasOlderTweets, entryCount };
}

// --- ページネーション ---

function extractNextCursor(data) {
  const instructions =
    data?.data?.bookmark_timeline_v2?.timeline?.instructions ?? [];

  for (const instruction of instructions) {
    if (instruction.type === "TimelineAddEntries") {
      for (const entry of instruction.entries ?? []) {
        if (
          entry.content?.entryType === "TimelineTimelineCursor" &&
          entry.content?.cursorType === "Bottom"
        ) {
          return entry.content.value;
        }
      }
    }
    if (instruction.type === "TimelineReplaceEntry") {
      if (instruction.entry?.content?.cursorType === "Bottom") {
        return instruction.entry.content.value;
      }
    }
  }

  return null;
}

// --- API 呼び出し ---

function getCookie(name) {
  return new Promise((resolve, reject) => {
    chrome.cookies.get({ url: "https://x.com", name }, (cookie) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (cookie) {
        resolve(cookie.value);
      } else {
        reject(new Error(`Cookie "${name}" が見つかりません。X にログインしてください。`));
      }
    });
  });
}

async function fetchBookmarksPage(queryId, features, csrfToken, cursor = null) {
  const variables = { count: 100, includePromotedContent: false };
  if (cursor) variables.cursor = cursor;

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: features || DEFAULT_FEATURES,
  });

  const response = await fetch(
    `https://x.com/i/api/graphql/${queryId}/Bookmarks?${params}`,
    {
      method: "GET",
      credentials: "include",
      headers: {
        Authorization: `Bearer ${BEARER_TOKEN}`,
        "x-csrf-token": csrfToken,
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`API エラー: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// --- メインエクスポート処理 ---

async function exportBookmarks(filter) {
  const stored = await new Promise((resolve) =>
    chrome.storage.local.get(["bookmarkQueryId", "bookmarkFeatures"], resolve)
  );

  if (!stored.bookmarkQueryId) {
    throw new Error(
      "x.com/i/bookmarks を開いてページを読み込んでから再試行してください。"
    );
  }

  const csrfToken = await getCookie("ct0");
  const range = getFilterRange(filter);

  const allTweets = [];
  let cursor = null;

  while (true) {
    const data = await fetchBookmarksPage(
      stored.bookmarkQueryId,
      stored.bookmarkFeatures,
      csrfToken,
      cursor
    );

    const { tweets, hasOlderTweets, entryCount } = extractTweetsWithFilter(data, range);
    allTweets.push(...tweets);

    // start より古いツイートに到達 → 以降のページは不要
    if (hasOlderTweets) break;

    const nextCursor = extractNextCursor(data);
    // 次ページなし、またはエントリが空
    if (!nextCursor || entryCount === 0) break;

    cursor = nextCursor;
    await new Promise((r) => setTimeout(r, 500));
  }

  return { success: true, tweets: allTweets };
}
