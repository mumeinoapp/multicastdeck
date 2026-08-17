# MCD大規模アップデート 元依頼一覧（2026-08-06 ユーザーより復元）

進捗ログ(Cowork_作業進捗)には「200〜400字の要点のみ」というルールがあり、原文がどこにも
残っていなかったため、このファイルに原文をそのまま保存しておく（進捗ログとは別管理）。
新しいセッションで続きから作業する際は、まずこのファイルを読むこと。

## 項目一覧と対応状況（2026-08-06時点）

1. [x] MCDの全タブ統合にてKICKのスタンプ等が文字で表示される問題の修正
   → 対応済み（buildKickEmoteAwareMessageHtml()追加、バグ修正1セッション）
2. [x] 全タブ統合のスクロールが一番下ではなく少し上になってた場合、一番下（最新のチャット
   表示位置）まで自動移動させる機能の追加
   → 対応済み（自動スクロールとクリップサムネセッション）
3. [x] 全タブ統合に貼られたクリップがURLで表示される問題。Twitchと同様にクリップの
   画面・サムネ表示タイプにし、クリックでTwitchと同様に飛べるようにする。もしくは配信画面を
   表示してるところに同じ感じで表示する形にする（上部のチャンネル名・ユーザー名欄には
   何も追加しなくていい）
   → 実装・独立レビュー完了（初回実装でXSSリスクを指摘され、range統合方式に全面書き換えて
   解消済み）。ただし実機での見た目・動作確認はまだ未実施。
4. [x] 配信タイトルの表示
   → 対応済み（配信メタ情報表示セッション）
5. [x] チャンネルの一覧更新をもっと早く更新できるようにする
   → 対応済み（チャンネル一覧更新の高速化セッション、60秒→25秒/20秒間隔）
6. [x] 登録チャンネルの配信開始通知を別途「通知タブ」に表示（通知がある時のみバージョンと
   同じ赤丸で通知の有無をわかりやすくする）
   → 対応済み（2026-08-07セッション）。自作メニューバーに「通知」項目を追加し、バージョン項目と
   同じ.menu-badge/.has-update-badgeの仕組みで赤丸表示。配信開始検知はchannels:get-stream-meta
   のポーリング（60秒間隔）に相乗りし、オフライン→ライブの遷移のみを検知（起動直後や手動追加
   直後に既にライブだった場合は通知しない）。store(streamStartNotifications/
   streamStartNotificationsLastReadAt)で永続化、通知タブを開くと既読化。
   ※対象はTwitch/Kickのみ（fetchAllStreamMetaが元々YouTubeのメタ情報を扱わない既存方針を踏襲、
   YouTubeの配信開始検知は未対応）。独立レビューでPASS。実機での動作確認はまだ未実施。
7. [x] 全タブ統合のチャットに表示するチャットのON/OFF機能の追加（チャンネル名の横にある
   チャット表示の切り替えを全タブ統合側にも実装）
   → 対応済み（2026-08-07セッション）。既存のchatHidden（タイル個別チャット埋め込み）とは
   別の新規store key `chatIntegrationHidden` を追加し、チャット統合パネルのタブ一覧
   （タブ/全タブ統合共通）に💬/🔇トグルを実装。全タブ統合（timeline）モードの実体である
   appendTimelineMessage()の入口でチャンネル名を突き合わせてフィルタする方式。永続化済み。
   独立レビューでPASS。実機での見た目・動作確認はまだ未実施。
8. [x] チャンネル名の横にあるチャット表示の切り替え等、変更した設定を記憶し、アプリを
   再起動しても変更内容をチャンネル毎に記憶するようにする
   → 個別チップのチャット表示切替(chatHidden)自体は元々electron-storeで永続化済みと確認済み。
   項目7（全タブ統合側のON/OFF機能）も上記の通り実装し、chatIntegrationHiddenとして
   同様に永続化済みのため、これで完了。
   （2026-08-06セッションで「設定永続化」として着手したchatIntegrationMode/
   unifiedFeedPlatformFilterの永続化は、この項目とは別の潜在バグだったが対応済み）
