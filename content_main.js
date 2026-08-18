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

        const legacy = rawResult.legacy;
        if (!legacy) continue;

        if (legacy.retweeted_status_id_str || legacy.full_text?.startsWith("RT @")) continue;

        const tweetDate = new Date(legacy.created_at);

        if (range.start && tweetDate < range.start) {
          hasOlderTweets = true;
          continue;
        }
        if (range.end && tweetDate > range.end) continue;

        // 引用ツイートの本文を取得
        const quotedRaw = rawResult.quoted_status_result?.result;
        const quotedLegacy = quotedRaw?.__typename === "TweetWithVisibilityResults"
          ? quotedRaw.tweet?.legacy
          : quotedRaw?.legacy;

        const noteText = rawResult.note_tweet?.note_tweet_results?.result?.text ?? null;

        const articleResult = rawResult.article?.article_results?.result ?? null;
        const articleText = articleResult
          ? `[X記事] ${articleResult.title}\n\n${articleResult.preview_text}\n\nhttps://x.com/i/article/${articleResult.rest_id}`
          : null;

        tweets.push({
          id: legacy.id_str,
          text: noteText ?? articleText ?? legacy.full_text,
          createdAt: legacy.created_at,
          quotedText: quotedLegacy?.full_text ?? null,
          articleRestId: articleResult?.rest_id ?? null,
          articleTitle: articleResult?.title ?? null,
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

  // --- X記事全文取得（iframe経由） ---

  async function fetchArticleContent(articleRestId) {
    return new Promise((resolve) => {
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;width:1px;height:1px;top:-9999px;left:-9999px;visibility:hidden;";
      iframe.src = `/i/article/${articleRestId}`;

      const TIMEOUT = 15000;
      const POLL_MS = 600;
      let elapsed = 0;

      function poll() {
        elapsed += POLL_MS;

        try {
          const doc = iframe.contentDocument;
          if (!doc || doc.readyState === "loading") {
            if (elapsed > TIMEOUT) { cleanup(null); return; }
            setTimeout(poll, POLL_MS);
            return;
          }

          const el =
            doc.querySelector('[data-testid="twitterArticleRichTextView"]') ||
            doc.querySelector('[data-testid="longformRichTextComponent"]');

          if (el && el.innerText.trim().length > 100) {
            cleanup(el.innerText.trim());
            return;
          }

          if (elapsed > TIMEOUT) { cleanup(null); return; }

          setTimeout(poll, POLL_MS);
        } catch (_) {
          cleanup(null);
        }
      }

      function cleanup(result) {
        iframe.remove();
        resolve(result);
      }

      iframe.addEventListener("load", () => setTimeout(poll, 1500));
      document.body.appendChild(iframe);
    });
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

    // X記事の全文をiframe経由で順次取得
    for (const t of allTweets.filter(u => u.articleRestId)) {
      const content = await fetchArticleContent(t.articleRestId).catch(() => null);
      if (content) t.text = `[X記事] ${t.articleTitle}\n\n${content}`;
    }

    return allTweets;
  }
})();
