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
    chrome.storage.session.set({
      bookmarkQueryId: message.queryId,
      bookmarkFeatures: message.features,
    });
    return false;
  }

  if (message.type === "GET_STATUS") {
    chrome.storage.session.get(["bookmarkQueryId"], (data) => {
      sendResponse({ ready: !!data.bookmarkQueryId });
    });
    return true;
  }

  if (message.type === "EXPORT_BOOKMARKS") {
    exportBookmarks()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  return false;
});

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

function extractTweets(data) {
  const tweets = [];
  const instructions =
    data?.data?.bookmark_timeline_v2?.timeline?.instructions ?? [];

  for (const instruction of instructions) {
    if (instruction.type !== "TimelineAddEntries") continue;

    for (const entry of instruction.entries ?? []) {
      const tweetResult =
        entry?.content?.itemContent?.tweet_results?.result ??
        entry?.content?.itemContent?.tweet_results?.result?.tweet;

      if (!tweetResult) continue;

      const legacy = tweetResult.legacy ?? tweetResult.tweet?.legacy;
      const userLegacy =
        tweetResult.core?.user_results?.result?.legacy ??
        tweetResult.tweet?.core?.user_results?.result?.legacy;

      if (!legacy || !userLegacy) continue;

      // リツイートを除外
      if (legacy.retweeted_status_id_str || legacy.full_text?.startsWith("RT @")) continue;

      tweets.push({
        id: legacy.id_str,
        text: legacy.full_text,
        createdAt: legacy.created_at,
        screenName: userLegacy.screen_name,
        displayName: userLegacy.name,
      });
    }
  }

  return tweets;
}

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

async function exportBookmarks() {
  const stored = await new Promise((resolve) =>
    chrome.storage.session.get(["bookmarkQueryId", "bookmarkFeatures"], resolve)
  );

  if (!stored.bookmarkQueryId) {
    throw new Error(
      "x.com/i/bookmarks を開いてページを読み込んでから再試行してください。"
    );
  }

  const csrfToken = await getCookie("ct0");

  const allTweets = [];
  let cursor = null;

  while (true) {
    const data = await fetchBookmarksPage(
      stored.bookmarkQueryId,
      stored.bookmarkFeatures,
      csrfToken,
      cursor
    );

    const tweets = extractTweets(data);
    allTweets.push(...tweets);

    const nextCursor = extractNextCursor(data);
    if (!nextCursor || tweets.length === 0) break;

    cursor = nextCursor;

    await new Promise((r) => setTimeout(r, 500));
  }

  return { success: true, tweets: allTweets };
}
