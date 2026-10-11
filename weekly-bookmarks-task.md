# Xブックマーク週次整理 → Notion

実行日時: 毎週金曜日 10:00（Asia/Tokyo）
作業ディレクトリ: $HOME/Apps/x-bookmarks-exporter
実行環境: ローカルのプロジェクト

パス内の `$HOME` は、実行ユーザーのホームディレクトリに展開して読み替える。開始時に作業ディレクトリの `.env` を読み、`X_BOOKMARKS_EXTENSION_ID`、`NOTION_TARGET_URL`、`NOTION_TARGET_NAME` を取得する。未設定なら停止して報告する。環境変数の値をシェルコードとして実行しない。`.env` の内容をログやレポートへ出力しない。

## 定期実行タスクの指示

直近7日間のXブックマークをエクスポートし、analyze-bookmarksスキルで日本語の技術解説を作成して、Notionの `NOTION_TARGET_NAME` が示す登録先に新規ページとして登録する。

1. $HOME/Apps/cc-skills/export-x-bookmarks/SKILL.md を全文読む。現在利用可能なComputer Useツールの説明に従い、Google Chromeで https://x.com/i/history を開く。ブックマークが読み込まれたことを確認し、そのタブを残したまま別タブで chrome-extension://${X_BOOKMARKS_EXTENSION_ID}/popup.html を開く。「直近7日間」を選び、Markdownに出力する。成功表示と今回生成されたDownloads内のファイルを確認する。既存のrun-weekly-export.zshやcodex execは呼び出さない。
2. $HOME/.codex/skills/analyze-bookmarks/SKILL.md と、その references/claude-command.md を全文読み、今回生成したMarkdownの全エントリを分析する。リンク先を取得し、技術的な投稿には概要・技術解説・エンジニア的注目点を付ける。それ以外は短い概要にする。取得できないリンクや途中で切れた本文は明記し、推測で補わない。出典を添え、引用は適用される引用制限に従う。
3. レポートの冒頭に対象期間、総件数、深掘り対象件数、主要トピックの要約を置き、関連トピックを整理した後、各投稿の分析と投稿URL・参照URLを載せる。公式用語または確立した技術用語を使う。
4. Notionプラグインの読み取りツールで次の登録先を確認する。
   URL: `NOTION_TARGET_URL`
   名前: `NOTION_TARGET_NAME`
   データベースの場合は、そのデータソースと必須プロパティを確認して新規レコードを作る。通常のページの場合は子ページを作る。登録先が判別できない場合は別の場所へ保存しない。
5. ページ名を「Xブックマーク技術解説 - YYYY-MM-DD（直近7日間）」にする。同じ対象期間のページが既にあるか確認し、重複を作らない。Notionへ分析結果の全文を保存し、読み取りでタイトル・内容・登録先を検証する。
6. 最終結果に、エクスポート件数、対象期間、Markdownの保存先、作成したNotionページのURL、取得できなかった情報を簡潔に報告する。

XまたはNotionのログイン、CAPTCHA、予期しない権限確認が必要になったら停止して具体的な障害を報告する。Notionに保存できない場合は、分析結果を作業ディレクトリ配下のreportsにMarkdownで保存し、そのパスを報告する。失敗時に過去のエクスポートを今回の結果として使わない。0件ならその旨を報告し、空のNotionページは作らない。リポジトリのコードやGitの状態は変更しない。Macをシャットダウンしたり、処理終了時に強制スリープさせたりしない。
