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
    - 段階D: 旧overlay-panel側のunified-feedコード撤去、分岐整理
    - 段階E: 実機確認＋要件②③の続行

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

## UIデザインについて（ユーザーからの補足）

UIに関しては応相談。イメージとしては「MCDに合う、オリジナリティのあるデザイン」
「公式サイト https://mumeinoapp.pages.dev/ のようなイメージのオリジナルデザイン」を
希望。項目9・10・16（プルダウン・スクロールバー・配信チェックのカード化）はこの方向性で
デザイン相談しながら進める。