9. [x] 「ファイル」の下にあるプルダウン（Twitch/YouTube/Kick表示）を当アプリにマッチする
   オリジナルの見た目に変更
   → 対応済み（2026-08-07セッション）。公式サイト(mumeinoapp.pages.dev)のブルー(#4f8cff)〜
   シアン(#22d3ee)グラデーション・角丸強めの方向性でユーザー承認済み。`#channel-platform-select`
   （チャンネル追加欄のプラットフォーム選択）のみを対象に、appearance:none+CSS二重グラデーション
   矢印でオリジナルの見た目に変更（ネイティブselectのキーボード操作・アクセシビリティは維持）。
   他4つのselect（emotes/zapping/pro-checkout/comment-font）は今回スコープ外として意図的に未変更
   （pro-checkout-months-selectは決済関連のため特に触れず）。独立レビューでPASS。
10. [x] 上下スクロールできるスクロールバー/スクロールポイントを当アプリにマッチする
    オリジナルの見た目に変更
    → 対応済み（2026-08-07セッション）。既存の横スクロール2箇所(#channel-chips/
    .chat-integration-tabs)のthumb色をブランドグラデーションに変更、縦スクロール13箇所
    （設定/スタンプ/共有/音量ミキサー/配信チェック/Dropsハブ等の各パネル）にブランドカラーの
    scrollbar-width/color(Firefox)+::-webkit-scrollbar系(Chromium)を統一適用。純CSSのみの変更。
    独立レビューでPASS。
11. [x] 音量のゲージを下げていても、再起動時等にそれより大きい音量で再生される問題の修正
    → 対応済み（バグ修正1セッション、MutationObserverで後から生成される<video>にも音量適用）
12. [x] 各配信のタイトル・カテゴリー・配信時間（リアルタイム更新）・視聴者数（リアルタイム更新）
    → 対応済み（配信メタ情報表示・配信経過時間セッション）
13. [x] 追加済みチャンネル名部分の入力履歴UIを、矢印キー上下での履歴選択ではなく当アプリ
    オリジナルの表示方法に変更。各履歴の右側に×ボタンを追加し履歴から削除できる機能の追加
    → 対応済み（2026-08-07セッション）。チャンネル名入力欄限定で、矢印キー方式(attachInputHistory)
    から入力欄下に一覧を出すオリジナルUI(setupChannelNameHistoryDropdown)に変更。各行クリックで
    入力欄に反映、×ボタンでhistory:remove IPC経由でその場で個別削除。Drops自動追加/削除の
    ゲーム名入力欄は影響なく従来の矢印キー方式のまま。独立レビューでPASS。実機での見た目・
    動作確認はまだ未実施。
14. [x] YouTubeの「@」から始まるハンドルで配信を追加しようとした際、ライブ予定枠
    （スケジュール済み配信）が既にある場合に配信が読み込まれない問題の修正
    → 対応済み（2026-08-06セッション後半）。根本原因はresolveYoutubeLiveVideoIdFree()が
    ページ全文へノースコープで"isLiveNow":trueを検索していたため、配信予定(未開始)ページの
    無関係な箇所にある別動画のisLiveNow:trueに誤ヒットし、配信予定の動画IDを「配信中」と
    誤認して埋め込んでいたこと。extractBalancedJsonAfter()でytInitialPlayerResponseを
    安全に切り出し、videoDetails.videoIdとliveBroadcastDetails.isLiveNowを同一スコープ内
    から突き合わせるよう修正。独立レビューでPASS（単体テストも実施）。
    ※注記: 先に「#13 YouTube @不具合」として対応したのは別の潜在バグ（URL/ハンドル入力で
    タイル識別キーが食い違う問題）で、これはこれで実在のバグとして修正済み。
15. [x] Dropsのボタンを一つに統合し、その中からTwitch/Kickのドロップ確認・進捗確認・
    配信チェック内にあるDrops自動追加/削除を移動させる
    → 対応済み（2026-08-07セッション）。旧3ボタン(drops-toggle-btn/drops-progress-btn/
    kick-drops-toggle-btn)を単一の`drops-hub-btn`に統合し、新規サイドパネル`drops-hub-modal`に
    Twitch/Kick Drops開閉・進捗確認・Drops自動追加/削除を集約。ユーザー確認の上、パネル自体は
    無料開放、Drops自動追加/削除の追加・削除操作のみPro限定を継続（premiumUnlockedガード）。
    Twitch/Kick DropsのBrowserViewはサイドパネル分だけ幅を縮める既存の仕組み
    (getUsableContentWidth)を流用し、パネルを開いたまま操作できるようにした。独立レビューでPASS。
    純JS/CSS/HTML変更でビルド不要のため.batルール非該当。実機での動作確認はまだ未実施。
16. [ ] 配信チェックボタンの変更提案。現在のままでもいいが、チャンネル一覧のような
    カード/タイル方式の表示（当アプリオリジナルの見た目）も検討したい。取り入れる場合、
    配信チェック内の「Drops自動追加/削除」以外の機能をどう配置するかも要相談。
    → 設計討議完了（2026-08-07セッション）。要件確定：①配信中一覧のカード/タイル化
    （視聴者数順、LIVE上部、avatar表示、isTargetソート撤廃）②自動追加対象選択の専用タブ化
    （サイト別/五十音順/アルファベット順）③フォロー自動追加設定を最上部に圧縮しヘルプへ説明移設。
    パネル表示方式は将来7パネル全体の移行も見据え、BrowserView最前面オーバーレイ方式
    （setTopBrowserView活用）へ切替決定。5段階に分割し、
    **段階1「汎用オーバーレイパネル基盤の新設」は実装・独立レビューPASS済み**
    （src/main.js: overlayPanelView/openOverlayPanel/closeOverlayPanel等、src/preload.js、
    src/renderer/renderer.js（ESC優先度分岐）、src/renderer/overlay-panel/配下の新規4ファイル。
    既存openSidePanel方式とは完全独立、既存タイルのbounds変更なし。中身はまだ「準備中」の
    ダミー表示のみで、実UI未着手。実機動作確認はまだ未実施）。
    **段階2「配信チェックパネルを新基盤に載せ替え+要件①」も実装・独立レビュー2周PASS済み**
    （2026-08-08セッション）。unified-feedパネルをopenSidePanel方式からオーバーレイパネル基盤へ
    移植し、配信中一覧をアバター画像付きカード表示化（視聴者数順、LIVE優先、isTarget優先ソートは
    main.jsのfetchUnifiedFeed()から削除済み）。Twitch(Helix Get Users)/YouTube(DOMスクレイプに
    相乗り)/Kick(reverse-engineered、フィールド名は実データ未検証)からアバターURLを取得、失敗しても
    本体データ取得はブロックしない設計。CSPにimg-src追加。自動追加対象選択/フォロー自動追加設定の
    2セクションは段階3/4向けに機能・見た目とも変更なしで新パネルへそのまま移設。独立レビューで
    TDZ落とし穴（宣言位置）とオーバーレイパネル/サイドパネル同時使用時の重なり不可視化バグの
    2件を検出・修正、再レビューPASS。git commit 0203fcf。**実機での動作・見た目確認はまだ未実施。**

    ⚠️**2026-08-07セッション追加相談で方針転換確定**: ユーザーから項目20「複窓レイアウト設定」
    （独立BrowserWindow方式）と項目16「配信チェック」は同一の想定で進めていたはずが、実際には
    項目16はBrowserViewオーバーレイ方式（段階1・2）で実装されており認識がズレていたと判明。
    ユーザー確認の結果、「配信チェックも複窓レイアウト設定と同じ独立BrowserWindow方式
    （alwaysOnTop・ドラッグ可・外側クリックで閉じない・×/ESCのみ閉じる）に統一する」ことで確定。
    **段階1・2で実装したオーバーレイパネル方式のunified-feed部分は置き換え対象**（ただし
    overlayPanelView基盤自体はhelp/welcome/premium-locked/feedback/pro-authの5モーダルで
    現役のため、基盤コード自体の無駄ではない）。残りの段階3(要件②専用タブ)/段階4(要件③圧縮設定)は
    独立ウィンドウ前提で以下の段階A〜Eに再分割して進行する:
    - 段階A: 独立ウィンドウの土台のみ新設（中身はプレースホルダー）
      → **実装・独立レビューPASS済み（2026-08-07セッション、git commit 181f819）。実機確認済み**
      （2026-08-08、ユーザーがスクリーンショットで確認：ウィンドウが開き「準備中です」表示が
      正しく出ることを確認）。
      src/renderer/stream-check-window/配下新規4ファイル、src/main.jsのcreateStreamCheckWindow()等、
      src/preload.jsのopenStreamCheckWindow、renderer.jsのunifiedFeedBtnハンドラ差し替え。
      旧overlay-panel側のmountUnifiedFeed()はまだ削除していない（段階Dで撤去予定）。同コミットで
      表示名「配信チェック」も「配信一覧」へ変更済み（ボタン・見出し・ウィンドウタイトル・
      README、内部識別子とコメントは意図的に未変更）。
    - 段階B: カード一覧・フィルタ・自動更新の表示ロジック移植
      → **実装・独立レビューPASS済み（2026-08-08セッション）**。overlay-panel.jsのmountUnifiedFeed()
      （プラットフォーム絞り込みボタン・20秒自動更新タイマー・＋追加ボタン）とlayout-window.jsの
      buildCard()（アバター・タイトル・カテゴリ・視聴者数・経過時間のカード表示、textContentベースの
      XSS対策）を組み合わせて、src/renderer/stream-check-window/配下の4ファイルへ実装。
      main.jsのnormalizeKickFollowedChannel()にtitle/category/startedAtを追加（Kickの
      livestreamオブジェクトから読むだけで新規リクエストなし）。「自動追加の対象にする」
      「常に表示（ピン留め）」チェックボックスと「自動追加の対象を選ぶ」「フォロー配信者の
      自動追加」セクションは意図的にスコープ外（段階Cで対応）、ピン留め済みでオフラインの
      チャンネルはOFFLINE表示のカードとして出すのみ（設定変更は不可）。独立レビューでPASS
      （main.js⇔JS間のプロパティ名・IPCチャンネル名・preload API名の整合性、XSS対策、
      タイマーのクリーンアップ等を確認）。実機での見た目・動作確認はまだ未実施。
      ⚠️注記: リポジトリの.git/index.lockが本セッション中ずっと解除できず、git commitが
      実行できていない（ファイル変更自体はディスクに保存済み）。次セッション冒頭でロック解除・
      コミットを確認すること。
    - 段階C: 自動追加対象選択・フォロー自動追加設定（Twitch連携）の移植
      → **実装・独立レビューPASS済み（2026-08-08セッション、git commit 5019b1e）**。
      Planエージェントによる設計の結果、旧overlay-panel.jsの`mountUnifiedFeed()`から以下を
      移植: ①「自動追加の対象を選ぶ」は専用タブ「自動追加の対象」として新設し、要件通り
      「サイト別（Twitch→YouTube→Kick、各内は名前順）」「五十音/アルファベット順」の
      並び替えボタンを追加。②「フォロー配信者の自動追加」（Twitch連携状態・有効化・上限枠）は
      ヘッダー直下の1行圧縮バーに集約（詳細説明のヘルプ移設＝段階C-6は段階Eで対応済み、後述）。
      加えて、配信一覧が独立BrowserWindow化（段階A）したことで新たに発覚した設計課題
      「Twitch OAuth認証画面(BrowserView)が配信一覧ウィンドウに隠れて操作不能になる」問題を、
      認証画面のホストウィンドウ（mainWindow/配信一覧のどちらから開始したか）を一般化する形で
      解消（main.jsの`openTwitchAuthView`/`closeTwitchAuthView`/`startTwitchUserAuth`をホスト
      引数化、`BrowserWindow.fromWebContents(event.sender)`で解決）。配信中一覧タブのカードにも
      「自動追加の対象にする」「常に表示（ピン留め）」チェックボックスを復活させ、対象選択タブと
      相互同期する。独立レビューでPASS（IPCチャンネル名整合・XSS対策・旧実装との機能同一性・
      既存段階B機能の非回帰を確認）。実機での動作確認はまだ未実施。
    - 段階D: 旧overlay-panel側のunified-feedコード撤去、分岐整理
      → **実装・独立レビューPASS済み（2026-08-08セッション）**。overlay-panel.js/index.html/
      overlay-panel.css/overlay-panel-preload.jsからunified-feed専用コードを削除、main.jsの
      OVERLAY_PANEL_WIDTHS・renderer.jsのOVERLAY_PANEL_DOCKED_IDS（いずれもunified-feedのみが
      対象だった）も撤去。overlayPanelView基盤（help/welcome/premium-locked/feedback/pro-auth
      が使用中）や、main.jsのfetchUnifiedFeed()本体・unified-feed:*のipcMainハンドラ
      （stream-check-window側が現役使用中）は変更なし。独立レビューでPASS。
      ⚠️注記: 本セッションも.git/index.lockが解除できず、git commit未実行（ファイル変更自体は
      ディスクに保存済み）。次セッション冒頭でロック解除・コミットを確認すること。
      実機での動作確認（help/welcome/premium-locked/feedback/pro-auth各モーダル、配信一覧
      ボタン）はまだ未実施。
    - 段階E: 実機確認＋要件②③の続行（③のヘルプ移設・「詳しく」導線は段階Cで未着手のため
      残作業として引き継ぐ）
      → **③のヘルプ移設・「詳しく」導線を実装・独立レビューPASS済み（2026-08-08セッション）**。
      overlay-panel/index.htmlのヘルプTwitchタブに「フォロー配信者の自動追加」の詳細説明
      （id="help-twitch-autotune"）を新設。stream-check-window/index.htmlの圧縮バーに
      「詳しく」ボタンを追加し、クリックで新規IPC`ui:open-help-section`（main.js）経由で
      メインウィンドウを前面化した上でヘルプをTwitchタブ・該当項目へ直接ジャンプ表示する
      （overlay-panel.jsがURLクエリhelpTab/helpAnchorを読み取りselectHelpTab+scrollIntoView、
      2秒間ハイライト）。stream-check-window-preload.jsにopenHelpSection追加。
      独立レビューでPASS（XSS対策・IPC引数のnullガード・既存help導線(welcome/premium-locked
      からのselectHelpTab呼び出し)への非回帰を確認）。実機での動作確認（詳しくボタン→
      メインウィンドウ最前面化→ヘルプTwitchタブへの遷移・ハイライト）はまだ未実施。
      残る要件②③の完全な残作業は無し（要件②③はこれで実装完了）。実機確認自体（段階B〜Eの
      全変更分）は次回セッションで実施予定。

    ⚠️**2026-08-08セッション追加**: 段階Bの実機確認（ユーザーがスクリーンショットで報告）で
    6件の追加修正依頼を受け、対応・独立レビューPASS・git commit 18d1453済み:
    ①カードの縁をネオン系グラデーション(#4f8cff〜#22d3ee)枠に変更（暗すぎる印象の解消）
    ②OSネイティブタイトルバーと自作ヘッダーの二重表示・×ボタン二重を解消（main.js
    frame:false化＋CSS -webkit-app-region:dragでドラッグ移動を代替、更新ボタンをツールバーへ
    移設、OS最小化ボタンごと廃止）③「＋追加」ボタン下に「削除」ボタンを追加（誤追加の取り消し、
    既存channels:remove IPC再利用）④カード表示順をTwitch→YouTube→Kick固定+各内は視聴者数順に
    変更（stream-check-window.js内のみでソート、main.js側fetchUnifiedFeed()の共通ソートは
    layout-window.js等への影響を避けるため意図的に不変更）⑤「読み込み中…」表示をツールバー
    右側（最終更新の左）へ移動し、本文上部の全幅行を廃止⑥最前面バグ修正（alwaysOnTop:true→
    parent:mainWindowへ変更、OS全体ではなくMCDアプリ内でのみ前面に出るようにした）。
    独立レビューでPASS（キー整合性・XSS対策・TDZ・.batルール非該当を確認）。実機での見た目・
    動作確認はまだ未実施。

    さらにユーザーから「理想」として2件の追加要望あり（今回未着手、段階C以降で検討）:
    ⑦自動更新間隔を最長5秒程度まで高速化 ⑧YouTube/Kickのチャンネルアイコン・カテゴリ・
    視聴者数・配信時間の取得＆表示（現状YouTubeはメタ情報非対応、Kickはtitle/category/
    startedAtのみ対応済みでアイコン・視聴者数は対応済み、YouTube側の対応が主な残作業）。
    ⑦は対応済み（Twitch5秒/YouTube20秒に分離、git commit 60d3422）。

    ⚠️**2026-08-08セッション追加**: 段階F実機確認後の追加要望10項目のうち、⑨は段階F
    （設定タブ新設ほか）で対応済み。**⑩「配信一覧のカードを複窓レイアウトの選択対象にし、
    レイアウト配置ボタンで選択順にメイン画面の自動整列テンプレートへ反映する」も実装・
    独立レビューPASS済み（git commit 6d3ed47）**。配信一覧ウィンドウのカードをクリック選択可能
    にし（最大9件、番号バッジ）、既存のlayout-window:auto-arrange IPC（applyLayoutWindowArrange）
    をそのまま呼び出す設計。main.js側は新規ハンドラ不要。実機での動作確認はまだ未実施。
    ⑪（オーバーレイパネル系ウィンドウが配信一覧より前面に来ない問題）はユーザー判断により
    保留（streamCheckWindowが子ウィンドウのため常に親より前面に出る仕様上の制約、詳細は
    Cowork_作業進捗の該当ログ参照）。
    これで項目16・20（配信一覧・複窓レイアウト設定）関連の要望はすべて実装完了、残るは実機確認のみ。

## 実機確認で追加報告された3件（2026-08-07、対応済み・実機確認前）

17. [x] チャンネル名入力欄の履歴ドロップダウンが下部で見切れて隠れる問題
    → 対応済み（2026-08-07セッション）。原因は#control-bar(height:84px, overflow-y:hidden)
    による絶対配置のクリップ。.input-history-dropdownをposition:fixed化し、
    setupChannelNameHistoryDropdown内でinputEl.closest('.channel-input-wrap')の
    getBoundingClientRect()からleft/top/widthをpxで算出して付与する方式に変更。
    ウィンドウリサイズ・#control-barの横スクロール時も追従。独立レビューでPASS。
    実機での動作確認はまだ未実施。
18. [x] 配信タイルに配信者名・タイトル・視聴者数・配信時間（リアルタイム更新）を表示
    → 対応済み（2026-08-07セッション）。配信サイト側のページには一切手を加えず、
    streamView(BrowserView)の高さを26px(TILE_INFO_BAR_HEIGHT)縮小し、できた隙間に
    アプリ自身が作るHTML帯(.tile-info-bar)を重ねる方式で実装。矩形はmain.js
    applyTileBoundsFromRectからtile:bar-bounds IPCでrendererへpush。中身は既存の
    streamMetaCache(チップと共有、新規フェッチ無し)を再利用。YouTubeは配信者名のみ表示
    （既存のfetchAllStreamMeta非対応方針を踏襲）。チップの視聴者数文字色もopacity減衰
    (0.75)から明色(#d7e6ff, opacity:1)に変更し視認性改善。独立レビューでPASS。
    実機での見た目・動作確認はまだ未実施。
19. [x] エラー通知等の表示位置をヘッダー直下の全幅帯からメニューバー右端へ移設
    → 対応済み（2026-08-07セッション）。旧#status-bar(高さ22px固定、全幅)を廃止し、
    #app-menu-bar（ファイル/表示/ヘルプ/バージョン/通知/フィードバック/会員登録の行）の
    末尾にmargin-left:autoで右端固定した#status-indicatorへ統合。中身が空の間はmax-width:0
    で場所を取らない。main.js HEADER_HEIGHTを132→110に変更（その分タイル表示領域が拡大）。
    独立レビューで通知の右寄せ漏れを1件指摘され、margin-left:auto追加で修正済み、再レビューPASS。
    実機での見た目・動作確認はまだ未実施。

## 実機確認以降に追加された新規依頼（2026-08-07後半）

20. [ ] 「複窓レイアウト設定」機能の新規実装（現コードベースに未実装、今回初出）。
    参考スクリーンショット：配信者アイコンがグリッド表示され、各カードにLIVEバッジ、
    経過時間、MAIN/SUB1/SUB2/SUB3のラベルが付く独立ウィンドウ風UI。ユーザー確定仕様：
    ①配信者アイコンをクリックした順にMAIN→SUBへ自動整列（「自動整列」ボタンを都度
    押した時のような並び替わり方）で追加。②LIVE/OFFLINE表示は占有率次第（窮屈なら
    撤廃も検討）。③パネル内から追加取り消し（選択解除）可能。④カード/タイル内に
    名前・タイトル・カテゴリ・配信時間を表示。⑤表示方式は独立ウィンドウ（Electronの
    別BrowserWindow、常に最前面(alwaysOnTop:true)、ドラッグ移動可、ウィンドウ外
    クリックでは閉じない、専用×ボタンかESCキーでのみ閉じる）＝サイドパネル/
    オーバーレイパネル方式は不採用。⑥このレイアウト設定で決めたMAIN/SUB配置は
    最終的にメイン画面の配信タイル配置（実際のBrowserView並び・サイズ）に反映される。
    → 設計討議完了（2026-08-07セッション）。⑦未選択タイル（適用時に選ばれなかった既存タイル）
    は「閉じる」（選択内容で完全に入れ替え）と確定。Planエージェントによる調査の結果、
    4段階に分割して進める：段階1=独立ウィンドウの土台＋既存unified-feedデータ再利用での
    グリッド表示のみ（クリック機能なし）／段階2=クリック選択・取消とMAIN/SUB自動整列ロジック／
    段階3=メイン画面タイル配置への実際の反映（addChannel+channelOrder/tileLayouts書き換え、
    未選択タイルは閉じる）／段階4=デザイン仕上げ・エッジケース対応。
    既存資産の再利用: unified-feed（fetchUnifiedFeed）のアバター・LIVE判定は流用可能だが、
    タイトル/カテゴリ/経過時間は現状含まれないため、fetchFollowedLiveChannels内でTwitch分の
    title/game_name/started_atを追加取得する必要あり（段階1で対応）。YouTubeはメタ情報
    非対応のため該当項目は省略許容。タイル配置は`computeAutoGridRects`類似の
    `computeMainSubRects`を新設し、既存の`layout-share`(applySharedLayout)のチャンネル適用
    パターンを踏襲する方針（段階3）。
    → **段階1「独立ウィンドウ土台＋グリッド表示」実装・独立レビューPASS済み、git commit f8b67e4。**
    **段階2「クリック選択・取消」も実装済み**（git commit 2628a2e）。

    ⚠️**段階3着手時にユーザーと再相談し、仕様を以下の通り更新（MAIN/SUB案は廃止）**:
    「MAIN/SUB1〜3固定4枠」ではなく、選択数(1〜9)に応じた専用テンプレート配置に変更。
    1枚=全画面／2枚=左右2分割／3枚=上1(全幅)+下3分割／4枚=四方2x2／5枚=上2分割+下3分割／
    6枚=上3分割+下3分割／7枚=上(2x2の4枠)+下3分割／8枚=上3分割+中3分割+下2分割(少し小さめ)／
    9枚=3x3。さらに、この1〜9テンプレートは今回の新機能専用ではなく、既存の「自動整列」ボタン
    （現在開いている全タイルを均等グリッドにする機能）の中身自体も全面置き換えてよいとユーザー
    承認済み。トリガーも「適用」ボタンではなく、レイアウト設定ウィンドウ内に新設する
    「自動整列」ボタンに統一。加えて2つのオプションを追加：①「クリックで即時追加」トグル
    （ONの間は選択と同時にメイン画面へその場でチャンネル追加、既存のchannels:add IPCを再利用）
    ②「チャット表示」トグル（自動整列実行時に選択チャンネル全体の個別チャット埋め込みを一括
    ON/OFF、Twitchのみ意味を持つ）。未選択タイルを閉じる完全入れ替え自体は元の確認事項⑦通り
    確認ポップアップなしで実行してよいとユーザー確認済み。

    → **段階3実装・独立レビューPASS済み（2026-08-07セッション、git commit 7b47444）**:
    main.jsに`computeTemplateRects(count)`（1〜9枚テンプレート、10枚超は既存
    computeAutoGridRectsへフォールバック）を新設し、`autoArrangeAllTiles()`
    （既存の自動整列ボタン）の中身をこれに置換。新規`applyLayoutWindowArrange({selection,
    chatVisible})`（既存タイル全閉じ→選択順にaddChannel→チャット一括設定→
    computeTemplateRectsでtileLayouts設定→channelOrder設定→relayoutStreamViews）と
    IPCハンドラ`layout-window:auto-arrange`を追加。layout-window-preload.jsに`addChannel`
    （既存channels:add再利用）・`autoArrange`を追加。layout-window.js/css/index.htmlに
    「自動整列」ボタン・2トグルのUIとロジックを追加、SLOT_LABELSはMAIN/SUB1〜3から1〜9の
    番号バッジに変更。実機での動作確認はまだ未実施。
    ⚠️注記: 3枚パターンの表記「上1(全幅)+下3分割」は1+3=4枚で本文と矛盾するtypoだったため、
    実装は`computeTemplateRects`のcase 3で「上1(全幅)+下2分割」（合計3枚、数学的に正しい方）
    として実装・独立レビュー確認済み。ユーザーへの明示的な再確認はまだ。

    ⚠️**2026-08-07セッション追加**: 項目16「配信チェック」も、当初のBrowserViewオーバーレイ方式
    から、この項目20と同じ独立BrowserWindow方式に統一されることが確定した（詳細は項目16参照）。
    ただし実装は完全に別系統（`src/renderer/stream-check-window/`配下に新規ファイル、
    `createStreamCheckWindow()`をmain.jsに新設）とし、このlayout-window関連コードには
    一切手を加えていない。段階3(このセクション)への影響はなし。

## 実機確認で追加報告された3件（2026-08-10、実装・独立レビューPASS済み）

21. [x] 全タブ統合のチャンネルタブ（`.chat-integration-tabs`、dmf_kyochan/mukai_fps/meltonff/
    sasatik等が並ぶ横並びタブ）を、マウスホイールでスクロールできるようにする。
    現状は`overflow-x: auto`（style.css 1402行〜、横スクロールバー自体は既存の
    ブランドカラーthumbで表示済み＝項目10で対応済み）だが、マウスホイール操作（縦方向の
    deltaY）が横スクロールに変換されておらず、スクロールバーを直接ドラッグしないと
    スクロールできない。renderer.js側で`.chat-integration-tabs`に`wheel`イベントリスナーを
    追加し、`e.deltaY`（必要なら`e.deltaX`優先）を`scrollLeft`加算に変換する対応を想定。
    影響範囲はこのタブバーのみで、他の横スクロール箇所（#channel-chips、#control-bar）は
    今回のユーザー指摘に含まれないためスコープ外。

    → 対応済み（2026-08-10セッション）。`.chat-integration-tabs`にwheelイベントリスナーを追加し、
    deltaX/deltaYをscrollLeftへ変換する形で実装。独立レビューでPASS。実機での動作確認はまだ未実施。

22. [x] 自作メニューバー（ファイル/表示/ヘルプ/バージョン/通知）の各ドロップダウン内に
    ある「無駄な余白」の調整。ユーザー指摘箇所：ファイル（「終了」の下側）、表示
    （「レイアウトを再計算」の下側）、ヘルプ（「Kick Developer Portal」の下側）、
    バージョン（「アップデートを確認」の下側）、通知（「YouTube通知対象」ラベルと
    チャンネル名追加欄の間）。コード調査の結果、ドロップダウン本体（.menu-bar-dropdown/
    floating-dropdown.css側の複製含む）のpaddingは`4px 0`、各項目は`padding: 6px 16px`
    のみで、マークアップ上も末尾に空のプレースホルダー要素等は無い。スクリーンショットで
    確認できる余白の実際の原因（floating-dropdown BrowserViewの矩形計算元である隠れた
    `.menu-bar-dropdown`側のレイアウト崩れの可能性が高いが未特定）は、実装フェーズの
    冒頭で実機のDevTools（表示→開発者ツール）による要素検証で確定させてから着手する。
    通知タブの余白は項目23（YouTube通知対象リストの並び順変更）と合わせて対応すると
    見た目上も自然になる可能性が高い。
    → 対応済み（2026-08-10セッション）。Planエージェントによる調査の結果、原因は隠れたDOM
    (style.css基準)と実際に表示される側(floating-dropdown.css基準)の高さの食い違い
    （フォントサイズ差に加え、YouTube通知対象の追加行は隠れたDOM側が空div・表示側が
    input+buttonという構造自体の違いもあった）と特定。floating-dropdown.js側で描画後の
    実測`scrollHeight`をmain.jsへ報告し、BrowserViewの高さをその都度実寸へ補正する方式
    （通知ドロップダウンのみ既存の5件スクロール上限270pxでクランプ）で対応。channel-history/
    volume-mixerパネルは対象外（app-menuパネルのみのスコープ）。独立レビューでPASS。
    →実機確認済み（2026-08-11）。ユーザーから「npm start再起動でも直らない」との報告を受け、
    floating-dropdown BrowserView自身のDevToolsを覗く手段（did-finish-load時の自動DevTools
    起動、デバッグ用に一時追加・検証後に削除済み）を追加して実測。実際のBrowserView高さは
    中身(40px)にほぼ一致しており（元の概算値42pxから2px補正のみ）、修正自体は正しく機能して
    いたと確認。ユーザーが実際のアプリ画面のスクリーンショットでも「終了」直下の余白解消を
    確認・承認済み。

23. [x] 通知タブのYouTube通知対象リストで、チャンネル追加時の挿入位置を変更する。
    現状（renderer.js renderNotificationsDropdown、3232〜3241行）は
    「YouTube通知対象」ラベル→登録済みチャンネル一覧→末尾に追加用入力欄、という順で
    描画しており、新規追加したチャンネルは一覧の末尾（＝ラベルと入力欄の間）に挿入される
    形になる。これを「ラベル→追加用入力欄→登録済みチャンネル一覧（新しく追加した
    ものほど下）」の順に変更する。renderer.js側の描画順（makeDisabledItem→
    makeYoutubeTargetAddRow→youtubeTargets.forEach）と、実際に表示される
    floating-dropdown.js側のrenderAppMenuRows（行タイプの並びはrenderer.js側が渡す
    rows配列の順番に従うだけなので、renderer.js側の並び替えのみで対応可能な想定）の
    両方を確認しながら実装する。
    → 対応済み（2026-08-10セッション）。renderer.jsのrenderNotificationsDropdownで、
    追加欄(makeYoutubeTargetAddRow)をラベル直下・一覧より前に描画する順序へ変更（一覧側の
    ロジックは無変更、DOM追加順のみの変更）。domDropdownToRowsが子要素をDOM順にそのまま
    floating-dropdown側へ渡す実装のため、表示側にも同じ順序が反映される。独立レビューでPASS。
    実機での動作確認はまだ未実施。

## 新規依頼（2026-08-17、ユーザーより追加）

24. [x] 過去に一度でも追加した配信の設定（埋め込みチャットのON/OFF・アプリボタンの音量設定）を、
    配信やアプリ自体を閉じたり、PCの再起動後も最後の設定を記憶するように変更する。
    → 対応済み（2026-08-17セッション）。原因はsrc/main.jsの`removeChannel()`が、配信タイルを
    閉じるたびに`chatHidden`/`chatIntegrationHidden`/`channelVolumes`のstoreエントリを
    自ら`delete`していたこと（保存・復元の仕組み自体は既に正しく実装済みで、削除時に消して
    いたことのみが原因）。3つのdelete処理ブロックを撤去し、意図的にstoreへ恒久保持する方式に
    変更（新規の復元ロジック追加は不要、既存のaddChannel/dom-ready側の読み込みがそのまま機能）。
    `channels`/`tileLayouts`/`channelPlatforms`等、今回スコープ外の他の永続化キーの削除処理は
    従来通り維持。周辺の古いコメント（「removeChannelで消える」前提の記述）も合わせて更新。
    独立レビューでPASS（node --check構文確認済み、ザッピング機能への非回帰も確認）。純JS変更で
    バンドラー無し（electron .で直接起動）のためビルド・.bat不要。**実機確認済み（2026-08-17）**。

25. [x] 配信一覧ボタン内のあらゆるスクロールバーが見切れてしまう問題の修正。
    → 対応済み（2026-08-17セッション）。原因はframe:falseの独立BrowserWindowでWindows 11の
    DWMが角丸クリップを窓の外周へ直接適用し、`.stream-check-window-body`（3タブ共通の唯一の
    スクロールコンテナ）のスクロールバーが真の右端に張り付いていたこと。
    stream-check-window.cssへmargin-right:3pxでスクロールバーと外周の隙間を確保し、
    main.jsのcreateStreamCheckWindow()へroundedCorners:falseを追加してDWM自動角丸自体を
    無効化。独立レビューでPASS（`.stream-check-targets-list`は別スクロールコンテナではなく
    対象漏れ無しと確認）。**実機確認済み（2026-08-17）**。dev版（npm start）で自動追加タブから
    フォロー一覧170件を読み込み、スクロールバーが外周から余白を保って表示されることを確認。

26. [x] Twitchの配信画面をドラッグしようとした時、ドラッグが実質不可になってしまう問題の
    調査と修正。
    → 対応済み（2026-08-17セッション）。原因はtileInteractionPreload.jsのmousedown
    ハンドラが移動ゾーンではpreventDefault()を呼ばないため、Twitch本体DOMの移動ゾーン上に
    重なるアバター画像等の`<img>`要素上でmousedownするとChromiumのネイティブHTML5画像
    ドラッグが横取りし、以降mousemoveが届かずタイル移動が止まっていたこと（Kick/YouTubeは
    同種の画像オーバーレイが無いため再現しない）。`isNativeDraggableElement()`
    （`img, a[href]`判定）を追加し、該当要素上のmousedownではpreventDefaultするよう変更。
    既存の音量スライダー等の`isNativeDragControl`優先判定・通常クリック（mouseupのclick）
    への影響なしと独立レビューで確認。ただし実際のTwitch DOMを見ての検証ではなく静的解析に
    基づく推定修正のため、実機での動作確認が特に重要。**実機確認済み（2026-08-17）**。dev版で
    Twitchタイルのアバター画像上からドラッグを実行し、ネイティブ画像ドラッグに横取りされず
    正常にタイルの移動/リサイズが機能することを確認。

27. [x] ヘッダーの設定ボタンの名称を「環境設定」に変更する。
    → 対応済み（2026-08-17セッション）。index.htmlの`#settings-open-btn`のラベル・titleを
    「設定」→「環境設定」に変更（アイコン⚙は維持）。設定パネル自体の見出し`<h2>設定</h2>`は
    今回のスコープ（ヘッダーボタンの名称のみ）外として意図的に未変更。独立レビューでPASS
    （他に「設定」というラベル文字列を重複保持している箇所・文字列比較で壊れる箇所なし）。
    **実機確認済み（2026-08-17）**。ヘッダーボタンが「⚙環境設定」表示になっていることを確認。

28. [x] 各ヘッダーのボタン内のタイトル（例：設定ボタン内の「設定」「アカウント連携」等）の
    上下の間隔が開きすぎているので、もう少し狭める。
    → 対応済み（2026-08-17セッション）。原因はブラウザ既定のh2/h3マージン（約19〜20px）が
    `.settings-divider`等と積み重なっていたこと。`.modal-content`のh2/h3パターンを使う
    `#settings-modal`（設定）/`#zapping-modal`（ザッピング）/`#drops-hub-modal`（Drops）の
    3パネルに絞ってh2のmargin-bottom・h3のmargin-top/bottomを縮小（約19px→約10px）。
    見出し構造が異なる`#emotes-panel`/`#layout-share-panel`（`.panel-header`内h3+×ボタンの
    横並び構成）は対象外として意図的に未変更。独立レビューでPASS（別ファイルの
    `.help-tab-content h3`への影響なしも確認）。**実機確認済み（2026-08-17）**。設定パネルの
    見出しと直下項目の余白が縮まっていることを確認。

    ⚠️**2026-08-17追加対応**: ユーザーから「スタンプ・共有と他も確認し、余白を同じように
    縮小処理を行ってください」と追加依頼を受け、前回スコープ外だった`#emotes-panel`
    （スタンプ）・`#layout-share-panel`（共有）と、見落としだった箇所を対応。
    Planエージェントによる網羅調査の結果、以下4箇所を追加修正（すべてsrc/renderer/style.css
    のみのCSS変更）:
    ①`#emotes-panel`/`#layout-share-panel`の`.panel-header h3`（flexコンテナ内でも
    ブラウザ既定のh3マージンが子要素に残っていたため`margin:0`に）
    ②`#emotes-panel`の`h4`（「お気に入り」「取得結果」見出し。h4用の全般リセットが
    元々存在しなかった見落とし）を`margin:10px 0 6px`に統一
    ③help/welcome/premium-locked/feedback/pro-authの5モーダル（overlay-panel/index.html、
    style.cssを共有読み込み）のh2に、既存の設定/ザッピング/Drops向けmargin-bottom:10px
    ルールをID追加する形で適用（前回セッションのスコープ漏れ）
    ④`.help-tab-content h3`にmargin-bottom:6pxを追加（margin-topのみリセット済みだった）。
    独立レビューでPASS（該当ID・セレクタの実在確認、既存ルールとの競合なしを確認）。
    実機確認済み（2026-08-17）：スタンプ/共有/使い方注記(基本操作見出し)/会員登録の各パネルで
    見出し直下の余白が縮まっていることを目視確認。純CSS変更のためビルド不要、.batルール非該当。

29. [x] 設定ボタン内のフォントメニュー（プルダウン）を当アプリのオリジナルデザインに変更する。
    → 対応済み（2026-08-17セッション）。src/renderer/style.cssの`#channel-platform-select`
    （項目9で確立済みのブランドカラー矢印デザイン）に`#comment-font-select`をセレクタ追加する
    形で共通化。`.modal-content input`との横幅統一のため`#comment-font-select`のみ個別に
    `width:100%`を追加。決済関連(pro-checkout-months-select)・emotes/zappingのselectは
    今回もスコープ外のため未変更。独立レビューでPASS（CSS構文・ID一致・他selectへの
    影響なしを確認）。純CSS変更のためビルド不要、.batルール非該当。
    実機確認済み（2026-08-17）。

30. [x] ザッピングの対象（サイト名）メニュー（プルダウン）を当アプリのオリジナルデザインに
    変更する。
    → 対応済み（2026-08-17セッション）。項目29と同じ共有ブロックに`#zapping-platform-select`
    をセレクタ追加。`.group`（field-labelと横並びのflexレイアウト）内のため
    `#channel-platform-select`と同様width:100%は付与せず。独立レビューでPASS。純CSS変更のため
    ビルド不要。実機確認済み（2026-08-17）。

31. [x] 配信画面下部のメタ情報バーをON/OFFできるスイッチを、メイン画面のどこか、または
    ヘッダーの設定ボタン内に新設する別タブへ配置する。このON/OFFスイッチ自体も
    オリジナルデザイン化する。
    → 対応済み（2026-08-17セッション）。Planエージェントによる調査の結果、アプリ内に
    「別タブ」型UI自体が存在しない（タブUI新規設計はコスト過大）と判明し、既存の
    #settings-modal内に1行追加する形に確定。store defaults に`tileInfoBarEnabled`(既定true)
    を追加し、`applyTileBoundsFromRect()`のTILE_INFO_BAR_HEIGHT参照とedgeConfigFor()の
    stream側bottom判定の両方をこのフラグに連動させる（OFF時は情報帯の高さ0で配信映像が
    全高を使い、代わりに配信映像側の下端リサイズを有効化。片方だけ直すと「バーは消えたが
    下端リサイズ不可」等の不整合になるためセットで対応）。settings:set-all側でトグル変化時に
    relayoutStreamViews()+全チャンネルsendEdgeConfig()再送。スイッチ自体はアプリ内に前例が
    無かったため新規CSS（checkbox+appearance:none+::afterノブ、ブランドグラデーション
    #4f8cff〜#22d3ee）で自作。独立レビューでPASS（座標計算の整合性、CSS詳細度、
    activeInfoBarViewとの連動を含め確認）。純JS/CSS/HTML変更でビルド不要、.batルール非該当。
    実機確認済み（2026-08-17）。

32. [x] 全タブ統合のチャット欄に表示されるチャンネル名（ユーザー名の左側）を、各チャンネルの
    アイコンに変更する。
    → 対応済み（2026-08-17セッション）。src/main.jsの`fetchTwitchStreamMeta`/
    `fetchKickStreamMeta`にavatarUrl取得を追加（Twitchは既存の`fetchTwitchAvatarUrls`流用、
    Kickは配信メタ取得と同一レスポンスから`profile_pic`を拾うだけで追加リクエスト無し）。
    YouTubeは今回スコープ外（アバター取得ロジック未実装のためフォールバック運用）。
    src/renderer/renderer.jsの`renderTimelineMessageLine`で、これまでテキストだった
    `[チャンネル名]`表示を`<img class="chat-channel-icon">`に置き換え、streamMetaCacheから
    引いたavatarUrlを使用。未取得/読み込み失敗時はチャンネル名から決定的にhueを算出した
    頭文字アイコン（SVG data URI）にonerrorで差し替え。title/alt属性でチャンネル名は
    ホバー時に確認可能な形で保持。src/renderer/style.cssに`.chat-channel-icon`
    （18px円形、border付き）を新設し旧`.chat-channel`ルールは削除。独立レビューでPASS
    （node --check構文確認、呼び出し元3箇所のchannel引数の型、escapeHtmlの属性適用、
    CSS残存参照なし、fetchAllStreamMeta等既存消費側への副作用なしを確認）。純JS/CSS変更で
    ビルド不要、.batルール非該当。Electronアプリのためブラウザプレビューでは検証不可、
    実機での動作・見た目確認はまだ未実施。

## 実機確認で追加報告された不具合2件（2026-08-17、対応済み・実機確認前）

A. [x] YouTubeのチャンネルアイコンを読み込めない、認識できない問題。
    → 項目32実装時点ではYouTubeのアバター取得は意図的に未実装（Phase2として保留）だったため
    フォールバック（頭文字＋色分けアイコン）が常に出ていた状態で、バグではなく実装漏れと判明。
    Planエージェント調査の結果、`fetchYoutubeLiveInfoFree`が既に取得しているライブページHTML
    中にYouTube側の`ytInitialData`という別JSONが同居しており、そこからチャンネルアバターURLを
    追加抽出できると判明。新規関数`extractYoutubeChannelAvatarFromInitialData`を追加し、
    既知パス（`videoSecondaryInfoRenderer.owner.videoOwnerRenderer.thumbnail.thumbnails`）を
    まず試し、見つからない場合はJSON全体を反復探索するフォールバックへ切り替える
    （どちらも失敗時はnullを返すのみで例外は投げない防御的実装）。追加のHTTPリクエストは
    発生しない。`fetchAllStreamMeta`のYouTube分岐にもavatarUrlを素通しさせる1行を追加。
    renderer.js側（項目32で実装済みのgetChannelAvatarUrl等）は無改修で自動反映される設計。
    独立レビューでPASS（構文確認、反復探索の性能・安全性、既存呼び出し元への非破壊性、
    fetchAllStreamMeta消費側への影響なしを確認）。実機確認済み（2026-08-17、ユーザーより
    「概ねいい感じ」との報告）。

B. [x] YouTubeのスタンプ（エモート）が読み込めない問題。
    → Planエージェント調査の結果、`fetchYoutubeEmotesForChannel`（絵文字ピッカーUIをBrowserViewで
    開いてDOM構造から画像を読み取る非公式スクレイピング方式）に、①ピッカー描画待ちが固定1秒待機
    で環境によっては間に合わず取りこぼす、②カテゴリーが見つからない/0件だった場合も常に「0件取得
    しました」という成功扱いの表示になり、実際に何が起きたかユーザーに伝わらない、という2つの
    脆弱性を確認。①は固定待機から「カテゴリーが現れるまで最大2.5秒ポーリング」方式に変更。
    ②はピッカー自体が開けなかった場合と、開けたがチャンネル固有スタンプが無かった場合を区別し、
    それぞれ専用のエラーメッセージを投げるように変更（呼び出し元のIPCハンドラ・renderer.js側は
    既存のresult.errorチェックの仕組みでそのまま表示されるため無改修）。なお「現在配信中でないと
    取得できない」という既存の制約自体は変更していない（配信中に選択したチャンネルでお試しいただく
    必要がある）。独立レビューでPASS。

    → 追加調査（2026-08-17、実機で「スタンプ一覧を開けませんでした」エラーを確認したとの
    報告を受け、Claude Browserで実際のYouTubeライブページに接続して原因を特定）: 根本原因は
    「YouTube側のページ構造変化」ではなく、このBrowserViewが使うpersist:youtubeパーティションに
    Googleアカウントのログインセッションが無いと、YouTubeがメッセージ入力欄
    （`<yt-live-chat-message-input-renderer>`）自体を描画しない（「ログインしてチャットを始める」
    ボタンのみ表示）ことだった。この状態では絵文字ピッカーボタンも存在しない。アプリには既に
    「アカウント連携」機能（環境設定）が同じpersist:youtubeパーティションでYouTubeログインを
    行う仕組みがあるため、連携済みならログインセッションが引き継がれる想定。ログイン欄の有無を
    先に判定し、無い場合はピッカー操作を試みず「YouTubeアカウントが未連携のようです（環境設定の
    「アカウント連携」からYouTubeにログインすると取得できるようになります）」という専用の
    エラーメッセージを返すよう修正。独立レビューでPASS（IIFE内の複数return経路の型整合性、
    IPCハンドラのtry/catch経由での伝播、既存コード内の同一セレクタ使用実績を確認）。
    YouTube側のUI構造依存のスクレイピングであるため、修正後も引き続きYouTube側の仕様変更で
    壊れうる前提。

    → 再修正（2026-08-17、ユーザーがYouTubeアカウント連携済み（環境設定で緑丸「連携済み」
    確認済み）の状態で試したところ、それでも「未連携のようです」エラーが出るとの報告を受けて
    調査）: 原因は、ログイン済みであっても入力欄（Polymerコンポーネント）の描画自体が1.5秒より
    遅くなることがあり、直後の単発チェックでは描画完了前に「未ログイン」と誤判定していたこと
    だった。入力欄の有無チェックとカテゴリー検出を1つのポーリングループに統合し、入力欄が
    見つかるまで最大10回×500ms（5秒）待ってから、それでも見つからない場合のみ未ログインと
    判定するよう変更（ピッカーボタンのクリックは初回発見時の1回のみ、トグル誤動作を防止）。
    独立レビューでPASS（クロージャのスコープ、ポーリング終了条件の網羅性、呼び出し元とのキー名
    整合、BrowserView破棄処理との競合なしを確認）。

    → 実機確認（2026-08-17、ポーリング統合版で再テスト）: 「未連携のようです」エラーは解消し、
    未ログイン誤判定は修正できたことを確認。ただし新たに「このチャンネル固有のスタンプが
    見つかりませんでした」エラーが発生。ユーザーから「YouTubeのチャンネル固有スタンプは
    メンバーシップ限定だから0件になっているのでは」との指摘があり、正しいと判断（コード内
    コメントの通りチャンネル固有スタンプ＝メンバーシップ特典絵文字であり、チャンネルが
    メンバーシップ機能を提供していない、または連携アカウントがそのチャンネルの有料メンバー
    でない場合は0件になるのが正常）。ロジックは変更せず、`fetchYoutubeEmotesForChannel`の
    エラーメッセージ（`categoriesFound>=2`側）と、`overlay-panel/index.html`のYouTubeヘルプ
    セクションにその旨を明記する文言追加のみ実施。独立レビューでPASS（構文確認、HTML構造の
    健全性、条件分岐との整合性を確認）。

いずれも純JS変更でビルド不要、.batルール非該当。

33. [x] Pro機能ボタンの無料会員への挙動変更。現状は有料会員以外は押せない仕様になっているが、
    無料会員でも押せるようにし、中の機能は全てグレーアウト+中央に「有料会員限定」等の文言を
    表示することで、無料会員でも実機画面上で機能のイメージを確認できるようにする。
    - ボタン内にタブがある場合、タブ自体は押せるようにする。ただし「配信一覧」など自動更新が
      発生する機能はグレーアウト中は自動更新等をさせない。
    - 全タブ統合の場合も、グレーアウト中は事前に配信を開いていてもチャンネルを一覧に表示せず、
      更新もしない（無料会員＝グレーアウト中の定義）。

    → 対象5箇所（ザッピング、配信一覧、全タブ統合チャット、Drops自動追加、Drops自動削除）の
    early return撤去+共通クラス`.pro-content-locked`/`.pro-lock-overlay`によるグレーアウト+
    案内文言表示を実装（2026-08-17）。「配信一覧」（独立BrowserWindowのstream-check-window）は
    premium:changedイベント中継用のIPC配線を追加し、ロック中はTwitch/YouTube/Kick APIへの
    フェッチ・自動更新タイマー・Twitch連携状態確認を一切呼ばずクォータを消費しない設計にした。
    実際の機能実行はpremiumUnlockedで引き続きガード（多層防御）。独立レビューでPASS
    （HTML構造の健全性、CSS適用範囲、ID参照の整合性、多層防御の網羅性、APIクォータ節約を確認）。
    実機確認はまだ未実施。

## UIデザインについて（ユーザーからの補足）

UIに関しては応相談。イメージとしては「MCDに合う、オリジナリティのあるデザイン」
「公式サイト https://mumeinoapp.pages.dev/ のようなイメージのオリジナルデザイン」を
希望。項目9・10・16（プルダウン・スクロールバー・配信チェックのカード化）はこの方向性で
デザイン相談しながら進める。
