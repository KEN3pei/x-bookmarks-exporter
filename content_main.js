// MAIN world。background.js が webRequest で捕捉したベアラートークンを受け取って
// x.com コンテキストで fetch する。window.fetch の wrap は不要。

(function () {
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

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== "xbe-isolated") return;
    if (event.data?.type !== "FETCH_BOOKMARKS") return;

    const { requestId, queryId, features, filter, bearerToken } = event.data;

    try {
      const csrfToken = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1];
      if (!csrfToken) throw new Error("ct0 クッキーが見つかりません。X にログインしてください。");

      const tweets = await fetchAllBookmarks(queryId, features, filter, bearerToken, csrfToken);
      window.postMessage(
        { source: "xbe-main", requestId, success: true, tweets },
        location.origin
      );
    } catch (err) {
      window.postMessage(
        { source: "xbe-main", requestId, success: false, error: err.message },
        location.origin
      );
    }
  });

  // --- 日付フィルター ---

  function getFilterRange(filter) {
    if (!filter || filter.mode === "all") return { start: null, end: null };
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

  // --- ツイート抽出 ---

  function extractTweetsWithFilter(data, range) {
    const tweets = [];
    let hasOlderTweets = false;
    let entryCount = 0;

    const instructions =
      data?.data?.bookmark_timeline_v2?.timeline?.instructions ?? [];

    for (const instruction of instructions) {
      if (instruction.type !== "TimelineAddEntries") continue;

      for (const entry of instruction.entries ?? []) {
        if (entry.content?.entryType === "TimelineTimelineCursor") continue;

        const rawResult = entry?.content?.itemContent?.tweet_results?.result;
        if (!rawResult) continue;

        entryCount++;

        // TweetWithVisibilityResults は .tweet に実データが入っている
        const tweetData =
          rawResult.__typename === "TweetWithVisibilityResults"
            ? rawResult.tweet
            : rawResult;
        if (!tweetData) continue;

        const legacy = tweetData.legacy;
        if (!legacy) continue;

        // ユーザー情報: result.legacy → result の直接プロパティ の順で試みる
        const userResult = tweetData.core?.user_results?.result;
        const screenName =
          userResult?.legacy?.screen_name ?? userResult?.screen_name;
        const displayName =
          userResult?.legacy?.name ?? userResult?.name ?? screenName;

        if (!screenName) continue;

        if (legacy.retweeted_status_id_str || legacy.full_text?.startsWith("RT @")) continue;

        const tweetDate = new Date(legacy.created_at);

        if (range.start && tweetDate < range.start) {
          hasOlderTweets = true;
          continue;
        }
        if (range.end && tweetDate > range.end) continue;

        tweets.push({
          id: legacy.id_str,
          text: legacy.full_text,
          createdAt: legacy.created_at,
          screenName,
          displayName,
        });
      }
    }

    return { tweets, hasOlderTweets, entryCount };
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

  // --- fetch ループ ---

  async function fetchAllBookmarks(queryId, features, filter, bearerToken, csrfToken) {
    const range = getFilterRange(filter);
    const allTweets = [];
    let cursor = null;

    while (true) {
      const variables = { count: 100, includePromotedContent: false };
      if (cursor) variables.cursor = cursor;

      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: features || DEFAULT_FEATURES,
      });

      const resp = await fetch(
        `https://x.com/i/api/graphql/${queryId}/Bookmarks?${params}`,
        {
          credentials: "include",
          headers: {
            Authorization: bearerToken,
            "x-csrf-token": csrfToken,
            "x-twitter-auth-type": "OAuth2Session",
            "x-twitter-active-user": "yes",
          },
        }
      );

      if (!resp.ok) throw new Error(`API エラー: ${resp.status} ${resp.statusText}`);

      const data = await resp.json();
      const { tweets, hasOlderTweets, entryCount } = extractTweetsWithFilter(data, range);
      allTweets.push(...tweets);

      if (hasOlderTweets) break;

      const nextCursor = extractNextCursor(data);
      if (!nextCursor || entryCount === 0) break;

      cursor = nextCursor;
      await new Promise((r) => setTimeout(r, 500));
    }

    return allTweets;
  }
})();
