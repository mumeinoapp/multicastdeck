'use strict';

const { app, BrowserWindow, BrowserView, ipcMain, screen, Menu, shell, session, dialog } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

// GitHub Releases（mumeinoapp/multicastdeck）を参照するアップデート確認機能。
// メニューバーの「アップデートを確認」（ファイル/表示/ヘルプと同じネイティブメニュー）から
// 完結し、ウィンドウやパネルは一切出さない。自動ダウンロード・自動インストールはせず、
// メニューから明示的にユーザーが操作（確認→ダウンロード→再起動してインストール）した時だけ
// 適用する（勝手に更新して再起動させることはしない）。
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

const store = new Store({
  name: 'multistream-drops-settings',
  defaults: {
    favoriteEmotes: [], // [{ id, name, channel: string|null (nullはグローバル), imageUrl }]
    channels: [],
    channelOrder: [], // 表示順（並び替え対応）
    parentDomain: 'localhost',
    layoutColumns: 0, // 0 = 自動（正方形に近いグリッド）。現在は「自動整列」実行時にのみ使用
    // 全タブ統合チャットのコメント本文（配信名・ユーザー名は除く）に適用するフォント。
    // 空文字列 = 未指定（デフォルト＝現状通りの見た目、実質Twitchのフォント）。
    commentFontFamily: '',
    helixClientId: '',
    helixClientSecret: '',
    // Kick Developer Portal（kick.com/settings/developer）で発行するOAuth 2.1（PKCE必須）アプリの
    // Client ID / Client Secret。Kickアカウント連携（視聴自体はplayer.kick.com埋め込みでログイン不要）。
    kickClientId: '',
    kickClientSecret: '',
    // YouTube Data API v3 のAPIキー（Google Cloud Consoleで無料発行）。
    // チャンネルのハンドル（@channelname等）から埋め込み配信に必要な内部チャンネルID（UC...）を
    // 解決するために使う（channels.list forHandle、見つからない場合はsearch.listにフォールバック）。
    youtubeDataApiKey: '',
    // { [channelName]: 'twitch'|'youtube' } チャンネルごとの配信プラットフォーム（未設定=twitch扱い、後方互換）
    channelPlatforms: {},
    // { [channelName]: string } YouTubeチャンネルの解決済み内部チャンネルID（再起動のたびにAPIを
    // 叩き直さずに済むよう、また将来的にAPIキー未設定でも復元できるようキャッシュしておく）
    channelYoutubeIds: {},
    // { [channelName]: string } 動画URL（watch?v=等）を直接貼り付けて追加した場合の動画ID。
    // これがある場合はライブ検索（search.list、100ユニット消費）を経由せず、その動画IDでそのまま
    // 埋め込む（ユーザーが「配信のURLを直接追加したい」という要望に対応。APIクォータも節約できる）。
    channelYoutubeVideoIds: {},
    tileLayouts: {}, // { [channelName]: { x, y, w, h } } コンテンツ領域に対する比率(0-1)。タイル毎の自由配置・自由リサイズ用
    chatHidden: {}, // { [channelName]: boolean } チャンネル毎に「チャット画面を表示しない」を選べる（配信のみ表示）
    // { [channelName]: boolean } #7対応: チャット統合パネル（タブ/全タブ統合）側で、チャンネル毎に
    // 「このチャンネルの発言を統合表示に含めない」を選べる。上のchatHiddenとは別物（そちらは
    // タイル個別のチャット埋め込み表示、こちらは統合パネルの表示対象フィルタ）。
    chatIntegrationHidden: {},
    // #6対応: 登録チャンネルの配信開始通知の履歴。[{ id, channel, platform, title, detectedAt }]
    // 直近100件のみ保持（recordStreamStartNotifications参照）。
    streamStartNotifications: [],
    // 通知タブを最後に開いた時刻（ms epoch）。これより新しいdetectedAtの通知があれば
    // 未読とみなし「通知」メニュー項目に赤丸バッジ（.has-update-badge、バージョン項目と同じ仕組み）を表示する。
    streamStartNotificationsLastReadAt: 0,
    dropsAutoTrack: [], // [{ gameName, maxTiles }] Drops自動追加/削除の対象ゲームと上限タイル数
    // ザッピング機能の絞り込み条件（言語・ゲーム名・タグ、すべて空欄なら無条件）。
    // platform: 'twitch'（Helix APIで言語/ゲーム/タグ厳密絞り込み可）| 'youtube'（youtube.com/live
    // ディレクトリの非公式scraping、languageは非対応、gameName/tagsはタイトル・チャンネル名への
    // ゆるい部分一致のベストエフォート）
    zappingFilters: { language: '', gameName: '', tags: [], platform: 'twitch' },
    channelVolumes: {}, // { [channelName]: 0-100 } チャンネル毎の個別音量（未設定なら100扱い）
    // ザッピングタイル専用の音量（0-100）。ザッピングは切替のたびに表示チャンネル名が変わり
    // channelVolumesのキー（チャンネル名）に紐づく音量がremoveChannelで都度消えてしまうため、
    // 「ザッピングタイル」という実体に対する音量として別キーで永続化し、切替のたびに新チャンネルへ
    // 再適用する（アプリ再起動後、次にザッピングを開始した時にも復元される）。
    zappingVolume: 100,
    inputHistories: {}, // { [historyKey]: string[] } 入力欄の上下キー履歴（チャンネル名・Drops対象ゲーム名など）
    dropsAutoDefaultMaxTiles: 3, // Drops自動追加/削除「上限」入力欄の初期値（最後に使った値を記憶する）
    // { [channelName]: { source: 'drops'|'tune-in', game: string|null } } 自動追加されたチャンネルの記録（永続化用）。
    // streamViews上のentry.autoAddedはアプリ再起動で失われる実行時フラグのため、これが無いと
    // 再起動のたびに旧自動追加チャンネルが「手動追加」扱いになって上限管理の対象から外れ、
    // 毎回上限いっぱいまで新規に自動追加されて枠が際限なく増えてしまう不具合があった。
    // sourceで「Drops自動追加」と「Auto Tune-In」のどちらが追加したチャンネルかを区別する
    // （互換性のため、旧形式＝値が文字列＝ゲーム名のみの場合も読めるようにしている）。
    autoAddedChannels: {},
    // Auto Tune-In（フォロー中の配信者が配信開始したら自動でタイル追加、ロードマップ項目7）
    autoTuneIn: { enabled: false, maxTiles: 4 },
    // Auto Tune-Inの対象を特定のチャンネルに絞る指定リスト（統一フィード機能の追加要望）。
    // [{ platform: 'twitch'|'youtube', channel: string }]。
    // Twitch: 空配列なら従来通り「フォロー中なら誰でも」対象（後方互換）。1件でもあればその中だけに絞る。
    // YouTube: 「登録中なら誰でも」を60秒間隔で全員チェックするのはページ取得コストが高すぎるため非対応。
    //   YouTubeの自動追加は必ずこのリストに入っている人だけが対象（空なら何もしない）。
    autoTuneInTargets: [],
    // フィードに常時表示する「ピン留め」YouTubeチャンネル（統一フィード改善要望）。
    // 自動追加の対象指定(autoTuneInTargets)とは完全に独立しており、こちらはオンライン・オフライン
    // 問わずフィード一覧に表示し続けるためだけのもの（自動でタイル追加はされない）。
    // Twitchはもともと「フォロー中なら誰でも」がデフォルトでフィードに出るため対象外（YouTube専用）。
    // [{ channel: string, displayName: string }]
    feedPinnedYoutubeChannels: [],
    // TwitchのユーザーOAuthトークン（Auto Tune-In専用。user:read:followsスコープ）。
    // Drops自動追加等で使っているHelixのClient Credentials（アプリ単位・匿名）トークンとは別物で、
    // こちらはユーザー本人の同意が必要な認可コードグラントフローで取得する。
    // null | { accessToken, refreshToken, expiresAt(ms epoch), userId, login }
    twitchUserAuth: null,
    // KickのユーザーOAuthトークン（アカウント連携確認専用。scope: user:read）。
    // OAuth 2.1 + PKCEで取得する。Kickはリフレッシュトークンがローテーションされる仕様のため、
    // 更新の都度refreshTokenも保存し直す。
    // null | { accessToken, refreshToken, expiresAt(ms epoch), username }
    kickUserAuth: null,
    // ヘッダーの操作ボタン（Dropsインベントリ/スタンプ/チャット統合/ザッピング/自動整列/共有/設定等）の
    // 並び順。ドラッグ&ドロップで並び替えた結果をdata-key配列として保存する。空配列 = HTML記載順（デフォルト）。
    headerButtonOrder: [],
    // 初回起動時の案内ポップアップ（「使い方/注記」を見るよう推奨）を表示済みかどうか。
    firstLaunchDone: false,
    // 有料機能（Pro機能）がアンロックされているかどうか。ログイン済みの場合はproAuthTokenを使って
    // 決済バックエンドの/statusを定期的に確認し、その結果で自動更新される。未ログインの場合は
    // 「表示メニュー > 開発用: Pro機能アンロックを切り替え」による手動トグル（開発者確認用）のみが効く。
    premiumUnlocked: false,
    // 決済バックエンド（multistream-payment-backend、Cloudflare Workers）のデプロイ先URL。
    // 決済方針.md記載の本番デプロイ先をデフォルト値にしている（通常はユーザーが変更する必要はない）。
    paymentBackendUrl: 'https://multicastdeck.mumeinoapp.workers.dev',
    // メールアドレス+6桁確認コード認証で発行される長期トークン。ログイン済みの間はこれを使って
    // /statusを呼び出し、Pro（premiumUnlocked）状態を確認する。
    proAuthToken: null,
    proAuthEmail: null,
    // 直近に取得した/statusのレスポンスをそのままキャッシュ（設定画面での表示用）。
    proStatus: null,
    // 全タブ統合チャットパネルの表示モード（'tab'=1チャンネルずつ埋め込み切替 / 'timeline'=自作
    // 時系列統合）。#8対応: 以前はrenderer.js側のJS変数のみで保持しており、アプリ再起動のたびに
    // 常に'tab'へ戻ってしまっていた。
    chatIntegrationMode: 'tab',
    // 統一フィード（フォロー中で現在配信中のチャンネル一覧）のプラットフォーム絞り込み
    // （'all'|'twitch'|'youtube'|'kick'）。#8対応: 同様に以前は永続化されていなかった。
    unifiedFeedPlatformFilter: 'all',
  },
});

/** @type {BrowserWindow} */
let mainWindow;

/**
 * 複窓レイアウト設定ウィンドウ（2026-08-08新設）。メインウィンドウとは独立した
 * BrowserWindow（parent指定なし・常に最前面）で、単一インスタンスのみを許可する。
 * TDZ（宣言前使用）を避けるため、createLayoutWindow()やmainWindow.on('closed')より
 * 手前のこの位置で宣言しておく。
 * @type {BrowserWindow|null}
 */
let layoutWindow = null;
// 配信チェックウィンドウ（2026-08-07、方針転換により新設）。旧overlayPanelView方式
// （unified-feed）から独立BrowserWindow方式へ切り替え中。layoutWindowと同じ管理パターン。
let streamCheckWindow = null;

// 「バージョン」メニューの表示状態。{ status: 'idle'|'checking'|'available'|
// 'not-available'|'downloading'|'downloaded'|'error', version?, percent? }
let updaterState = { status: 'idle' };

/** 「バージョン」メニュー内「アップデートを確認」クリック時の共通処理。 */
function manualCheckForUpdates() {
  if (!app.isPackaged) {
    // electron-updaterはパッケージ化されたアプリでしか正しく動作しない（app-update.ymlが
    // ビルド時にのみ生成されるため）。npm start（開発モード）では待たせずすぐ伝える。
    dialog.showMessageBox({
      type: 'info',
      title: 'アップデートを確認',
      message: '開発モード（npm start）ではアップデート確認はできません。ビルドしたアプリでお試しください。',
    });
    return;
  }
  autoUpdater.checkForUpdates().catch(() => {
    // エラー内容は autoUpdater.on('error', ...) 側で処理する（ダイアログは出さず、メニューの
    // 表示だけを更新する）。
  });
}

/** チャンネル毎の { streamView, chatView, channel } を保持 */
const streamViews = new Map();

// #6対応: 通知タブの配信開始検知用。channel -> 直近ポーリング時点でライブだったか(boolean)。
// キーの有無で「一度でも観測したか」を判定し、初回観測時（アプリ起動直後や手動追加直後）は
// 通知を出さず記録のみ行う（recordStreamStartNotifications参照）。
const notificationsKnownLiveMap = new Map();

/** Drops インベントリ用 BrowserView（オンデマンドでのみ生成） */
let dropsView = null;
/** Kick版 Drops & 報酬（インベントリ）用 BrowserView（オンデマンドでのみ生成） */
let kickDropsView = null;

// UI（コントロールパネル）が占める上部の高さ(px)。それ以下を配信表示エリアとして BrowserView を敷き詰める。
// ネイティブメニュー廃止に伴い自作メニューバー(#app-menu-bar, 26px)を最上部に追加したため、106→132に変更。
// 2026-08-07: #status-bar(22px)を廃止しmenu-bar行内の#status-indicatorへ統合したため132→110に変更
// （style.cssの #app-menu-bar の height (26px) + #control-bar の height (84px) と一致させること）。
const HEADER_HEIGHT = 110;

/**
 * タイル（配信+チャットのペア）の自由リサイズ・自由移動機能（ウィンドウマネージャー相当）用の定数。
 * 旧実装ではタイル上部にタイトルバー・右下にリサイズハンドルというHTML製の枠を用意していたが、
 * 「枠をなくし、画面のどこからでもドラッグ移動・端からリサイズできるように」という要望に対応するため、
 * 配信/チャットのBrowserView自体にプリロード（tileInteractionPreload.js）を注入し、
 * 画面内でのmousedown位置を見て「移動」か「どの辺のリサイズか」を判定する方式に変更した。
 * そのためタイトルバー/ハンドル用の余白は不要になり、タイルの矩形＝BrowserViewの矩形そのものになる。
 */
const MIN_TILE_WIDTH = 260;
const MIN_TILE_HEIGHT = 180;
/**
 * タイル内、配信映像(streamView)の下に表示する「アプリ製の情報帯」（配信者名・タイトル・
 * 視聴者数・配信時間）の高さ(px)。中身自体はrenderer.js側のHTML要素（#tile-info-bars配下）で、
 * 配信サイト側のページには一切手を加えない。streamViewの高さはこの分だけ縮め、chatViewの高さ・
 * 幅は変更しない（2026-08-07追加）。
 */
const TILE_INFO_BAR_HEIGHT = 26;
const TILE_DRAG_PRELOAD = path.join(__dirname, 'tileInteractionPreload.js');
const YOUTUBE_CHAT_SCRAPER_PRELOAD = path.join(__dirname, 'youtubeChatScraperPreload.js');

/**
 * マルチプラットフォーム対応（方式B: 専用ログイン + セッション連携）の設定。
 * platform ごとに永続セッションパーティションを持たせ、一度ログインすれば
 * 配信タイル側にも自動的にログイン状態が引き継がれる。
 * ログイン状態の一次判定は Cookie の有無（軽量・高速）、
 * 「ログイン状況確認」ボタン押下時のみ DOM を確認する（正確・重い）二段構え。
 * まずは Twitch のみ対応。YouTube / Kick は今後同じ枠組みで追加する。
 */
const PLATFORM_CONFIG = {
  twitch: {
    label: 'Twitch',
    partition: 'persist:twitch',
    loginUrl: 'https://www.twitch.tv/login',
    domCheckUrl: 'https://www.twitch.tv/',
    cookieDomain: '.twitch.tv',
    cookieName: 'auth-token',
    // 非公式のDOMセレクタ推測実装。Twitch側のUI変更で効かなくなる可能性がある。
    // 「ユーザーメニュー」等の要素は誤検知しやすいため、より確実な
    // 「ログイン／登録ボタンが存在しない＝ログイン済み」という逆判定を採用する。
    domCheckScript: `
      (function () {
        var loginBtn = document.querySelector(
          '[data-a-target="login-button"], [aria-label="ログイン"], [aria-label="Log In"]'
        );
        var signupBtn = document.querySelector(
          '[data-a-target="signup-button"], [aria-label="登録"], [aria-label="Sign Up"]'
        );
        return !loginBtn && !signupBtn;
      })()
    `,
  },
  youtube: {
    label: 'YouTube',
    partition: 'persist:youtube',
    loginUrl: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F',
    domCheckUrl: 'https://www.youtube.com/',
    cookieDomain: '.youtube.com',
    cookieName: 'LOGIN_INFO', // Googleにログイン済みのYouTubeで立つ非公式の目印Cookie
    // 非公式のDOMセレクタ推測実装。YouTube側のUI変更で効かなくなる可能性がある。
    // Twitchと同様、「サインインボタンが存在しない＝ログイン済み」という逆判定を採用する。
    domCheckScript: `
      (function () {
        var signInBtn = document.querySelector(
          'a[aria-label="Sign in"], a[aria-label="ログイン"], tp-yt-paper-button[aria-label="Sign in"], ytd-button-renderer a[href*="ServiceLogin"]'
        );
        return !signInBtn;
      })()
    `,
  },
};

/**
 * Kickは「方式B（専用ログイン＋Cookieセッション共有）」のアカウント連携UIには含めない
 * （視聴自体はplayer.kick.comの公式埋め込みでログイン不要のため）。アカウント連携は
 * OAuth 2.1 + PKCEによる別方式（kickUserAuth、startKickUserAuth等）で行うが、配信タイルの
 * BrowserViewについてはTwitch/YouTube同様に専用の永続パーティションを持たせておく
 * （Cookieの混在を避けるため）。
 */
const KICK_PARTITION = 'persist:kick';

/**
 * Kickのチャット統合（タブモード）用URL。
 * 当初 kick.com/{username}/chatroom を使っていたが、これは実在しないルートでKick側が
 * エラーJSON（{"message":""}）を返すだけだった（実機報告により判明）。KICK公式ヘルプの
 * OBSブラウザドック手順・実際の配信者ページで使われているのは kick.com/popout/{username}/chat
 * （入力欄のplaceholderが"Send a message"の視聴者向けポップアウトチャットページ）。
 * player.kick.com（映像側）とは別ホストなので、Cookie共有には同じpersist:kickパーティションを使う。
 */
function KICK_CHATROOM_URL(channelName) {
  return `https://kick.com/popout/${encodeURIComponent(channelName)}/chat`;
}

/** チャンネルのプラットフォームに応じたBrowserView用パーティション名を返す（未知の値はtwitch扱い＝後方互換） */
function getPlatformPartition(platform) {
  if (platform === 'youtube') return PLATFORM_CONFIG.youtube.partition;
  if (platform === 'kick') return KICK_PARTITION;
  return PLATFORM_CONFIG.twitch.partition;
}

/** アカウント連携用ログインビュー（プラットフォーム毎に1つだけオンデマンドで開く） */
let accountLoginView = null;
let accountLoginPlatform = null;

/**
 * 設定パネル・スタンプパネル・注記モーダルなどHTML側のオーバーレイUIは、
 * 配信/チャット/Drops等のBrowserViewが画面全体を覆っていると常にその背後に隠れてしまう
 * （BrowserViewはCSSのz-indexに関係なく常にウィンドウの最前面に描画されるため）。
 * そのため、HTMLオーバーレイを開く際はいったんBrowserView群をウィンドウから外し、
 * 閉じたら再び addBrowserView して元のレイアウトに戻す。
 */
let contentViewsHiddenForOverlay = false;

/**
 * スタンプ/ザッピング/設定/チャット統合パネルなど「配信を見ながら操作したいサイドパネル」用。
 * これらはBrowserViewを丸ごと外すのではなく、右側にパネル幅ぶんの隙間を空ける形でタイル領域を
 * 縮小するだけにして、配信を表示・視聴し続けられるようにする（ユーザー要望で本セッションから対応）。
 * 0の時は通常通り全幅を使う。
 * 注: 音量ミキサーは「必要な時だけ出す」最前面ドロップダウンのためこのスタック管理には含めない
 * （floatingDropdowns['volume-mixer']参照）。
 */
let activeSidePanelWidth = 0;

/**
 * 複数のサイドパネル（スタンプ・ザッピング・設定・チャット統合）を同時に開けるようにする
 * スタック管理。開いた順に配列へ積み、後から開いたパネルほど画面右端（オフセット0）に近い位置になる
 * （＝新しく開いたパネルが一番右、既存のパネルはその分だけ左に押し出される）。
 * 「チャットを見ながらスタンプを選びたい」「チャット統合を開いたまま音量を調整したい」等の
 * 実機フィードバックを受けて、単一のサイドパネル幅から複数パネル対応に変更した。
 */
let openPanels = []; // [{ id, width }] 開いている順（先頭が最初に開いたもの）

/** 指定パネルの右端からのオフセット（自分より後に開かれた＝右側に積まれているパネルの幅の合計） */
function getPanelRightOffset(id) {
  const idx = openPanels.findIndex((p) => p.id === id);
  if (idx === -1) return 0;
  let offset = 0;
  for (let i = idx + 1; i < openPanels.length; i++) offset += openPanels[i].width;
  return offset;
}

function recalcSidePanels() {
  activeSidePanelWidth = openPanels.reduce((sum, p) => sum + p.width, 0);
  relayoutStreamViews();
  relayoutChatIntegrationTabView();
  relayoutDropsView(); // 依頼#15: Dropsハブパネルを開いたまま操作できるよう、開閉のたびに幅を再計算
  relayoutKickDropsView();
  const positions = {};
  openPanels.forEach((p) => {
    positions[p.id] = getPanelRightOffset(p.id);
  });
  notifyRenderer('ui:side-panels-changed', positions);
}

function openSidePanel(id, widthPx) {
  const width = Math.max(0, Number(widthPx) || 0);
  openPanels = openPanels.filter((p) => p.id !== id);
  openPanels.push({ id, width });
  recalcSidePanels();
}

function closeSidePanel(id) {
  openPanels = openPanels.filter((p) => p.id !== id);
  recalcSidePanels();
}

/** アカウントログイン画面など、全幅を使いたい時に呼ぶ（開いているパネルを全て閉じた扱いにする） */
function closeAllSidePanels() {
  openPanels = [];
  recalcSidePanels();
}

/** タイル配置計算で実際に使える幅（サイドパネル分を差し引いたもの）を返す */
function getUsableContentWidth() {
  if (!mainWindow) return 0;
  const { width } = mainWindow.getContentBounds();
  return Math.max(MIN_TILE_WIDTH, width - activeSidePanelWidth);
}

/**
 * 汎用オーバーレイパネル基盤（MCD大規模アプデ#16向け、2026-08-07新設）。
 * 既存の openSidePanel 方式（配信タイルのbounds＝幅を縮めてパネル分の隙間を空ける方式）とは
 * 完全に別物で、openPanels / activeSidePanelWidth には一切加えない・影響させない。
 *
 * こちらは「配信タイルの幅は一切変更せず、専用のBrowserViewを setTopBrowserView で
 * 画面最前面に重ねて表示する」方式。BrowserView同士の重なり順にしか作用しないため、
 * 既存タイルは元のレイアウトのまま再生を継続できる。
 *
 * 現時点（第1段階）ではこの基盤のみを新設し、中身（配信チェックパネルのカード化UI等）は
 * まだ載せ替えない。次回セッション以降、この仕組みの上に実際のパネルUIを実装していく。
 *
 * 命名について: 既存の hideContentViewsForOverlay/showContentViewsForOverlay
 * （HTMLモーダル表示のために全BrowserViewを丸ごと外す仕組み）とは目的も実装も別物なので、
 * 混同しないよう変数・関数名の接頭辞を overlayPanel* に揃えている。
 */
let overlayPanelView = null;
let overlayPanelOpenId = null;

const OVERLAY_PANEL_DEFAULT_WIDTH = 360;

// ドッキング型（非centered）オーバーレイパネルのうち、既定幅では狭すぎるものだけを個別に指定する。
// 'unified-feed'（配信チェック）は2026-08-08にカード表示化し、アバター画像＋2種類のチェックボックス
// ＋配信者名＋視聴者数＋追加ボタンを1行に収める必要があるため420pxにしている。
const OVERLAY_PANEL_WIDTHS = { 'unified-feed': 420 };

// overlayPanelView（オーバーレイパネル用BrowserView）にも中継する必要があるpush通知チャンネル。
// notifyRenderer()はメインウィンドウにしか送らないため、パネル側UIが購読しているものだけを
// ここに列挙して二重送信する（無関係な高頻度チャンネルまで中継しないよう最小限に留める）。
const OVERLAY_PANEL_FORWARDED_CHANNELS = new Set(['auto-tune-in:error', 'auto-tune-in:auth-lost']);

// フィードバックモーダルの下書き（件名・本文）。centered化に伴い外側クリックでも閉じられる
// ようになったため、閉じる＝入力内容の消失にならないよう、BrowserView自体は
// closeOverlayPanel()でabout:blankへ遷移し中身を破棄するが、メインプロセス側にこの下書きを
// 保持しておき、次回feedbackを開いた時にoverlayApi.getFeedbackDraft()で復元する
// （送信成功時のみクリアする）。
let feedbackDraft = { subject: '', body: '' };

/**
 * 2026-08-07追加: help/welcome/premium-locked/feedbackの4モーダルをこの基盤へ移植した
 * （旧: hideContentViewsForOverlayで全BrowserViewを丸ごと退避する方式。配信を一切消さない
 * 方針への転換に伴う変更）。
 * 2026-08-08追加: 会員登録(pro-auth)もこの基盤へ移植した。決済(Stripe Checkout)自体は
 * shell.openExternalで外部ブラウザに委譲する既存方式のままで、pro-auth:*のIPCハンドラ・
 * 決済ロジック（本ファイル内、refreshProAuthStatus/paymentBackendFetch等）は変更していない。
 * これにより旧方式のhideContentViewsForOverlay/showContentViewsForOverlayを呼ぶ画面は
 * 無くなったが、関数・IPCハンドラ自体は将来のために残してある。
 *
 * 2026-08-08修正（実機報告3件の根本原因対応）: 当初は「カード自体のサイズだけBrowserView
 * を取り、画面中央に配置する」方式にしていたが、これだとカードの外側（配信タイルが透けて
 * 見える領域）はoverlayPanelViewの範囲外になるため、そこをクリックすると配下の配信タイル
 * 自身のBrowserViewへ直接クリックが渡ってしまっていた。タイル側はmousedownで
 * startTileInteraction→bringTileToFrontを呼ぶため、その一度のクリックだけでタイルが
 * overlayPanelViewより前面に来てしまい、「外側クリックで閉じない」「（前面を奪われた結果）
 * ボタン/タブが反応しなくなる」「見た目が配信タイルと重なって崩れる」の3件はすべて
 * この単一の原因から発生していた。
 * 対策として、centered系4モーダルもドッキング型パネルと同じ「コンテンツ表示領域全体
 * （ヘッダー下〜ウィンドウ下端、幅いっぱい）」までBrowserView自体を広げ、配下の配信タイルへ
 * クリックが一切漏れないようにした。カードの外側は引き続き透明背景のまま（配信は隠さない）
 * にしつつ、外側クリックでの「閉じる」判定はoverlayPanelView自身のJS
 * （overlay-panel.js側、背景要素へのclickでoverlayApi.close()）で行う。
 */
const OVERLAY_PANEL_CENTERED_IDS = new Set(['help', 'welcome', 'premium-locked', 'feedback', 'pro-auth']);

function ensureOverlayPanelView() {
  if (overlayPanelView) return overlayPanelView;
  overlayPanelView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'overlay-panel', 'overlay-panel-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  forwardEscapeKey(overlayPanelView.webContents);
  return overlayPanelView;
}

function relayoutOverlayPanel() {
  if (!overlayPanelView || !mainWindow || !overlayPanelOpenId) return;
  const { width, height } = mainWindow.getContentBounds();
  if (OVERLAY_PANEL_CENTERED_IDS.has(overlayPanelOpenId)) {
    // 2026-08-08修正: コンテンツ表示領域全体を覆う（配下の配信タイルへクリックを一切
    // 漏らさないため）。カード自体の見た目のサイズ・中央寄せはCSS側
    // （#help-modal等のdisplay:flex+align/justify-center、.modal-content系のmax-width）で
    // 行う。詳細はOVERLAY_PANEL_CENTERED_IDSの定義コメント参照。
    overlayPanelView.setBounds({
      x: 0,
      y: HEADER_HEIGHT,
      width,
      height: height - HEADER_HEIGHT,
    });
    return;
  }
  const panelWidth = Math.min(OVERLAY_PANEL_WIDTHS[overlayPanelOpenId] || OVERLAY_PANEL_DEFAULT_WIDTH, width);
  overlayPanelView.setBounds({
    x: width - panelWidth,
    y: HEADER_HEIGHT,
    width: panelWidth,
    height: height - HEADER_HEIGHT,
  });
}

function notifyOverlayPanelChanged() {
  notifyRenderer('ui:overlay-panel-changed', { openId: overlayPanelOpenId });
}

/**
 * 汎用オーバーレイパネルを開く。panelId は将来複数パネル（配信チェック等）を
 * 同じ基盤に載せ替える際の識別用（第1段階では 'test' 等の仮IDでもよい）。
 * 既存タイルのbounds再計算（relayoutStreamViews等）は一切呼ばない点が openSidePanel との違い。
 */
function openOverlayPanel(panelId) {
  if (!mainWindow) return;
  const view = ensureOverlayPanelView();
  if (!isViewAttached(view)) {
    mainWindow.addBrowserView(view);
  }
  overlayPanelOpenId = panelId;
  const url = require('url').format({
    pathname: path.join(__dirname, 'renderer', 'overlay-panel', 'index.html'),
    protocol: 'file:',
    slashes: true,
    query: { panel: panelId },
  });
  view.webContents.loadURL(url).catch(() => {
    /* ignore（同一ページへの再ロード等） */
  });
  relayoutOverlayPanel();
  if (typeof mainWindow.setTopBrowserView === 'function') {
    mainWindow.setTopBrowserView(view);
  }
  // フィードバックの件名/本文入力欄などにキーボード入力がすぐ効くよう、開いたら明示的に
  // フォーカスを移しておく（読み込み完了前に呼んでも無害なため、did-finish-load待ちはしない）。
  try {
    view.webContents.focus();
  } catch (_) {
    /* ignore */
  }
  notifyOverlayPanelChanged();
}

function closeOverlayPanel() {
  if (!overlayPanelView || !overlayPanelOpenId) return;
  const view = overlayPanelView;
  try {
    if (mainWindow && isViewAttached(view)) {
      mainWindow.removeBrowserView(view);
    }
  } catch (_) {
    /* 既に外れている場合などは無視 */
  }
  try {
    view.webContents.loadURL('about:blank');
  } catch (_) {
    /* ignore */
  }
  overlayPanelOpenId = null;
  notifyOverlayPanelChanged();
}

/**
 * チャット統合パネルの「タブ切替」モード用。複数のチャットBrowserViewを持たず、
 * パネル内で選択中の1チャンネル分だけTwitch公式埋め込みチャットを使い回して表示する。
 * パネル上部（見出し・モード切替・タブ一覧）はHTML側で表示するため、その高さぶんは
 * BrowserViewの表示開始位置をずらす（CHAT_INTEGRATION_TOP_OFFSET、renderer側のCSSと値を合わせる必要がある）。
 */
const CHAT_INTEGRATION_PANEL_WIDTH = 340;
const CHAT_INTEGRATION_TOP_OFFSET = 116; // .chat-integration-tabsの高さを32→40pxにした分(+8)を反映

// プラットフォーム毎にBrowserViewを使い回す（partitionはBrowserView作成時にしか指定できないため、
// Twitch/YouTubeで1つを共用することができない。ログイン中セッションのCookieもプラットフォーム毎に
// 分かれているべきなので、この分割は挙動としても正しい）。
const chatIntegrationTabViews = {}; // { [platform]: BrowserView }
let chatIntegrationActivePlatform = null;
let chatIntegrationTabChannel = null;

function getChatIntegrationTabView(platform) {
  if (!chatIntegrationTabViews[platform]) {
    // PLATFORM_CONFIGにはKickのエントリが無い（Kickは方式Bのアカウント連携UI対象外のため）。
    // パーティションの決定は必ずgetPlatformPartition経由にし、Kickがここでtwitch用パーティション
    // （persist:twitch）に誤って倒れてCookieが混在してしまう事故を防ぐ。
    const view = new BrowserView({
      webPreferences: { contextIsolation: true, sandbox: true, partition: getPlatformPartition(platform) },
    });
    forwardEscapeKey(view.webContents);
    chatIntegrationTabViews[platform] = view;
  }
  return chatIntegrationTabViews[platform];
}

function showChatIntegrationTab(channelName) {
  if (!mainWindow) return;
  const entry = streamViews.get(channelName);
  const platform = entry?.platform || 'twitch';
  const parent = store.get('parentDomain');

  // 別プラットフォームのタブから切り替わる場合は、そちらのBrowserViewを一旦外す
  // （同時に2つ表示したままだと重なってしまうため）。
  if (chatIntegrationActivePlatform && chatIntegrationActivePlatform !== platform) {
    const prevView = chatIntegrationTabViews[chatIntegrationActivePlatform];
    if (prevView && isViewAttached(prevView)) {
      try {
        mainWindow.removeBrowserView(prevView);
      } catch (_) {
        /* 既に外れている場合などは無視 */
      }
    }
  }
  chatIntegrationActivePlatform = platform;

  const view = getChatIntegrationTabView(platform);
  if (!isViewAttached(view)) {
    mainWindow.addBrowserView(view);
  }
  chatIntegrationTabChannel = channelName;
  // ensureChatSendViewLoaded（送信/挿入用）が「今表示しているチャンネルと同じかどうか」を
  // 正しく判定できるよう、ここでも読み込み済みチャンネルの記録を更新しておく。
  // これを怠ると、タブを開いて既に表示できているチャンネルに対してスタンプを挿入しただけで
  // 「別チャンネルだと誤認して不要な再読み込みが走る→挿入スクリプトが古いページに対して実行され、
  // 見た目に反映されない」という実機報告につながっていた。
  chatIntegrationLoadedChannel[platform] = channelName;

  if (platform === 'youtube') {
    // YouTube公式のライブチャット埋め込み（Twitchのparentと同様、embed_domainでドメインを指定する）。
    // 動画ID（現在配信中の動画）がまだ解決できていない場合は表示できない旨を伝える。
    const videoId = entry?.youtubeVideoId;
    if (!videoId) {
      view.webContents.loadURL('about:blank').catch(() => {});
      notifyRenderer('channel:load-error', {
        channel: channelName,
        target: 'chat',
        message: '配信中の動画がまだ確認できていないため、チャットを表示できません',
      });
    } else {
      view.webContents
        .loadURL(`https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}&embed_domain=${encodeURIComponent(parent)}`)
        .catch((err) => {
          if (isBenignNavigationError(err)) return;
          notifyRenderer('channel:load-error', { channel: channelName, target: 'chat', message: String(err) });
        });
    }
  } else if (platform === 'kick') {
    // Kickには「チャット埋め込み専用URL」の公式ドキュメントが無いため、視聴者向けチャットページ
    // （kick.com/{username}/chatroom）自体をそのまま読み込む。OBSのブラウザソース等でも実際に
    // 使われている方法。persist:kickパーティションでロード済みならログイン状態も引き継がれる。
    view.webContents
      .loadURL(KICK_CHATROOM_URL(channelName))
      .catch((err) => {
        if (isBenignNavigationError(err)) return;
        notifyRenderer('channel:load-error', { channel: channelName, target: 'chat', message: String(err) });
      });
  } else {
    view.webContents
      .loadURL(`https://www.twitch.tv/embed/${encodeURIComponent(channelName)}/chat?parent=${parent}&darkpopout`)
      .catch((err) => {
        if (isBenignNavigationError(err)) return;
        notifyRenderer('channel:load-error', { channel: channelName, target: 'chat', message: String(err) });
      });
  }
  relayoutChatIntegrationTabView();
}

function relayoutChatIntegrationTabView() {
  const view = chatIntegrationActivePlatform ? chatIntegrationTabViews[chatIntegrationActivePlatform] : null;
  if (!view || !mainWindow) return;
  const { width, height } = mainWindow.getContentBounds();
  const top = HEADER_HEIGHT + CHAT_INTEGRATION_TOP_OFFSET;
  // 他のパネル（スタンプ・音量等）がチャット統合パネルより右側に重ねて開かれている場合、
  // その分だけ左にずらす（getPanelRightOffsetはチャット統合パネルが未オープンの間は0を返す）
  const rightOffset = getPanelRightOffset('chat-integration');
  view.setBounds({
    x: Math.max(0, width - CHAT_INTEGRATION_PANEL_WIDTH - rightOffset),
    y: top,
    width: CHAT_INTEGRATION_PANEL_WIDTH,
    height: Math.max(0, height - top),
  });
}

function hideChatIntegrationTab() {
  if (!mainWindow) return;
  Object.values(chatIntegrationTabViews).forEach((view) => {
    if (isViewAttached(view)) {
      try {
        mainWindow.removeBrowserView(view);
      } catch (_) {
        /* 既に外れている場合などは無視 */
      }
    }
  });
  chatIntegrationTabChannel = null;
  chatIntegrationActivePlatform = null;
}

// ---- 時系列統合モードからのチャット送信 ----
// 時系列統合モードの読み取りは匿名（justinfan/裏読み込み）接続のため送信ができない。
// 送信時だけ、プラットフォーム毎に使い回しているチャット埋め込み用BrowserView
// （chatIntegrationTabViews、ログイン中セッションのCookieを引き継いでいる）に対象チャンネルの
// チャットページを読み込ませ、公式サイトの入力欄にexecuteJavaScriptでテキストを流し込んで送信する
// （非公式のDOM操作。Twitch/YouTube側のUI変更で効かなくなる可能性がある）。
const chatIntegrationLoadedChannel = {}; // { [platform]: channelName } 各プラットフォーム用ビューが今どのチャンネルを表示しているか

async function ensureChatSendViewLoaded(platform, channelName) {
  const view = getChatIntegrationTabView(platform);
  if (chatIntegrationLoadedChannel[platform] === channelName) return view;
  const parent = store.get('parentDomain');
  if (platform === 'youtube') {
    const entry = streamViews.get(channelName);
    const videoId = entry?.youtubeVideoId;
    if (!videoId) throw new Error('配信中の動画がまだ確認できていないため送信できません');
    await view.webContents.loadURL(
      `https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}&embed_domain=${encodeURIComponent(parent)}`
    );
  } else if (platform === 'kick') {
    await view.webContents.loadURL(KICK_CHATROOM_URL(channelName));
  } else {
    await view.webContents.loadURL(
      `https://www.twitch.tv/embed/${encodeURIComponent(channelName)}/chat?parent=${parent}&darkpopout`
    );
  }
  chatIntegrationLoadedChannel[platform] = channelName;
  // チャット欄が実際に操作可能になるまで少し時間がかかるため待つ
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return view;
}

/**
 * チャット送信/挿入操作の対象となるBrowserViewを返す。
 *
 * 以前はTwitchだけ配信タイル自体のチャットBrowserView（entry.chatView）を直接操作していたが、
 * これだと（1）タイル側チャットは編集・削除ができず使い勝手が悪い、（2）チャットを非表示に
 * しているとビューがウィンドウに一度もattachされておらずfocus/execCommandが黙って効かない、
 * という2つの問題があった。ユーザーからも「スタンプも文字もチャット統合の方から挿入・入力
 * できるようにしてほしい」という要望があったため、Twitch・YouTubeどちらも一貫して
 * 「チャット統合パネル」用の共用ビュー（chatIntegrationTabViews、showChatIntegrationTabで
 * 画面に表示されるものと同じ実体）を対象にするよう統一した。挿入・送信した内容は
 * チャット統合パネルの中でそのまま見え、ユーザー自身が続けて編集・削除もできる。
 */
async function getChatTargetView(channelName) {
  const entry = streamViews.get(channelName);
  if (!entry) throw new Error('チャンネルが見つかりません');
  const platform = entry.platform || 'twitch';
  return ensureChatSendViewLoaded(platform, channelName);
}

/**
 * チャット統合パネル用のビューは、そのチャンネルのタブが実際に開かれている時しかウィンドウに
 * addBrowserViewされていない。この状態だとページ内のcontenteditableへのfocus()やexecCommandが
 * ブラウザ内部的に「画面に出ていない要素」として黙って効かないことがあり、「エラーは出ないのに
 * 実際には挿入・送信されない」という実機報告の主因になっていた。
 * そのため、現在ウィンドウに付いていない場合は画面外（負の座標）に一時的にattachしてから操作し、
 * 終わったら元の状態（タブが開かれていなければ再度外す）に戻す。
 *
 * さらに、タブが既に開いていて画面に見えている場合でも実際には反映されない実機報告があった。
 * 原因は、ページ内から input.focus() を呼んでもそれは「そのページの中でのDOMフォーカス」でしか
 * なく、直前にスタンプパネル等（メインウィンドウ側のHTMLオーバーレイ）を操作していると、
 * Electron/OSレベルでのフォーカスはそちらに残ったままになる。この状態だとexecCommandがエラー
 * 無く黙って何もしないことがある。そのため、操作前に明示的に対象のBrowserViewを最前面へ出し
 * （setTopBrowserView）、webContents.focus()でOS/Electronレベルのフォーカスも対象へ移してから
 * スクリプトを実行し、終わったらメインウィンドウ側へフォーカスを戻す。
 */
async function withAttachedForAutomation(view, fn) {
  const wasAttached = isViewAttached(view);
  if (!wasAttached && mainWindow) {
    mainWindow.addBrowserView(view);
    // 以前はウィンドウ座標の外（マイナス座標）に配置していたが、Chromiumはウィンドウの
    // 可視範囲から完全に外れたビューを「非表示（occluded）」として扱い、document.hidden が
    // trueになる等でキー入力の処理が抑制されることがあると分かった（時系列統合モードでの
    // Twitch送信・挿入だけ反映されない問題の一因と考えられる）。そのため、ウィンドウの
    // 実際の可視範囲内（右下の隅、2x2px）に配置することで「可視」扱いにしつつ、
    // サイズを最小限にして見た目への影響を抑える。
    const { width, height } = mainWindow.getContentBounds();
    view.setBounds({ x: Math.max(0, width - 2), y: Math.max(0, height - 2), width: 2, height: 2 });
    // 追加直後は描画・フォーカス周りが安定していないことがあるため一呼吸置く
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (mainWindow && typeof mainWindow.setTopBrowserView === 'function') {
    try {
      mainWindow.setTopBrowserView(view);
    } catch (_) {
      /* ignore */
    }
  }
  view.webContents.focus();
  // フォーカス移動が実際にページ内へ反映されるまでの猶予
  await new Promise((resolve) => setTimeout(resolve, 50));
  try {
    return await fn();
  } finally {
    try {
      mainWindow && mainWindow.webContents.focus();
    } catch (_) {
      /* ignore */
    }
    if (!wasAttached && mainWindow) {
      try {
        mainWindow.removeBrowserView(view);
      } catch (_) {
        /* ignore */
      }
    }
  }
}

/**
 * document.execCommand('insertText', ...) はページ内スクリプトからの合成入力のため、
 * Twitchのリッチテキスト編集（Slate）側で「本物のユーザー入力」と認識されない場合がある
 * （タブを直接開いて操作している時は動くのに、時系列統合モード側の裏読み込みビューだと
 * 反映されない、という実機報告の原因と考えられる）。webContents.sendInputEvent は
 * Electron/Chromiumの入力パイプラインへ本物のキーイベントとして送られるため、実際に
 * キーボードで入力したのと同じように扱われ、より確実に反映される。
 */
async function nativeTypeText(webContents, text) {
  for (const ch of Array.from(text)) {
    webContents.sendInputEvent({ type: 'char', keyCode: ch });
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

/**
 * Kickのチャット入力欄DOMは非公開（Bot対策により本セッションでは自動調査もできなかった）ため、
 * Twitch/YouTubeで実際に見つかりやすかったパターン（contenteditable、role="textbox"、
 * placeholderにメッセージ入力を示す語を含むtextarea等）を一通り試す推測実装にしている。
 * 実機での動作確認の結果、ここに一致しない場合はセレクタの調整が必要。
 */
const KICK_CHAT_INPUT_FOCUS_SCRIPT = `(function () {
  var candidates = Array.prototype.slice.call(document.querySelectorAll(
    '[contenteditable="true"][role="textbox"], [contenteditable="true"], textarea, input[type="text"]'
  ));
  var input = candidates.find(function (el) {
    var placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
    var aria = (el.getAttribute('aria-label') || '').toLowerCase();
    return /message|chat|メッセージ|チャット/.test(placeholder + ' ' + aria);
  }) || candidates[0];
  if (!input) return 'no-input';
  input.focus();
  return 'ready';
})();`;

async function sendChatIntegrationMessage(channelName, message) {
  const trimmed = String(message || '').trim();
  if (!trimmed) throw new Error('メッセージを入力してください');
  const entry = streamViews.get(channelName);
  if (!entry) throw new Error('チャンネルが見つかりません');
  const platform = entry.platform || 'twitch';
  const view = await getChatTargetView(channelName);
  const webContents = view.webContents;

  // YouTubeはexecCommand('insertText')による合成入力で問題なく反映されることが実機で
  // 確認できているため、そのまま使う。Twitchは同じ方式だと、タブを直接開いて操作している時は
  // 動くのに、時系列統合モードの裏読み込みビュー経由だと反映されないという実機報告が続いたため、
  // 「本物のキー入力」としてChromiumの入力パイプラインに直接送るwebContents.sendInputEvent
  // （nativeTypeText）による1文字ずつのタイピングに切り替えた。
  if (platform === 'youtube') {
    const script = `(function () {
          var input = document.querySelector('#input.yt-live-chat-message-input-renderer') ||
            document.querySelector('div#input[contenteditable="true"]');
          if (!input) return 'no-input';
          input.focus();
          document.execCommand('insertText', false, ${JSON.stringify(trimmed)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          var btn = document.querySelector('#send-button button');
          if (btn && !btn.disabled) { btn.click(); return 'sent'; }
          return 'need-native-enter';
        })();`;
    const result = await withAttachedForAutomation(view, async () => {
      const r = await webContents.executeJavaScript(script);
      if (r === 'need-native-enter') {
        webContents.focus();
        webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
        webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        return 'sent';
      }
      return r;
    });
    if (result === 'no-input') {
      throw new Error(
        'チャット送信欄が見つかりませんでした（未ログインの可能性があります。設定画面のアカウント連携をご確認ください）'
      );
    }
    return;
  }

  if (platform === 'kick') {
    // Kickのチャット入力欄は非公開のDOM構造（Bot対策で自動調査もできなかった）のため、
    // 想定されるパターンを複数試す推測実装。実機での動作確認・セレクタ調整が別途必要。
    const result = await withAttachedForAutomation(view, async () => {
      const r = await webContents.executeJavaScript(KICK_CHAT_INPUT_FOCUS_SCRIPT);
      if (r !== 'ready') return r;
      await nativeTypeText(webContents, trimmed);
      webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      return 'sent';
    });
    if (result === 'no-input') {
      throw new Error(
        'チャット送信欄が見つかりませんでした（未ログインの可能性、またはKick側のUI変更でセレクタが合っていない可能性があります）'
      );
    }
    return;
  }

  // Twitch: フォーカスだけスクリプトで行い、実際の文字入力・送信はElectron側からの
  // 本物のキーイベントで行う。
  const focusScript = `(function () {
          var input = document.querySelector('div[data-a-target="chat-input"][contenteditable="true"]') ||
            document.querySelector('[contenteditable="true"][role="textbox"]');
          if (!input) return 'no-input';
          input.focus();
          return 'ready';
        })();`;

  const result = await withAttachedForAutomation(view, async () => {
    const r = await webContents.executeJavaScript(focusScript);
    if (r !== 'ready') return r;
    await nativeTypeText(webContents, trimmed);
    webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    return 'sent';
  });
  if (result === 'no-input') {
    throw new Error(
      'チャット送信欄が見つかりませんでした（未ログインの可能性があります。設定画面のアカウント連携をご確認ください）'
    );
  }
}

/**
 * お気に入りスタンプのワンクリック挿入用。sendChatIntegrationMessageと同じ埋め込みビューを使い回すが、
 * こちらは送信（Enter/送信ボタン）はせず、入力欄の末尾にテキストを追加するだけに留める
 * （続けて他のスタンプや文章を足してから、ユーザー自身が送信できるようにするため）。
 */
async function insertIntoChatInput(channelName, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;
  const entry = streamViews.get(channelName);
  if (!entry) throw new Error('チャンネルが見つかりません');
  const platform = entry.platform || 'twitch';
  const view = await getChatTargetView(channelName);
  const webContents = view.webContents;

  // YouTubeは、テキストとしてショートコード（:名前:）を打ち込むだけだと入力欄には文字のまま表示され、
  // ユーザーが求める「実際のスタンプ画像として挿入」にならない。本物のユーザー操作と同じく、
  // 絵文字ピッカーを開いて該当するスタンプ画像を実際にクリックすることで、YouTube側の標準の
  // 変換処理に任せ、入力欄にインライン画像として挿入されるようにする
  // （見つからない場合＝そのチャンネル固有スタンプ一覧に無い場合のみ、従来のテキスト挿入にフォールバック）。
  const youtubeClickScript = `(function () {
    return new Promise(function (resolve) {
      var btn = document.querySelector('#emoji-picker-button button') ||
        document.querySelector('yt-live-chat-message-input-renderer #emoji-picker-button button');
      var input = document.querySelector('#input.yt-live-chat-message-input-renderer') ||
        document.querySelector('div#input[contenteditable="true"]');
      if (!input) { resolve('no-input'); return; }
      input.focus();
      if (!btn) { resolve('no-picker-button'); return; }
      btn.click();
      setTimeout(function () {
        var picker = document.querySelector('yt-emoji-picker-renderer');
        if (!picker) { resolve('no-picker'); return; }
        var target = ${JSON.stringify(trimmed)};
        var imgs = Array.from(picker.querySelectorAll('img[alt]'));
        var img = imgs.find(function (im) { return im.getAttribute('alt') === target; });
        if (!img) { resolve('not-found'); return; }
        var clickable = img.closest('button') || img.closest('[role="button"]') || img;
        clickable.click();
        setTimeout(function () {
          var stillOpen = document.querySelector('yt-emoji-picker-renderer');
          if (stillOpen && btn) btn.click();
          resolve('ok');
        }, 300);
      }, 800);
    });
  })();`;
  const youtubeTextFallbackScript = `(function () {
          var input = document.querySelector('#input.yt-live-chat-message-input-renderer') ||
            document.querySelector('div#input[contenteditable="true"]');
          if (!input) return 'no-input';
          input.focus();
          document.execCommand('insertText', false, ${JSON.stringify(`${trimmed} `)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return 'ok';
        })();`;

  // Twitchはフォーカスのみスクリプトで行い、実際の文字入力はElectron側の本物のキーイベント
  // （nativeTypeText）で行う（sendChatIntegrationMessageと同じ理由）。
  const twitchFocusScript = `(function () {
          var input = document.querySelector('div[data-a-target="chat-input"][contenteditable="true"]') ||
            document.querySelector('[contenteditable="true"][role="textbox"]');
          if (!input) return 'no-input';
          input.focus();
          return 'ready';
        })();`;

  const result = await withAttachedForAutomation(view, async () => {
    if (platform === 'youtube') {
      let r = await webContents.executeJavaScript(youtubeClickScript);
      // ピッカー内に該当スタンプが見つからなかった場合（グローバル絵文字など、
      // チャンネル固有スタンプ一覧に含まれないもの）は、従来のテキスト挿入方式にフォールバックする
      if (r === 'not-found' || r === 'no-picker' || r === 'no-picker-button') {
        r = await webContents.executeJavaScript(youtubeTextFallbackScript);
      }
      return r;
    }
    const r = await webContents.executeJavaScript(twitchFocusScript);
    if (r !== 'ready') return r;
    await nativeTypeText(webContents, `${trimmed} `);
    return 'ok';
  });

  if (result === 'no-input') {
    throw new Error(
      'チャット入力欄が見つかりませんでした（未ログインの可能性があります。設定画面のアカウント連携をご確認ください）'
    );
  }
}

// ---- 「時系列統合」モードでのYouTubeチャット取り込み（裏読み込み＋DOM監視） ----
// Twitch側は匿名IRC（justinfan）で本物のプロトコルに直接接続できるが、YouTubeには
// 同等の無料・匿名で使える公開プロトコルが無い。そのため、既にタブモードで使っている公式の
// ライブチャット埋め込みページ（youtube.com/live_chat、APIキー不要）を画面には出さずに
// 裏で読み込み、新着メッセージのDOM要素をMutationObserverで検知して取り込む
// （youtubeChatScraperPreload.js参照）。負荷を抑えるため、時系列統合モードでパネルを
// 開いている間だけ生成し、閉じたら破棄する（syncYoutubeChatWatch/stopAllYoutubeChatWatch）。
const youtubeChatWatchViews = {}; // { [channelName]: BrowserView }（addBrowserViewはしない＝非表示のまま）

function startYoutubeChatWatch(channelName, videoId) {
  if (youtubeChatWatchViews[channelName]) return;
  const parent = store.get('parentDomain');
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      partition: PLATFORM_CONFIG.youtube.partition,
      preload: YOUTUBE_CHAT_SCRAPER_PRELOAD,
    },
  });
  youtubeChatWatchViews[channelName] = view;
  try {
    view.webContents.setAudioMuted(true); // 万一音声を持つ要素があっても無音化しておく
  } catch (_) {
    /* ignore */
  }
  view.webContents.on('did-finish-load', () => {
    view.webContents.send('youtube-chat-watch:init', { channel: channelName });
  });
  view.webContents
    .loadURL(`https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}&embed_domain=${encodeURIComponent(parent)}`)
    .catch(() => {
      /* 取り込みできなくてもタイムライン自体は動くので無視 */
    });
}

function stopYoutubeChatWatch(channelName) {
  const view = youtubeChatWatchViews[channelName];
  if (!view) return;
  delete youtubeChatWatchViews[channelName];
  try {
    view.webContents.setAudioMuted(true);
    view.webContents.loadURL('about:blank');
  } catch (_) {
    /* ignore */
  }
  // addBrowserViewしていないので removeBrowserView は不要。破棄は猶予を置いて明示的に行う
  // （scheduleWebContentsDestroy参照。長時間の使用でメモリが増え続ける問題への対応）。
  scheduleWebContentsDestroy(view.webContents);
}

function stopAllYoutubeChatWatch() {
  Object.keys(youtubeChatWatchViews).forEach(stopYoutubeChatWatch);
}

/** 現在開いているチャンネルのうち、時系列統合で取り込み対象にしたいYouTubeチャンネル名の配列を渡して同期する */
function syncYoutubeChatWatch(wantedChannelNames) {
  const wanted = new Set(wantedChannelNames || []);
  wanted.forEach((channelName) => {
    if (youtubeChatWatchViews[channelName]) return;
    const entry = streamViews.get(channelName);
    if (!entry || entry.platform !== 'youtube' || !entry.youtubeVideoId) return;
    startYoutubeChatWatch(channelName, entry.youtubeVideoId);
  });
  Object.keys(youtubeChatWatchViews).forEach((channelName) => {
    if (!wanted.has(channelName)) stopYoutubeChatWatch(channelName);
  });
}

/** 指定BrowserViewが現在ウィンドウにアタッチ済みかどうか（無駄なaddBrowserView/removeBrowserView呼び出しを避けるため） */
function isViewAttached(view) {
  if (!mainWindow || !view) return false;
  try {
    return mainWindow.getBrowserViews().includes(view);
  } catch (_) {
    return false;
  }
}

function getStreamAndDropsViews() {
  const views = [];
  streamViews.forEach((entry) => views.push(entry.streamView, entry.chatView));
  if (dropsView) views.push(dropsView);
  if (kickDropsView) views.push(kickDropsView);
  return views;
}

/**
 * 汎用フローティングドロップダウン基盤（MCD大規模アプデ、2026-08-07新設）。
 * チャンネル名履歴ドロップダウン・音量ミキサー等、位置・サイズが可変な小さな浮遊UI向け。
 *
 * 旧実装（rectOverlayHiding、以前はこの直前に音量ミキサー専用のものがあった）は「ドロップダウンの
 * 矩形と重なっている配信タイルだけを一時的にremoveBrowserViewする」方式だったが、「配信タイルを
 * 絶対に消さない」方針への転換（2026-08-07、help/welcome/premium-locked/feedbackモーダルの
 * overlayPanelView化と同時）に伴い、こちらもoverlayPanelViewと同じ「専用の小さなBrowserViewを
 * setTopBrowserViewで最前面に重ねる」方式に置き換えた。既存の配信タイルは一切removeBrowserViewしない。
 *
 * 中身の描画（履歴一覧・音量スライダー等のDOM生成）はfloating-dropdown.js側で行い、状態管理
 * （履歴データやチャンネル音量の取得・フィルタ・永続化）は引き続きメインウィンドウ側（renderer.js）
 * が持つ。メインプロセスは「BrowserViewの生成・配置」と「メインウィンドウ⇔floating-dropdown間の
 * イベント中継」のみ担う。
 *
 * 第1段階（2026-08-07セッション）ではチャンネル名履歴ドロップダウンのみ対応、第2段階で
 * 音量ミキサーもこの基盤へ移植済み（旧applyVolumeDropdownOverlapHiding方式は廃止）。
 */
function createFloatingDropdown(id) {
  let view = null;
  let loaded = false;
  let open = false;
  // openAt()直後にsend()でコンテンツをpushすると、BrowserView側のページ読み込み
  // （loadURL）がまだ完了しておらずfloating-dropdown.js側のipcRenderer.onリスナーが
  // 登録される前にIPCが届いてしまい、そのメッセージが失われる競合が発生していた
  // （実機確認で発覚: アプリ起動後・初回オープン時にチャンネル名履歴の中身が空のまま
  // 表示されるバグ）。直近のsend内容を憶えておき、did-finish-load後に確実に再送する。
  let pendingSend = null; // { channel, payload }

  function ensure() {
    if (view) return view;
    view = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, 'renderer', 'floating-dropdown', 'floating-dropdown-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    forwardEscapeKey(view.webContents);
    view.webContents.on('did-finish-load', flushPendingSend);
    return view;
  }

  function flushPendingSend() {
    if (!pendingSend || !view || view.webContents.isDestroyed() || !open) return;
    const { channel, payload } = pendingSend;
    pendingSend = null;
    view.webContents.send(channel, payload);
  }

  function clampRect(rect) {
    if (!mainWindow || !rect) return null;
    const { width, height } = mainWindow.getContentBounds();
    const x = Math.max(0, Math.min(Math.round(rect.x), width));
    const y = Math.max(0, Math.min(Math.round(rect.y), height));
    const w = Math.max(0, Math.min(Math.round(rect.width), width - x));
    const h = Math.max(0, Math.min(Math.round(rect.height), height - y));
    return { x, y, width: w, height: h };
  }

  function setRect(rect) {
    if (!view || !mainWindow || !open) return;
    const clamped = clampRect(rect);
    if (!clamped) return;
    view.setBounds(clamped);
  }

  function openAt(rect) {
    if (!mainWindow) return;
    const v = ensure();
    if (!isViewAttached(v)) {
      mainWindow.addBrowserView(v);
    }
    open = true;
    if (!loaded) {
      const url = require('url').format({
        pathname: path.join(__dirname, 'renderer', 'floating-dropdown', 'index.html'),
        protocol: 'file:',
        slashes: true,
        query: { panel: id },
      });
      v.webContents.loadURL(url).catch(() => {
        /* ignore */
      });
      loaded = true;
    }
    setRect(rect);
    if (typeof mainWindow.setTopBrowserView === 'function') {
      mainWindow.setTopBrowserView(v);
    }
  }

  function close() {
    if (!open) return;
    open = false;
    try {
      if (view && mainWindow && isViewAttached(view)) {
        mainWindow.removeBrowserView(view);
      }
    } catch (_) {
      /* 既に外れている場合は無視 */
    }
  }

  function send(channel, payload) {
    if (!view || view.webContents.isDestroyed() || !open) return;
    // isLoading()中（loadURL直後でまだページ/スクリプトが準備できていない可能性がある間）は
    // 直接送らず、pendingSendに憶えておいてdid-finish-load時にflushPendingSendで送る。
    // 既に読み込み済みの状態（2回目以降のオープン等）ではこれまで通り即座に送る。
    if (view.webContents.isLoading()) {
      pendingSend = { channel, payload };
      return;
    }
    view.webContents.send(channel, payload);
  }

  function isOpen() {
    return open;
  }

  return { id, openAt, setRect, close, send, isOpen };
}

const floatingDropdowns = {
  'channel-history': createFloatingDropdown('channel-history'),
  // 実機確認で発覚した「ファイル/表示/ヘルプ/バージョン/通知の小ドロップダウンが配信タイルの
  // 裏に隠れる」問題への対応（2026-08-07セッション内追加）。
  'app-menu': createFloatingDropdown('app-menu'),
  // 音量ミキサーを旧rectOverlayHiding方式から移植（2026-08-07セッション内追加）。
  'volume-mixer': createFloatingDropdown('volume-mixer'),
};

function hideContentViewsForOverlay() {
  if (!mainWindow || contentViewsHiddenForOverlay) return;
  getStreamAndDropsViews().forEach((view) => {
    try {
      mainWindow.removeBrowserView(view);
    } catch (_) {
      /* 既に外れている場合は無視 */
    }
  });
  contentViewsHiddenForOverlay = true;
  // タイル情報帯（renderer.js側のHTML要素）もモーダル等の下に透けて見えないよう明示的に隠す
  // （z-indexだけに頼らない二重対策）。
  notifyRenderer('tile:bars-visible', false);
}

function showContentViewsForOverlay() {
  if (!mainWindow || !contentViewsHiddenForOverlay) return;
  getStreamAndDropsViews().forEach((view) => {
    try {
      mainWindow.addBrowserView(view);
    } catch (_) {
      /* 既に破棄済みの場合は無視 */
    }
  });
  contentViewsHiddenForOverlay = false;
  relayoutStreamViews();
  relayoutDropsView();
  relayoutKickDropsView();
  notifyRenderer('tile:bars-visible', true);
}

function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width,
    height,
    // ヘッダー（#control-bar）はチャンネルチップ欄・操作ボタン・右端固定ボタンが
    // 縮まない固定幅レイアウトのため、ウィンドウをこれより狭くするとヘッダー右側の要素が
    // 画面外にはみ出してしまう（実機報告への対応）。1000x600を下回れないようにして、
    // レイアウトが破綻するサイズまで縮小できないようにする。
    minWidth: 1000,
    minHeight: 600,
    // 配信タイル（BrowserView）側からHTML5 Fullscreen APIが呼ばれると、Electronの既定挙動として
    // mainWindowごとOSレベルのフルスクリーンに昇格し、タイトルバー（最小化/最大化/閉じるボタン）が
    // 消えてリサイズ・ドラッグ移動もできなくなる（実機報告のあった「突然リサイズ不可になる」不具合の
    // 原因と考えられる）。タイルの拡大表示はアプリ独自のリサイズ機能で代替できるため、
    // ウィンドウ自体のOSフルスクリーン昇格は無効化する。
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('resize', () => {
    relayoutStreamViews();
    relayoutDropsView();
    relayoutKickDropsView();
    relayoutAccountLoginView();
    relayoutChatIntegrationTabView();
    relayoutTwitchAuthView();
    relayoutOverlayPanel();
  });

  // fullscreenable:falseにしていても、BrowserView側からのHTML5 Fullscreen API呼び出しに対する
  // 万一のフェイルセーフとして、enter-html-full-screenが発火した場合は即座に強制解除する。
  mainWindow.on('enter-html-full-screen', () => {
    try {
      mainWindow.setFullScreen(false);
    } catch (_) {
      /* ignore */
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // 複窓レイアウト設定ウィンドウは parent 指定を持たない完全独立ウィンドウ（＝Electronの
    // 親子連動では閉じない）ため、メインウィンドウが閉じられた時に取り残されないよう
    // 明示的に閉じる。既にユーザーが閉じていれば layoutWindow は null になっている。
    if (layoutWindow && !layoutWindow.isDestroyed()) {
      layoutWindow.close();
    }
    // 配信チェックウィンドウも同じ理由（parent未指定の完全独立ウィンドウ）で明示的に閉じる。
    if (streamCheckWindow && !streamCheckWindow.isDestroyed()) {
      streamCheckWindow.close();
    }
  });

  // ネイティブのアプリケーションメニューは使わない。ファイル/表示/ヘルプ/バージョンは
  // すべてrenderer側の自作メニューバー（index.html #app-menu-bar、renderer.js）で描画し、
  // 実際の処理だけをここで定義するIPCハンドラ（app-menu:*）経由でmain.jsに委譲する。
  // 理由: 「バージョン」項目の右上に、スマホアプリの未読バッジのような赤丸を出したいという
  // 要望があり、ネイティブメニューでは項目の位置・サイズを自由に制御できない（Windowsでは
  // アイコンは常にラベルの左側固定）ため、HTML/CSSで自由に配置できる自作メニューに切り替えた。
  Menu.setApplicationMenu(null);
}

/**
 * 複窓レイアウト設定ウィンドウを開く（2026-08-08新設、第1段階）。
 *
 * 既存のオーバーレイパネル（BrowserView方式）とは意図的に別系統の、完全に独立した
 * BrowserWindowとして実装している。理由と仕様は以下の通り:
 * - parent は指定しない（メインウィンドウの子にしない）。配信タイルの上に被せるのではなく、
 *   OSレベルで自由にドラッグ移動できる別ウィンドウとして扱いたいため。
 * - alwaysOnTop: true。配置作業中にメインウィンドウの裏へ回り込まないようにする。
 * - frame: true。タイトルバーのドラッグ移動・閉じるボタンをOS標準の実装に任せる
 *   （カスタムタイトルバーは第1段階では不要）。
 * - ウィンドウ外クリックでは閉じない（フォーカス喪失で閉じる処理は入れない）。
 *   閉じられるのは「HTML側の×ボタン」「ESCキー」「OSの閉じるボタン」の3つだけ。
 *
 * 既に開いている場合は多重生成せず、既存ウィンドウをフォーカスするだけにする。
 */
function createLayoutWindow() {
  if (layoutWindow && !layoutWindow.isDestroyed()) {
    if (layoutWindow.isMinimized()) layoutWindow.restore();
    layoutWindow.focus();
    return layoutWindow;
  }

  layoutWindow = new BrowserWindow({
    width: 900,
    height: 700,
    // カードのグリッドが1列まで潰れて実用性が無くなるサイズまでは縮められないようにする。
    minWidth: 520,
    minHeight: 400,
    title: '複窓レイアウト設定',
    alwaysOnTop: true,
    // ちらつき防止（表示準備が整ってから見せる）。既存のBrowserView群と同じ考え方。
    show: false,
    frame: true,
    backgroundColor: '#1a1a1e',
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'layout-window', 'layout-window-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  layoutWindow.setMenuBarVisibility(false);
  layoutWindow.loadFile(path.join(__dirname, 'renderer', 'layout-window', 'index.html'));

  layoutWindow.once('ready-to-show', () => {
    if (layoutWindow && !layoutWindow.isDestroyed()) layoutWindow.show();
  });

  // ESCキーで閉じる。既存の forwardEscapeKey() はBrowserView（＝メインウィンドウのrenderer側へ
  // 転送する前提）専用なので流用せず、このウィンドウ単体で完結する形で実装する。
  layoutWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      if (layoutWindow && !layoutWindow.isDestroyed()) layoutWindow.close();
    }
  });

  layoutWindow.on('closed', () => {
    layoutWindow = null;
  });

  return layoutWindow;
}

/**
 * 配信チェックウィンドウを開く（2026-08-07新設、段階A）。
 *
 * 経緯: 「配信チェック」（フォロー中/登録中の配信中一覧、旧unified-feed）は当初オーバーレイ
 * パネル方式（overlayPanelView、BrowserView重ね表示）で段階1・2まで実装していたが、
 * ユーザーとの再確認の結果、「複窓レイアウト設定」（createLayoutWindow()）と同じ独立
 * BrowserWindow方式に統一することが確定した。詳細はMCD大規模アプデ_元依頼一覧.md 項目16参照。
 *
 * createLayoutWindow()と同じくウィンドウ外クリックでは閉じない（閉じられるのは「HTML側の×
 * ボタン」「ESCキー」「OSの閉じるボタン」の3つだけ）が、以下2点は2026-08-08の実機報告を受けて
 * createLayoutWindow()から意図的に差分を付けている:
 * - frame: false（＋自前のドラッグ可能ヘッダー）。旧frame:trueでは「OSネイティブのタイトルバー
 *   （灰色の『配信一覧』文字・最小化/最大化/閉じるボタン）」と「HTML側の自作ヘッダー（同じ
 *   『配信一覧』文字・×ボタン）」が二重に表示される実機報告があったため、frameを廃止して
 *   自作ヘッダー側（ブランドグラデーションで着色済み）だけを唯一の表示にした。最小化ボタンは
 *   ユーザー了承の上そのまま消える。ドラッグ移動はCSS側の-webkit-app-region:dragで自作ヘッダーに
 *   持たせている（stream-check-window.css参照）。
 * - alwaysOnTopではなくparent: mainWindowを指定。alwaysOnTop:trueはOS全体の最前面（他アプリの
 *   ウィンドウより前）に出てしまう実機報告があったため、「MCDのメインウィンドウより前」に
 *   留める目的でparent指定に変更した（Electronの子ウィンドウは親より常に前面に出るが、
 *   OS全体の最前面固定にはならない）。
 * - 既に開いている場合は多重生成せず、既存ウィンドウをフォーカスするだけ。
 *
 * 段階Bでカード一覧・フィルタ・自動更新を実装済み。「自動追加の対象を選ぶ」「フォロー配信者の
 * 自動追加」は段階C未着手のため、旧overlay-panel側のmountUnifiedFeed()はそれらの受け皿として
 * まだ削除しない（段階Dで撤去予定）。
 */
function createStreamCheckWindow() {
  if (streamCheckWindow && !streamCheckWindow.isDestroyed()) {
    streamCheckWindow.focus();
    return streamCheckWindow;
  }

  streamCheckWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 480,
    minHeight: 360,
    title: '配信一覧',
    parent: mainWindow,
    show: false,
    frame: false,
    backgroundColor: '#1a1a1e',
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'stream-check-window', 'stream-check-window-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  streamCheckWindow.setMenuBarVisibility(false);
  streamCheckWindow.loadFile(path.join(__dirname, 'renderer', 'stream-check-window', 'index.html'));

  streamCheckWindow.once('ready-to-show', () => {
    if (streamCheckWindow && !streamCheckWindow.isDestroyed()) streamCheckWindow.show();
  });

  // ESCキーで閉じる。createLayoutWindow()と同じく、このウィンドウ単体で完結させる。
  streamCheckWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      if (streamCheckWindow && !streamCheckWindow.isDestroyed()) streamCheckWindow.close();
    }
  });

  streamCheckWindow.on('closed', () => {
    streamCheckWindow = null;
  });

  return streamCheckWindow;
}

/** 「バージョン」メニュー右上の赤丸バッジを出すべきか。renderer側に渡す状態にも使う。 */
function hasUpdateBadge() {
  return updaterState.status === 'available' || updaterState.status === 'downloaded';
}

/** 自作メニューバー（renderer.js）が必要とする状態一式。取得時・変化時の両方でこれを渡す。 */
function getAppMenuState() {
  return {
    appVersion: app.getVersion(),
    premiumUnlocked: !!store.get('premiumUnlocked'),
    hasUpdateBadge: hasUpdateBadge(),
    updater: { ...updaterState },
  };
}

/** app-menu:state-changed をrendererへ送る（値が変わるあらゆる箇所から呼ぶ）。 */
function notifyAppMenuStateChanged() {
  notifyRenderer('app-menu:state-changed', getAppMenuState());
}

// ---- YouTube埋め込み用ローカルHTTPサーバー ----
// 当初 youtube.com/embed/live_stream?channel=... を使っていたが、これは①トップレベル
// ナビゲーションとして直接読み込むと再生できない（実ページのiframe内に埋め込まれている前提の
// チェックがあるため）、②iframe化して回避しても、この「チャンネル指定」の埋め込み方式自体が
// 不安定で、配信中・埋め込み許可済みの動画でも再生できないケースが確認された（実際のブラウザで
// 検証済み。Google側で正式サポートされていない非公式の挙動と見られる）。
// そのため、YouTube Data APIのsearch.list（eventType=live）で「現在配信中の動画ID」を都度解決し、
// 通常の動画埋め込み（youtube.com/embed/<動画ID>、公式にサポートされ安定して動作する）を使う方式に
// 変更した。埋め込みURLはRefererヘッダーが必要＆トップレベル読み込みでは動かないため、引き続き
// このローカルHTTPサーバーでラッパーHTMLを配信し、その中にiframeとして読み込む。
const YOUTUBE_EMBED_SERVER_PORT = 17654;
let youtubeEmbedServerStarted = false;

function ensureYoutubeEmbedServer() {
  if (youtubeEmbedServerStarted) return;
  youtubeEmbedServerStarted = true;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${YOUTUBE_EMBED_SERVER_PORT}`);
    if (u.pathname === '/checking') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;display:flex;align-items:center;justify-content:center;color:#adadb8;font-family:sans-serif;font-size:13px;}</style></head><body>配信状況を確認中…</body></html>'
      );
      return;
    }
    if (u.pathname === '/unsupported') {
      // ハンドル/チャンネルIDも動画URLも無い、想定外の状態用の静的メッセージ（通常は到達しない）。
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;display:flex;align-items:center;justify-content:center;color:#adadb8;font-family:sans-serif;font-size:13px;text-align:center;padding:16px;box-sizing:border-box;}</style></head><body>チャンネル情報を読み込めませんでした</body></html>'
      );
      return;
    }
    if (u.pathname !== '/embed') {
      res.writeHead(404);
      res.end();
      return;
    }
    const videoId = u.searchParams.get('video') || '';
    // iframe（youtube.com、別ドキュメント）はタイルのドラッグ移動・端リサイズ検知
    // （tileInteractionPreload.jsがこのラッパーページのwindowに仕込むmousedown/mousemove）が
    // 届かない。そのため映像を100%いっぱいにはせず、周囲に20pxの縁を残しておく。
    // 外側10px（tileInteractionPreload.jsのEDGE_PX）はリサイズ、残り10pxは移動のドラッグ開始点になる
    // （ドラッグ中にポインタがiframe上に入っても追従できるよう、tileInteractionPreload.js側で
    // ドラッグ中だけiframeのpointer-eventsを無効化している）。
    // id="player" + enablejsapi=1 は、音量調整（applyChannelVolume）がIFrame Player APIの
    // postMessageコマンドでこのiframeを操作するために必要（<video>要素はクロスオリジンで直接触れないため）。
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden;}.frame{position:absolute;inset:0;box-sizing:border-box;border:20px solid #141416;}iframe{width:100%;height:100%;border:0;display:block;}</style></head><body><div class="frame"><iframe id="player" src="https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&enablejsapi=1&origin=${encodeURIComponent(`http://127.0.0.1:${YOUTUBE_EMBED_SERVER_PORT}`)}" allow="autoplay; encrypted-media" allowfullscreen></iframe></div></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  server.listen(YOUTUBE_EMBED_SERVER_PORT, '127.0.0.1');
}

/**
 * 配信＋チャットの BrowserView ペアを1チャンネル分追加する。
 * Twitch公式の埋め込みプレイヤー / 埋め込みチャットを利用する（低リスク・公式サポート範囲内）。
 * YouTube対応分（ロードマップ項目8、現時点では視聴＋ログイン連携のみのスコープ）は、動画IDが
 * 分かっていればそのまま埋め込み（opts.youtubeVideoId、動画URL貼り付け時）、ハンドル/チャンネル名
 * （opts.youtubeChannelId）の場合は無料の/liveリダイレクト方式（resolveYoutubeLiveVideoIdFree、
 * APIキー・クォータ不要）で現在配信中の動画を都度解決する。チャット統合・Drops相当機能・
 * Auto Tune-In相当機能は今回のスコープ外のため、チャット欄は常時非表示（chatHidden固定）にしている。
 * Kick対応（視聴＋アカウントログイン連携のみのスコープ）は、Kick公式の埋め込みプレイヤー
 * （https://player.kick.com/{username}、APIキー不要）をそのままloadURLするだけで完結するため、
 * YouTubeのような複雑な動画ID解決・ローカルHTTPラッパーサーバーは不要（Twitchの直接loadURL方式に近い）。
 * チャット統合・スタンプ等は今回のスコープ外のため、チャット欄はYouTube同様に常時非表示にしている。
 */
function addChannel(channelName, opts = {}) {
  const {
    auto = false,
    autoGame = null,
    autoSource = null,
    platform = 'twitch',
    youtubeChannelId = null,
    // 動画URL（watch?v=等）を直接貼り付けた場合の動画ID。指定があればライブ検索を経由せず
    // そのままその動画を埋め込む（resolveYoutubeChannelIdのvideo判定・parseYoutubeInput参照）。
    youtubeVideoId = null,
  } = opts;
  if (streamViews.has(channelName)) return;

  const partition = getPlatformPartition(platform);
  const parent = store.get('parentDomain');

  const streamView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      partition,
      preload: TILE_DRAG_PRELOAD,
    },
  });
  const chatView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      partition,
      preload: TILE_DRAG_PRELOAD,
    },
  });

  // YouTube/Kickチャンネルは今回のスコープでは常にチャット非表示（既存の「チャット表示しない」機構を流用）。
  // Kickはチャット統合・スタンプ等は今回のスコープ外（視聴＋アカウント連携のみ）のため、Twitch公式埋め込み
  // チャットのような統合先が無く、常時非表示固定にする。
  if (platform === 'youtube' || platform === 'kick') {
    const chatHiddenMap = store.get('chatHidden');
    chatHiddenMap[channelName] = true;
    store.set('chatHidden', chatHiddenMap);
  }

  // 画面内のどこをドラッグ/リサイズの起点にできるかは配信側とチャット側で異なる
  // （チャットはタイル内部の右側に固定表示されるため、その左端は「タイルの外周」ではない）。
  // dom-ready のたびに送り直すことで、parentDomain変更等によるページ再読み込み後も追従する。
  streamView.webContents.on('dom-ready', () => sendEdgeConfig(channelName));
  // ページ再読み込み（parentDomain変更等）のたびに<video>要素は作り直されるため、
  // dom-readyのたびに保存済みの音量を再適用する
  streamView.webContents.on('dom-ready', () => applyChannelVolume(channelName));
  chatView.webContents.on('dom-ready', () => sendEdgeConfig(channelName));
  forwardEscapeKey(streamView.webContents);
  forwardEscapeKey(chatView.webContents);

  // 設定パネル等のHTMLオーバーレイ表示中に追加された場合は、オーバーレイの背後に回さないよう
  // あえてウィンドウにはまだ追加しない（オーバーレイを閉じた時に showContentViewsForOverlay がまとめて追加する）
  if (!contentViewsHiddenForOverlay) {
    mainWindow.addBrowserView(streamView);
    if (!isChatHidden(channelName)) mainWindow.addBrowserView(chatView);
  }

  let chatUrl = null;
  if (platform === 'youtube') {
    ensureYoutubeEmbedServer();
    if (youtubeVideoId) {
      // 動画URLを直接貼り付けた場合はAPIを呼ばずそのままその動画を埋め込む（一番安く・確実）
      const url = `http://127.0.0.1:${YOUTUBE_EMBED_SERVER_PORT}/embed?video=${encodeURIComponent(youtubeVideoId)}`;
      streamView.webContents.loadURL(url).catch((err) => {
        if (isBenignNavigationError(err)) return;
        notifyRenderer('channel:load-error', { channel: channelName, target: 'stream', message: String(err) });
      });
    } else if (youtubeChannelId) {
      // ハンドル/チャンネル名で追加した場合は、無料の/liveリダイレクト方式（resolveYoutubeLiveVideoIdFree）
      // で現在配信中の動画IDを都度解決する。解決が終わるまでは簡単な「確認中」プレースホルダーを表示。
      streamView.webContents.loadURL(`http://127.0.0.1:${YOUTUBE_EMBED_SERVER_PORT}/checking`).catch(() => {});
      loadYoutubeLiveStreamFree(streamView, channelName, youtubeChannelId);
    } else {
      streamView.webContents.loadURL(`http://127.0.0.1:${YOUTUBE_EMBED_SERVER_PORT}/unsupported`).catch(() => {});
    }
  } else if (platform === 'kick') {
    // Kick公式の埋め込みプレイヤー（無料・APIキー不要）。TwitchのplayerURL同様、そのままloadURLするだけで
    // 再生できる（parentドメイン指定やローカルHTTPラッパーサーバーは不要）。チャット統合は今回のスコープ外
    // のためchatUrlはnullのまま（chatViewはabout:blank・常時非表示）。
    const streamUrl = `https://player.kick.com/${encodeURIComponent(channelName)}?autoplay=true&muted=false`;
    streamView.webContents.loadURL(streamUrl).catch((err) => {
      if (isBenignNavigationError(err)) return;
      notifyRenderer('channel:load-error', { channel: channelName, target: 'stream', message: String(err) });
    });
  } else {
    const streamUrl = `https://player.twitch.tv/?channel=${encodeURIComponent(channelName)}&parent=${parent}&muted=false`;
    // darkpopout: Twitch公式のチャット埋め込みをダークテーマで表示させる非公式パラメータ
    // （公式ドキュメントには未記載だが広く使われている。値は不要、付けるだけで有効になる）
    chatUrl = `https://www.twitch.tv/embed/${encodeURIComponent(channelName)}/chat?parent=${parent}&darkpopout`;
    streamView.webContents.loadURL(streamUrl).catch((err) => {
      if (isBenignNavigationError(err)) return;
      notifyRenderer('channel:load-error', { channel: channelName, target: 'stream', message: String(err) });
    });
  }
  // YouTubeはチャット統合が今回のスコープ外のため、chatViewはabout:blankのまま
  // （常時chatHidden=trueで非表示・非アタッチなので実害はない。将来チャット対応する際に差し替える）。
  chatView.webContents.loadURL(chatUrl || 'about:blank').catch((err) => {
    if (isBenignNavigationError(err) || !chatUrl) return;
    notifyRenderer('channel:load-error', { channel: channelName, target: 'chat', message: String(err) });
  });

  streamViews.set(channelName, {
    streamView,
    chatView,
    channel: channelName,
    chatSuppressed: false,
    platform,
    youtubeChannelId,
    youtubeVideoId,
    // Drops自動追加/削除・Auto Tune-Inのどちらかで追加されたチャンネルかどうか。手動追加分と区別し、
    // 自動削除の対象は「自動追加されたチャンネルのみ」に限定するために保持する。
    // autoSourceで「drops」「tune-in」のどちらの機能が追加したかを区別する（互いの上限管理が
    // 干渉しないようにするため）。
    autoAdded: auto,
    autoGame: auto ? autoGame : null,
    autoSource: auto ? autoSource || 'drops' : null,
  });

  const channels = new Set(store.get('channels'));
  channels.add(channelName);
  store.set('channels', Array.from(channels));

  const channelPlatforms = store.get('channelPlatforms');
  channelPlatforms[channelName] = platform;
  store.set('channelPlatforms', channelPlatforms);
  if (platform === 'youtube' && youtubeChannelId) {
    const channelYoutubeIds = store.get('channelYoutubeIds');
    channelYoutubeIds[channelName] = youtubeChannelId;
    store.set('channelYoutubeIds', channelYoutubeIds);
  }
  if (platform === 'youtube' && youtubeVideoId) {
    const channelYoutubeVideoIds = store.get('channelYoutubeVideoIds');
    channelYoutubeVideoIds[channelName] = youtubeVideoId;
    store.set('channelYoutubeVideoIds', channelYoutubeVideoIds);
  }

  const order = store.get('channelOrder').filter((c) => channels.has(c));
  if (!order.includes(channelName)) order.push(channelName);
  store.set('channelOrder', order);

  // 自動追加されたチャンネルは、アプリ再起動後も上限管理・自動削除の対象として
  // 引き継げるよう永続化する（entry.autoAddedはstreamViews上の実行時フラグのみで、
  // 再起動でstreamViews自体が作り直されると失われるため）。
  if (auto) {
    const autoAddedChannels = store.get('autoAddedChannels');
    autoAddedChannels[channelName] = { source: autoSource || 'drops', game: autoGame || null };
    store.set('autoAddedChannels', autoAddedChannels);
  }

  relayoutStreamViews();
}

// 猶予を置いてから .webContents.destroy() を呼ぶまでの待機時間（ミリ秒）。
// about:blank への遷移完了（did-finish-load）後にこの時間を追加で待ってから破棄する。
// 短すぎるとdestroy()関連の不安定化（過去に実機で確認・原因の詳細は不明、そのため封印していた）が
// 再発するおそれがあるため、実務上十分すぎる余裕を持たせている。
const DESTROY_SAFETY_DELAY_MS = 8000;

/**
 * removeBrowserView後のwebContentsを、少し待ってから明示的に破棄してメモリを解放する
 * （長時間使い続けるとメモリ使用量が増え続けるというフィードバックを受けての対応）。
 * 即座に .destroy() を呼ぶのではなく、about:blankへの遷移が完全に完了したのを確認した上で
 * さらに安全マージンとして数秒待つ。何らかの理由で既に破棄済み・エラーになった場合は無視する
 * （ここで失敗してもアプリの動作には影響しない、あくまでメモリ解放の後始末のため）。
 * @param {Electron.WebContents} webContents
 * @param {{ alreadyLoaded?: boolean }} [opts] alreadyLoaded=true の場合、既にナビゲーションが
 *   完了済み（did-finish-loadが既に発火済みで、今後は発火しない）と分かっている呼び出し元向け。
 *   その場合はイベント待ちをせず、猶予時間の経過だけで破棄する。
 */
function scheduleWebContentsDestroy(webContents, opts = {}) {
  if (!webContents) return;
  const doDestroy = () => {
    try {
      if (!webContents.isDestroyed()) webContents.destroy();
    } catch (_) {
      /* 何らかの理由で破棄に失敗しても、アプリ本体の動作には影響させない */
    }
  };
  try {
    if (webContents.isDestroyed()) return;
    if (opts.alreadyLoaded) {
      setTimeout(doDestroy, DESTROY_SAFETY_DELAY_MS);
      return;
    }
    webContents.once('did-finish-load', () => setTimeout(doDestroy, DESTROY_SAFETY_DELAY_MS));
    webContents.once('did-fail-load', () => setTimeout(doDestroy, DESTROY_SAFETY_DELAY_MS));
    // 保険: 上記イベントが何らかの理由で発火しなかった場合に備え、最大でもこの時間で破棄する
    setTimeout(doDestroy, DESTROY_SAFETY_DELAY_MS * 2);
  } catch (_) {
    /* ignore */
  }
}

function removeChannel(channelName) {
  const entry = streamViews.get(channelName);
  if (!entry) return;

  // webContents.destroy() はElectronの公開APIとして不安定だったため長らく使用禁止にしていたが、
  // 使い続けるとメモリ使用量が増え続けるという指摘を受け、安全マージンを設けた上で再導入した
  // （scheduleWebContentsDestroy参照。about:blankへの遷移完了後さらに数秒待ってから破棄する）。
  // removeBrowserView でウィンドウから切り離すだけでは、参照がGCされるまでの間ページ
  // （Twitchプレイヤー）が裏で再生され続け、音声だけが流れ続けてしまう不具合が実機で確認された
  // （ザッピングでの切替時も同様）。そのため切り離す前に明示的にミュート＋about:blankへの
  // 遷移で再生をまず止め、破棄はその後に猶予を置いて行う。
  try {
    entry.streamView.webContents.setAudioMuted(true);
  } catch (_) {
    /* ビュー破棄後などは無視 */
  }
  try {
    entry.streamView.webContents.loadURL('about:blank');
  } catch (_) {
    /* ビュー破棄後などは無視 */
  }
  // chatView側は元々音声を持たないが、destroy前のdid-finish-loadを確実に発火させ、
  // 安全マージンの計算基準を揃えるためstreamViewと同様にabout:blankへ遷移させておく
  try {
    entry.chatView.webContents.loadURL('about:blank');
  } catch (_) {
    /* ビュー破棄後などは無視 */
  }
  try {
    mainWindow.removeBrowserView(entry.streamView);
    mainWindow.removeBrowserView(entry.chatView);
  } catch (_) {
    /* 既に外れている場合などは無視 */
  }
  scheduleWebContentsDestroy(entry.streamView.webContents);
  scheduleWebContentsDestroy(entry.chatView.webContents);
  streamViews.delete(channelName);
  notifyRenderer('tile:bar-remove', channelName);

  const channels = new Set(store.get('channels'));
  channels.delete(channelName);
  store.set('channels', Array.from(channels));
  store.set('channelOrder', store.get('channelOrder').filter((c) => c !== channelName));

  const layouts = store.get('tileLayouts');
  delete layouts[channelName];
  store.set('tileLayouts', layouts);

  const chatHidden = store.get('chatHidden');
  delete chatHidden[channelName];
  store.set('chatHidden', chatHidden);

  const chatIntegrationHidden = store.get('chatIntegrationHidden');
  delete chatIntegrationHidden[channelName];
  store.set('chatIntegrationHidden', chatIntegrationHidden);

  const volumes = store.get('channelVolumes');
  delete volumes[channelName];
  store.set('channelVolumes', volumes);

  const autoAddedChannels = store.get('autoAddedChannels');
  if (channelName in autoAddedChannels) {
    delete autoAddedChannels[channelName];
    store.set('autoAddedChannels', autoAddedChannels);
  }

  const channelPlatforms = store.get('channelPlatforms');
  if (channelName in channelPlatforms) {
    delete channelPlatforms[channelName];
    store.set('channelPlatforms', channelPlatforms);
  }
  const channelYoutubeIds = store.get('channelYoutubeIds');
  if (channelName in channelYoutubeIds) {
    delete channelYoutubeIds[channelName];
    store.set('channelYoutubeIds', channelYoutubeIds);
  }
  const channelYoutubeVideoIds = store.get('channelYoutubeVideoIds');
  if (channelName in channelYoutubeVideoIds) {
    delete channelYoutubeVideoIds[channelName];
    store.set('channelYoutubeVideoIds', channelYoutubeVideoIds);
  }

  relayoutStreamViews();
}

/**
 * loadURL() が「ページが読み込めなかった」わけではなく、ログイン済みリダイレクト等で
 * ナビゲーションが別のものに差し替えられただけの場合に発生する無害なエラーかどうかを判定する。
 * （ERR_ABORTED (-3) はChromiumの仕様上、リダイレクトが挟まっただけでも発生しうる）
 * 「時系列統合モードでYouTubeチャットが読み込めない」というフィードバックの原因はこの判定漏れで、
 * Electronのバージョン/状況によってエラー文言に "ERR_ABORTED" の文字列が含まれず
 * "Error: (-3) loading 'url'" のように code 部分のみになることがあり、従来の文字列一致では
 * 素通りしてしまっていた。err.code（存在する場合）と、メッセージ中の "(-3)" 表記の両方も見るようにする。
 */
function isBenignNavigationError(err) {
  if (err && typeof err === 'object' && 'code' in err && Number(err.code) === -3) return true;
  const message = String(err);
  return message.includes('ERR_ABORTED') || message.includes('(-3)');
}

/** レンダラー（コントロールパネル）へ通知イベントを送る */
function notifyRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
  // オーバーレイパネル（配信チェック等）へ移植したUIも同じ通知を必要とするため、
  // 明示的に列挙したチャンネルだけパネル側BrowserViewにも中継する（OVERLAY_PANEL_FORWARDED_CHANNELS参照）。
  if (overlayPanelOpenId && overlayPanelView && OVERLAY_PANEL_FORWARDED_CHANNELS.has(channel)) {
    try {
      if (!overlayPanelView.webContents.isDestroyed()) {
        overlayPanelView.webContents.send(channel, payload);
      }
    } catch (_) {
      /* パネルが閉じられた直後などは無視（通知は装飾的なもので、失敗しても本処理に影響させない） */
    }
  }
}

/**
 * 配信/チャット/Drops/ログイン等のBrowserViewはメインウィンドウのdocumentとは別のフォーカス先のため、
 * それらにフォーカスがある状態でEscapeキーを押してもメインウィンドウ側のkeydownリスナーには
 * 届かない（Electronの仕様）。各BrowserViewでもEscapeを検知し、メインプロセス経由でレンダラーへ
 * 転送することで、「どこにフォーカスがあってもEscapeでパネルを閉じられる」ようにする。
 */
function forwardEscapeKey(webContents) {
  webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      notifyRenderer('ui:escape-pressed');
    }
  });
}

/**
 * チャンネルの表示順を並び替える。ドラッグ&ドロップ操作の結果を反映する。
 */
function reorderChannels(newOrder) {
  const valid = newOrder.filter((c) => streamViews.has(c));
  streamViews.forEach((_v, c) => {
    if (!valid.includes(c)) valid.push(c);
  });
  store.set('channelOrder', valid);
  relayoutStreamViews();
}

/**
 * チャンネル数に応じた「グリッド自動整列」の矩形一覧を比率(0-1)で返す。
 * タイルの初期配置や「自動整列」ボタン実行時に使う。
 */
function computeAutoGridRects(count) {
  if (count === 0) return [];
  const manualCols = store.get('layoutColumns');
  const cols = manualCols && manualCols > 0 ? Math.min(manualCols, count) : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cellW = 1 / cols;
  const cellH = 1 / rows;
  const rects = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    rects.push({ x: col * cellW, y: row * cellH, w: cellW, h: cellH });
  }
  return rects;
}

/**
 * MCD大規模アプデ item20（複窓レイアウト設定）に伴い新設。1〜9枚専用の見栄え重視レイアウト
 * テンプレート（比率0-1の矩形一覧、先頭＝選択/表示順の1番目から順に割り当て）。
 * ユーザー確定仕様（2026-08-08、3枚のみユーザー原案「上1+下3分割」が合計4枚になり枚数と矛盾する
 * ため、他の枚数（5〜9）と同じ「上のブロック数＋下のブロック数＝合計枚数」の法則に合わせて
 * 「上1(全幅)+下2分割」に補正して実装）:
 *   1枚=全画面 / 2枚=左右2分割 / 3枚=上1(全幅)+下2分割 / 4枚=四方2x2 /
 *   5枚=上2分割+下3分割 / 6枚=上3分割+下3分割 / 7枚=上(2x2の4枠)+下3分割 /
 *   8枚=上3分割+中3分割+下2分割(少し小さめ) / 9枚=3x3(上中下とも3分割)。
 * 10枚以上は本テンプレート未定義のためcomputeAutoGridRects（均等グリッド）にフォールバックする。
 * `layoutColumns`（手動列数指定）はこのテンプレート適用時は参照しない
 * （固定レイアウトのため列数という概念がそもそも無い。10枚以上のフォールバック時のみ従来通り有効）。
 * 「自動整列」ボタン（メイン画面既存機能・複窓レイアウト設定ウィンドウの新設ボタン共通）から呼ばれる。
 */
function computeTemplateRects(count) {
  if (count <= 0) return [];
  if (count > 9) return computeAutoGridRects(count);

  /** y〜y+h の帯をn等分した横並びの矩形をn枚分返す */
  const row = (y, h, n) => {
    const w = 1 / n;
    return Array.from({ length: n }, (_, i) => ({ x: i * w, y, w, h }));
  };

  switch (count) {
    case 1:
      return [{ x: 0, y: 0, w: 1, h: 1 }];
    case 2:
      return row(0, 1, 2);
    case 3:
      return [{ x: 0, y: 0, w: 1, h: 0.5 }, ...row(0.5, 0.5, 2)];
    case 4:
      return [...row(0, 0.5, 2), ...row(0.5, 0.5, 2)];
    case 5:
      return [...row(0, 0.5, 2), ...row(0.5, 0.5, 3)];
    case 6:
      return [...row(0, 0.5, 3), ...row(0.5, 0.5, 3)];
    case 7: {
      // 上側(高さ2/3)を2x2の4枠、下側(高さ1/3)を3分割。上段2行の各行高さは(2/3)/2=1/3となり、
      // 下段の高さ1/3と揃うため、7枚とも見た目のタイル高さが均一に近くなる。
      const topH = 2 / 3;
      return [...row(0, topH / 2, 2), ...row(topH / 2, topH / 2, 2), ...row(topH, 1 - topH, 3)];
    }
    case 8:
      // 上3分割・中3分割は高さ3/8ずつ、下2分割だけ高さ2/8とやや小さめにする。
      return [...row(0, 3 / 8, 3), ...row(3 / 8, 3 / 8, 3), ...row(6 / 8, 2 / 8, 2)];
    case 9:
      return [...row(0, 1 / 3, 3), ...row(1 / 3, 1 / 3, 3), ...row(2 / 3, 1 / 3, 3)];
    default:
      return computeAutoGridRects(count);
  }
}

/** 新規タイル追加時、既存タイルの自由配置を崩さないよう少しずつオフセットして配置する（カスケード配置） */
function nextCascadeRect(existingCount) {
  const w = 0.42;
  const h = 0.5;
  const offset = 0.035 * (existingCount % 8);
  const x = Math.min(0.05 + offset, 1 - w);
  const y = Math.min(0.05 + offset, 1 - h);
  return { x, y, w, h };
}

/** チャンネルのタイル矩形（比率）を取得。未保存なら新規に割り当てて保存する。 */
function ensureTileLayout(channelName) {
  const layouts = store.get('tileLayouts');
  if (layouts[channelName]) return layouts[channelName];
  const rect = nextCascadeRect(Object.keys(layouts).length);
  layouts[channelName] = rect;
  store.set('tileLayouts', layouts);
  return rect;
}

/** チャンネルの「チャット画面を表示しない」設定を取得する */
function isChatHidden(channelName) {
  return !!store.get('chatHidden')[channelName];
}

/**
 * ---- レイアウトのURL共有（ロードマップ項目5） ----
 * 「現在開いているチャンネル構成＋タイル配置（位置・サイズ・チャット表示有無）」だけをURL化して
 * 共有できるようにする機能。Drops自動追加設定・Helixキー・アカウント連携などの個人設定は含めない。
 * カスタムプロトコル登録によるワンクリック取込みは、未インストーラー版（開発中のnpm start）では
 * 動作検証がしづらいため見送り、URL文字列をアプリ内の入力欄に貼り付けて読み込む方式にした
 * （ユーザーとの合意事項）。
 */
const LAYOUT_SHARE_SCHEME = 'multistream-drops-tool://layout';
const LAYOUT_SHARE_MAX_CHANNELS = 30; // 貼り付けられたURLに悪意ある/壊れたデータが入っていた場合の暴走防止

function toUrlSafeBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromUrlSafeBase64(b64) {
  let s = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

/** 現在の構成からレイアウト共有用URLを生成する */
function buildLayoutShareUrl() {
  const order = store.get('channelOrder').filter((c) => streamViews.has(c));
  const tileLayouts = store.get('tileLayouts');
  const chatHidden = store.get('chatHidden');
  const channelPlatforms = store.get('channelPlatforms');
  const channelYoutubeIds = store.get('channelYoutubeIds');
  const channelYoutubeVideoIds = store.get('channelYoutubeVideoIds');
  const payload = {
    v: 1,
    channels: order,
    layouts: order.map((c) => tileLayouts[c] || null),
    chatHidden: order.filter((c) => !!chatHidden[c]),
    // v1ではプラットフォーム情報を保持していなかったため、共有→取り込みで常にTwitch扱いに戻って
    // しまう既存の抜け（YouTube/Kick共通）があった。後方互換のため配列の並びはchannelsと揃えつつ、
    // 古いURL（platforms未収録）を読み込んだ場合はparseLayoutShareUrl側で'twitch'扱いにフォールバックする。
    platforms: order.map((c) => channelPlatforms[c] || 'twitch'),
    youtubeChannelIds: order.map((c) => channelYoutubeIds[c] || null),
    youtubeVideoIds: order.map((c) => channelYoutubeVideoIds[c] || null),
  };
  const encoded = toUrlSafeBase64(JSON.stringify(payload));
  return `${LAYOUT_SHARE_SCHEME}?data=${encoded}`;
}

/** 共有URL文字列をパースし、構成データを取り出す（不正な形式はエラーを投げる） */
function parseLayoutShareUrl(urlStr) {
  const str = String(urlStr || '').trim();
  const match = str.match(/[?&]data=([^&]+)/);
  if (!match) throw new Error('URLの形式が正しくありません（dataパラメータが見つかりません）');
  let payload;
  try {
    payload = JSON.parse(fromUrlSafeBase64(decodeURIComponent(match[1])));
  } catch (_) {
    throw new Error('URLのデータを読み取れませんでした（壊れているか、対応していない形式です）');
  }
  if (!payload || !Array.isArray(payload.channels)) {
    throw new Error('URLのデータ形式が正しくありません');
  }
  // チャンネル名の簡易サニタイズ（空文字除去・重複排除・件数上限）。
  // layouts/platforms/youtube系IDはchannelsと同じ添字で対応させたいため、間引いた分は必ず同じ添字で間引く。
  const rawLayouts = Array.isArray(payload.layouts) ? payload.layouts : [];
  const rawPlatforms = Array.isArray(payload.platforms) ? payload.platforms : [];
  const rawYoutubeChannelIds = Array.isArray(payload.youtubeChannelIds) ? payload.youtubeChannelIds : [];
  const rawYoutubeVideoIds = Array.isArray(payload.youtubeVideoIds) ? payload.youtubeVideoIds : [];
  const seen = new Set();
  const channels = [];
  const layouts = [];
  const platforms = [];
  const youtubeChannelIds = [];
  const youtubeVideoIds = [];
  payload.channels.forEach((c, i) => {
    const name = String(c || '').trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    if (channels.length < LAYOUT_SHARE_MAX_CHANNELS) {
      channels.push(name);
      layouts.push(rawLayouts[i] || null);
      // 古いURL（v1初期・platforms未収録）を読み込んだ場合は従来通りTwitch扱いにフォールバックする
      const platform = rawPlatforms[i];
      platforms.push(platform === 'youtube' || platform === 'kick' ? platform : 'twitch');
      youtubeChannelIds.push(rawYoutubeChannelIds[i] || null);
      youtubeVideoIds.push(rawYoutubeVideoIds[i] || null);
    }
  });
  const chatHiddenList = Array.isArray(payload.chatHidden) ? payload.chatHidden : [];
  return { channels, layouts, chatHiddenList, platforms, youtubeChannelIds, youtubeVideoIds };
}

/** 共有データを適用する。既存のチャンネルはすべて閉じ、共有された構成で置き換える。 */
function applySharedLayout({ channels, layouts, chatHiddenList, platforms, youtubeChannelIds, youtubeVideoIds }) {
  // 既存チャンネルをすべて閉じる（removeChannelは音声停止処理込みなので安全に使い回す）
  Array.from(streamViews.keys()).forEach((c) => removeChannel(c));

  const tileLayouts = store.get('tileLayouts');
  const chatHidden = store.get('chatHidden');
  const chatHiddenSet = new Set(chatHiddenList);

  channels.forEach((channelName, i) => {
    const rect = layouts[i];
    if (rect && typeof rect.x === 'number' && typeof rect.y === 'number' && typeof rect.w === 'number' && typeof rect.h === 'number') {
      tileLayouts[channelName] = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    }
    if (chatHiddenSet.has(channelName)) {
      chatHidden[channelName] = true;
    } else {
      delete chatHidden[channelName];
    }
  });
  store.set('tileLayouts', tileLayouts);
  store.set('chatHidden', chatHidden);

  channels.forEach((channelName, i) => {
    const platform = (platforms && platforms[i]) || 'twitch';
    if (platform === 'youtube') {
      const videoId = youtubeVideoIds && youtubeVideoIds[i];
      const ytChannelId = youtubeChannelIds && youtubeChannelIds[i];
      addChannel(channelName, videoId ? { platform: 'youtube', youtubeVideoId: videoId } : { platform: 'youtube', youtubeChannelId: ytChannelId || null });
    } else if (platform === 'kick') {
      addChannel(channelName, { platform: 'kick' });
    } else {
      addChannel(channelName);
    }
  });
  store.set('channelOrder', channels.slice());
  relayoutStreamViews();
  notifyRenderer('channels:changed');
}

/**
 * 複窓レイアウト設定ウィンドウ（item20）の「自動整列」ボタンから呼ばれる。
 * applySharedLayoutと同じ「既存タイルは全部閉じてから選択内容で置き換える」方式を踏襲するが、
 * 座標は共有データではなくcomputeTemplateRects（1〜9枚テンプレート）で都度算出する。
 * selection: [{ platform, channel, youtubeChannelId }] 最大9件、並び順＝選択順（テンプレートの
 * 1枠目から順に割り当てる）。chatVisible: 選択チャンネル全体の一括チャット表示ON/OFF
 * （true=表示/false=非表示）。YouTube/Kickはチャット統合非対応のためこの設定を適用しても
 * addChannel側の強制非表示が優先される（従来通り）。
 */
function applyLayoutWindowArrange({ selection, chatVisible } = {}) {
  const list = Array.isArray(selection) ? selection.slice(0, 9) : [];
  if (list.length === 0) return { ok: false, error: '配信が選択されていません' };

  // 重複（同じplatform+channel）は先勝ちで除去。selectedOrder側で既にユニークなキー管理をしている
  // 前提だが、IPC越しに壊れたデータが来ても安全なように防御的に行う。
  const seen = new Set();
  const dedup = [];
  list.forEach((item) => {
    const platform = item && (item.platform === 'youtube' || item.platform === 'kick') ? item.platform : 'twitch';
    const channelName = String((item && item.channel) || '').trim();
    if (!channelName) return;
    const key = `${platform}::${channelName}`;
    if (seen.has(key)) return;
    seen.add(key);
    dedup.push({ platform, channelName, youtubeChannelId: (item && item.youtubeChannelId) || channelName });
  });
  if (dedup.length === 0) return { ok: false, error: '配信が選択されていません' };

  // 要件⑦: 未選択の既存タイルは閉じる（＝選択内容で完全に入れ替え）。
  Array.from(streamViews.keys()).forEach((c) => removeChannel(c));

  dedup.forEach(({ platform, channelName, youtubeChannelId }) => {
    if (platform === 'youtube') {
      addChannel(channelName, { platform: 'youtube', youtubeChannelId });
    } else if (platform === 'kick') {
      addChannel(channelName, { platform: 'kick' });
    } else {
      addChannel(channelName);
    }
  });

  // 一括チャット表示ON/OFF（Twitchのみ意味を持つ。YouTube/Kickはaddchannel内で常時非表示固定のため
  // ここで触っても実効はない＝上書きしない）。
  if (typeof chatVisible === 'boolean') {
    const chatHidden = store.get('chatHidden');
    dedup.forEach(({ platform, channelName }) => {
      if (platform !== 'twitch') return;
      if (chatVisible) delete chatHidden[channelName];
      else chatHidden[channelName] = true;
    });
    store.set('chatHidden', chatHidden);
  }

  const order = dedup.map((d) => d.channelName).filter((c) => streamViews.has(c));
  const rects = computeTemplateRects(order.length);
  const tileLayouts = store.get('tileLayouts');
  order.forEach((channelName, i) => {
    tileLayouts[channelName] = rects[i];
  });
  store.set('tileLayouts', tileLayouts);
  store.set('channelOrder', order);
  relayoutStreamViews();
  notifyRenderer('channels:changed');
  return { ok: true, count: order.length };
}

/**
 * ストリームごとの個別音量調整（0-100）。ViewGrid等の競合にある機能を参考に実装。
 * ElectronのwebContentsには「ミュートON/OFF」しかなく、段階的な音量調整APIが無いため、
 * ページ内の<video>要素に対してexecuteJavaScriptで直接volumeプロパティを設定する非公式手段を使う
 * （Drops進捗読み取り等、他の非公式DOM操作と同様の手法）。
 */
function getChannelVolume(channelName) {
  const volumes = store.get('channelVolumes');
  return channelName in volumes ? volumes[channelName] : 100;
}

/** 保存済みの音量を実際のBrowserViewに反映する。ページ再読み込み後の<video>要素にも効くよう dom-ready 毎に呼ぶ想定。 */
function applyChannelVolume(channelName) {
  const entry = streamViews.get(channelName);
  if (!entry) return;
  const volume = getChannelVolume(channelName);
  try {
    entry.streamView.webContents.setAudioMuted(volume === 0);
  } catch (_) {
    /* ビュー破棄後などは無視 */
  }
  if (entry.platform === 'youtube') {
    // YouTubeは<video>要素がクロスオリジンiframe（youtube.com）の中にあり直接触れないため、
    // IFrame Player APIのpostMessageコマンド（iframeのenablejsapi=1が必要）で操作する。
    // postMessage自体はクロスオリジンでも呼び出せる（iframe.contentWindowへの参照さえあればよい）。
    entry.streamView.webContents
      .executeJavaScript(
        `(function () {
          var f = document.getElementById('player');
          if (!f || !f.contentWindow) return;
          function send(func, args) {
            f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [] }), '*');
          }
          send('setVolume', [${volume}]);
          send(${volume === 0 ? "'mute'" : "'unMute'"}, []);
        })();`
      )
      .catch(() => {
        /* ページ未ロード時などは無視 */
      });
    return;
  }
  // Twitch/Kickは<video>要素がReact等のクライアントサイドJSにより「dom-ready後」に非同期で
  // 生成されるため、この時点でquerySelectorAllしても0件で何もせず終わることがある
  // （そのままだとブラウザ既定音量=100%のまま再生され続け、保存済みの低い音量が反映されないバグの原因）。
  // 既存<video>への即時適用に加え、MutationObserverを1回だけ常駐させて以降生成される<video>にも
  // 同じ音量を適用し続ける。二重登録防止のためwindowにフラグを立てて多重dom-ready発火に備える。
  entry.streamView.webContents
    .executeJavaScript(
      `(function () {
        var vol = ${volume / 100};
        function apply(v) { try { v.volume = vol; } catch (_) {} }
        document.querySelectorAll('video').forEach(apply);
        window.__mcdChatVolume = vol;
        if (!window.__mcdVolumeObserverInstalled) {
          window.__mcdVolumeObserverInstalled = true;
          var observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
              m.addedNodes && m.addedNodes.forEach(function (node) {
                if (!node || node.nodeType !== 1) return;
                if (node.tagName === 'VIDEO') {
                  node.volume = window.__mcdChatVolume;
                  node.addEventListener('loadedmetadata', function () { node.volume = window.__mcdChatVolume; });
                } else if (node.querySelectorAll) {
                  node.querySelectorAll('video').forEach(function (v) {
                    v.volume = window.__mcdChatVolume;
                    v.addEventListener('loadedmetadata', function () { v.volume = window.__mcdChatVolume; });
                  });
                }
              });
            });
          });
          observer.observe(document.documentElement, { childList: true, subtree: true });
          document.querySelectorAll('video').forEach(function (v) {
            v.addEventListener('loadedmetadata', function () { v.volume = window.__mcdChatVolume; });
          });
        }
      })();`
    )
    .catch(() => {
      /* ページ未ロード時などは無視 */
    });
}

/** ユーザーがチップのスライダーを操作した時に呼ばれる。永続化＋即時反映を行う。 */
function setChannelVolume(channelName, volume) {
  if (!streamViews.has(channelName)) return;
  const v = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
  const volumes = store.get('channelVolumes');
  volumes[channelName] = v;
  store.set('channelVolumes', volumes);
  applyChannelVolume(channelName);

  // 操作対象が現在ザッピング中のタイルなら、「ザッピングタイル」自体の音量としても保存しておく
  // （このchannelNameは次の切替でremoveChannelされ、channelVolumes側の値は消える想定のため）。
  if (channelName === currentZappingChannel) {
    store.set('zappingVolume', v);
  }
}

/**
 * 各タイルの自由配置・自由サイズ（比率で保存）に基づいて BrowserView の bounds を更新する。
 * タイルの矩形＝配信(+チャット)のBrowserViewの矩形そのもの（枠・タイトルバー等の余白は持たない）。
 * チャットを非表示にしているチャンネルは chatView をウィンドウから外し、配信を全幅で表示する。
 *
 * また、ドラッグ／リサイズ中（entry.chatSuppressed）は、チャットが表示設定のチャンネルであっても
 * 一時的に chatView を外して配信側だけを動かす。BrowserViewは1つ動かすだけでもコストが軽くないため、
 * 配信+チャットの2つを毎フレーム同時にリサイズするとカクつきが目立ったための負荷軽減策。
 * ドラッグ／リサイズ終了時（chatSuppressed=false に戻った時）に元の並びへ復帰する。
 */
/** 比率(rect)から実ピクセルの bounds を計算し、指定チャンネルの BrowserView に即時反映する（永続化はしない） */
function applyTileBoundsFromRect(channelName, rect) {
  const entry = streamViews.get(channelName);
  if (!entry || !mainWindow) return;
  const { height } = mainWindow.getContentBounds();
  const width = getUsableContentWidth();
  const usableHeight = height - HEADER_HEIGHT;
  if (usableHeight <= 0 || width <= 0) return;

  const outerW = Math.max(MIN_TILE_WIDTH, Math.round(rect.w * width));
  const outerH = Math.max(MIN_TILE_HEIGHT, Math.round(rect.h * usableHeight));
  const outerX = Math.round(rect.x * width);
  const outerY = HEADER_HEIGHT + Math.round(rect.y * usableHeight);
  // streamView（配信映像）の高さだけを情報帯の分縮める。chatViewの高さ・幅は変更しない。
  const streamH = Math.max(40, outerH - TILE_INFO_BAR_HEIGHT);

  const permanentlyHidden = isChatHidden(channelName);

  if (permanentlyHidden) {
    // 既に外れている場合にまで毎回removeBrowserViewを呼ぶと（特にリサイズ中は高頻度で
    // このメソッドが呼ばれるため）無駄なネイティブ呼び出しがガクつきの原因になるので、
    // アタッチ状態を見てから必要な時だけ呼ぶようにしている。
    if (!contentViewsHiddenForOverlay && isViewAttached(entry.chatView)) {
      try {
        mainWindow.removeBrowserView(entry.chatView);
      } catch (_) {
        /* 既に外れている場合は無視 */
      }
    }
    entry.streamView.setBounds({ x: outerX, y: outerY, width: outerW, height: streamH });
    notifyRenderer('tile:bar-bounds', {
      channel: channelName,
      x: outerX,
      y: outerY + streamH,
      width: outerW,
      height: TILE_INFO_BAR_HEIGHT,
    });
    return;
  }

  const chatW = Math.min(280, Math.floor(outerW * 0.28));
  const streamW = Math.max(40, outerW - chatW);
  entry.streamView.setBounds({ x: outerX, y: outerY, width: streamW, height: streamH });
  notifyRenderer('tile:bar-bounds', {
    channel: channelName,
    x: outerX,
    y: outerY + streamH,
    width: streamW,
    height: TILE_INFO_BAR_HEIGHT,
  });

  if (entry.chatSuppressed) {
    // ドラッグ/リサイズ中の負荷軽減：チャット欄の再配置はスキップし、いったん画面から外す
    if (!contentViewsHiddenForOverlay && isViewAttached(entry.chatView)) {
      try {
        mainWindow.removeBrowserView(entry.chatView);
      } catch (_) {
        /* 既に外れている場合は無視 */
      }
    }
    return;
  }

  if (!contentViewsHiddenForOverlay && !isViewAttached(entry.chatView)) {
    try {
      mainWindow.addBrowserView(entry.chatView);
    } catch (_) {
      /* 既に追加済みの場合は無視 */
    }
  }
  entry.chatView.setBounds({ x: outerX + (outerW - chatW), y: outerY, width: chatW, height: outerH });
}

/** チャンネルの「チャット画面を表示しない」設定を切り替える（表示するチャンネルはユーザーが個別に選べる） */
function setChatHidden(channelName, hidden) {
  if (!streamViews.has(channelName)) return;
  const map = store.get('chatHidden');
  map[channelName] = !!hidden;
  store.set('chatHidden', map);
  sendEdgeConfig(channelName);
  relayoutStreamViews();
}

/**
 * #7対応: チャット統合パネル（タブ/全タブ統合）の表示対象からチャンネルを除外するかどうかを切り替える。
 * setChatHiddenと違い、これは統合パネル側の絞り込みだけなのでBrowserView（タイル個別チャット埋め込み）
 * の再レイアウトは不要。実際のフィルタ処理はrenderer.js側（appendTimelineMessage呼び出し前）で行う。
 */
function setChatIntegrationHidden(channelName, hidden) {
  const map = store.get('chatIntegrationHidden');
  if (hidden) {
    map[channelName] = true;
  } else {
    delete map[channelName];
  }
  store.set('chatIntegrationHidden', map);
}

function relayoutStreamViews() {
  if (!mainWindow) return;
  const order = store.get('channelOrder').filter((c) => streamViews.has(c));
  streamViews.forEach((_v, c) => {
    if (!order.includes(c)) order.push(c);
  });
  if (order.length === 0) return;

  order.forEach((channelName) => {
    if (!streamViews.has(channelName)) return;
    const rect = ensureTileLayout(channelName);
    applyTileBoundsFromRect(channelName, rect);
  });
}

/** 全タイルを現在のチャンネル数に応じたレイアウトへ一括リセットする（自由配置が崩れた時の避難ボタン用）。
 *  2026-08-08: 中身をcomputeAutoGridRects（均等グリッドのみ）からcomputeTemplateRects
 *  （1〜9枚の見栄え重視テンプレート、10枚以上は従来の均等グリッドにフォールバック）へ置き換え。 */
function autoArrangeAllTiles() {
  const order = store.get('channelOrder').filter((c) => streamViews.has(c));
  streamViews.forEach((_v, c) => {
    if (!order.includes(c)) order.push(c);
  });
  const rects = computeTemplateRects(order.length);
  const layouts = {};
  order.forEach((c, i) => {
    layouts[c] = rects[i];
  });
  store.set('tileLayouts', layouts);
  relayoutStreamViews();
}

/**
 * ドラッグ／リサイズ中のライブプレビュー用。mousemove毎に呼ばれる想定のため、
 * electron-storeへの書き込み（ディスクI/O）は行わず、BrowserViewの見た目だけを即時追従させる。
 */
function previewTileLayout(channelName, rect) {
  applyTileBoundsFromRect(channelName, rect);
}

/** ドラッグ／リサイズ確定（mouseup）時に呼ばれる。比率を永続化する。 */
function commitTileLayout(channelName, rect) {
  if (!streamViews.has(channelName)) return;
  const layouts = store.get('tileLayouts');
  layouts[channelName] = rect;
  store.set('tileLayouts', layouts);
  relayoutStreamViews();
}

/** ドラッグ開始時などにタイルを最前面に持ってくる（重なり配置を許容するウィンドウマネージャー方式のため） */
function bringTileToFront(channelName) {
  const entry = streamViews.get(channelName);
  if (!entry || !mainWindow) return;
  try {
    if (typeof mainWindow.setTopBrowserView === 'function') {
      mainWindow.setTopBrowserView(entry.streamView);
      mainWindow.setTopBrowserView(entry.chatView);
    }
  } catch (_) {
    /* 古いElectronバージョン等でAPIが無い場合は無視 */
  }
}

/**
 * タイルのドラッグ移動／端リサイズ（要望②③）。
 * 配信・チャットのBrowserViewに注入したプリロード（tileInteractionPreload.js）が
 * mousedown/mousemove/mouseup を検知してIPCで通知してくるので、実際の位置計算はここで行う。
 * 当初はsetIntervalでscreen.getCursorScreenPoint()をポーリングしていたが、
 * Node側タイマーの精度・処理負荷でドラッグがカクつく（ガクガクする）問題があったため、
 * 実際のmousemoveイベント（screenX/screenY）にそのまま追従する方式に変更した
 * （送信側は requestAnimationFrame で1フレーム1回に間引き済み）。
 */
let interactionSession = null; // { channel, type, dir, startCursor, startRect, currentRect }

/** 配信側/チャット側それぞれで有効な「リサイズ対象の辺」を返す。チャットはタイル内部の右側固定表示のため左端は対象外。 */
function edgeConfigFor(channelName, target) {
  if (target === 'chat') {
    return { top: true, bottom: true, left: false, right: true };
  }
  return { top: true, bottom: true, left: true, right: isChatHidden(channelName) };
}

/** プリロードへ「今どの辺が有効か」を送る（初回・チャット非表示切替時・ページ再読み込み後に呼ぶ） */
function sendEdgeConfig(channelName) {
  const entry = streamViews.get(channelName);
  if (!entry) return;
  try {
    entry.streamView.webContents.send('tile-edge-config', {
      channel: channelName,
      target: 'stream',
      edges: edgeConfigFor(channelName, 'stream'),
    });
  } catch (_) {
    /* ビュー破棄後などは無視 */
  }
  try {
    entry.chatView.webContents.send('tile-edge-config', {
      channel: channelName,
      target: 'chat',
      edges: edgeConfigFor(channelName, 'chat'),
    });
  } catch (_) {
    /* ビュー破棄後などは無視 */
  }
}

function startTileInteraction(channelName, type, dir, screenX, screenY, origin) {
  const entry = streamViews.get(channelName);
  if (!entry || !mainWindow) return;
  stopTileInteraction(); // 多重開始の保険
  const rect = ensureTileLayout(channelName);
  bringTileToFront(channelName);

  // ドラッグ/リサイズ中はチャット欄の再配置コストを避けるため一時的に非表示にすることで
  // 負荷を下げる。ただし、そのドラッグ操作自体がチャット側のBrowserView内で始まった場合は
  // チャット側を外すとmousemove/mouseupが届かなくなり操作が続行できなくなるため、
  // 配信側からドラッグが始まった時だけ抑制する。
  if (origin !== 'chat' && !isChatHidden(channelName)) {
    entry.chatSuppressed = true;
  }

  interactionSession = {
    channel: channelName,
    type,
    dir: dir || '',
    startCursor: { x: screenX, y: screenY },
    startRect: { ...rect },
    currentRect: { ...rect },
  };
}

/** 実際のmousemove（screenX/screenY）が届くたびに呼ばれる。setIntervalによるポーリングは行わない。 */
function updateTileInteraction(screenX, screenY) {
  if (!interactionSession || !mainWindow) return;
  const { channel, type, dir, startCursor, startRect } = interactionSession;
  const { height } = mainWindow.getContentBounds();
  const width = getUsableContentWidth();
  const usableHeight = height - HEADER_HEIGHT;
  if (usableHeight <= 0 || width <= 0) return;

  const dxFrac = (screenX - startCursor.x) / width;
  const dyFrac = (screenY - startCursor.y) / usableHeight;
  const minWFrac = MIN_TILE_WIDTH / width;
  const minHFrac = MIN_TILE_HEIGHT / usableHeight;

  let rect = { ...startRect };
  if (type === 'move') {
    rect.x = Math.min(Math.max(startRect.x + dxFrac, 0), Math.max(0, 1 - startRect.w));
    rect.y = Math.min(Math.max(startRect.y + dyFrac, 0), Math.max(0, 1 - startRect.h));
  } else {
    if (dir.includes('e')) {
      rect.w = Math.max(minWFrac, Math.min(startRect.w + dxFrac, 1 - startRect.x));
    }
    if (dir.includes('w')) {
      const newX = Math.min(Math.max(startRect.x + dxFrac, 0), startRect.x + startRect.w - minWFrac);
      rect.w = startRect.w + (startRect.x - newX);
      rect.x = newX;
    }
    if (dir.includes('s')) {
      rect.h = Math.max(minHFrac, Math.min(startRect.h + dyFrac, 1 - startRect.y));
    }
    if (dir.includes('n')) {
      const newY = Math.min(Math.max(startRect.y + dyFrac, 0), startRect.y + startRect.h - minHFrac);
      rect.h = startRect.h + (startRect.y - newY);
      rect.y = newY;
    }
  }
  interactionSession.currentRect = rect;
  previewTileLayout(channel, rect);
}

/** ドラッグ/リサイズ終了。実際に動きがあった場合のみ永続化する（クリックのみの誤発火を無害化するため）。 */
function stopTileInteraction() {
  if (!interactionSession) return;
  const { channel, startRect, currentRect } = interactionSession;
  interactionSession = null;
  const entry = streamViews.get(channel);
  if (!entry) return;

  entry.chatSuppressed = false; // 一時的に外していたチャットを元に戻す

  const moved =
    Math.abs(currentRect.x - startRect.x) > 0.0005 ||
    Math.abs(currentRect.y - startRect.y) > 0.0005 ||
    Math.abs(currentRect.w - startRect.w) > 0.0005 ||
    Math.abs(currentRect.h - startRect.h) > 0.0005;

  if (moved) {
    commitTileLayout(channel, currentRect); // 内部で relayoutStreamViews まで呼ばれる
  } else {
    applyTileBoundsFromRect(channel, currentRect); // 動きが無くてもチャット再表示は反映する
  }
}

/**
 * Drops インベントリページをアプリ内の専用ウィンドウ（BrowserView）に、
 * 実ページのまま描画する（方法A採用: 外枠のみオリジナル化、ページ内部はTwitch本家のまま）。
 * DOM読み取りによる進捗抽出は「確認操作をした時だけ」呼び出すオンデマンド設計とし、
 * 常時監視のポーリングは行わない。
 */
function ensureDropsView() {
  if (dropsView) return dropsView;

  dropsView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: true, partition: PLATFORM_CONFIG.twitch.partition },
  });
  forwardEscapeKey(dropsView.webContents);
  mainWindow.addBrowserView(dropsView);
  dropsView.webContents.loadURL('https://www.twitch.tv/drops/inventory').catch((err) => {
    if (isBenignNavigationError(err)) return;
    notifyRenderer('drops:load-error', { message: String(err) });
  });
  relayoutDropsView();
  return dropsView;
}

function relayoutDropsView() {
  if (!dropsView || !mainWindow) return;
  const { height } = mainWindow.getContentBounds();
  // 依頼#15でDropsハブパネルをサイドパネルとして開けるようにしたため、タイルBrowserView同様に
  // 開いているサイドパネル分だけ幅を縮めてパネルと重ならないようにする（getUsableContentWidth参照）。
  const usableWidth = getUsableContentWidth();
  dropsView.setBounds({ x: 0, y: HEADER_HEIGHT, width: usableWidth, height: height - HEADER_HEIGHT });
}

function hideDropsView() {
  if (!dropsView || !mainWindow) return;
  const view = dropsView;
  try {
    mainWindow.removeBrowserView(view);
  } catch (_) {
    /* 既に外れている場合などは無視 */
  }
  try {
    view.webContents.loadURL('about:blank');
  } catch (_) {
    /* ignore */
  }
  scheduleWebContentsDestroy(view.webContents);
  dropsView = null;
  if (!contentViewsHiddenForOverlay) relayoutStreamViews();
}

/**
 * Kick版「Drops & 報酬」ページ（インベントリ）をアプリ内の専用ウィンドウ（BrowserView）に、
 * 実ページのまま描画する（Twitchの Drops インベントリ表示と同じ方式）。
 * KickのDrops進捗はTwitchとDOM構造が異なり非公式スクレイプの対応コストが見合わないため、
 * v1では「実ページをそのまま開ける」ところまでとし、進捗の自動読み取りは行わない。
 * persist:kickパーティションを使うため、配信タイル視聴やチャット統合で既にkick.comに
 * ログイン済みであれば、ここでもログイン状態が引き継がれた状態で表示される。
 */
function ensureKickDropsView() {
  if (kickDropsView) return kickDropsView;

  kickDropsView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: true, partition: KICK_PARTITION },
  });
  forwardEscapeKey(kickDropsView.webContents);
  mainWindow.addBrowserView(kickDropsView);
  kickDropsView.webContents.loadURL('https://kick.com/drops/inventory').catch((err) => {
    if (isBenignNavigationError(err)) return;
    notifyRenderer('kick-drops:load-error', { message: String(err) });
  });
  relayoutKickDropsView();
  return kickDropsView;
}

function relayoutKickDropsView() {
  if (!kickDropsView || !mainWindow) return;
  const { height } = mainWindow.getContentBounds();
  // Twitch Drops側と同様、Dropsハブパネル（サイドパネル）分だけ幅を縮める。
  const usableWidth = getUsableContentWidth();
  kickDropsView.setBounds({ x: 0, y: HEADER_HEIGHT, width: usableWidth, height: height - HEADER_HEIGHT });
}

function hideKickDropsView() {
  if (!kickDropsView || !mainWindow) return;
  const view = kickDropsView;
  try {
    mainWindow.removeBrowserView(view);
  } catch (_) {
    /* 既に外れている場合などは無視 */
  }
  try {
    view.webContents.loadURL('about:blank');
  } catch (_) {
    /* ignore */
  }
  scheduleWebContentsDestroy(view.webContents);
  kickDropsView = null;
  if (!contentViewsHiddenForOverlay) relayoutStreamViews();
}

/**
 * Drops進捗の「確認操作」トリガー。DOM読み取り方式（企画合意事項）。
 * ページを丸ごと描画し終えている前提で、進捗バー要素をスクレイプする。
 * 非公式手法のため、Twitch側のDOM構造変更で動かなくなる可能性がある点に注意。
 */
async function readDropsProgress() {
  const view = ensureDropsView();
  await view.webContents.executeJavaScript('new Promise(r => { if (document.readyState === "complete") r(); else window.addEventListener("load", r); })');

  const script = `
    (function () {
      const cards = Array.from(document.querySelectorAll('[data-test-selector="drops-campaign-details__progress-description"], .tw-progress-bar'));
      const results = [];
      document.querySelectorAll('[class*="progress-bar"]').forEach((el) => {
        const label = el.getAttribute('aria-valuenow');
        if (label !== null) {
          results.push({
            valueNow: el.getAttribute('aria-valuenow'),
            valueMax: el.getAttribute('aria-valuemax'),
            text: el.closest('div')?.innerText?.slice(0, 200) || '',
          });
        }
      });
      return { count: results.length, items: results, scrapedAt: Date.now() };
    })();
  `;

  try {
    return await view.webContents.executeJavaScript(script);
  } catch (err) {
    return { error: String(err) };
  }
}

// ---- アカウント連携（方式B: 専用ログイン + セッション共有） ----

/**
 * 指定プラットフォームのログイン画面をアプリ内に表示する（実ページそのまま）。
 * 配信タイル・Dropsと同じ永続パーティションを使うため、ここでログインすれば
 * 以後追加するタイルにも自動的にログイン状態が引き継がれる。
 */
// Kickは方式B（PLATFORM_CONFIG経由の専用ログインUI・Cookie有無でのログイン状態判定）の対象外
// （アカウント連携自体はOAuth 2.1 + PKCEの別方式で行うため）。ただし、チャット統合パネルで
// 使っているkick.com/popout/{channel}/chatページはOAuthトークンではなく実際のkick.com自体の
// Cookieセッションが無いとメッセージを送信できないため、persist:kickパーティションに対して
// 実サイトへブラウザログインするための最小限の設定だけここに用意する
// （domCheckScript等のログイン状態自動判定は行わない＝ボタンはいつでも押せる）。
const KICK_SITE_LOGIN_CFG = { partition: KICK_PARTITION, loginUrl: 'https://kick.com/' };

function openAccountLogin(platform) {
  const cfg = platform === 'kick' ? KICK_SITE_LOGIN_CFG : PLATFORM_CONFIG[platform];
  if (!cfg || !mainWindow) return;
  if (accountLoginView) closeAccountLogin();

  accountLoginView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: true, partition: cfg.partition },
  });
  forwardEscapeKey(accountLoginView.webContents);
  accountLoginPlatform = platform;
  mainWindow.addBrowserView(accountLoginView);
  accountLoginView.webContents.loadURL(cfg.loginUrl).catch((err) => {
    if (isBenignNavigationError(err)) return;
    notifyRenderer('account:load-error', { platform, message: String(err) });
  });
  relayoutAccountLoginView();
}

function relayoutAccountLoginView() {
  if (!accountLoginView || !mainWindow) return;
  const { width, height } = mainWindow.getContentBounds();
  accountLoginView.setBounds({ x: 0, y: HEADER_HEIGHT, width, height: height - HEADER_HEIGHT });
}

function closeAccountLogin() {
  if (!accountLoginView || !mainWindow) return;
  const view = accountLoginView;
  try {
    mainWindow.removeBrowserView(view);
  } catch (_) {
    /* 既に外れている場合などは無視 */
  }
  try {
    view.webContents.loadURL('about:blank');
  } catch (_) {
    /* ignore */
  }
  scheduleWebContentsDestroy(view.webContents);
  accountLoginView = null;
  accountLoginPlatform = null;
  // 設定パネル等のオーバーレイ表示中（配信ビューを意図的に外している間）は
  // ここで再配置してしまうと不要な処理になるため、外していない時だけ再配置する
  if (!contentViewsHiddenForOverlay) relayoutStreamViews();
}

/** Cookieの有無による軽量なログイン状態の一次判定（高速だが「おそらく」レベルの精度） */
async function checkCookieStatus(platform) {
  const cfg = PLATFORM_CONFIG[platform];
  if (!cfg) return 'unknown';
  try {
    const cookies = await session
      .fromPartition(cfg.partition)
      .cookies.get({ domain: cfg.cookieDomain, name: cfg.cookieName });
    return cookies.length > 0 ? 'connected' : 'disconnected';
  } catch (_) {
    return 'unknown';
  }
}

/**
 * 「ログイン状況確認」ボタン押下時のみ実行するDOM二次確認（正確だが重い・非公式）。
 * 現在ログイン画面を開いている最中ならそのビューを使い、そうでなければ
 * 画面に表示しない一時的なBrowserViewを作って確認後に破棄する。
 */
async function verifyPlatformDom(platform) {
  const cfg = PLATFORM_CONFIG[platform];
  if (!cfg) return 'unknown';

  const reuseExisting = accountLoginView && accountLoginPlatform === platform;
  const view =
    reuseExisting
      ? accountLoginView
      : new BrowserView({ webPreferences: { contextIsolation: true, sandbox: true, partition: cfg.partition } });

  try {
    if (!reuseExisting) {
      await view.webContents.loadURL(cfg.domCheckUrl);
    }
    await view.webContents.executeJavaScript(
      'new Promise(r => { if (document.readyState === "complete") r(); else window.addEventListener("load", r); })'
    );
    const loggedIn = await view.webContents.executeJavaScript(cfg.domCheckScript);
    return loggedIn ? 'connected' : 'disconnected';
  } catch (_) {
    return 'unknown';
  } finally {
    // 使い回し中（ログイン画面表示中）のビューはここで破棄しない。それ以外の使い捨てビューのみ、
    // 猶予を置いて明示的に破棄する（長時間の使用でメモリが増え続ける問題への対応）。
    if (!reuseExisting) scheduleWebContentsDestroy(view.webContents, { alreadyLoaded: true });
  }
}

// 広告自動ミュート機能は削除済み（ユーザー指示）。

// ---- Twitch Helix API（エモート/スタンプ一覧取得。無料のClient Credentials方式） ----
// スタンプ一覧カスタム機能（お気に入り整理等）は「クライアント側のローカル設定保存のみ」という
// 企画資料の方針どおり、取得したエモート一覧に対する「お気に入り」フラグはローカルにのみ保存する。

function httpsRequestJson(urlStr, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(data || '{}') });
          } catch (e) {
            resolve({ status: res.statusCode, json: null, raw: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * application/x-www-form-urlencoded なPOSTリクエスト用のヘルパー。
 * KickのOAuthトークンエンドポイント（id.kick.com/oauth/token）はRFC 6749準拠のフォームエンコード
 * ボディを期待するため、httpsRequestJson（application/json固定）とは別に用意する。
 */
function httpsPostForm(urlStr, formData) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const payload = new URLSearchParams(formData).toString();
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(data || '{}') });
          } catch (e) {
            resolve({ status: res.statusCode, json: null, raw: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ---- YouTube Data API v3（チャンネルのハンドル→内部チャンネルID解決専用。無料枠のAPIキーが必要） ----
// YouTubeの埋め込みライブ配信（youtube.com/embed/live_stream?channel=<ID>）は動画IDではなく
// 「UCから始まる内部チャンネルID」を必要とするため、ユーザーが入力するハンドル（@name）や
// チャンネル名からこれを解決する。channels.list(forHandle)がヒットしない場合は
// search.list（キーワード検索）にフォールバックする。

/** 入力文字列が既に内部チャンネルID形式（UC + 22文字）かどうか */
function looksLikeYoutubeChannelId(input) {
  return /^UC[\w-]{22}$/.test(input);
}

/**
 * youtube.com の各種URL形式から、以降の解決処理に使える手がかりを取り出す。
 * 対応: /channel/UC...（チャンネルID直接） / @handle または /@handle（ハンドル）
 *       /watch?v=VIDEO_ID（動画URL。channelIdはvideos.list APIで別途解決が必要）
 *       /c/カスタム名, /user/ユーザー名（レガシー形式。search.listフォールバックに委ねる）
 * URL形式でなければそのまま返す（従来通りハンドル/チャンネル名として扱う）。
 */
function parseYoutubeInput(raw) {
  const input = raw.trim();

  // スキーム省略（"youtube.com/watch?v=..."）やパス部分のみの貼り付け（"watch?v=..."）でも
  // 拾えるよう、まずURL解析に頼らず動画ID（11文字の英数字+-_）を正規表現で直接探す。
  // youtu.be短縮URLもここで拾う。
  const vParamMatch = input.match(/[?&]v=([\w-]{11})(?:[&#]|$)/);
  if (vParamMatch) return { kind: 'video', value: vParamMatch[1] };
  const shortLinkMatch = input.match(/youtu\.be\/([\w-]{11})/i);
  if (shortLinkMatch) return { kind: 'video', value: shortLinkMatch[1] };

  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input.replace(/^\/+/, '')}`;
  try {
    const url = new URL(withScheme);
    if (!/(^|\.)youtube\.com$|^youtu\.be$/i.test(url.hostname)) return { kind: 'text', value: input };
    const channelMatch = url.pathname.match(/^\/channel\/([\w-]+)/);
    if (channelMatch) return { kind: 'text', value: channelMatch[1] };
    const handleMatch = url.pathname.match(/^\/(@[\w.-]+)/);
    if (handleMatch) return { kind: 'text', value: handleMatch[1] };
    const legacyMatch = url.pathname.match(/^\/(?:c|user)\/([\w.-]+)/);
    if (legacyMatch) return { kind: 'text', value: legacyMatch[1] };
    return { kind: 'text', value: input };
  } catch {
    return { kind: 'text', value: input };
  }
}

// ---- ハンドル/チャンネル名から「現在配信中の動画ID」を、YouTube Data API（有料/クォータ消費あり）
// を使わずに解決する（無料・APIキー不要）。
// 当初 youtube.com/@handle/live へのアクセスが配信中ならHTTPリダイレクトされる挙動を想定していたが、
// 実機検証の結果、現在のYouTubeはこのページを常に200 OKで返し、ページ内に埋め込まれたJSON
// （"isLiveNow":true、canonicalリンクのwatch?v=...）で判定する必要があることが分かった。
// そのためHTMLを取得し、そこから isLiveNow フラグと動画IDを正規表現で抜き出す方式にしている。
// DOM scraping同様、YouTube側の仕様変更で効かなくなる可能性がある非公式ヒューリスティックである点は
// 注記モーダルの開示範囲と同じ位置づけ。

/** 指定URLのHTML本文を取得する（リダイレクトは念のため数回まで追従） */
function fetchHtml(startUrl, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const visit = (currentUrl, remaining) => {
      let parsed;
      try {
        parsed = new URL(currentUrl);
      } catch (err) {
        reject(err);
        return;
      }
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (remaining <= 0) {
              reject(new Error('リダイレクトが多すぎます'));
              return;
            }
            visit(new URL(res.headers.location, currentUrl).toString(), remaining - 1);
            return;
          }
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => resolve(data));
        }
      );
      req.on('error', reject);
      req.end();
    };
    visit(startUrl, maxRedirects);
  });
}

/**
 * html文字列中のmarker直後にある最初の "{" から、文字列リテラル・エスケープを考慮した
 * 波カッコの対応を数えて、バランスの取れた1つのJSONオブジェクトだけを切り出しparseする。
 * 正規表現だけでは「どこからどこまでが1つのJSONオブジェクトか」を正しく区切れない
 * （ネストしたオブジェクトや文字列中の"{"等がある）ため、YouTubeページに埋め込まれた
 * ytInitialPlayerResponseのような巨大なJSONを安全に取り出すために使う。
 */
function extractBalancedJsonAfter(html, marker) {
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;
  const start = html.indexOf('{', markerIdx + marker.length);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * ハンドル（@name）またはチャンネルID（UC...）から、現在配信中の動画IDを無料で解決する。
 * ページ内の "isLiveNow":true フラグが無ければ「配信中ではない」としてエラーにする。
 *
 * #14対応（元依頼: 「@ハンドルで追加時、ライブ予定枠(スケジュール済み配信)が既にある場合に
 * 配信が読み込まれない」）:
 * 修正前は`"isLiveNow":true`をhtml全文に対してノースコープで正規表現検索していたため、
 * チャンネルに「配信予定（まだ開始していないプレミア公開等）」の枠があるページを開いた場合、
 * ページ内の無関係な箇所（関連動画欄・チャンネル内の別動画のカード等）に偶然存在する
 * `isLiveNow:true`にヒットしてチェックを通過してしまい、続くcanonicalMatch/videoIdMatchで
 * 「このページ自体が指している配信予定（未開始）の動画ID」を「配信中」と誤認して返して
 * しまうことがあった。埋め込みプレイヤーは開始前の待機画面をロードするだけになるため、
 * ユーザーからは「配信が読み込まれない」ように見える。
 * 修正後は、ページに埋め込まれた ytInitialPlayerResponse という1つのJSONオブジェクトだけを
 * 切り出し、その中の videoDetails.videoId と
 * microformat.playerMicroformatRenderer.liveBroadcastDetails.isLiveNow
 * （どちらも「このページが表示している動画」自身の情報）を突き合わせてから判定する。
 * この抽出に失敗した場合（YouTube側のページ構造変化等）は、従来のページ全文検索
 * ヒューリスティックにフォールバックする。
 */
async function resolveYoutubeLiveVideoIdFree(handleOrChannelId) {
  const input = String(handleOrChannelId || '').trim();
  const liveUrl = looksLikeYoutubeChannelId(input)
    ? `https://www.youtube.com/channel/${encodeURIComponent(input)}/live`
    : `https://www.youtube.com/${encodeURIComponent(input.startsWith('@') ? input : `@${input}`)}/live`;
  const html = await fetchHtml(liveUrl);

  const playerResponse = extractBalancedJsonAfter(html, 'ytInitialPlayerResponse');
  if (playerResponse) {
    const videoId = playerResponse.videoDetails && playerResponse.videoDetails.videoId;
    const liveBroadcastDetails =
      playerResponse.microformat &&
      playerResponse.microformat.playerMicroformatRenderer &&
      playerResponse.microformat.playerMicroformatRenderer.liveBroadcastDetails;
    if (videoId && liveBroadcastDetails) {
      if (liveBroadcastDetails.isLiveNow === true) return videoId;
      // startTimestampはあるがendTimestampが無い＝配信予定（まだ開始前）である可能性が高い
      // （終了済みの過去配信はendTimestampが入る）。専用メッセージで区別する。
      const isUpcoming = !!liveBroadcastDetails.startTimestamp && !liveBroadcastDetails.endTimestamp;
      throw new Error(
        isUpcoming
          ? '現在配信中ではなく、配信予定（開始前）の状態のようです。配信が始まってから再度お試しください'
          : '現在配信中ではないようです（配信していないか、ハンドル/チャンネル名が正しくない可能性があります）'
      );
    }
    // videoDetails/liveBroadcastDetailsが期待通りの形で取れなかった場合は下の旧ロジックへフォールバック
  }

  if (!/"isLiveNow":\s*true/.test(html)) {
    throw new Error(
      '現在配信中ではないようです（配信していないか、ハンドル/チャンネル名が正しくない可能性があります）'
    );
  }
  const canonicalMatch = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
  if (canonicalMatch) return canonicalMatch[1];
  const videoIdMatch = html.match(/"videoId":"([\w-]{11})"/);
  if (videoIdMatch) return videoIdMatch[1];
  throw new Error('配信中の動画IDを特定できませんでした（YouTube側のページ構造が変わった可能性があります）');
}

/**
 * resolveYoutubeLiveVideoIdFreeのリトライ付き版。統一フィード/Auto Tune-Inのように多数のチャンネルを
 * 一括で都度HTTP確認する場面では、ネットワークの瞬断やYouTube側の一時的な応答遅延で「配信中なのに
 * 未配信と誤判定される」ことがあり、それが「一覧から消えたり出たりする」不安定さの原因になっていた。
 * 1回失敗しても間隔を空けて再試行することで誤判定の頻度を下げる（完全には無くならない前提）。
 */
async function resolveYoutubeLiveVideoIdFreeWithRetry(handleOrChannelId, retries = 1) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await resolveYoutubeLiveVideoIdFree(handleOrChannelId);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastErr;
}

/** addChannel後に非同期でYouTubeの現在配信中動画を無料で解決し、見つかり次第streamViewに読み込む */
async function loadYoutubeLiveStreamFree(streamView, channelName, handleOrChannelId) {
  try {
    const videoId = await resolveYoutubeLiveVideoIdFree(handleOrChannelId);
    // チャット統合パネル（showChatIntegrationTab）が同じ動画IDを使い回せるよう、
    // 解決結果をstreamViewsのエントリにも書き戻しておく（ハンドル追加時は当初nullのため）。
    const entry = streamViews.get(channelName);
    if (entry) entry.youtubeVideoId = videoId;
    // youtubeVideoIdが非同期解決された時点で全タブ統合側（syncYoutubeChatWatch等）に
    // 変化を伝える。これが無いと、ハンドル/チャンネル名で追加したYouTubeチャンネルは
    // 動画IDが後から判明しても統合チャットに反映されないままになる。
    notifyRenderer('channels:changed');
    const url = `http://127.0.0.1:${YOUTUBE_EMBED_SERVER_PORT}/embed?video=${encodeURIComponent(videoId)}`;
    await streamView.webContents.loadURL(url);
  } catch (err) {
    if (isBenignNavigationError(err)) return;
    notifyRenderer('channel:load-error', { channel: channelName, target: 'stream', message: String(err.message || err) });
  }
}

/**
 * 統一フィード（ロードマップ項目6）用: ログイン済みYouTubeアカウントの登録チャンネル一覧を取得する。
 * YouTube Data API（subscriptions.list）は使わず、既存ログイン連携（persist:youtubeセッション）を
 * 使ってyoutube.com/feed/channelsを裏読み込みしDOM scrapingする非公式・クォータ消費ゼロの方式。
 * Drops進捗確認・ログイン確認と同じ「非公式ヒューリスティック」の位置づけ（注記モーダルに開示）。
 * 常時ポーリングはせず、手動「更新」ボタン押下時のみ呼び出す。
 */
async function scrapeYoutubeSubscribedChannels() {
  if (!mainWindow) return [];
  const view = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: true, partition: PLATFORM_CONFIG.youtube.partition },
  });
  // ウィンドウには追加しない（addBrowserViewしない）一時ビューだが、bounds を明示的に設定しないと
  // 0x0のままになり、YouTube側のバーチャルスクロール（IntersectionObserverによる遅延描画）が
  // 一切発動せず一覧が空になったり不安定になったりする不具合があった（「読み込んだり読み込まなかったり
  // する」というフィードバックの原因）。実際に表示するわけではないが、十分大きいビューポートサイズを
  // 明示的に与えることで安定して描画されるようにする。
  view.setBounds({ x: 0, y: 0, width: 1280, height: 2000 });
  try {
    await view.webContents.loadURL('https://www.youtube.com/feed/channels');
    await view.webContents.executeJavaScript(
      'new Promise(r => { if (document.readyState === "complete") r(); else window.addEventListener("load", r); })'
    );
    // 一覧の遅延描画を待つ（実機確認で必要だった待機時間、他のDOM scraping箇所と同じ考え方）
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // 登録数が多い場合は初期表示分だけでは全件揃わないため、要素数が増えなくなるまで
    // 下端までのスクロールを数回繰り返し、遅延読み込み分も読み込ませる。
    await view.webContents.executeJavaScript(`
      (async function () {
        let lastCount = -1;
        for (let i = 0; i < 8; i++) {
          const count = document.querySelectorAll('ytd-channel-renderer').length;
          if (count > 0 && count === lastCount) break;
          lastCount = count;
          window.scrollTo(0, document.documentElement.scrollHeight);
          await new Promise((r) => setTimeout(r, 700));
        }
      })();
    `);
    const script = `
      (function () {
        var items = Array.from(document.querySelectorAll('ytd-channel-renderer'));
        var seen = {};
        var result = [];
        items.forEach(function (el) {
          try {
            var link = el.querySelector('#main-link') || el.querySelector('a[href^="/@"], a[href^="/channel/"]');
            var nameEl = el.querySelector('#channel-title') || el.querySelector('#text');
            var href = link ? link.getAttribute('href') : null;
            var name = nameEl ? nameEl.textContent.trim() : null;
            if (!href || !name || seen[href]) return;
            seen[href] = true;
            // アバター画像（配信チェックパネルのカード表示用、2026-08-08追加）。
            // YouTube側は遅延読み込みのため、src が空/1x1プレースホルダのことがある。その場合は
            // data-src へフォールバックする。取れなければ null のままにする（装飾要素なので
            // 取得できなくても一覧取得自体は成功扱い）。
            var avatarEl = el.querySelector('#avatar img, yt-img-shadow img, img');
            var avatarUrl = null;
            if (avatarEl) {
              var src = avatarEl.src || '';
              if (!src || src.indexOf('data:image/gif') === 0) src = avatarEl.getAttribute('data-src') || '';
              avatarUrl = src || null;
            }
            result.push({ href: href, name: name, avatarUrl: avatarUrl });
          } catch (e) {
            /* 1要素の解析失敗で一覧全体を落とさない */
          }
        });
        return result;
      })();
    `;
    const raw = await view.webContents.executeJavaScript(script);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        const href = String(item.href || '');
        let handle = null;
        if (href.startsWith('/@')) handle = href.slice(1); // "@xxx" の形のまま（addChannelの既存ハンドル形式と一致）
        else if (href.startsWith('/channel/')) handle = href.replace('/channel/', ''); // "UC..." チャンネルID
        return handle ? { handle, name: item.name, avatarUrl: item.avatarUrl || null } : null;
      })
      .filter(Boolean);
  } catch (err) {
    throw new Error(
      `登録チャンネル一覧の取得に失敗しました（未ログイン、またはYouTube側のページ構造変更の可能性）: ${String(err.message || err)}`
    );
  } finally {
    try {
      view.webContents.loadURL('about:blank');
    } catch (_) {
      /* ignore */
    }
    scheduleWebContentsDestroy(view.webContents);
  }
}

/** 配列を指定並列数で処理する（YouTubeの/live確認を都度HTTPで叩くため、直列連打・無制限並列の両方を避ける） */
async function mapWithConcurrency(items, limit, fn) {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const current = idx++;
      await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

const UNIFIED_FEED_YOUTUBE_MAX_CHECK = 60; // 登録チャンネル数が多い場合の確認上限（無料HTML確認を都度叩くため）
const UNIFIED_FEED_YOUTUBE_CONCURRENCY = 4;

/**
 * プラットフォーム横断の統一フィード（ロードマップ項目6）。
 * フォロー中/登録中チャンネルのうち現在配信中のものだけをまとめて返す。手動更新ボタン専用（常時ポーリングしない）。
 * - Twitch: 既存Auto Tune-In用ロジック（fetchFollowedLiveChannels、Helix API）をそのまま流用
 * - YouTube: 登録チャンネル一覧はDOM scraping（クォータ消費ゼロ）、配信中判定は既存の
 *   無料HTML確認方式（resolveYoutubeLiveVideoIdFree）を流用
 * どちらか一方の取得に失敗しても、もう一方の結果はそのまま返す（errorsに理由を格納）。
 */
/**
 * @param {{ includeKick?: boolean }} [options] includeKick=false の場合、KickチャンネルはBrowserView
 *   フルロードを伴い重いため取得をスキップする（統一フィードパネルを開いている間の自動更新ループ用。
 *   「チャンネルの一覧更新をもっと早く更新できるようにする」要望への対応で、Twitch/YouTube分だけを
 *   短い間隔で自動更新できるようにするためのオプション。手動更新ボタン・パネルを開いた直後の
 *   初回取得は常にKickも含めて取得する）。
 */
async function fetchUnifiedFeed(options = {}) {
  const includeKick = options.includeKick !== false;
  const items = [];
  const errors = {};

  await Promise.all([
    (async () => {
      try {
        const liveFollowed = await fetchFollowedLiveChannels();
        liveFollowed.forEach((s) => {
          items.push({
            platform: 'twitch',
            channel: s.login,
            displayName: s.login,
            viewerCount: s.viewerCount,
            avatarUrl: s.avatarUrl || null,
            alreadyAdded: streamViews.has(s.login),
            isTarget: isAutoTuneInTarget('twitch', s.login),
            isPinned: false,
            isLive: true,
            // 2026-08-08追加（複窓レイアウト設定ウィンドウのカード表示用）。Twitchのみ対応で、
            // YouTube/Kickは値を持たない（表示側では欠けているものを単に出さない扱い）。
            // 既存の配信チェックパネル側は参照しないため、増えても挙動は変わらない。
            title: s.title || '',
            category: s.gameName || '',
            startedAt: s.startedAt || null,
          });
        });
      } catch (err) {
        errors.twitch = String(err.message || err);
      }
    })(),
    (async () => {
      try {
        const subs = await scrapeYoutubeSubscribedChannels();
        const pinned = getFeedPinnedYoutubeChannels();
        const pinnedHandles = new Set(pinned.map((p) => p.channel.toLowerCase()));
        // 配信中のみ表示する通常チャンネル（ピン留め分は下で別途必ず表示するため、ここでは除外）
        const checkList = subs.filter((s) => !pinnedHandles.has(s.handle.toLowerCase())).slice(0, UNIFIED_FEED_YOUTUBE_MAX_CHECK);
        await mapWithConcurrency(checkList, UNIFIED_FEED_YOUTUBE_CONCURRENCY, async (sub) => {
          // 大文字小文字違いでの表記揺れも「追加済み」と判定できるようhasYoutubeChannel()を使う（#13対策）
          const alreadyAdded = hasYoutubeChannel(sub.handle);
          // 既にタイル追加済み＝配信中であることは実績として分かっているため、都度のネットワーク確認は
          // 省略する。ここで再確認すると、YouTube側の一時的な応答遅延などで「配信中ではない」と
          // 誤判定された時に、実際は視聴中のチャンネルが次の更新までフィードから消えてしまっていた
          // （ユーザー報告の不具合）。
          if (alreadyAdded) {
            items.push({
              platform: 'youtube',
              channel: sub.handle,
              displayName: sub.name,
              viewerCount: null,
              avatarUrl: sub.avatarUrl || null,
              alreadyAdded: true,
              isTarget: isAutoTuneInTarget('youtube', sub.handle),
              isPinned: false,
              isLive: true,
            });
            return;
          }
          try {
            await resolveYoutubeLiveVideoIdFreeWithRetry(sub.handle);
            items.push({
              platform: 'youtube',
              channel: sub.handle,
              displayName: sub.name,
              viewerCount: null,
              avatarUrl: sub.avatarUrl || null,
              alreadyAdded: false,
              isTarget: isAutoTuneInTarget('youtube', sub.handle),
              isPinned: false,
              isLive: true,
            });
          } catch (_) {
            // 配信中ではない、またはハンドル解決失敗（リトライ後も失敗）。フィードには含めないだけでエラー扱いにはしない
          }
        });

        // ピン留めチャンネルは、配信中かどうかに関わらず必ずフィードに表示する
        // （ユーザーが自分で外すまで表示し続ける、という要望への対応）。
        // 表示名は現在の登録一覧（subs）から拾えればそれを、拾えなければ保存時の名前を使う。
        const subsByHandle = new Map(subs.map((s) => [s.handle.toLowerCase(), s]));
        await mapWithConcurrency(pinned, UNIFIED_FEED_YOUTUBE_CONCURRENCY, async (p) => {
          const alreadyAdded = hasYoutubeChannel(p.channel);
          const displayName = subsByHandle.get(p.channel.toLowerCase())?.name || p.displayName;
          // ピン留め分は保存データに画像を持っていないため、現在の登録一覧から拾えた時だけアバターを付ける
          const avatarUrl = subsByHandle.get(p.channel.toLowerCase())?.avatarUrl || null;
          let isLive = alreadyAdded;
          if (!alreadyAdded) {
            try {
              await resolveYoutubeLiveVideoIdFreeWithRetry(p.channel);
              isLive = true;
            } catch (_) {
              isLive = false;
            }
          }
          items.push({
            platform: 'youtube',
            channel: p.channel,
            displayName,
            viewerCount: null,
            avatarUrl,
            alreadyAdded,
            isTarget: isAutoTuneInTarget('youtube', p.channel),
            isPinned: true,
            isLive,
          });
        });
      } catch (err) {
        errors.youtube = String(err.message || err);
      }
    })(),
    (async () => {
      if (!includeKick) return; // 自動更新ループ用の軽量取得時はKick（BrowserViewフルロード）を省略
      try {
        const followed = await fetchKickFollowedChannels();
        followed
          .filter((c) => c.isLive)
          .forEach((s) => {
            items.push({
              platform: 'kick',
              channel: s.channel,
              displayName: s.displayName,
              viewerCount: s.viewerCount,
              avatarUrl: s.avatarUrl || null,
              alreadyAdded: streamViews.has(s.channel),
              // KickはAuto Tune-In自体が未対応（60秒間隔ポーリングの重さ・Bot対策リスクを避けるため）。
              // 対象指定チェックボックスはTwitch/YouTube専用のためisTargetは常にfalse固定でよい。
              isTarget: false,
              isPinned: false,
              isLive: true,
              // 2026-08-08段階B追加（配信一覧カード表示用）。normalizeKickFollowedChannel()側で
              // 既に取得済みの値をそのまま渡すだけ（追加リクエストなし）。
              title: s.title || '',
              category: s.category || '',
              startedAt: s.startedAt || null,
            });
          });
      } catch (err) {
        errors.kick = String(err.message || err);
      }
    })(),
  ]);

  // 表示順: まずオンライン（配信中）を上に、その中では視聴者数の多い順
  // （YouTubeは視聴者数が取れないためnull=0扱い）。
  // 2026-08-08のカード表示化に伴い、旧仕様にあった「対象指定（自動追加チェック済み）を最優先」の
  // 並び替えは廃止した（チェックの有無で一覧の並びが入れ替わり分かりにくかったため）。
  items.sort((a, b) => {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return (b.viewerCount || 0) - (a.viewerCount || 0);
  });
  return { items, errors };
}

/**
 * 「全フォロー/登録一覧（オンライン・オフライン問わず）」。Auto Tune-Inの対象指定チェックボックス用。
 * フィードとは違い配信中判定はしない（一覧を出すだけ）ため、専用の「読み込む」ボタン押下時のみ呼ぶ。
 */
async function fetchAllFollowCandidates() {
  const items = [];
  const errors = {};

  await Promise.all([
    (async () => {
      try {
        const followed = await fetchAllFollowedTwitchChannels();
        followed.forEach((f) => {
          items.push({
            platform: 'twitch',
            channel: f.channel,
            displayName: f.displayName || f.channel,
            isTarget: isAutoTuneInTarget('twitch', f.channel),
            isPinned: false,
          });
        });
      } catch (err) {
        errors.twitch = String(err.message || err);
      }
    })(),
    (async () => {
      try {
        const subs = await scrapeYoutubeSubscribedChannels();
        subs.forEach((sub) => {
          items.push({
            platform: 'youtube',
            channel: sub.handle,
            displayName: sub.name,
            avatarUrl: sub.avatarUrl || null,
            isTarget: isAutoTuneInTarget('youtube', sub.handle),
            isPinned: isFeedPinnedYoutube(sub.handle),
          });
        });
      } catch (err) {
        errors.youtube = String(err.message || err);
      }
    })(),
  ]);

  items.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));
  return { items, errors };
}

let helixTokenCache = { token: null, expiresAt: 0 };

async function getHelixAppToken() {
  const clientId = store.get('helixClientId');
  const clientSecret = store.get('helixClientSecret');
  if (!clientId || !clientSecret) {
    throw new Error('Helix Client ID / Client Secret が未設定です。設定画面で入力してください（Twitch Developer Consoleで無料登録可能）。');
  }
  if (helixTokenCache.token && Date.now() < helixTokenCache.expiresAt) {
    return helixTokenCache.token;
  }
  const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`;
  const res = await httpsRequestJson(url, { method: 'POST' });
  if (res.status !== 200) throw new Error(`Helixトークン取得失敗: ${res.status} ${JSON.stringify(res.json)}`);
  helixTokenCache = {
    token: res.json.access_token,
    expiresAt: Date.now() + (res.json.expires_in - 60) * 1000,
  };
  return helixTokenCache.token;
}

async function getBroadcasterId(channelName) {
  const clientId = store.get('helixClientId');
  const token = await getHelixAppToken();
  const res = await httpsRequestJson(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(channelName)}`, {
    headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200 || !res.json.data?.length) {
    throw new Error(`チャンネル「${channelName}」が見つかりませんでした`);
  }
  return res.json.data[0].id;
}

// ---- 配信メタ情報（タイトル・カテゴリ・視聴者数）取得 ----
// タイル本体はプラットフォーム公式ページをそのまま読み込んだBrowserViewのため、その上に
// 直接HTMLを重ねて情報表示することはできない（BrowserViewは常にレンダラーHTMLより手前に
// 描画される、L253前後のコメント参照）。そのため、既存の音量ミキサー・クリップサムネ等と
// 同様に「BrowserViewに重ならないHTML領域」＝チャンネルチップ（#channel-chips）に、
// 視聴者数バッジ＋ツールチップ（タイトル・カテゴリ）という形で表示する方針にしている。

/** Twitchチャンネル複数分のタイトル・カテゴリ・視聴者数を1回のHelix呼び出し（最大100件）でまとめて取得する */
async function fetchTwitchStreamMeta(channelNames) {
  if (!channelNames.length) return {};
  const clientId = store.get('helixClientId');
  const token = await getHelixAppToken();
  const result = {};
  for (let i = 0; i < channelNames.length; i += 100) {
    const chunk = channelNames.slice(i, i + 100);
    const url = new URL('https://api.twitch.tv/helix/streams');
    chunk.forEach((name) => url.searchParams.append('user_login', name));
    url.searchParams.set('first', '100');
    const res = await httpsRequestJson(url.toString(), {
      headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
    });
    if (res.status !== 200) throw new Error(`Twitch配信メタ情報の取得に失敗しました: ${res.status}`);
    (res.json.data || []).forEach((s) => {
      result[s.user_login] = {
        title: s.title || '',
        gameName: s.game_name || '',
        viewerCount: Number(s.viewer_count) || 0,
        // Helixの started_at はISO8601（UTC）。配信経過時間のリアルタイム表示はrenderer側で
        // Date.now()との差分から毎秒計算する（この値自体は60秒間隔でしか更新しないが、
        // 開始時刻というほぼ不変の値なので実用上問題ない）。
        startedAt: s.started_at || null,
      };
    });
  }
  return result;
}

/**
 * Kickチャンネル1件分のタイトル・カテゴリ・視聴者数を取得する。resolveKickChatroomId（L3270〜）と
 * 同じ「隠しBrowserViewでkick.com自身を読み込み、その中からsame-origin fetch()する」方式
 * （Cloudflareのボット判定回避のため）。1件ごとにBrowserView生成が必要でコストが高いため、
 * 呼び出し側（fetchAllStreamMeta）で同時実行数を絞って呼ぶこと。
 */
async function fetchKickStreamMeta(channelName) {
  const view = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: true, partition: KICK_PARTITION },
  });
  try {
    await view.webContents.loadURL(`https://kick.com/${encodeURIComponent(channelName)}`);
    const result = await view.webContents.executeJavaScript(`
      fetch(${JSON.stringify(`https://kick.com/api/v2/channels/${channelName}`)}, { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); })
        .then(function (r) {
          var live = r.json && r.json.livestream;
          if (!live) return { ok: false, error: 'offline', status: r.status };
          var category = live.categories && live.categories[0] && live.categories[0].name;
          return {
            ok: true,
            title: live.session_title || '',
            gameName: category || '',
            viewerCount: Number(live.viewer_count) || 0,
            // created_at はkick.com自身のフロントエンドが配信経過時間表示に使っているのを
            // 参考にした非公式フィールド名（resolveKickChatroomId等と同じく、Kick側の仕様変更で
            // 効かなくなる可能性がある）。無い場合はnullのまま返し、呼び出し元で経過時間非表示にする。
            startedAt: live.created_at || null,
          };
        })
        .catch(function (e) { return { ok: false, error: String(e) }; });
    `);
    if (result && result.ok) {
      return {
        title: result.title,
        gameName: result.gameName,
        viewerCount: result.viewerCount,
        startedAt: result.startedAt,
      };
    }
    return null;
  } catch (err) {
    return null;
  } finally {
    scheduleWebContentsDestroy(view.webContents, { alreadyLoaded: true });
  }
}

/**
 * 現在タイルとして追加済みのチャンネル全部について、配信メタ情報（タイトル・カテゴリ・視聴者数）を
 * まとめて取得する（チップの視聴者数バッジ・ツールチップ表示用）。既存の「統一フィード」
 * （fetchUnifiedFeed、L2575〜）とは目的も取得経路も別物: 統一フィードはユーザーの
 * フォロー/登録一覧全体から「今ライブなのは誰か」をアカウント連携を前提に取得する重い処理だが、
 * こちらは既にタイル追加済みのチャンネルだけを対象にアカウント連携不要で軽く取る処理。
 * - Twitch: getHelixAppToken()（Client ID/Secretのみ、アカウント連携不要）が使えない場合は
 *   Twitch分のみ静かに空扱いにする（Kick/YouTubeには影響させない）
 * - Kick: BrowserView生成コストが高いため同時実行数を絞る（mapWithConcurrency）
 * - YouTube: Helixのような視聴者数・カテゴリを無料で返す公式APIが無いため今回のスコープ外
 *   （タイトルすら取得しない。チップ側は「対応チェック中」ではなく「非対応」表示にする）
 * 個別チャンネルの取得失敗はチャンネル単位で握りつぶし、該当キーを省略する
 * （呼び出し元でバッジ非表示にフォールバックする設計）。
 */
async function fetchAllStreamMeta() {
  const twitchChannels = [];
  const kickChannels = [];
  streamViews.forEach((entry, channel) => {
    if (entry.platform === 'kick') kickChannels.push(channel);
    else if (entry.platform !== 'youtube') twitchChannels.push(channel); // platform未設定は従来通りtwitch扱い
  });

  const result = {};

  if (twitchChannels.length) {
    try {
      const twitchMeta = await fetchTwitchStreamMeta(twitchChannels);
      Object.entries(twitchMeta).forEach(([login, meta]) => {
        result[login] = { ...meta, platform: 'twitch' };
      });
    } catch (err) {
      // Helix未設定・トークン取得失敗等。Twitch分だけ空のまま返す（Kick分の取得は継続する）
    }
  }

  if (kickChannels.length) {
    await mapWithConcurrency(kickChannels, 2, async (channel) => {
      const meta = await fetchKickStreamMeta(channel);
      if (meta) result[channel] = { ...meta, platform: 'kick' };
    });
  }

  return result;
}

/**
 * #6対応: 登録チャンネルの配信開始（オフライン→ライブへの遷移）を検知し、通知タブ用の
 * 履歴に積む。fetchAllStreamMeta()の戻り値（現在ライブなチャンネルのみキーとして存在。
 * YouTubeは対象外＝上のfetchAllStreamMetaのコメント参照）を元に、前回ポーリング時点の
 * 生存状態と比較する。
 * 「一度でも観測したか」をnotificationsKnownLiveMapのキーの有無で判定することで、
 * ①アプリ起動直後に既にライブだったチャンネル、②ユーザーが今まさにライブなチャンネルを
 * 手動追加した直後、のどちらも「今まさに配信開始した」とは扱わない
 * （初めて観測した回は記録のみで通知は出さない）。
 * channels:get-stream-meta のハンドラから、レスポンスを返す前に呼ぶ。
 */
function recordStreamStartNotifications(meta) {
  const currentLiveChannels = new Set(Object.keys(meta));
  const trackedChannels = new Set(streamViews.keys());
  const newlyLive = [];

  trackedChannels.forEach((channel) => {
    const isLive = currentLiveChannels.has(channel);
    const wasObserved = notificationsKnownLiveMap.has(channel);
    if (wasObserved && !notificationsKnownLiveMap.get(channel) && isLive) {
      newlyLive.push(channel);
    }
    notificationsKnownLiveMap.set(channel, isLive);
  });

  // 削除済みチャンネルのエントリはMapに残しても実害はないが、肥大化を避けるため掃除する。
  Array.from(notificationsKnownLiveMap.keys()).forEach((channel) => {
    if (!trackedChannels.has(channel)) notificationsKnownLiveMap.delete(channel);
  });

  if (!newlyLive.length) return;

  const list = store.get('streamStartNotifications');
  newlyLive.forEach((channel) => {
    const info = meta[channel] || {};
    list.push({
      id: `${Date.now()}-${channel}-${Math.random().toString(36).slice(2, 8)}`,
      channel,
      platform: info.platform || 'twitch',
      title: info.title || '',
      detectedAt: Date.now(),
    });
  });
  // 直近100件のみ保持（無限に増え続けないように）
  store.set('streamStartNotifications', list.slice(-100));
  notifyNotificationsStateChanged();
}

/** 通知タブの赤丸バッジを出すべきか（未読＝最後に開いた時刻より新しい通知がある）。 */
function hasUnreadNotifications() {
  const lastReadAt = store.get('streamStartNotificationsLastReadAt');
  return store.get('streamStartNotifications').some((n) => n.detectedAt > lastReadAt);
}

/** 自作メニューバー（renderer.js）の「通知」項目が必要とする状態一式。 */
function getNotificationsState() {
  return {
    items: store.get('streamStartNotifications'),
    hasUnread: hasUnreadNotifications(),
  };
}

/** notifications:state-changed をrendererへ送る（値が変わるあらゆる箇所から呼ぶ）。 */
function notifyNotificationsStateChanged() {
  notifyRenderer('notifications:state-changed', getNotificationsState());
}

/** 通知タブを開いた時に呼ぶ。既読時刻を更新してバッジを消す。 */
function markNotificationsRead() {
  store.set('streamStartNotificationsLastReadAt', Date.now());
  notifyNotificationsStateChanged();
}

/** 指定チャンネルのエモート一覧＋グローバルエモートを取得する */
async function fetchEmotesForChannel(channelName) {
  const clientId = store.get('helixClientId');
  const token = await getHelixAppToken();
  const broadcasterId = await getBroadcasterId(channelName);

  const [channelRes, globalRes] = await Promise.all([
    httpsRequestJson(`https://api.twitch.tv/helix/chat/emotes?broadcaster_id=${broadcasterId}`, {
      headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
    }),
    httpsRequestJson('https://api.twitch.tv/helix/chat/emotes/global', {
      headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
    }),
  ]);

  // emote_typeが'subscriptions'のものは、視聴者がそのチャンネルにサブスクしていないと
  // 実際には使えないTwitch公式のサブスク限定スタンプ（tierは1000/2000/3000のいずれか）。
  // それ以外（follower/bitstier/globals等）は無料で使えるスタンプとして扱う。
  const toEntry = (e, channel) => ({
    id: e.id,
    name: e.name,
    channel,
    imageUrl: e.images?.url_1x || e.images?.url_2x || '',
    emoteType: e.emote_type || '',
    tier: e.tier || '',
    subOnly: e.emote_type === 'subscriptions',
  });

  const channelEmotes = (channelRes.json?.data || []).map((e) => toEntry(e, channelName));
  const globalEmotes = (globalRes.json?.data || []).map((e) => toEntry(e, null));

  return { channelEmotes, globalEmotes };
}

/**
 * YouTubeにはTwitch Helixのような「チャンネル毎のスタンプ一覧」公式APIが無いため、
 * 現在配信中のライブチャット埋め込みページ（youtube.com/live_chat、@ハンドル追加と同じくAPIキー不要）を
 * 裏で読み込み、絵文字ピッカーを開いてそこに並ぶ画像を読み取る非公式の方式で代替する
 * （DOM scraping、YouTube側のUI変更で効かなくなる可能性がある）。
 * 現在配信中でない（動画IDが未解決の）チャンネルでは取得できない制約がある。
 */
async function fetchYoutubeEmotesForChannel(channelName) {
  const entry = streamViews.get(channelName);
  const videoId = entry?.youtubeVideoId;
  if (!videoId) {
    throw new Error(
      '現在配信中の動画が確認できていないため取得できません（配信中に追加したチャンネルでお試しください）'
    );
  }
  const parent = store.get('parentDomain');
  const view = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: true, partition: PLATFORM_CONFIG.youtube.partition },
  });
  try {
    await view.webContents.loadURL(
      `https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}&embed_domain=${encodeURIComponent(parent)}`
    );
    // チャット欄の初期化を待つ
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // ピッカーはカテゴリー毎に<yt-emoji-picker-category-renderer>が並ぶ構造で、
    // 先頭（0番目）は検索結果表示用の空プレースホルダー、2番目（1番目）がそのチャンネル固有の
    // スタンプ（メンバーシップ絵文字）一覧になっている（実機のDOM構造を実際に確認して特定した値）。
    const script = `(function () {
      var btn = document.querySelector('#emoji-picker-button button') ||
        document.querySelector('yt-live-chat-message-input-renderer #emoji-picker-button button');
      if (btn) btn.click();
      return new Promise(function (resolve) {
        setTimeout(function () {
          var picker = document.querySelector('yt-emoji-picker-renderer');
          if (!picker) { resolve([]); return; }
          var categories = picker.querySelectorAll('yt-emoji-picker-category-renderer');
          var channelCategory = categories[1];
          if (!channelCategory) { resolve([]); return; }
          var imgs = Array.from(channelCategory.querySelectorAll('img'));
          var seen = {};
          var result = [];
          imgs.forEach(function (img) {
            var alt = img.getAttribute('alt') || '';
            var src = img.getAttribute('src') || '';
            if (!alt || !src || seen[alt]) return;
            seen[alt] = true;
            result.push({ id: alt, name: alt, channel: null, imageUrl: src });
          });
          resolve(result);
        }, 1000);
      });
    })();`;
    const list = await view.webContents.executeJavaScript(script);
    return Array.isArray(list) ? list : [];
  } finally {
    try {
      view.webContents.loadURL('about:blank');
    } catch (_) {
      /* ignore */
    }
    scheduleWebContentsDestroy(view.webContents);
  }
}

function toggleFavoriteEmote(emote) {
  const favorites = store.get('favoriteEmotes');
  const idx = favorites.findIndex((f) => f.id === emote.id && f.channel === emote.channel);
  if (idx >= 0) {
    favorites.splice(idx, 1);
  } else {
    favorites.push(emote);
  }
  store.set('favoriteEmotes', favorites);
  return favorites;
}

// ---- Drops自動追加/削除 ----
// 対象ゲームを事前に指定しておくと、そのゲームを配信中のチャンネルを自動でタイルに追加/削除する。
// StreamSyncの「Auto Tune-In」を参考にした設計。Dropsキャンペーンが実際に有効かどうかは
// Helix APIでは判定できない（非公式手段が必要）ため、v1では「対象ゲームの配信中チャンネル」を
// 対象にする（企画メモに記載の既知の制約）。
// 自動追加したチャンネルは entry.autoAdded / entry.autoGame で手動追加分と区別し、
// 自動削除の対象は自動追加分のみに限定する（ユーザーが手動で追加したチャンネルは消さない）。

// 「チャンネルの一覧更新をもっと早く更新できるようにする」要望への対応で60秒→25秒に短縮。
// Twitch Helixのみを叩く処理（resolveGameId/fetchLiveStreamsForGame）でレート制限に対して
// 余裕が大きいこと、多重実行防止ロック（dropsAutoCheckRunning）が既にあるため間隔短縮による
// 多重起動の心配もないことを踏まえた値。
const DROPS_AUTO_INTERVAL_MS = 25 * 1000;
const gameIdCache = new Map(); // gameName(小文字) -> game_id

let dropsAutoTimer = null;
let dropsAutoCheckRunning = false; // 前回のチェックが完了する前に多重実行しないための簡易ロック
const dropsAutoLastErrorNotifiedAt = new Map(); // gameName -> timestamp（毎回通知してスパムにならないように）

/** ゲーム名からgame_idを取得する（Helix `/helix/games?name=`）。一度引いたら以後はキャッシュを使う。 */
async function resolveGameId(gameName) {
  const key = gameName.trim().toLowerCase();
  if (gameIdCache.has(key)) return gameIdCache.get(key);
  const clientId = store.get('helixClientId');
  const token = await getHelixAppToken();
  const res = await httpsRequestJson(`https://api.twitch.tv/helix/games?name=${encodeURIComponent(gameName.trim())}`, {
    headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200 || !res.json.data?.length) {
    throw new Error(`ゲーム「${gameName}」が見つかりませんでした`);
  }
  const gameId = res.json.data[0].id;
  gameIdCache.set(key, gameId);
  return gameId;
}

/** 指定game_idで現在配信中のチャンネルを視聴者数の多い順で取得する（最大100件） */
async function fetchLiveStreamsForGame(gameId) {
  const clientId = store.get('helixClientId');
  const token = await getHelixAppToken();
  const res = await httpsRequestJson(`https://api.twitch.tv/helix/streams?game_id=${encodeURIComponent(gameId)}&first=100`, {
    headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) {
    throw new Error(`配信一覧の取得に失敗しました: ${res.status}`);
  }
  return (res.json.data || [])
    .map((s) => ({ login: s.user_login, viewerCount: s.viewer_count || 0 }))
    .sort((a, b) => b.viewerCount - a.viewerCount);
}

/** 現在自動追加されていて、かつ指定ゲームに紐づいているチャンネル名一覧 */
function autoAddedChannelsForGame(gameName) {
  const result = [];
  streamViews.forEach((entry, channel) => {
    if (entry.autoAdded && entry.autoGame === gameName) result.push(channel);
  });
  return result;
}

/** Drops自動追加/削除の1サイクル。トラッキング対象ゲーム毎に配信中チャンネルを取得し、追加/削除を行う。 */
async function runDropsAutoCheck() {
  if (dropsAutoCheckRunning) return;
  const tracked = store.get('dropsAutoTrack');
  if (!tracked.length) return;
  dropsAutoCheckRunning = true;
  let changed = false;
  try {
    for (const { gameName, maxTiles } of tracked) {
      try {
        const gameId = await resolveGameId(gameName);
        const liveStreams = await fetchLiveStreamsForGame(gameId);
        const liveLogins = new Set(liveStreams.map((s) => s.login.toLowerCase()));

        // 配信が終了した自動追加チャンネルを削除
        autoAddedChannelsForGame(gameName).forEach((channel) => {
          if (!liveLogins.has(channel.toLowerCase())) {
            removeChannel(channel);
            changed = true;
          }
        });

        // 上限を後から引き下げた場合、既に自動追加済みのチャンネルはこれまで削除対象外だった
        // （削除条件が「配信終了」のみだったため）。上限超過分をここで間引く（実機フィードバックで発覚した不具合の修正）。
        const overCap = autoAddedChannelsForGame(gameName);
        if (overCap.length > (maxTiles || 0)) {
          const excess = overCap.length - (maxTiles || 0);
          overCap.slice(0, excess).forEach((channel) => {
            removeChannel(channel);
            changed = true;
          });
        }

        // 上限まで新規追加（既存の自動追加分でまだ配信中のものはそのままカウントに含める）
        const currentlyAutoCount = autoAddedChannelsForGame(gameName).length;
        const slotsLeft = Math.max(0, (maxTiles || 0) - currentlyAutoCount);
        if (slotsLeft > 0) {
          const candidates = liveStreams
            .map((s) => s.login)
            .filter((login) => !streamViews.has(login));
          candidates.slice(0, slotsLeft).forEach((login) => {
            addChannel(login, { auto: true, autoGame: gameName });
            changed = true;
          });
        }
      } catch (err) {
        // 1ゲームの失敗が他ゲームの処理を止めないようにし、通知は同一ゲームにつき5分に1回まで
        const lastNotified = dropsAutoLastErrorNotifiedAt.get(gameName) || 0;
        if (Date.now() - lastNotified > 5 * 60 * 1000) {
          dropsAutoLastErrorNotifiedAt.set(gameName, Date.now());
          notifyRenderer('drops-auto:error', { gameName, message: String(err.message || err) });
        }
      }
    }
    // 自動追加/削除が発生した場合はレンダラーへ通知し、チップ一覧をその場で更新できるようにする
    // (ユーザー操作を介さずメインプロセス側で完結する変更のため、明示的な通知が必要)
    if (changed) notifyRenderer('channels:changed');
  } finally {
    dropsAutoCheckRunning = false;
  }
}

function startDropsAutoWatcher() {
  if (dropsAutoTimer) return;
  runDropsAutoCheck(); // 設定変更直後に即時反映
  dropsAutoTimer = setInterval(runDropsAutoCheck, DROPS_AUTO_INTERVAL_MS);
}

function stopDropsAutoWatcher() {
  if (!dropsAutoTimer) return;
  clearInterval(dropsAutoTimer);
  dropsAutoTimer = null;
}

/** トラッキング対象ゲームリストが変更された時に呼ぶ。空なら停止、非空なら（再）起動する。 */
function syncDropsAutoWatcherState() {
  const tracked = store.get('dropsAutoTrack');
  if (tracked.length > 0) startDropsAutoWatcher();
  else stopDropsAutoWatcher();
}

// ---- Auto Tune-In（フォロー中の配信者が配信開始したら自動でタイル追加、ロードマップ項目7） ----
// Drops自動追加/削除と違い「フォロー中チャンネル一覧」はユーザー個人の情報のため、Helixの
// Client Credentials（アプリ単位・匿名）トークンでは取得できず、ユーザー本人の同意を得た
// OAuthユーザートークン（scope: user:read:follows）が必要（将来的な安定性を優先し、
// Drops進捗確認等で使っている非公式DOM scrapingではなく公式の認可コードグラントフローを採用）。
// 取得したユーザートークンで /helix/channels/followed → /helix/streams の順に叩き、
// フォロー中かつ配信中のチャンネルを求める。以降の追加/削除ロジックはDrops自動追加と同じパターン
// （addChannel/removeChannel、上限超過分の自己修復、entry.autoAddedでの区別）を踏襲している。

// Twitch Developer Console側で、このアプリのRedirect URIとして以下を追加登録しておく必要がある
// （http://localhost 固定ポートのローカルループバックはTwitch公式ドキュメントで案内されている方式）。
const TWITCH_OAUTH_REDIRECT_PORT = 17652;
const TWITCH_OAUTH_REDIRECT_URI = `http://localhost:${TWITCH_OAUTH_REDIRECT_PORT}`;
const TWITCH_OAUTH_SCOPES = 'user:read:follows';

let twitchAuthView = null;
let twitchAuthCancelFn = null; // 進行中のOAuthフローをキャンセルするための関数（無ければ進行中フローなし）

function openTwitchAuthView(url) {
  if (!mainWindow) return;
  if (twitchAuthView) closeTwitchAuthView();
  // BrowserViewは追加した順に手前へ積み重なるため、既存の配信タイル等より後に追加すれば
  // 自動的に最前面に表示される（アカウント連携ログイン画面と同じ考え方）。
  twitchAuthView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: true, partition: PLATFORM_CONFIG.twitch.partition },
  });
  forwardEscapeKey(twitchAuthView.webContents);
  mainWindow.addBrowserView(twitchAuthView);
  twitchAuthView.webContents.loadURL(url).catch((err) => {
    if (isBenignNavigationError(err)) return;
  });
  relayoutTwitchAuthView();
  // 2026-08-08追加: 連携開始ボタンが「配信チェック」パネル（overlayPanelView側のHTML）へ
  // 移ったため、メインウィンドウ側のヘッダーロック・「連携画面を閉じる」ボタンの出し入れは
  // レンダラーのクリックハンドラではなくこの通知で行う（旧: renderer.js側で直接切り替えていた）。
  notifyRenderer('auto-tune-in:auth-view-opened');
}

function relayoutTwitchAuthView() {
  if (!twitchAuthView || !mainWindow) return;
  const { width, height } = mainWindow.getContentBounds();
  twitchAuthView.setBounds({ x: 0, y: HEADER_HEIGHT, width, height: height - HEADER_HEIGHT });
}

function closeTwitchAuthView() {
  if (!twitchAuthView || !mainWindow) return;
  const view = twitchAuthView;
  try {
    mainWindow.removeBrowserView(view);
  } catch (_) {
    /* 既に外れている場合などは無視 */
  }
  try {
    view.webContents.loadURL('about:blank');
  } catch (_) {
    /* ignore */
  }
  scheduleWebContentsDestroy(view.webContents);
  twitchAuthView = null;
  // 連携画面は addBrowserView で後から積んだぶん overlayPanelView より前面に来ているため、
  // 閉じたあとはオーバーレイパネル（配信チェック等）を確実に最前面へ戻す。
  // なおパネル自体は連携中も閉じていない（閉じるとabout:blankへ遷移してJSごと破棄され、
  // startTwitchAuth()のawaitが結果を受け取れなくなるため）。
  if (overlayPanelOpenId && overlayPanelView && mainWindow && typeof mainWindow.setTopBrowserView === 'function') {
    try {
      mainWindow.setTopBrowserView(overlayPanelView);
    } catch (_) {
      /* ignore */
    }
  }
  notifyRenderer('auto-tune-in:auth-view-closed');
}

/** 認可コードをアクセストークン・リフレッシュトークンに交換し、ユーザー情報を取得して保存する */
async function exchangeTwitchAuthCode(code, clientId, clientSecret) {
  const tokenUrl =
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}` +
    `&code=${encodeURIComponent(code)}` +
    `&grant_type=authorization_code` +
    `&redirect_uri=${encodeURIComponent(TWITCH_OAUTH_REDIRECT_URI)}`;
  const tokenRes = await httpsRequestJson(tokenUrl, { method: 'POST' });
  if (tokenRes.status !== 200) {
    throw new Error(`トークン取得に失敗しました: ${tokenRes.status} ${JSON.stringify(tokenRes.json)}`);
  }
  const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = tokenRes.json;

  const userRes = await httpsRequestJson('https://api.twitch.tv/helix/users', {
    headers: { 'Client-Id': clientId, Authorization: `Bearer ${accessToken}` },
  });
  if (userRes.status !== 200 || !userRes.json.data?.length) {
    throw new Error('ユーザー情報の取得に失敗しました');
  }
  const { id: userId, login } = userRes.json.data[0];

  store.set('twitchUserAuth', {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
    userId,
    login,
  });
  return { userId, login };
}

/**
 * Auto Tune-In用のTwitch OAuth連携フローを開始する。ローカルループバック（127.0.0.1固定ポート）に
 * 一時的なHTTPサーバーを立て、Twitchからのリダイレクトをそこで直接受け取る方式
 * （カスタムプロトコル登録は不要で、未インストーラー版でも動作検証できる）。
 * 呼び出し元（IPC）へは、連携が完了・失敗・キャンセルのいずれかで確定するまで待たせる。
 */
function startTwitchUserAuth() {
  return new Promise((resolve) => {
    if (twitchAuthCancelFn) {
      resolve({ ok: false, error: '既に連携処理が進行中です' });
      return;
    }
    const clientId = store.get('helixClientId');
    const clientSecret = store.get('helixClientSecret');
    if (!clientId || !clientSecret) {
      resolve({ ok: false, error: 'Helix Client ID / Client Secretが未設定です。先に設定画面で入力してください。' });
      return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    let settled = false;
    let server = null;
    let timeoutHandle = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (server) {
        try {
          server.close();
        } catch (_) {
          /* 既に閉じている場合は無視 */
        }
      }
      closeTwitchAuthView();
      twitchAuthCancelFn = null;
      resolve(result);
    };

    twitchAuthCancelFn = () => finish({ ok: false, cancelled: true });

    server = http.createServer((req, res) => {
      const u = new URL(req.url, TWITCH_OAUTH_REDIRECT_URI);
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      const errDesc = u.searchParams.get('error_description');
      const returnedState = u.searchParams.get('state');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<html><body style="font-family:sans-serif;padding:24px;">連携処理が完了しました。このタブ/ウィンドウは閉じてアプリに戻ってください。</body></html>'
      );

      if (err) {
        finish({ ok: false, error: errDesc || err });
        return;
      }
      if (!code || returnedState !== state) {
        finish({ ok: false, error: '認可コードの受け取りに失敗しました（stateが一致しません）' });
        return;
      }
      exchangeTwitchAuthCode(code, clientId, clientSecret)
        .then((info) => finish({ ok: true, login: info.login }))
        .catch((e) => finish({ ok: false, error: String(e.message || e) }));
    });

    server.on('error', (e) => {
      finish({
        ok: false,
        error: `ローカルサーバーの起動に失敗しました（ポート${TWITCH_OAUTH_REDIRECT_PORT}が使用中の可能性があります）: ${String(e.message || e)}`,
      });
    });

    server.listen(TWITCH_OAUTH_REDIRECT_PORT, '127.0.0.1', () => {
      const authorizeUrl =
        `https://id.twitch.tv/oauth2/authorize?response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(TWITCH_OAUTH_REDIRECT_URI)}` +
        `&scope=${encodeURIComponent(TWITCH_OAUTH_SCOPES)}` +
        `&state=${encodeURIComponent(state)}`;
      openTwitchAuthView(authorizeUrl);
    });

    timeoutHandle = setTimeout(() => {
      finish({ ok: false, error: '連携がタイムアウトしました（5分以内に認可を完了してください）' });
    }, 5 * 60 * 1000);
  });
}

function disconnectTwitchUserAuth() {
  store.set('twitchUserAuth', null);
  const cfg = store.get('autoTuneIn');
  if (cfg.enabled) store.set('autoTuneIn', { ...cfg, enabled: false });
  syncAutoTuneInWatcherState();
}

/** アクセストークンをリフレッシュトークンで更新する。失効していた場合は連携情報をクリアする。 */
async function refreshTwitchUserToken() {
  const auth = store.get('twitchUserAuth');
  if (!auth || !auth.refreshToken) return null;
  const clientId = store.get('helixClientId');
  const clientSecret = store.get('helixClientSecret');
  if (!clientId || !clientSecret) return null;

  const url =
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}` +
    `&grant_type=refresh_token&refresh_token=${encodeURIComponent(auth.refreshToken)}`;
  const res = await httpsRequestJson(url, { method: 'POST' });
  if (res.status !== 200) {
    // リフレッシュトークンが失効している等。再連携が必要なため連携情報をクリアして通知する。
    store.set('twitchUserAuth', null);
    const cfg = store.get('autoTuneIn');
    if (cfg.enabled) store.set('autoTuneIn', { ...cfg, enabled: false });
    notifyRenderer('auto-tune-in:auth-lost');
    return null;
  }
  const updated = {
    ...auth,
    accessToken: res.json.access_token,
    refreshToken: res.json.refresh_token || auth.refreshToken, // リフレッシュトークンはローテーションされる
    expiresAt: Date.now() + (res.json.expires_in - 60) * 1000,
  };
  store.set('twitchUserAuth', updated);
  return updated.accessToken;
}

async function getValidTwitchUserAccessToken() {
  const auth = store.get('twitchUserAuth');
  if (!auth) return null;
  if (auth.accessToken && Date.now() < auth.expiresAt) return auth.accessToken;
  return refreshTwitchUserToken();
}

// ---- Kickチャット（時系列統合モード）用: チャンネル名→chatroom_idの解決 ----
// KickのライブチャットはPusherというホスト型WebSocketサービスで配信されており、
// 購読するチャンネル名は chatrooms.{chatroom_id}.v2 という数値IDベースの形式（ユーザー名では購読できない）。
// このIDは非公式のkick.com/api/v2/channels/{slug}エンドポイントのレスポンス（chatroom.id）から取得する。
//
// 当初Node標準のhttpsモジュール（httpsRequestJson）で直接叩いていたが機能しなかった。KickはCloudflareの
// TLSフィンガープリンティング（JA3等）でBotを判定しており、User-Agentヘッダーだけ偽装してもNodeの
// TLSスタックはブラウザと異なる指紋になるため弾かれる（他の非公式Kickクライアント実装がこのAPIだけ
// curlをサブプロセス起動して回避しているのも同じ理由）。そのため、実際にChromiumのネットワークスタックを
// 使う「隠しBrowserViewでkick.com自身のページを読み込み、そのページ内からsame-origin fetch()する」方式に
// 変更した（タブモードのポップアウトチャットが正常に読み込めているのと同じ経路）。
async function resolveKickChatroomId(channelName) {
  const view = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: true, partition: KICK_PARTITION },
  });
  try {
    await view.webContents.loadURL(`https://kick.com/${encodeURIComponent(channelName)}`);
    const result = await view.webContents.executeJavaScript(`
      fetch(${JSON.stringify(`https://kick.com/api/v2/channels/${channelName}`)}, { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); })
        .then(function (r) { return { ok: true, status: r.status, chatroomId: r.json && r.json.chatroom && r.json.chatroom.id }; })
        .catch(function (e) { return { ok: false, error: String(e) }; });
    `);
    if (result && result.ok && typeof result.chatroomId === 'number') {
      return { ok: true, chatroomId: result.chatroomId };
    }
    return {
      ok: false,
      error: `chatroom_idを取得できませんでした（${result && (result.status || result.error)}）`,
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    scheduleWebContentsDestroy(view.webContents, { alreadyLoaded: true });
  }
}

// ---- Kick「フォロー中で配信中」一覧（統一フィード用） ----
// Kickの公式Public API（api.kick.com/public/v1）には「フォロー中チャンネル一覧」を返す
// エンドポイントが存在しない（channels/livestreamsはどちらもID/スラッグ指定が前提）。
// そのため、resolveKickChatroomIdと同じ非公式エンドポイント（kick.com/api/v2/channels/followed。
// kick.com自身のWebアプリが使っているもの）を、同じ「隠しBrowserViewでkick.com自身を読み込み、
// その中からsame-origin fetch()する」方式で叩く（Node直fetchはCloudflareのTLS指紋判定で弾かれるため）。
// レスポンスの正確なフィールド名・ページネーション方式は非公開のため、複数の想定パターンを試す
// ガード実装にしている（Kick側の仕様変更で壊れる可能性がある非公式ヒューリスティックの一つ、
// resolveKickChatroomIdと同じ位置づけ）。
// 重い処理（BrowserView生成・ページ読み込み）のため、Auto Tune-Inのような60秒間隔の常時
// ポーリングには使わない。統一フィードの手動更新ボタン押下時のみ呼び出す。
async function fetchKickFollowedChannels() {
  // 実機確認の結果、kick.com/api/v2/channels/followed はページ内からの単純な
  // fetch()（Cookie任せ）だけでは401になることが判明した。非公式クライアント実装
  // （kick-apiクレート等）の情報によると、この非公式v2 APIはCookieの自動送信ではなく
  // 「session_token」Cookieの値をAuthorizationヘッダー（Bearer）として明示的に送る必要がある。
  // session_tokenはhttpOnlyの可能性があるため、レンダラー側JS（document.cookie）ではなく
  // Electronのsessionモジュール（メインプロセス）でCookie値を取得し、fetch()呼び出し側の
  // スクリプトに埋め込む。
  const sessionCookies = await session.fromPartition(KICK_PARTITION).cookies.get({ domain: '.kick.com', name: 'session_token' });
  if (!sessionCookies.length) {
    throw new Error('Kickにログインしていない可能性があります（設定画面のKickアカウント行からログインしてください）');
  }
  let sessionToken = sessionCookies[0].value;
  try {
    sessionToken = decodeURIComponent(sessionToken);
  } catch (_) {
    /* デコードできない場合は生の値のまま使う */
  }

  const view = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: true, partition: KICK_PARTITION },
  });
  try {
    await view.webContents.loadURL('https://kick.com/');
    const result = await view.webContents.executeJavaScript(`
      (async function () {
        const authHeader = 'Bearer ' + ${JSON.stringify(sessionToken)};
        const out = [];
        let cursor = null;
        for (let i = 0; i < 10; i++) {
          let url = 'https://kick.com/api/v2/channels/followed';
          if (cursor) url += '?cursor=' + encodeURIComponent(cursor);
          let res;
          try {
            res = await fetch(url, { headers: { Accept: 'application/json', Authorization: authHeader } });
          } catch (e) {
            return { ok: false, error: String(e) };
          }
          if (res.status === 401 || res.status === 403) {
            return { ok: false, error: 'unauthorized', status: res.status };
          }
          if (!res.ok) {
            return { ok: false, error: 'http-' + res.status, status: res.status };
          }
          let json;
          try {
            json = await res.json();
          } catch (e) {
            return { ok: false, error: 'invalid-json' };
          }
          const list = Array.isArray(json) ? json : json.channels || json.data || json.followed_channels || [];
          if (!Array.isArray(list) || list.length === 0) break;
          out.push.apply(out, list);
          const nextCursor = json && !Array.isArray(json) ? json.nextCursor || json.next_cursor : null;
          if (!nextCursor) break;
          cursor = nextCursor;
        }
        return { ok: true, items: out };
      })();
    `);
    if (!result || !result.ok) {
      const reason =
        result && result.error === 'unauthorized'
          ? 'Kickにログインしていない可能性があります（設定画面のKickアカウント行からログインしてください）'
          : `フォロー一覧の取得に失敗しました（${result ? result.error : '不明なエラー'}）`;
      throw new Error(reason);
    }
    return (result.items || []).map((raw) => normalizeKickFollowedChannel(raw)).filter(Boolean);
  } finally {
    scheduleWebContentsDestroy(view.webContents, { alreadyLoaded: true });
  }
}

/**
 * kick.com/api/v2/channels/followedのレスポンス1件を正規化する。
 * フィールド名が非公開のため、複数の想定パターン（channel/broadcaster入れ子、
 * is_live/isLive、livestreamオブジェクトの有無等）を順に試す。
 */
function normalizeKickFollowedChannel(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const channelObj = raw.channel || raw.broadcaster || raw;
  const slug =
    channelObj.slug || channelObj.user_username || channelObj.username || raw.slug || raw.user_username || raw.username;
  if (!slug) return null;
  const displayName = channelObj.user?.username || channelObj.username || raw.user?.username || slug;
  const livestream = raw.livestream || channelObj.livestream || null;
  const isLive = Boolean(
    raw.is_live ?? raw.isLive ?? channelObj.is_live ?? (livestream ? livestream.is_live !== false : false)
  );
  const viewerCount =
    Number(raw.viewer_count ?? channelObj.viewer_count ?? (livestream && livestream.viewer_count) ?? 0) || 0;
  // アバター画像（配信チェックパネルのカード表示用、2026-08-08追加）。
  // この関数の他の項目と同様、Kick側のレスポンス形式は非公開のため候補パスを順に試すだけの
  // リバースエンジニアリング実装で、実レスポンスでの検証はできていない（null が返ることも普通にある）。
  // 表示側（overlay-panel.js）は avatarUrl が null / 読み込み失敗でもフォールバック画像を出すため実害はない。
  let avatarUrl = null;
  try {
    avatarUrl =
      raw.user?.profile_pic ||
      raw.profile_pic ||
      channelObj.user?.profile_pic ||
      channelObj.profile_pic ||
      raw.banner_image?.url ||
      null;
    if (avatarUrl) avatarUrl = String(avatarUrl);
  } catch (_) {
    avatarUrl = null; // 装飾要素なので、どんな形のレスポンスが来ても絶対にthrowさせない
  }
  // タイトル・カテゴリ・配信時間（配信一覧のカード表示用、2026-08-08段階B追加）。
  // fetchKickStreamMeta()（個別チャンネルAPI、L3517〜）が使っているのと同じフィールド名
  // （livestream.session_title / livestream.categories[0].name / livestream.created_at）を、
  // ここで既に取得済みの livestream から読むだけ（追加のリクエストは発生しない）。
  // アバターと同様、Kickのレスポンス形式は非公開のため値が取れないこともある前提で、
  // 表示側（stream-check-window.js）は値が無い項目を単に出さない設計にしてある。
  let title = '';
  let category = '';
  let startedAt = null;
  try {
    if (livestream) {
      title = livestream.session_title || '';
      category = (livestream.categories && livestream.categories[0] && livestream.categories[0].name) || '';
      startedAt = livestream.created_at || null;
    }
  } catch (_) {
    title = '';
    category = '';
    startedAt = null;
  }
  return { channel: String(slug), displayName: String(displayName), isLive, viewerCount, avatarUrl, title, category, startedAt };
}

// ---- Kickアカウント連携（OAuth 2.1 + PKCE、視聴とは独立した「連携状態の確認」専用） ----
// Kickの視聴自体はplayer.kick.com埋め込みでログイン不要のため、このOAuth連携は
// 「連携済みかどうかの表示・接続/切断」のみに使う（チャット統合・Drops相当・Auto Tune-In相当は
// 今回のスコープ外）。Kick Developer Portal（kick.com/settings/developer）でアプリを登録する必要がある。
//
// OAuthサーバーは id.kick.com（APIサーバーの api.kick.com とはホストが別）。PKCEが必須。
// 既知のバグ: redirect_uriに127.0.0.1を使うとKick側のNext.jsが最初に出現する127.0.0.1を
// localhostに書き換えてしまい認可が失敗するため、redirect_uriは必ずlocalhost表記にする
// （Twitchは127.0.0.1:17652を使っているが、Kickはlocalhost:17655/callbackを使う）。
// また、TwitchのようにアプリのBrowserViewに認可画面を埋め込む方式ではなく、既定のブラウザで
// 認可画面を開く方式にする（ローカルループバックHTTPサーバーでリダイレクトだけを受け取る）。
const KICK_OAUTH_REDIRECT_PORT = 17655;
const KICK_OAUTH_REDIRECT_URI = `http://localhost:${KICK_OAUTH_REDIRECT_PORT}/callback`;
const KICK_OAUTH_SCOPES = 'user:read';

let kickAuthCancelFn = null; // 進行中のOAuthフローをキャンセルするための関数（無ければ進行中フローなし）

/** base64url（PKCEのcode_verifier/code_challengeで使う。paddingなし・URL安全文字） */
function toBase64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PKCE用の code_verifier / code_challenge（S256）のペアを生成する */
function generateKickPkcePair() {
  const verifier = toBase64Url(crypto.randomBytes(32));
  const challenge = toBase64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** 認可コードをアクセストークン・リフレッシュトークンに交換し、ユーザー情報を取得して保存する */
async function exchangeKickAuthCode(code, clientId, clientSecret, codeVerifier) {
  const tokenRes = await httpsPostForm('https://id.kick.com/oauth/token', {
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: KICK_OAUTH_REDIRECT_URI,
    code,
    code_verifier: codeVerifier,
  });
  if (tokenRes.status !== 200) {
    throw new Error(`トークン取得に失敗しました: ${tokenRes.status} ${JSON.stringify(tokenRes.json || tokenRes.raw || '')}`);
  }
  const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = tokenRes.json || {};
  if (!accessToken) throw new Error('トークン取得に失敗しました（access_tokenが返されませんでした）');

  const userRes = await httpsRequestJson('https://api.kick.com/public/v1/users', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (userRes.status !== 200 || !userRes.json?.data?.length) {
    throw new Error('ユーザー情報の取得に失敗しました');
  }
  const user = userRes.json.data[0];
  const username = user.name || user.username || user.slug || String(user.user_id || user.id || '');

  store.set('kickUserAuth', {
    accessToken,
    refreshToken: refreshToken || null,
    expiresAt: Date.now() + (Number(expiresIn || 3600) - 60) * 1000,
    username,
  });
  return { username };
}

/**
 * Kickアカウント連携フローを開始する。ローカルループバック（localhost固定ポート）に一時的な
 * HTTPサーバーを立ててリダイレクトを受け取りつつ、認可画面自体は既定のブラウザで開く
 * （Twitchのような埋め込みBrowserView方式ではない）。
 */
function startKickUserAuth() {
  return new Promise((resolve) => {
    if (kickAuthCancelFn) {
      resolve({ ok: false, error: '既に連携処理が進行中です' });
      return;
    }
    const clientId = store.get('kickClientId');
    const clientSecret = store.get('kickClientSecret');
    if (!clientId || !clientSecret) {
      resolve({ ok: false, error: 'Kick Client ID / Client Secretが未設定です。先に設定画面で入力してください。' });
      return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    const { verifier, challenge } = generateKickPkcePair();
    let settled = false;
    let server = null;
    let timeoutHandle = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (server) {
        try {
          server.close();
        } catch (_) {
          /* 既に閉じている場合は無視 */
        }
      }
      kickAuthCancelFn = null;
      resolve(result);
    };

    kickAuthCancelFn = () => finish({ ok: false, cancelled: true });

    server = http.createServer((req, res) => {
      const u = new URL(req.url, KICK_OAUTH_REDIRECT_URI);
      if (u.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      const errDesc = u.searchParams.get('error_description');
      const returnedState = u.searchParams.get('state');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<html><body style="font-family:sans-serif;padding:24px;">連携処理が完了しました。このタブ/ウィンドウは閉じてアプリに戻ってください。</body></html>'
      );

      if (err) {
        finish({ ok: false, error: errDesc || err });
        return;
      }
      if (!code || returnedState !== state) {
        finish({ ok: false, error: '認可コードの受け取りに失敗しました（stateが一致しません）' });
        return;
      }
      exchangeKickAuthCode(code, clientId, clientSecret, verifier)
        .then((info) => finish({ ok: true, login: info.username }))
        .catch((e) => finish({ ok: false, error: String(e.message || e) }));
    });

    server.on('error', (e) => {
      finish({
        ok: false,
        error: `ローカルサーバーの起動に失敗しました（ポート${KICK_OAUTH_REDIRECT_PORT}が使用中の可能性があります）: ${String(e.message || e)}`,
      });
    });

    server.listen(KICK_OAUTH_REDIRECT_PORT, '127.0.0.1', () => {
      const authorizeUrl =
        `https://id.kick.com/oauth/authorize?response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(KICK_OAUTH_REDIRECT_URI)}` +
        `&scope=${encodeURIComponent(KICK_OAUTH_SCOPES)}` +
        `&state=${encodeURIComponent(state)}` +
        `&code_challenge=${encodeURIComponent(challenge)}` +
        `&code_challenge_method=S256`;
      shell.openExternal(authorizeUrl).catch((e) => {
        finish({ ok: false, error: `既定のブラウザを開けませんでした: ${String(e.message || e)}` });
      });
    });

    timeoutHandle = setTimeout(() => {
      finish({ ok: false, error: '連携がタイムアウトしました（5分以内に認可を完了してください）' });
    }, 5 * 60 * 1000);
  });
}

function cancelKickUserAuth() {
  if (kickAuthCancelFn) kickAuthCancelFn();
}

function disconnectKickUserAuth() {
  store.set('kickUserAuth', null);
}

/** アクセストークンをリフレッシュトークンで更新する。失効していた場合は連携情報をクリアする。
 * Kickはリフレッシュトークンが使い捨て（ローテーション）される仕様のため、更新の都度
 * 新しいrefreshTokenで保存し直す（返ってこなかった場合のみ従来のものを維持する）。 */
async function refreshKickUserToken() {
  const auth = store.get('kickUserAuth');
  if (!auth || !auth.refreshToken) return null;
  const clientId = store.get('kickClientId');
  const clientSecret = store.get('kickClientSecret');
  if (!clientId || !clientSecret) return null;

  const res = await httpsPostForm('https://id.kick.com/oauth/token', {
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (res.status !== 200 || !res.json?.access_token) {
    // リフレッシュトークンが失効している等。再連携が必要なため連携情報をクリアして通知する。
    store.set('kickUserAuth', null);
    notifyRenderer('kick-auth:auth-lost');
    return null;
  }
  const updated = {
    ...auth,
    accessToken: res.json.access_token,
    refreshToken: res.json.refresh_token || auth.refreshToken, // リフレッシュトークンはローテーションされる
    expiresAt: Date.now() + (Number(res.json.expires_in || 3600) - 60) * 1000,
  };
  store.set('kickUserAuth', updated);
  return updated.accessToken;
}

async function getValidKickUserAccessToken() {
  const auth = store.get('kickUserAuth');
  if (!auth) return null;
  if (auth.accessToken && Date.now() < auth.expiresAt) return auth.accessToken;
  return refreshKickUserToken();
}

/** 現在Auto Tune-Inによって追加されているチャンネル一覧（プラットフォーム別の集計・削除判定に使うためplatformも返す） */
function autoTuneInAddedChannels() {
  const result = [];
  streamViews.forEach((entry, channel) => {
    if (entry.autoAdded && entry.autoSource === 'tune-in') {
      result.push({ channel, platform: entry.platform || 'twitch' });
    }
  });
  return result;
}

/** Auto Tune-Inの対象指定リストを取得する */
function getAutoTuneInTargets() {
  return store.get('autoTuneInTargets');
}

/**
 * 対象指定リストを丸ごと置き換える（トグル操作はレンダラー側で現在値を編集してから呼ぶ）。
 * ウォッチャーが既に起動中の場合、syncAutoTuneInWatcherStateだけでは次の60秒間隔まで
 * 反映されない（起動中ならstartAutoTuneInWatcherが何もしないため）。チェックを入れた/外した
 * 直後に反映されず「効いていないように見える」というフィードバックがあったため、
 * 対象指定の変更時は明示的に1回即時チェックを走らせる。
 */
async function setAutoTuneInTargets(targets) {
  const list = Array.isArray(targets)
    ? targets
        .filter((t) => t && (t.platform === 'twitch' || t.platform === 'youtube') && t.channel)
        .map((t) => ({ platform: t.platform, channel: String(t.channel) }))
    : [];
  store.set('autoTuneInTargets', list);
  syncAutoTuneInWatcherState();
  runAutoTuneInCheck(); // 有効化されていなければ内部で何もしない（cfg.enabledチェックは関数内で行われる）
  return list;
}

/** フィードに常時表示する「ピン留め」YouTubeチャンネル一覧を取得する */
function getFeedPinnedYoutubeChannels() {
  return store.get('feedPinnedYoutubeChannels');
}

/** ピン留めYouTubeチャンネル一覧を丸ごと置き換える */
function setFeedPinnedYoutubeChannels(list) {
  const clean = Array.isArray(list)
    ? list
        .filter((p) => p && p.channel)
        .map((p) => ({ channel: String(p.channel), displayName: String(p.displayName || p.channel) }))
    : [];
  store.set('feedPinnedYoutubeChannels', clean);
  return clean;
}

/** 指定チャンネルがピン留めされているかどうか */
function isFeedPinnedYoutube(channel) {
  const key = String(channel || '').toLowerCase();
  return getFeedPinnedYoutubeChannels().some((p) => p.channel.toLowerCase() === key);
}

/** 指定プラットフォームのチャンネルが対象指定リストに含まれているかどうか */
function isAutoTuneInTarget(platform, channel) {
  const key = channel.toLowerCase();
  return getAutoTuneInTargets().some((t) => t.platform === platform && t.channel.toLowerCase() === key);
}

/**
 * フォロー中のTwitchチャンネル全員（オンライン/オフライン問わず）を取得する。
 * 「全フォロー/登録一覧」で対象チャンネルを選ぶためのもの（fetchFollowedLiveChannelsと違い配信中判定はしない）。
 */
async function fetchAllFollowedTwitchChannels() {
  const token = await getValidTwitchUserAccessToken();
  const auth = store.get('twitchUserAuth');
  if (!token || !auth) throw new Error('Twitchアカウント連携が必要です（「📡 フィード」パネルから連携してください）');
  const clientId = store.get('helixClientId');

  const result = [];
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    const url = new URL('https://api.twitch.tv/helix/channels/followed');
    url.searchParams.set('user_id', auth.userId);
    url.searchParams.set('first', '100');
    if (cursor) url.searchParams.set('after', cursor);
    const res = await httpsRequestJson(url.toString(), {
      headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
    });
    if (res.status !== 200) throw new Error(`フォロー一覧の取得に失敗しました: ${res.status}`);
    const page_data = res.json.data || [];
    page_data.forEach((f) => result.push({ channel: f.broadcaster_login, displayName: f.broadcaster_name }));
    cursor = res.json.pagination?.cursor;
    if (!cursor || page_data.length < 100) break;
  }
  return result;
}

// ---- Twitchアバター画像（配信チェックパネルのカード表示用） ----
// /helix/users は1回あたり最大100 idまで指定できる。プロフィール画像はほとんど変わらないため
// 6時間キャッシュし、キャッシュ済みのidはGet Usersの問い合わせ対象から外す。
// アバターはあくまで装飾要素なので、取得に失敗しても配信一覧そのものは必ず返す（throwしない）。
const TWITCH_AVATAR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const twitchAvatarCache = new Map(); // broadcaster id -> { url, fetchedAt }

/**
 * 指定したbroadcaster idのプロフィール画像URLを取得する（キャッシュ優先）。
 * 失敗しても例外は投げず、取れたぶんだけのMapを返す。
 * @returns {Promise<Map<string, string|null>>} id -> profile_image_url
 */
async function fetchTwitchAvatarUrls(ids, clientId, token) {
  const result = new Map();
  const now = Date.now();
  const missing = [];
  ids.forEach((id) => {
    const cached = twitchAvatarCache.get(id);
    if (cached && now - cached.fetchedAt < TWITCH_AVATAR_CACHE_TTL_MS) {
      result.set(id, cached.url);
    } else {
      missing.push(id);
    }
  });
  if (!missing.length) return result;
  try {
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      const url = new URL('https://api.twitch.tv/helix/users');
      chunk.forEach((id) => url.searchParams.append('id', id));
      const res = await httpsRequestJson(url.toString(), {
        headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
      });
      if (res.status !== 200) continue; // アバターは装飾なので、失敗したチャンクは黙って諦める
      (res.json.data || []).forEach((u) => {
        const avatar = u.profile_image_url || null;
        twitchAvatarCache.set(String(u.id), { url: avatar, fetchedAt: Date.now() });
        result.set(String(u.id), avatar);
      });
    }
  } catch (_) {
    /* アバター取得の失敗は配信一覧の取得結果に影響させない */
  }
  return result;
}

/** フォロー中チャンネルのうち現在配信中のもの一覧を視聴者数の多い順で取得する */
async function fetchFollowedLiveChannels() {
  const token = await getValidTwitchUserAccessToken();
  const auth = store.get('twitchUserAuth');
  if (!token || !auth) throw new Error('Twitchアカウント連携が必要です（設定画面から連携してください）');
  const clientId = store.get('helixClientId');

  // フォロー中チャンネル一覧を取得（最大5ページ=500件まで。通常のフォロー数であれば十分カバーできる）
  const followedIds = [];
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    const url = new URL('https://api.twitch.tv/helix/channels/followed');
    url.searchParams.set('user_id', auth.userId);
    url.searchParams.set('first', '100');
    if (cursor) url.searchParams.set('after', cursor);
    const res = await httpsRequestJson(url.toString(), {
      headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
    });
    if (res.status !== 200) throw new Error(`フォロー一覧の取得に失敗しました: ${res.status}`);
    const page_data = res.json.data || [];
    page_data.forEach((f) => followedIds.push(f.broadcaster_id));
    cursor = res.json.pagination?.cursor;
    if (!cursor || page_data.length < 100) break;
  }
  if (followedIds.length === 0) return [];

  // /helix/streams はuser_idを一度に最大100個まで指定できるため、100件ずつに分けて配信中判定する
  const live = [];
  for (let i = 0; i < followedIds.length; i += 100) {
    const chunk = followedIds.slice(i, i + 100);
    const url = new URL('https://api.twitch.tv/helix/streams');
    chunk.forEach((id) => url.searchParams.append('user_id', id));
    url.searchParams.set('first', '100');
    const res = await httpsRequestJson(url.toString(), {
      headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
    });
    if (res.status !== 200) throw new Error(`配信状況の取得に失敗しました: ${res.status}`);
    // title / gameName / startedAt は複窓レイアウト設定ウィンドウ（2026-08-08新設）の
    // カード表示用に追加した。キー名は fetchTwitchStreamMeta() 側（チップのツールチップ用）と
    // 揃えてある。startedAt はHelix仕様通りISO8601（UTC）文字列で、経過時間の計算は
    // 表示側（renderer）で Date.now() との差分から行う。
    (res.json.data || []).forEach((s) =>
      live.push({
        login: s.user_login,
        userId: String(s.user_id || ''),
        viewerCount: s.viewer_count || 0,
        avatarUrl: null,
        title: s.title || '',
        gameName: s.game_name || '',
        startedAt: s.started_at || null,
      })
    );
  }

  // アバター画像（配信チェックパネルのカード表示用）。
  // 当初案では /helix/streams と同じidチャンクで /helix/users を並列に叩く想定だったが、
  // アバターが必要なのは「実際に配信中だった配信者」だけ（通常フォロー数よりずっと少ない）ため、
  // streams の結果が出てからその user_id 分だけを問い合わせる方式にした（リクエスト数が減り、
  // 実質的な待ち時間も短い）。失敗しても avatarUrl は null のまま配信一覧はそのまま返す。
  try {
    const liveIds = live.map((s) => s.userId).filter(Boolean);
    if (liveIds.length) {
      const avatars = await fetchTwitchAvatarUrls(liveIds, clientId, token);
      live.forEach((s) => {
        s.avatarUrl = avatars.get(s.userId) || null;
      });
    }
  } catch (_) {
    /* アバターは装飾要素。取得できなくても配信一覧は必ず返す */
  }

  return live.sort((a, b) => b.viewerCount - a.viewerCount);
}

// 「チャンネルの一覧更新をもっと早く更新できるようにする」要望への対応で60秒→25秒に短縮。
// Twitch分（フォロー一覧＋streams、Helix）はレート制限に対して余裕が大きい。YouTube分は
// DOM/HTML直接アクセス方式のため頻度を上げすぎるとBot判定リスクがあるが、対象指定チャンネル
// （target化されたもの）のみをチェックする設計（runAutoTuneInCheck内）で対象数は通常少数のため、
// 25秒間隔でも許容範囲と判断。多重実行防止ロック（autoTuneInCheckRunning）は既存のまま維持される。
const AUTO_TUNE_IN_INTERVAL_MS = 25 * 1000;
let autoTuneInTimer = null;
let autoTuneInCheckRunning = false;
let autoTuneInLastErrorNotifiedAt = 0;

/**
 * Auto Tune-Inの1サイクル。Drops自動追加のrunDropsAutoCheckと同じ追加/削除/自己修復パターンを
 * Twitch/YouTube両対応に拡張したもの。
 * - Twitch: 対象指定リストにTwitch分が1件以上あればその中だけ、無ければ従来通りフォロー中全員が対象（後方互換）。
 * - YouTube: ページ取得コストの都合上「登録中なら誰でも」は対象にできないため、対象指定リストに
 *   入っているチャンネルだけをチェックする（対象指定が空ならYouTube側は何もしない）。
 */
async function runAutoTuneInCheck() {
  if (autoTuneInCheckRunning) return;
  const cfg = store.get('autoTuneIn');
  if (!cfg.enabled) return;
  autoTuneInCheckRunning = true;
  let changed = false;
  try {
    const targets = getAutoTuneInTargets();
    const twitchTargets = new Set(targets.filter((t) => t.platform === 'twitch').map((t) => t.channel.toLowerCase()));
    const youtubeTargets = targets.filter((t) => t.platform === 'youtube').map((t) => t.channel);

    const liveLoginsTwitch = new Set();
    let twitchCandidates = [];
    try {
      const liveFollowed = await fetchFollowedLiveChannels();
      const filtered = twitchTargets.size
        ? liveFollowed.filter((s) => twitchTargets.has(s.login.toLowerCase()))
        : liveFollowed;
      filtered.forEach((s) => liveLoginsTwitch.add(s.login.toLowerCase()));
      twitchCandidates = filtered.map((s) => ({ channel: s.login, platform: 'twitch', viewerCount: s.viewerCount }));
    } catch (err) {
      const now = Date.now();
      if (now - autoTuneInLastErrorNotifiedAt > 5 * 60 * 1000) {
        autoTuneInLastErrorNotifiedAt = now;
        notifyRenderer('auto-tune-in:error', { message: `Twitch: ${String(err.message || err)}` });
      }
    }

    const liveHandlesYoutube = new Set();
    const youtubeCandidates = [];
    if (youtubeTargets.length) {
      await mapWithConcurrency(youtubeTargets, UNIFIED_FEED_YOUTUBE_CONCURRENCY, async (handle) => {
        try {
          // リトライ付き: 1回の判定失敗で「配信終了した」と誤認して既存タイルを削除してしまう
          // チラつきを減らす（統一フィードの表示消失と同じ原因への対策）
          await resolveYoutubeLiveVideoIdFreeWithRetry(handle);
          liveHandlesYoutube.add(handle);
          youtubeCandidates.push({ channel: handle, platform: 'youtube', viewerCount: null });
        } catch (_) {
          // 配信中ではない。エラー通知はしない（Twitch同様、単に対象外として扱う）
        }
      });
    }

    // 配信が終了した（または対象指定から外れた）Auto Tune-In追加チャンネルを削除
    autoTuneInAddedChannels().forEach(({ channel, platform }) => {
      const stillLive = platform === 'youtube' ? liveHandlesYoutube.has(channel) : liveLoginsTwitch.has(channel.toLowerCase());
      if (!stillLive) {
        removeChannel(channel);
        changed = true;
      }
    });

    // 上限を後から引き下げた場合の超過分を間引く（Drops自動追加と同じ自己修復ロジック）
    const overCap = autoTuneInAddedChannels();
    if (overCap.length > (cfg.maxTiles || 0)) {
      const excess = overCap.length - (cfg.maxTiles || 0);
      overCap.slice(0, excess).forEach(({ channel }) => {
        removeChannel(channel);
        changed = true;
      });
    }

    // 上限まで新規追加。
    // 対象指定（チェック済み）のチャンネルを常に優先する（統一フィードの並び順と同じ考え方）。
    // 修正前は視聴者数だけでソートしていたため、視聴者数を持たないYouTube（対象指定）が
    // 視聴者数の多いTwitch（対象指定なし＝「フォロー中なら誰でも」の全件）に埋もれて
    // ほぼ選ばれないという不具合があった。対象指定内では従来通り視聴者数順（Twitch優先）。
    const currentCount = autoTuneInAddedChannels().length;
    const slotsLeft = Math.max(0, (cfg.maxTiles || 0) - currentCount);
    if (slotsLeft > 0) {
      const candidates = [...twitchCandidates, ...youtubeCandidates]
        .filter((c) => !streamViews.has(c.channel))
        .map((c) => ({ ...c, isTarget: isAutoTuneInTarget(c.platform, c.channel) }))
        .sort((a, b) => {
          if (a.isTarget !== b.isTarget) return a.isTarget ? -1 : 1;
          return (b.viewerCount || 0) - (a.viewerCount || 0);
        });
      candidates.slice(0, slotsLeft).forEach((c) => {
        addChannel(c.channel, {
          auto: true,
          autoGame: null,
          autoSource: 'tune-in',
          platform: c.platform,
          youtubeChannelId: c.platform === 'youtube' ? c.channel : undefined,
        });
        changed = true;
      });
    }
    if (changed) notifyRenderer('channels:changed');
  } catch (err) {
    // 1回の失敗でウォッチャー自体は止めず、通知は5分に1回までに抑える（Drops自動追加と同じ方針）
    const now = Date.now();
    if (now - autoTuneInLastErrorNotifiedAt > 5 * 60 * 1000) {
      autoTuneInLastErrorNotifiedAt = now;
      notifyRenderer('auto-tune-in:error', { message: String(err.message || err) });
    }
  } finally {
    autoTuneInCheckRunning = false;
  }
}

function startAutoTuneInWatcher() {
  if (autoTuneInTimer) return;
  runAutoTuneInCheck(); // 設定変更直後に即時反映
  autoTuneInTimer = setInterval(runAutoTuneInCheck, AUTO_TUNE_IN_INTERVAL_MS);
}

function stopAutoTuneInWatcher() {
  if (!autoTuneInTimer) return;
  clearInterval(autoTuneInTimer);
  autoTuneInTimer = null;
}

/**
 * 有効フラグ＆連携状態が変わった時に呼ぶ。有効かつ「Twitch連携済み、またはYouTube対象指定が1件以上」の
 * どちらかを満たす時だけ（再）起動する（YouTubeの配信中判定は公開ページ確認のためログイン不要で動く）。
 */
function syncAutoTuneInWatcherState() {
  const cfg = store.get('autoTuneIn');
  const auth = store.get('twitchUserAuth');
  const hasYoutubeTargets = getAutoTuneInTargets().some((t) => t.platform === 'youtube');
  if (cfg.enabled && (auth || hasYoutubeTargets)) startAutoTuneInWatcher();
  else stopAutoTuneInWatcher();
}

// ---- ランダム自動切換え（ザッピング）機能 ----
// ニコニコ生放送のクルーズ機能を参考にしたオリジナル機能（競合の定番マルチストリームサイトには無い）。
// 言語・ゲーム・タグで絞り込んだランダムな配信を10〜30秒間隔（毎回ランダム）で自動切換えする。
// 実装は「専用のタイル」を1つ持ち、その中身（表示する配信）を定期的に差し替える方式。
// 既存のタイル自由配置・自由リサイズ・チャット表示切替の仕組みをそのまま流用できるよう、
// 内部的には addChannel/removeChannel を呼び出して「古いチャンネルを消して新しいチャンネルを追加」
// する形にし、その際にタイルの位置・サイズ・チャット表示設定だけは引き継ぐ。
// Twitchの「ジャンル」には厳密な階層分類が無いため、タグによる絞り込みは取得した配信のtags配列に対する
// 部分一致（大文字小文字を区別しない）というゆるい判定にとどめている。

let zappingTimer = null;
let currentZappingChannel = null; // 現在ザッピングタイルに表示中のチャンネル名（null = ザッピング未起動）
const zappingLastErrorNotifiedAt = { at: 0 };

function randomIntInclusive(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---- Kick版ザッピング候補取得 ----
// Kickは公式Public API（api.kick.com/public/v1）にclient_credentialsグラントによる
// App Access Token（アプリ登録のClient ID/Secretのみで取得可能、ユーザーのログイン状態は不要）が
// 存在するため、resolveKickChatroomId等で使っている「隠しBrowserView経由のsame-origin fetch」
// （TLSフィンガープリンティング回避目的）は不要。この非公式回避が必要なのはkick.com自身の内部API
// （api/v2/...、Cookie/session_token前提）だけで、公式Public APIは通常のNode https直叩きで問題ない
// （Twitchのhelix app tokenと同じ位置づけ）。
let kickAppTokenCache = { token: null, expiresAt: 0 };

/** Kick Public APIのApp Access Token（client_credentialsグラント）を取得する。取得済みならキャッシュを使う。 */
async function getKickAppToken() {
  const clientId = store.get('kickClientId');
  const clientSecret = store.get('kickClientSecret');
  if (!clientId || !clientSecret) {
    throw new Error('Kick Client ID / Client Secretが未設定です。設定画面で入力してください（Kick Developer Portalで登録可能）。');
  }
  if (kickAppTokenCache.token && Date.now() < kickAppTokenCache.expiresAt) {
    return kickAppTokenCache.token;
  }
  const res = await httpsPostForm('https://id.kick.com/oauth/token', {
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (res.status !== 200 || !res.json?.access_token) {
    throw new Error(`Kick App Access Tokenの取得に失敗しました: ${res.status} ${JSON.stringify(res.json || res.raw || '')}`);
  }
  kickAppTokenCache = {
    token: res.json.access_token,
    expiresAt: Date.now() + (Number(res.json.expires_in || 3600) - 60) * 1000,
  };
  return kickAppTokenCache.token;
}

const kickCategoryIdCache = new Map(); // カテゴリ名(lowercase) -> category_id

/**
 * カテゴリ名からcategory_idを取得する（Public API `/public/v1/categories?q=`、あいまい検索で先頭候補を採用）。
 * v1は非推奨表示だが、v2（/public/v2/categories）はname[]パラメータが「既知の名称での絞り込み」用途で
 * あいまい検索を意図していないため、ユーザーが自由入力するゲーム名の解決にはv1のq=検索を使う。
 */
async function resolveKickCategoryId(categoryName) {
  const key = categoryName.trim().toLowerCase();
  if (kickCategoryIdCache.has(key)) return kickCategoryIdCache.get(key);
  const token = await getKickAppToken();
  const res = await httpsRequestJson(`https://api.kick.com/public/v1/categories?q=${encodeURIComponent(categoryName.trim())}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200 || !res.json?.data?.length) {
    throw new Error(`カテゴリ「${categoryName}」が見つかりませんでした`);
  }
  const categoryId = res.json.data[0].id;
  kickCategoryIdCache.set(key, categoryId);
  return categoryId;
}

/** 現在の絞り込み条件（言語・カテゴリ・タグ）に合致する配信中Kickチャンネルの候補一覧を取得する */
async function fetchKickZappingCandidates(filters) {
  const token = await getKickAppToken();

  const params = new URLSearchParams();
  params.set('limit', '100');
  if (filters.language) params.append('language_code', filters.language.trim());
  if (filters.gameName) {
    const categoryId = await resolveKickCategoryId(filters.gameName);
    params.append('category_id', String(categoryId));
  }

  const res = await httpsRequestJson(`https://api.kick.com/public/v2/livestreams?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) {
    throw new Error(`配信一覧の取得に失敗しました: ${res.status}`);
  }

  let streams = res.json.data || [];

  // タグによるゆるい絞り込み（Twitch版と同じ考え方。Kickのtagsは配信に付与された自由入力タグ）
  const tagKeywords = (filters.tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (tagKeywords.length > 0) {
    streams = streams.filter((s) => {
      const streamTags = (s.tags || []).map((t) => String(t).toLowerCase());
      return tagKeywords.some((kw) => streamTags.some((tag) => tag.includes(kw)));
    });
  }

  // 既に他のタイルで開いているチャンネル（ザッピング中の現在チャンネル自身を除く）は候補から除外
  return streams
    .map((s) => ({ platform: 'kick', channel: s.channel?.slug }))
    .filter((c) => c.channel && c.channel !== currentZappingChannel && !streamViews.has(c.channel));
}

/** 現在の絞り込み条件（言語・ゲーム・タグ）に合致する配信中Twitchチャンネルの候補一覧を取得する */
async function fetchTwitchZappingCandidates(filters) {
  const clientId = store.get('helixClientId');
  const token = await getHelixAppToken();

  const params = new URLSearchParams();
  params.set('first', '100');
  if (filters.language) params.set('language', filters.language.trim());
  if (filters.gameName) {
    const gameId = await resolveGameId(filters.gameName);
    params.set('game_id', gameId);
  }

  const res = await httpsRequestJson(`https://api.twitch.tv/helix/streams?${params.toString()}`, {
    headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) {
    throw new Error(`配信一覧の取得に失敗しました: ${res.status}`);
  }

  let streams = res.json.data || [];

  // タグによるゆるい絞り込み（Twitchにはジャンルの厳密な階層分類が無いため、
  // 配信のtags配列に対する部分一致で代用する）
  const tagKeywords = (filters.tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (tagKeywords.length > 0) {
    streams = streams.filter((s) => {
      const streamTags = (s.tags || []).map((t) => String(t).toLowerCase());
      return tagKeywords.some((kw) => streamTags.some((tag) => tag.includes(kw)));
    });
  }

  // 既に他のタイルで開いているチャンネル（ザッピング中の現在チャンネル自身を除く）は候補から除外し、
  // 同じ配信が重複して開かれるのを防ぐ
  return streams
    .map((s) => ({ platform: 'twitch', channel: s.user_login }))
    .filter((c) => c.channel !== currentZappingChannel && !streamViews.has(c.channel));
}

/**
 * youtube.com/live の動画一覧（ytd-rich-item-renderer等）は、ウィンドウに全く追加していない
 * （addBrowserViewしていない）完全に非表示のBrowserViewだと、実機検証の結果 document.title 等の
 * テキストは取れるのに動画一覧の要素が1件も描画されない（0件のまま）ことが判明した。
 * これはチャット自動送信の実装時に踏んだのと同じ「Chromiumが非表示（occluded）のビューでは
 * IntersectionObserver等に依存する遅延描画を止めてしまう」問題だと考えられる
 * （withAttachedForAutomation関数のコメント参照）。
 * そのため、この関数専用にウィンドウへ一時的に実サイズで追加（＝画面に一瞬映る）して描画を
 * 成立させてから読み取り、終わったら外す。既存のwithAttachedForAutomationは2x2pxの極小サイズで
 * 「見た目への影響を抑える」設計だが、それだと動画グリッドのレイアウト自体が成立せず今回の
 * 目的には使えないため、専用の処理にしている。
 * 毎回のザッピング切り替え（10〜30秒間隔）のたびにこの「一瞬画面に映る」処理が起きると
 * 煩わしいため、結果は数分間キャッシュし、キャッシュが新しい間は再スクレイピングしない。
 */
let youtubeLiveDirectoryCache = { items: [], fetchedAt: 0 };
const youtubeSearchLiveCache = new Map(); // keyword(lowercase) -> { items, fetchedAt }
const YOUTUBE_SEARCH_LIVE_CACHE_MAX_ENTRIES = 5;
const YOUTUBE_LIVE_DIRECTORY_CACHE_TTL_MS = 3 * 60 * 1000;

// youtube.com/live 本体・シェルフ拡大ページ双方で使い回す、現在表示中ページからの
// 「ライブ配信中の動画一覧」抽出ロジック（スクロールで遅延読み込み分も拾ってから抽出する）。
const YOUTUBE_LIVE_SCROLL_AND_EXTRACT_SCRIPT = `
  (async function () {
    let lastCount = -1;
    for (let i = 0; i < 10; i++) {
      const count = document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer').length;
      if (count > 0 && count === lastCount) break;
      lastCount = count;
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((r) => setTimeout(r, 800));
    }
    var nodes = Array.from(document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer'));
    var seen = {};
    var result = [];
    nodes.forEach(function (el) {
      // LIVEバッジの有無で現在配信中のものだけに絞る（非公式ヒューリスティック、
      // YouTube側のUI変更でこのセレクタが効かなくなる可能性がある）
      var badge = el.querySelector(
        '[overlay-style="LIVE"], .badge-style-type-live-now-alternate, ytd-thumbnail-overlay-time-status-renderer[overlay-style="LIVE"]'
      );
      if (!badge) return;
      var titleEl = el.querySelector('#video-title, a#video-title-link');
      var channelEl = el.querySelector('ytd-channel-name a, #channel-name a, #text.ytd-channel-name');
      var href = titleEl ? titleEl.getAttribute('href') : null;
      var title = titleEl ? (titleEl.textContent || '').trim() : '';
      var channelName = channelEl ? (channelEl.textContent || '').trim() : '';
      // youtube.com/live のライブ枠は href が "/watch?v=ID" ではなく "/live/ID" 形式になっている
      // ことが実機確認で判明したため、両方の形式に対応する。
      var vMatch = href ? href.match(/\\/live\\/([\\w-]{11})/) || href.match(/[?&]v=([\\w-]{11})/) : null;
      var videoId = vMatch ? vMatch[1] : null;
      if (!videoId || !channelName || seen[videoId]) return;
      seen[videoId] = true;
      result.push({ videoId: videoId, title: title, channelName: channelName });
    });
    return result;
  })();
`;

/** 生成済みBrowserViewをmainWindowにアタッチし、youtube.com/liveを開いて描画されるまで待つ共通処理 */
async function openYoutubeLiveView(view) {
  mainWindow.addBrowserView(view);
  const { width, height } = mainWindow.getContentBounds();
  view.setBounds({ x: 0, y: HEADER_HEIGHT, width, height: Math.max(400, height - HEADER_HEIGHT) });

  await view.webContents.loadURL('https://www.youtube.com/live');
  await view.webContents.executeJavaScript(
    'new Promise(r => { if (document.readyState === "complete") r(); else window.addEventListener("load", r); })'
  );
  // youtube.com/live は特定チャンネルへリダイレクトされた上でその中の動画一覧を描画するため、
  // 通常のページより初期描画に時間がかかることが実機確認で分かった。待機を長めに取る。
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

/** BrowserViewの後始末（デタッチ・about:blank化・遅延destroy）を共通化 */
function cleanupYoutubeLiveView(view) {
  try {
    mainWindow.removeBrowserView(view);
  } catch (_) {
    /* ignore */
  }
  try {
    view.webContents.loadURL('about:blank');
  } catch (_) {
    /* ignore */
  }
  scheduleWebContentsDestroy(view.webContents);
  if (!contentViewsHiddenForOverlay) relayoutStreamViews();
}

async function scrapeYoutubeLiveDirectory() {
  if (!mainWindow) return [];
  const view = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: true, partition: PLATFORM_CONFIG.youtube.partition },
  });
  try {
    await openYoutubeLiveView(view);
    const raw = await view.webContents.executeJavaScript(YOUTUBE_LIVE_SCROLL_AND_EXTRACT_SCRIPT);
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    throw new Error(`YouTubeのライブ一覧取得に失敗しました（YouTube側のページ構造変更の可能性）: ${String(err.message || err)}`);
  } finally {
    cleanupYoutubeLiveView(view);
  }
}

/**
 * ゲーム名・タグでの絞り込み時に使う、YouTube検索の「ライブ」フィルタ結果からの抽出。
 * youtube.com/results?search_query=KEYWORD&sp=EgJAAQ%253D%253D は、YouTube公式の検索機能で
 * 「ライブ配信中」に絞り込んだ結果を返すため、youtube.com/live のトップページ（ニュース・スポーツ等が
 * 中心で特定ゲームがほぼ含まれない）と違い、キーワードに実際に一致する配信のみを拾える。
 * 実機のChrome確認で、この検索結果ページは videoタイトル要素・チャンネル名要素は
 * youtube.com/live と共通だが、ライブバッジのクラスが異なる（.ytBadgeShapeLive）ことを確認済み。
 */
async function scrapeYoutubeSearchLive(keyword) {
  if (!mainWindow) return [];
  const view = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: true, partition: PLATFORM_CONFIG.youtube.partition },
  });
  try {
    mainWindow.addBrowserView(view);
    const { width, height } = mainWindow.getContentBounds();
    view.setBounds({ x: 0, y: HEADER_HEIGHT, width, height: Math.max(400, height - HEADER_HEIGHT) });

    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}&sp=EgJAAQ%253D%253D`;
    await view.webContents.loadURL(searchUrl);
    await view.webContents.executeJavaScript(
      'new Promise(r => { if (document.readyState === "complete") r(); else window.addEventListener("load", r); })'
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const raw = await view.webContents.executeJavaScript(`
      (async function () {
        let lastCount = -1;
        for (let i = 0; i < 8; i++) {
          const count = document.querySelectorAll('ytd-video-renderer').length;
          if (count > 0 && count === lastCount) break;
          lastCount = count;
          window.scrollTo(0, document.documentElement.scrollHeight);
          await new Promise((r) => setTimeout(r, 800));
        }
        var nodes = Array.from(document.querySelectorAll('ytd-video-renderer'));
        var seen = {};
        var result = [];
        nodes.forEach(function (el) {
          // 検索結果ページのライブバッジは youtube.com/live トップページと異なるクラス構成のため、
          // 両方のパターンに対応しておく（非公式ヒューリスティック）
          var badge = el.querySelector(
            '.ytBadgeShapeLive, [overlay-style="LIVE"], .badge-style-type-live-now-alternate, ytd-thumbnail-overlay-time-status-renderer[overlay-style="LIVE"]'
          );
          if (!badge) return;
          var titleEl = el.querySelector('#video-title, a#video-title-link');
          var channelEl = el.querySelector('ytd-channel-name a, #channel-name a, #text.ytd-channel-name');
          var href = titleEl ? titleEl.getAttribute('href') : null;
          var title = titleEl ? (titleEl.textContent || '').trim() : '';
          var channelName = channelEl ? (channelEl.textContent || '').trim() : '';
          var vMatch = href ? href.match(/[?&]v=([\\w-]{11})/) : null;
          var videoId = vMatch ? vMatch[1] : null;
          if (!videoId || !channelName || seen[videoId]) return;
          seen[videoId] = true;
          result.push({ videoId: videoId, title: title, channelName: channelName });
        });
        return result;
      })();
    `);
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    // キーワード検索はベストエフォートのため、失敗しても全体のエラーにはせず空配列で継続する
    console.error('scrapeYoutubeSearchLive failed:', err);
    return [];
  } finally {
    cleanupYoutubeLiveView(view);
  }
}

/** キャッシュ済みならそれを、古い/未取得ならscrapeYoutubeLiveDirectory()で取得し直す */
async function getYoutubeLiveDirectoryItems() {
  const fresh = Date.now() - youtubeLiveDirectoryCache.fetchedAt < YOUTUBE_LIVE_DIRECTORY_CACHE_TTL_MS;
  if (fresh && youtubeLiveDirectoryCache.items.length) return youtubeLiveDirectoryCache.items;
  const items = await scrapeYoutubeLiveDirectory();
  youtubeLiveDirectoryCache = { items, fetchedAt: Date.now() };
  return items;
}

/** キーワード別にキャッシュ済みならそれを、古い/未取得ならscrapeYoutubeSearchLive()で取得し直す */
async function getYoutubeSearchLiveItems(keyword) {
  const key = keyword.trim().toLowerCase();
  const cached = youtubeSearchLiveCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < YOUTUBE_LIVE_DIRECTORY_CACHE_TTL_MS) {
    return cached.items;
  }
  const items = await scrapeYoutubeSearchLive(keyword);
  youtubeSearchLiveCache.set(key, { items, fetchedAt: Date.now() });
  // キーワードは絞り込み入力次第で多様になり得るため、キャッシュが際限なく増えないよう古い順に間引く
  if (youtubeSearchLiveCache.size > YOUTUBE_SEARCH_LIVE_CACHE_MAX_ENTRIES) {
    const oldestKey = Array.from(youtubeSearchLiveCache.entries()).sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0][0];
    youtubeSearchLiveCache.delete(oldestKey);
  }
  return items;
}

/**
 * YouTube版ザッピング候補: youtube.com/live（YouTube公式のライブ配信ディレクトリページ）から
 * 収集した現在ライブ配信中の動画一覧（キャッシュ経由）を、絞り込み条件で候補に絞る。
 * Twitchの/helix/streamsのような「言語・ゲームで厳密に絞り込める公式API」がYouTubeには
 * 無料で存在しないため、初回実装はベストエフォート:
 * - 言語（filters.language）は絞り込み手段が無いため非対応（無視する）
 * - ゲーム名・タグは動画タイトル・チャンネル名に対するゆるい部分一致で代用する
 * ページの実際のDOM構造は変わりやすいため、非公式ヒューリスティックとして注記モーダルに開示する。
 */
async function fetchYoutubeZappingCandidates(filters) {
  // ゲーム名・タグ入力はYouTube側の絞り込み手段が無いため、以前はタイトル・チャンネル名への
  // ゆるい部分一致のみで代用していたが、その母集団（youtube.com/liveトップの一般候補）自体が
  // ニュース・スポーツ等中心で特定ゲームをほぼ含まず、常に0件になってしまっていた。
  // そこでYouTube検索の「ライブ」フィルタ（youtube.com/results?...&sp=EgJAAQ%3D%3D）を使い、
  // キーワードに実際に一致する配信中の動画だけを取得するようにする（Twitchのゲーム名絞り込みに近い精度）。
  const keywords = [filters.gameName, ...(filters.tags || [])].filter(Boolean).map((k) => k.trim()).filter(Boolean);

  let items;
  if (keywords.length > 0) {
    // 最初のキーワード（ゲーム名優先）でYouTube検索そのものに絞り込ませる
    items = await getYoutubeSearchLiveItems(keywords[0]);
    // 2つ目以降のキーワードがあれば、タイトル・チャンネル名への部分一致でさらに絞り込む（ベストエフォート）
    const secondaryKeywords = keywords.slice(1).map((k) => k.toLowerCase());
    if (secondaryKeywords.length > 0) {
      items = items.filter((c) => {
        const haystack = `${c.title} ${c.channelName}`.toLowerCase();
        return secondaryKeywords.some((kw) => haystack.includes(kw));
      });
    }
  } else {
    items = await getYoutubeLiveDirectoryItems();
  }

  let candidates = items.slice();

  // 既に他のタイルで開いている動画・チャンネルは候補から除外（重複防止、Twitch版と同じ考え方）
  const openVideoIds = new Set(Array.from(streamViews.values()).map((e) => e.youtubeVideoId).filter(Boolean));
  candidates = candidates.filter(
    (c) => !openVideoIds.has(c.videoId) && c.channelName !== currentZappingChannel && !streamViews.has(c.channelName)
  );

  return candidates.map((c) => ({ platform: 'youtube', channel: c.channelName, youtubeVideoId: c.videoId }));
}

/** 現在の絞り込み条件・プラットフォームに合致する配信候補一覧を取得する（{ platform, channel, youtubeVideoId? }[]） */
async function fetchZappingCandidates(filters) {
  if (filters.platform === 'youtube') return fetchYoutubeZappingCandidates(filters);
  if (filters.platform === 'kick') return fetchKickZappingCandidates(filters);
  return fetchTwitchZappingCandidates(filters);
}

/** ザッピングタイルの中身を新しい候補に差し替える。位置・サイズ・チャット表示設定は引き継ぐ。 */
function swapZappingTile(candidate) {
  const previous = currentZappingChannel;
  if (previous && streamViews.has(previous)) {
    // 新チャンネルにも同じタイル位置・チャット表示設定を引き継がせるため、
    // removeChannel で消える前に値を退避し、addChannel前に先回りしてstoreへ書き込んでおく
    const layouts = store.get('tileLayouts');
    const savedRect = layouts[previous];
    const chatHiddenMap = store.get('chatHidden');
    const savedChatHidden = !!chatHiddenMap[previous];

    removeChannel(previous);

    if (savedRect) {
      const newLayouts = store.get('tileLayouts');
      newLayouts[candidate.channel] = savedRect;
      store.set('tileLayouts', newLayouts);
    }
    if (savedChatHidden) {
      const newChatHidden = store.get('chatHidden');
      newChatHidden[candidate.channel] = true;
      store.set('chatHidden', newChatHidden);
    }
  }
  addChannel(candidate.channel, { platform: candidate.platform, youtubeVideoId: candidate.youtubeVideoId });
  currentZappingChannel = candidate.channel;
  // ザッピングタイル専用に保存済みの音量（アプリ再起動をまたいでも維持）を、切り替わった新チャンネルへ
  // 都度再適用する。個別のchannelVolumesはremoveChannelで消えるため、この再適用が無いと
  // 切り替えのたびに音量が100（デフォルト）に戻ってしまう。
  setChannelVolume(candidate.channel, store.get('zappingVolume'));
  notifyRenderer('channels:changed');
}

/**
 * @param {{ throwOnError?: boolean }} opts
 * throwOnError=true の場合はエラーを握りつぶさず呼び出し元に伝える。
 * 「開始」「次へ」など、ユーザー操作に対して直接フィードバックしたい場合に使う
 * （逆にタイマーによる裏側での定期切替は、失敗してもアプリを止めないよう握りつぶして通知だけ行う）。
 */
async function doZapSwitch(opts = {}) {
  const { throwOnError = false } = opts;
  try {
    const filters = store.get('zappingFilters');
    const candidates = await fetchZappingCandidates(filters);
    if (!candidates.length) {
      const message = '条件に合う配信が見つかりませんでした。';
      if (throwOnError) throw new Error(message);
      notifyRenderer('zapping:status', { message: `${message}次の切り替えタイミングで再試行します。` });
      return;
    }
    swapZappingTile(pickRandomFrom(candidates));
    notifyRenderer('zapping:status', { message: `切り替えました: ${currentZappingChannel}` });
  } catch (err) {
    if (throwOnError) throw err;
    if (Date.now() - zappingLastErrorNotifiedAt.at > 60 * 1000) {
      zappingLastErrorNotifiedAt.at = Date.now();
      notifyRenderer('zapping:error', { message: String(err.message || err) });
    }
  }
}

function scheduleNextZap() {
  if (zappingTimer) clearTimeout(zappingTimer);
  const delay = randomIntInclusive(10, 30) * 1000;
  zappingTimer = setTimeout(async () => {
    await doZapSwitch();
    scheduleNextZap();
  }, delay);
}

async function startZapping(filters) {
  if (filters) store.set('zappingFilters', filters);
  if (currentZappingChannel) return; // 既に起動中なら何もしない（フィルタ変更のみ反映）
  await doZapSwitch({ throwOnError: true }); // 開始操作の失敗理由はUIにそのまま返す
  scheduleNextZap();
}

function stopZapping() {
  if (zappingTimer) {
    clearTimeout(zappingTimer);
    zappingTimer = null;
  }
  if (currentZappingChannel) {
    const toRemove = currentZappingChannel;
    currentZappingChannel = null;
    removeChannel(toRemove);
    notifyRenderer('channels:changed');
  }
}

/** ユーザーが「次へ」ボタンで手動スキップした時。タイマーを仕切り直す。 */
async function skipZappingNow() {
  if (!currentZappingChannel) return;
  await doZapSwitch({ throwOnError: true }); // 手動操作の失敗理由もUIにそのまま返す
  scheduleNextZap();
}

// ---- 入力欄の履歴（上下キーで過去の入力を再現） ----
// チャンネル名入力・Drops自動追加/削除のゲーム名入力などで、過去に入力した内容を
// 矢印キーの上下で呼び出せるようにする（シェルのコマンド履歴と同様の使い勝手）。
const INPUT_HISTORY_MAX = 20;

function getInputHistory(key) {
  return store.get('inputHistories')[key] || [];
}

/** 履歴に追加する。既存の同じ値（大文字小文字は区別しない）は先頭に移動し、重複は持たない。 */
function addInputHistory(key, value) {
  const v = String(value || '').trim();
  if (!v) return getInputHistory(key);
  const histories = store.get('inputHistories');
  const list = (histories[key] || []).filter((item) => item.toLowerCase() !== v.toLowerCase());
  list.unshift(v);
  histories[key] = list.slice(0, INPUT_HISTORY_MAX);
  store.set('inputHistories', histories);
  return histories[key];
}

/**
 * #13対応: 履歴一覧UI（チャンネル名入力欄）の各行に付けた×ボタンから、指定した1件だけを
 * 履歴から削除する。大文字小文字を区別せずに一致判定する（addInputHistoryの重複判定と統一）。
 */
function removeInputHistoryItem(key, value) {
  const v = String(value || '').trim();
  const histories = store.get('inputHistories');
  const list = (histories[key] || []).filter((item) => item.toLowerCase() !== v.toLowerCase());
  histories[key] = list;
  store.set('inputHistories', histories);
  return list;
}

// ---- IPC ----

/**
 * streamViews内に、指定のYouTubeハンドル/チャンネルIDと大文字小文字を無視して一致する
 * エントリが既に存在するか判定する。
 * 背景（#13 YouTube @不具合）: 同じチャンネルでも「@handle」で追加した場合と
 * 「https://www.youtube.com/@handle」のURLで追加した場合とで、修正前は識別キー
 * （streamViewsのMapキー＝タイル表示名）が別物になっていた（前者は@handleそのまま、
 * 後者は生URL文字列）。この表記揺れにより、同一チャンネルの重複追加を検知できない、
 * 統一フィード/Auto Tune-Inの「追加済み」判定が一致しない、といった不具合が起きていた。
 * ハンドルの大文字小文字表記揺れも同様の理由でここで吸収する。
 */
function hasYoutubeChannel(handle) {
  const target = String(handle || '').toLowerCase();
  if (!target) return false;
  for (const [key, entry] of streamViews) {
    if ((entry.platform || 'twitch') === 'youtube' && key.toLowerCase() === target) return true;
  }
  return false;
}

// 第2引数は文字列（チャンネル名のみ、Twitch扱い＝後方互換）または { name, platform } のどちらも受け付ける
ipcMain.handle('channels:add', async (_e, payload) => {
  const { name, platform } = typeof payload === 'string' ? { name: payload, platform: 'twitch' } : payload || {};
  const trimmed = String(name || '').trim();
  if (!trimmed) return { ok: false, error: 'チャンネル名を入力してください' };

  if (platform === 'youtube') {
    // 配信の動画URL（watch?v=・youtu.be等）を直接貼り付けた場合は、その動画IDでそのまま埋め込む
    // （APIを一切呼ばない、最も確実）。
    // ハンドル（@name）・チャンネル名・チャンネルURLの場合は、無料の/liveリダイレクト方式
    // （resolveYoutubeLiveVideoIdFree、YouTube Data APIは使わない）で現在配信中の動画を
    // addChannel内部で非同期に解決する。
    const parsed = parseYoutubeInput(trimmed);
    // タイルの識別キー（＝表示名）は、URL貼り付けでもハンドル直接入力でも同じ値になるよう
    // parseYoutubeInput()で正規化済みの値を使う（#13対策）。動画URL直接貼り付け（kind==='video'）
    // だけは、識別キーが動画IDだと分かりにくいため従来通り生入力のままにする。
    const identifier = parsed.kind === 'video' ? trimmed : parsed.value;
    if (hasYoutubeChannel(identifier)) return { ok: false, error: '既に追加されています' };
    if (parsed.kind === 'video') {
      addChannel(identifier, { platform: 'youtube', youtubeVideoId: parsed.value });
    } else {
      addChannel(identifier, { platform: 'youtube', youtubeChannelId: parsed.value });
    }
    // 全タブ統合パネルが開いている場合にリアルタイムで新規タブを反映させるため通知する
    // （renderer側のonChannelsChangedがrefreshChatIntegrationIfOpen経由でsyncIrcChannels等を呼ぶ）。
    notifyRenderer('channels:changed');
    return { ok: true };
  }

  if (streamViews.has(trimmed)) return { ok: false, error: '既に追加されています' };

  if (platform === 'kick') {
    // Kickは公式埋め込みプレイヤー（player.kick.com/{username}）にユーザー名（=Kickのスラッグ）を
    // そのまま渡すだけで再生できるため、YouTubeのような動画ID解決は不要。
    addChannel(trimmed, { platform: 'kick' });
    notifyRenderer('channels:changed');
    return { ok: true };
  }

  addChannel(trimmed);
  notifyRenderer('channels:changed');
  return { ok: true };
});

ipcMain.handle('channels:remove', (_e, channelName) => {
  // ザッピングタイルのチップを×で消された場合は、単なるチャンネル削除ではなく
  // ザッピング機能自体を停止する（そうしないとタイマーが生きたままになり、
  // 次の切り替えタイミングで勝手にタイルが復活してしまうため）
  if (channelName === currentZappingChannel) {
    stopZapping();
  } else {
    removeChannel(channelName);
  }
  return Array.from(streamViews.keys());
});

ipcMain.handle('channels:list', () => {
  const order = store.get('channelOrder').filter((c) => streamViews.has(c));
  streamViews.forEach((_v, c) => {
    if (!order.includes(c)) order.push(c);
  });
  return order;
});

ipcMain.handle('channels:reorder', (_e, newOrder) => {
  reorderChannels(newOrder);
  return store.get('channelOrder');
});

/** チャンネル毎のプラットフォーム（'twitch'|'youtube'）対応表（UIでのバッジ表示・チャット切替可否判定用） */
ipcMain.handle('channels:get-platforms', () => {
  const result = {};
  streamViews.forEach((entry, channel) => {
    result[channel] = entry.platform || 'twitch';
  });
  return result;
});

// チップの視聴者数バッジ・ツールチップ用（タイトル・カテゴリ・視聴者数）。
// 重い処理（Kick分はBrowserView生成を伴う）のため、レンダラー側は60秒程度の間隔で定期呼び出しする想定。
ipcMain.handle('channels:get-stream-meta', async () => {
  const meta = await fetchAllStreamMeta();
  // #6対応: このポーリング結果を使って配信開始通知（通知タブ）の検知も同時に行う。
  recordStreamStartNotifications(meta);
  return meta;
});

ipcMain.handle('drops:open', () => {
  ensureDropsView();
  return true;
});

ipcMain.handle('drops:close', () => {
  hideDropsView();
  return true;
});

ipcMain.handle('drops:read-progress', async () => readDropsProgress());

ipcMain.handle('kick-drops:open', () => {
  ensureKickDropsView();
  return true;
});

ipcMain.handle('kick-drops:close', () => {
  hideKickDropsView();
  return true;
});

ipcMain.handle('settings:get-favorites', () => store.get('favoriteEmotes'));

ipcMain.handle('settings:set-favorites', (_e, favorites) => {
  store.set('favoriteEmotes', favorites);
  return true;
});

ipcMain.handle('favorites:toggle', (_e, emote) => toggleFavoriteEmote(emote));

// 設定パネル用の汎用取得/保存（親ドメイン・レイアウト列数・Helix認証情報）
ipcMain.handle('settings:get-all', () => ({
  parentDomain: store.get('parentDomain'),
  layoutColumns: store.get('layoutColumns'),
  helixClientId: store.get('helixClientId'),
  helixClientSecret: store.get('helixClientSecret'),
  youtubeDataApiKey: store.get('youtubeDataApiKey'),
  kickClientId: store.get('kickClientId'),
  kickClientSecret: store.get('kickClientSecret'),
  paymentBackendUrl: store.get('paymentBackendUrl'),
  commentFontFamily: store.get('commentFontFamily'),
  chatIntegrationMode: store.get('chatIntegrationMode'),
  unifiedFeedPlatformFilter: store.get('unifiedFeedPlatformFilter'),
}));

ipcMain.handle('settings:set-all', (_e, partial) => {
  const reloadNeeded = 'parentDomain' in partial && partial.parentDomain !== store.get('parentDomain');
  Object.entries(partial).forEach(([k, v]) => store.set(k, v));
  if ('layoutColumns' in partial) relayoutStreamViews();
  if (reloadNeeded) {
    // parentDomain 変更はTwitch埋め込みにのみ関係するため、YouTube/Kickチャンネルは対象外
    const parent = store.get('parentDomain');
    streamViews.forEach((entry, channel) => {
      if (entry.platform === 'youtube' || entry.platform === 'kick') return;
      entry.streamView.webContents.loadURL(
        `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${parent}&muted=false`
      );
      entry.chatView.webContents.loadURL(
        `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?parent=${parent}&darkpopout`
      );
    });
  }
  return true;
});

// タイル自由配置・自由リサイズ（ウィンドウマネージャー相当）
ipcMain.handle('layout:get-all', () => {
  if (!mainWindow) return { tiles: [], contentWidth: 0, contentHeight: 0 };
  const order = store.get('channelOrder').filter((c) => streamViews.has(c));
  streamViews.forEach((_v, c) => {
    if (!order.includes(c)) order.push(c);
  });
  const { width, height } = mainWindow.getContentBounds();
  const usableHeight = height - HEADER_HEIGHT;
  return {
    minWidth: MIN_TILE_WIDTH,
    minHeight: MIN_TILE_HEIGHT,
    contentWidth: width,
    contentHeight: usableHeight,
    tiles: order.map((c) => ({ channel: c, rect: ensureTileLayout(c) })),
  };
});

ipcMain.handle('layout:auto-arrange', () => {
  autoArrangeAllTiles();
  return true;
});

// タイルのドラッグ移動／端リサイズ：配信・チャットのBrowserView内に注入したプリロードから
// mousedown/mouseup 時に送られてくる（高頻度なmousemoveはメインプロセス側のポーリングで処理するため、
// ここは開始/終了の2イベントのみを受ける one-way の ipcMain.on）。
ipcMain.on('tile-interaction:start', (_e, { channel, type, dir, screenX, screenY, origin }) => {
  startTileInteraction(channel, type, dir, screenX, screenY, origin);
});

ipcMain.on('tile-interaction:move', (_e, { x, y }) => {
  updateTileInteraction(x, y);
});

ipcMain.on('tile-interaction:end', () => {
  stopTileInteraction();
});

// レンダラー（コントロールパネル部分）側でmouseupを検知した場合の保険（BrowserViewに覆われない
// 隙間・ヘッダー領域でマウスを離した場合など、プリロード側のmouseupが発火しないケースに備える）
ipcMain.handle('layout:interaction-end', () => {
  stopTileInteraction();
  return true;
});

// チャンネル毎の「チャット画面を表示しない」設定
ipcMain.handle('channels:get-chat-hidden-map', () => store.get('chatHidden'));

ipcMain.handle('channels:set-chat-hidden', (_e, { channel, hidden }) => {
  setChatHidden(channel, hidden);
  return true;
});

// #7対応: チャット統合パネル（タブ/全タブ統合）側のチャンネル毎チャット表示ON/OFF
ipcMain.handle('chat-integration:get-hidden-map', () => store.get('chatIntegrationHidden'));

// #6対応: 通知タブ（配信開始通知）
ipcMain.handle('notifications:get-state', () => getNotificationsState());
ipcMain.handle('notifications:mark-read', () => {
  markNotificationsRead();
  return true;
});

ipcMain.handle('chat-integration:set-hidden', (_e, { channel, hidden }) => {
  setChatIntegrationHidden(channel, hidden);
  return true;
});

// チャンネル毎の個別音量調整
ipcMain.handle('channels:get-volumes', () => store.get('channelVolumes'));

ipcMain.handle('channels:set-volume', (_e, { channel, volume }) => {
  setChannelVolume(channel, volume);
  return true;
});

// HTMLオーバーレイ（設定/スタンプ/注記など）表示中はBrowserViewを一時的に外す
ipcMain.handle('ui:hide-content-views', () => {
  hideContentViewsForOverlay();
  return true;
});

ipcMain.handle('ui:show-content-views', () => {
  showContentViewsForOverlay();
  return true;
});

// スタンプ/ザッピング/音量ミキサー/設定/チャット統合パネルなど、配信を表示したまま操作したい
// サイドパネル用。複数パネルを同時に開けるよう、開閉をIDベースで管理する。
ipcMain.handle('ui:open-side-panel', (_e, { id, width }) => {
  // 2026-08-08修正（独立レビュー指摘）: 配信チェック(unified-feed)は#16向けに専用BrowserView
  // を最前面表示するオーバーレイパネル方式へ移植済みだが、openSidePanel系のパネル（設定/ザッピング/
  // スタンプ等）はメインウィンドウのDOM要素（right:0基準の絶対配置）のままで、BrowserViewより
  // 必ず下のz-orderになる。overlayPanelViewを開いたまま別のサイドパネルを開くと、そのサイドパネルが
  // overlayPanelViewの裏に完全に隠れて操作不能になってしまうため、サイドパネルを開く際は
  // 先にオーバーレイパネルを閉じておく（同時に開いていた状態を意図的に許可しない）。
  if (overlayPanelOpenId) closeOverlayPanel();
  openSidePanel(id, width);
  return true;
});

ipcMain.handle('ui:close-side-panel', (_e, id) => {
  closeSidePanel(id);
  return true;
});

ipcMain.handle('ui:close-all-side-panels', () => {
  closeAllSidePanels();
  return true;
});

// 汎用オーバーレイパネル基盤（#16向け、2026-08-07新設）。openSidePanel系とは独立したIPC。
ipcMain.handle('ui:open-overlay-panel', (_e, panelId) => {
  // 上のui:open-side-panelコメントと対になる修正: オーバーレイパネル（配信チェック等）を
  // 開く際も、既に開いているサイドパネルが同様にoverlayPanelViewの裏へ隠れてしまうため、
  // 先にすべて閉じておく。
  if (openPanels.length) closeAllSidePanels();
  openOverlayPanel(panelId);
  return true;
});

ipcMain.handle('ui:close-overlay-panel', () => {
  closeOverlayPanel();
  return true;
});

ipcMain.handle('ui:get-overlay-panel-state', () => overlayPanelOpenId);

// フィードバック下書きの保存/取得（centered化で外側クリック閉じに対応したことに伴う追加）。
ipcMain.handle('ui:get-feedback-draft', () => feedbackDraft);

ipcMain.handle('ui:set-feedback-draft', (_e, { subject, body } = {}) => {
  feedbackDraft = { subject: subject || '', body: body || '' };
  return true;
});

// 初回起動案内ポップアップの表示済みフラグ
ipcMain.handle('app:get-first-launch-done', () => store.get('firstLaunchDone'));

ipcMain.handle('app:set-first-launch-done', () => {
  store.set('firstLaunchDone', true);
  return true;
});

// 有料機能（Pro機能）アンロック状態。会員登録ログイン後のrefreshProAuthStatus（/status連携、
// 開発者本人のメールなら自動アンロック）によってのみ更新される。
ipcMain.handle('app:get-premium-unlocked', () => store.get('premiumUnlocked'));

// ---- 自作メニューバー（ファイル/表示/ヘルプ/バージョン。index.html #app-menu-bar、renderer.js） ----
// ネイティブのMenuを廃止した代わりに、実処理だけをここに集約する。表示・開閉・状態の見た目は
// すべてrenderer側の責務。

ipcMain.handle('app-menu:get-state', () => getAppMenuState());

ipcMain.handle('app-menu:quit', () => {
  app.quit();
});

ipcMain.handle('app-menu:reload', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
});

ipcMain.handle('app-menu:toggle-devtools', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.toggleDevTools();
});

ipcMain.handle('app-menu:relayout', () => {
  relayoutStreamViews();
});

ipcMain.handle('app-menu:open-external', (_e, url) => {
  // ヘルプメニューからの固定リンクのみを許可し、任意のURLを開けないようにする。
  const allowed = ['https://dev.twitch.tv/console/apps', 'https://kick.com/settings/developer'];
  if (allowed.includes(url)) shell.openExternal(url);
});

ipcMain.handle('app-menu:check-update', () => {
  manualCheckForUpdates();
});

ipcMain.handle('app-menu:download-update', () => {
  autoUpdater.downloadUpdate();
});

// 「バージョン」メニューのダウンロード完了後、「今すぐ更新」（アプリを終了してインストーラーを
// 起動するだけ。インストール後にアプリを再度開くかどうかはインストーラーの画面上の選択に委ねる）と
// 「今すぐ更新して再起動」（インストール完了後、自動でアプリを再起動する）の2択に分けている。
// electron-updaterのquitAndInstall(isSilent, isForceRunAfter)の第2引数がこの違いに対応する。
ipcMain.handle('app-menu:install-update', (_e, { forceRunAfter } = {}) => {
  autoUpdater.quitAndInstall(false, !!forceRunAfter);
});

// フィードバック（メニューバーの「フィードバック」、バージョンの隣）。以前はmailtoで既定の
// メールソフトを開くだけだったが、アプリ内から直接送れるようにしてほしいという要望を受け、
// 決済バックエンド（multistream-payment-backend）に追加した POST /feedback 経由でDiscordの
// チャンネルへ転送する方式に変更した（2026-07-25）。Discord Webhook URL自体はバックエンド側の
// シークレット（DISCORD_WEBHOOK_URL）としてのみ保持し、Publicリポジトリのこのアプリ側には
// 一切含めていない（paymentBackendFetchは決済方針.md記載の既定バックエンドURLを使い回す）。
ipcMain.handle('app-menu:send-feedback', async (_e, { subject, body } = {}) => {
  await paymentBackendFetch('/feedback', {
    method: 'POST',
    body: JSON.stringify({ subject, body }),
  });
});

// ---- 会員登録（メールアドレス＋6桁確認コード認証、multistream-payment-backend連携） ----
// 決済方針.md参照。カード/都度払いの購入導線自体は別タスクで、まずは
// 「メール入力→確認コード→ログイン→/statusでPro状態確認」の認証部分のみを実装する。

// 決済方針.md記載の本番デプロイ先。paymentBackendUrlのstoreスキーマdefaultとしても設定しているが、
// electron-storeのdefaultはstoreファイルが既に作られている既存インストールには効かない
// （''が保存されたまま残る）ため、読み取り側でも同じ既定値にフォールバックさせている。
const DEFAULT_PAYMENT_BACKEND_URL = 'https://multicastdeck.mumeinoapp.workers.dev';

// 2026-07-31にバックエンドのURLを multistream-payment-backend.mumeinoapp.workers.dev から
// multicastdeck.mumeinoapp.workers.dev に変更した際の旧デフォルトURL。会員登録ポップアップで
// 一度でも「確認コードを送信」等を行ったユーザーは、この旧URLがstoreに明示的に保存されたままに
// なっており、コード側のデフォルト値だけを変更してもそのユーザーには反映されない
// （store.get()は明示的に保存された値をデフォルトより優先するため）。そのため起動時、
// 保存されている値がこの旧デフォルトと完全一致する場合に限り、新デフォルトへ自動的に
// 移行する（ユーザーが独自のURLに変更していた場合はそのまま尊重し、上書きしない）。
const LEGACY_DEFAULT_PAYMENT_BACKEND_URL = 'https://multistream-payment-backend.mumeinoapp.workers.dev';

/** 起動時に一度だけ呼ぶ。paymentBackendUrlが旧デフォルトのままなら新デフォルトへ移行する。 */
function migrateLegacyPaymentBackendUrl() {
  const current = String(store.get('paymentBackendUrl') || '').trim();
  if (current === LEGACY_DEFAULT_PAYMENT_BACKEND_URL) {
    store.set('paymentBackendUrl', DEFAULT_PAYMENT_BACKEND_URL);
  }
}

// 開発者本人（このメールで会員登録ログインした場合）は、Stripeの決済・購読状況に関係なく
// 常にPro機能をアンロックする。表示メニューの手動トグル（廃止済み）に代わる仕組み。
// 配布版の他ユーザーには一切影響しない（このメールでログインできるのは開発者本人のみ）。
const DEVELOPER_EMAIL = 'mumeinoapp@gmail.com';

function isDeveloperEmail(email) {
  return String(email || '').trim().toLowerCase() === DEVELOPER_EMAIL;
}

/** 会員登録ポップアップで入力されたバックエンドURL（末尾スラッシュを除いたもの）を返す。 */
function getPaymentBackendBaseUrl() {
  const raw = String(store.get('paymentBackendUrl') || DEFAULT_PAYMENT_BACKEND_URL).trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

async function paymentBackendFetch(pathname, options = {}) {
  const base = getPaymentBackendBaseUrl();
  if (!base) throw new Error('決済バックエンドURLが利用できません。会員登録のポップアップでご確認ください');
  const res = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    /* レスポンスがJSONでない場合は無視 */
  }
  if (!res.ok) {
    throw new Error((body && (body.error || body.message)) || `サーバーエラー (HTTP ${res.status})`);
  }
  return body;
}

/** /statusを呼び出し、premiumUnlocked・proStatusを更新する。ログイン中でなければ何もしない。 */
async function refreshProAuthStatus() {
  const token = store.get('proAuthToken');
  if (!token) return null;
  try {
    const base = getPaymentBackendBaseUrl();
    if (!base) return null;
    const res = await fetch(`${base}/status?token=${encodeURIComponent(token)}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && (body.error || body.message)) || `サーバーエラー (HTTP ${res.status})`);
    store.set('proStatus', body);
    const active = isDeveloperEmail(store.get('proAuthEmail')) || !!(body && (body.active || body.premiumUnlocked));
    store.set('premiumUnlocked', active);
    notifyRenderer('premium:changed', active);
    return body;
  } catch (err) {
    // ネットワークエラー等は静かに失敗させる（ログイン状態自体は保持し、次回の定期確認に任せる）。
    return { error: String(err.message || err) };
  }
}

ipcMain.handle('pro-auth:get-config', () => ({
  backendUrl: store.get('paymentBackendUrl') || DEFAULT_PAYMENT_BACKEND_URL,
  email: store.get('proAuthEmail') || null,
  loggedIn: !!store.get('proAuthToken'),
  proStatus: store.get('proStatus') || null,
}));

ipcMain.handle('pro-auth:set-backend-url', (_e, value) => {
  store.set('paymentBackendUrl', String(value || '').trim());
  return true;
});

ipcMain.handle('pro-auth:request-code', async (_e, email) => {
  const trimmed = String(email || '').trim();
  if (!trimmed) throw new Error('メールアドレスを入力してください');
  await paymentBackendFetch('/auth/request-code', {
    method: 'POST',
    body: JSON.stringify({ email: trimmed }),
  });
  return true;
});

ipcMain.handle('pro-auth:verify-code', async (_e, { email, code }) => {
  const trimmedEmail = String(email || '').trim();
  const trimmedCode = String(code || '').trim();
  if (!trimmedEmail || !trimmedCode) throw new Error('メールアドレスと確認コードを入力してください');
  const body = await paymentBackendFetch('/auth/verify-code', {
    method: 'POST',
    body: JSON.stringify({ email: trimmedEmail, code: trimmedCode }),
  });
  const token = body && body.token;
  if (!token) throw new Error('サーバーからトークンを取得できませんでした');
  store.set('proAuthToken', token);
  store.set('proAuthEmail', trimmedEmail);
  const status = await refreshProAuthStatus();
  return { email: trimmedEmail, proStatus: status };
});

ipcMain.handle('pro-auth:refresh-status', async () => refreshProAuthStatus());

/**
 * 購入（お申し込み）ボタン。/checkout でCheckout SessionのURLを発行してもらい、
 * アプリ内に埋め込まず既定のブラウザで開く（カード番号等をアプリのBrowserViewに
 * 直接入力させない、Stripeの決済ページはアプリ外の信頼できるコンテキストで見せる）。
 * method: "card"（自動更新サブスク） | "other"（months: 1|6|12の都度払い）
 */
ipcMain.handle('pro-auth:start-checkout', async (_e, { method, months }) => {
  const token = store.get('proAuthToken');
  if (!token) throw new Error('先にログインしてください');
  const body = await paymentBackendFetch('/checkout', {
    method: 'POST',
    body: JSON.stringify({ token, method, months }),
  });
  if (!body || !body.checkoutUrl) throw new Error('決済ページのURLを取得できませんでした');
  await shell.openExternal(body.checkoutUrl);
  return true;
});

ipcMain.handle('pro-auth:logout', () => {
  store.set('proAuthToken', null);
  store.set('proAuthEmail', null);
  store.set('proStatus', null);
  // ログアウト時はPro状態も解除する（開発者本人でも、再ログインするまでは解除される）。
  store.set('premiumUnlocked', false);
  notifyRenderer('premium:changed', false);
  return true;
});

// ログイン中は10分間隔でバックグラウンドから/statusを確認し、Pro状態を最新に保つ。
setInterval(() => {
  if (store.get('proAuthToken')) refreshProAuthStatus();
}, 10 * 60 * 1000);

// ---- アップデート確認（GitHub Releases: mumeinoapp/multicastdeck） ----
// ウィンドウ・パネルもネイティブダイアログも一切出さず、renderer側の自作メニューバーの
// 「バージョン」ドロップダウンだけで完結させる。アップデートが見つかった場合は、
// 「バージョン」ラベルの右上に赤丸バッジを出して一目でわかるようにする（hasUpdateBadge参照）。

autoUpdater.on('checking-for-update', () => {
  updaterState = { status: 'checking' };
  notifyAppMenuStateChanged();
});
autoUpdater.on('update-available', (info) => {
  updaterState = { status: 'available', version: info.version };
  notifyAppMenuStateChanged();
});
autoUpdater.on('update-not-available', () => {
  updaterState = { status: 'not-available' };
  notifyAppMenuStateChanged();
});
autoUpdater.on('download-progress', (progress) => {
  updaterState = { status: 'downloading', percent: Math.round(progress.percent || 0) };
  notifyAppMenuStateChanged();
});
autoUpdater.on('update-downloaded', (info) => {
  updaterState = { status: 'downloaded', version: info.version };
  notifyAppMenuStateChanged();
});
autoUpdater.on('error', (err) => {
  // 手動確認・起動時の静かなチェックのどちらでも、失敗時にダイアログは出さない。
  // メニューの中身（「確認できませんでした」）だけで状態を伝える。
  updaterState = { status: 'error' };
  notifyAppMenuStateChanged();
});

// ヘッダー操作ボタンのドラッグ並び替え結果の保存/取得
ipcMain.handle('ui:get-header-button-order', () => store.get('headerButtonOrder'));

ipcMain.handle('ui:set-header-button-order', (_e, order) => {
  store.set('headerButtonOrder', Array.isArray(order) ? order : []);
  return true;
});

// 汎用フローティングドロップダウン基盤（MCD大規模アプデ、2026-08-07新設）。
// createFloatingDropdown参照。配信タイルは一切removeBrowserViewしない。
ipcMain.handle('ui:floating-dropdown-open', (_e, { id, rect }) => {
  floatingDropdowns[id]?.openAt(rect);
  return true;
});

ipcMain.handle('ui:floating-dropdown-set-rect', (_e, { id, rect }) => {
  floatingDropdowns[id]?.setRect(rect);
  return true;
});

ipcMain.handle('ui:floating-dropdown-close', (_e, id) => {
  floatingDropdowns[id]?.close();
  return true;
});

// メインウィンドウ側から描画データ（行の一覧等）をfloating-dropdown BrowserViewへpushする。
ipcMain.handle('ui:floating-dropdown-set-content', (_e, { id, payload }) => {
  floatingDropdowns[id]?.send('floating-dropdown:content', { id, ...payload });
  return true;
});

// floating-dropdown側での行クリック・削除ボタン等のユーザー操作を、メインウィンドウへ中継する。
ipcMain.handle('ui:floating-dropdown-event', (_e, { id, type, value }) => {
  notifyRenderer('floating-dropdown:event', { id, type, value });
  return true;
});

// レイアウトのURL共有
ipcMain.handle('layout-share:export', () => {
  try {
    return { ok: true, url: buildLayoutShareUrl() };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('layout-share:import', (_e, urlStr) => {
  try {
    const parsed = parseLayoutShareUrl(urlStr);
    if (parsed.channels.length === 0) {
      return { ok: false, error: 'URLにチャンネルが含まれていません' };
    }
    applySharedLayout(parsed);
    return { ok: true, count: parsed.channels.length };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// チャット統合パネル（タブ切替モード）
ipcMain.handle('chat-integration:show-tab', (_e, channelName) => {
  showChatIntegrationTab(channelName);
  return true;
});

ipcMain.handle('chat-integration:hide-tab', () => {
  hideChatIntegrationTab();
  return true;
});

// 時系列統合モード: YouTubeチャットの裏読み込み監視の開始/終了同期
ipcMain.handle('chat-integration:sync-youtube-watch', (_e, channelNames) => {
  syncYoutubeChatWatch(Array.isArray(channelNames) ? channelNames : []);
  return true;
});
ipcMain.handle('chat-integration:stop-youtube-watch', () => {
  stopAllYoutubeChatWatch();
  return true;
});
// youtubeChatScraperPreload.js から送られてくる、取り込んだチャットメッセージをレンダラーへ中継する
ipcMain.on('youtube-chat:message', (_e, payload) => {
  notifyRenderer('youtube-chat:message', payload);
});

// 時系列統合モードからのチャット送信
ipcMain.handle('chat-integration:send-message', async (_e, payload) => {
  const { channel, message } = payload || {};
  try {
    await sendChatIntegrationMessage(channel, message);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// お気に入りスタンプのワンクリック挿入
ipcMain.handle('emotes:insert-into-chat', async (_e, payload) => {
  const { channel, text } = payload || {};
  try {
    await insertIntoChatInput(channel, text);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// アカウント連携（方式B）
ipcMain.handle('accounts:get-status', async () => {
  const result = {};
  for (const platform of Object.keys(PLATFORM_CONFIG)) {
    result[platform] = await checkCookieStatus(platform);
  }
  return result;
});

ipcMain.handle('accounts:open-login', (_e, platform) => {
  openAccountLogin(platform);
  return true;
});

ipcMain.handle('accounts:close-login', () => {
  closeAccountLogin();
  return true;
});

ipcMain.handle('accounts:verify-all', async () => {
  const result = {};
  for (const platform of Object.keys(PLATFORM_CONFIG)) {
    result[platform] = await verifyPlatformDom(platform);
  }
  return result;
});

// Drops自動追加/削除
ipcMain.handle('drops-auto:get-config', () => store.get('dropsAutoTrack'));

ipcMain.handle('drops-auto:set-config', (_e, list) => {
  // list: [{ gameName, maxTiles }]。不正値を軽く弾く
  const sanitized = (Array.isArray(list) ? list : [])
    .map((item) => ({
      gameName: String(item.gameName || '').trim(),
      maxTiles: Math.max(0, Math.min(20, Number(item.maxTiles) || 0)),
    }))
    .filter((item) => item.gameName);
  store.set('dropsAutoTrack', sanitized);
  syncDropsAutoWatcherState();
  // 上限を下げた/ゲームを削除した等の変更を、次のポーリング（最大60秒後）を待たずに即座に反映する
  runDropsAutoCheck();
  return sanitized;
});

ipcMain.handle('drops-auto:get-default-max', () => store.get('dropsAutoDefaultMaxTiles'));

ipcMain.handle('drops-auto:set-default-max', (_e, value) => {
  const v = Math.max(1, Math.min(20, Number(value) || 3));
  store.set('dropsAutoDefaultMaxTiles', v);
  return v;
});

/** 現在Drops自動追加されているチャンネルとその対象ゲームの対応表（UIでの表示用） */
ipcMain.handle('drops-auto:get-status', () => {
  const result = {};
  streamViews.forEach((entry, channel) => {
    if (entry.autoAdded && entry.autoSource === 'drops') result[channel] = entry.autoGame;
  });
  return result;
});

// ---- Auto Tune-In ----

ipcMain.handle('auto-tune-in:start-auth', () => startTwitchUserAuth());

ipcMain.handle('auto-tune-in:cancel-auth', () => {
  if (twitchAuthCancelFn) twitchAuthCancelFn();
  return true;
});

ipcMain.handle('auto-tune-in:disconnect', () => {
  disconnectTwitchUserAuth();
  return true;
});

ipcMain.handle('auto-tune-in:get-status', () => {
  const auth = store.get('twitchUserAuth');
  const cfg = store.get('autoTuneIn');
  const hasYoutubeTargets = getAutoTuneInTargets().some((t) => t.platform === 'youtube');
  return {
    connected: !!auth,
    login: auth ? auth.login : null,
    enabled: cfg.enabled,
    maxTiles: cfg.maxTiles,
    // Twitch未連携でも、YouTube対象指定が1件以上あれば有効化できる（YouTubeはOAuth不要のため）
    canEnable: !!auth || hasYoutubeTargets,
  };
});

ipcMain.handle('auto-tune-in:set-config', (_e, partial) => {
  const cfg = store.get('autoTuneIn');
  const next = { ...cfg, ...partial };
  if ('maxTiles' in partial) next.maxTiles = Math.max(1, Math.min(20, Number(partial.maxTiles) || 1));
  store.set('autoTuneIn', next);
  syncAutoTuneInWatcherState();
  // 2026-08-08追加: この設定UIが配信チェックパネル（オーバーレイパネル側のBrowserView）へ移り、
  // メインウィンドウのチップ一覧を直接更新できなくなったため、ここから更新を促す
  // （旧: renderer.js側のchangeハンドラが直接refreshChips()を呼んでいた）。
  notifyRenderer('channels:changed');
  return true;
});

/** 現在Auto Tune-Inで追加されているチャンネル名一覧（UIでの表示用） */
ipcMain.handle('auto-tune-in:get-added-channels', () => autoTuneInAddedChannels());

// ---- Kickアカウント連携（OAuth 2.1 + PKCE、視聴とは独立） ----

ipcMain.handle('kick-auth:start', () => startKickUserAuth());

ipcMain.handle('kick-auth:cancel', () => {
  cancelKickUserAuth();
  return true;
});

ipcMain.handle('kick-auth:disconnect', () => {
  disconnectKickUserAuth();
  return true;
});

ipcMain.handle('kick-auth:get-status', async () => {
  // 期限切れの場合はここでリフレッシュを試み、実際に有効なトークンがあるかどうかで判定する
  // （リフレッシュトークンが失効していれば getValidKickUserAccessToken 内部で連携情報がクリアされる）。
  const token = await getValidKickUserAccessToken();
  const auth = store.get('kickUserAuth');
  return { connected: !!token && !!auth, login: auth ? auth.username : null };
});

// 時系列統合モード（renderer側で直接Pusher WebSocketに接続する）用。CORSの影響を受けないよう、
// チャンネル名→chatroom_idの解決だけメインプロセス側のNode https経由で行う。
ipcMain.handle('kick:resolve-chatroom-id', (_e, channelName) => resolveKickChatroomId(channelName));

// プラットフォーム横断の統一フィード（ロードマップ項目6）。手動更新ボタンからのみ呼ばれる（常時ポーリングなし）。
ipcMain.handle('unified-feed:fetch', (_e, options) => fetchUnifiedFeed(options || {}));

// ---- 複窓レイアウト設定ウィンドウ（2026-08-08新設、第1段階） ----
// open はメインウィンドウの自作メニューバー（表示メニュー）から、close は当該ウィンドウ自身の
// ×ボタン（layout-window.js）から呼ばれる。ESCキー・OSの閉じるボタンはmain.js側で処理される。
ipcMain.handle('layout-window:open', () => {
  createLayoutWindow();
  return true;
});
ipcMain.handle('layout-window:close', () => {
  if (layoutWindow && !layoutWindow.isDestroyed()) layoutWindow.close();
  return true;
});
// 段階2の選択(MAIN/SUBは廃止し1〜9の選択順に一本化)をメイン画面へ反映する「自動整列」ボタン用（段階3）。
ipcMain.handle('layout-window:auto-arrange', (_e, payload) => applyLayoutWindowArrange(payload || {}));

// ---- 配信チェックウィンドウ（2026-08-07新設、段階A） ----
// open はメインウィンドウのヘッダー「📡 配信チェック」ボタンから、close は当該ウィンドウ自身の
// ×ボタン（stream-check-window.js）から呼ばれる。ESCキー・OSの閉じるボタンはmain.js側で処理される。
ipcMain.handle('stream-check-window:open', () => {
  createStreamCheckWindow();
  return true;
});
ipcMain.handle('stream-check-window:close', () => {
  if (streamCheckWindow && !streamCheckWindow.isDestroyed()) streamCheckWindow.close();
  return true;
});

// Auto Tune-Inの対象指定チャンネル（フィード改善③）
ipcMain.handle('auto-tune-in:get-targets', () => getAutoTuneInTargets());
ipcMain.handle('auto-tune-in:set-targets', (_e, targets) => setAutoTuneInTargets(targets));
// 「全フォロー/登録一覧」。専用の「読み込む」ボタンからのみ呼ばれる（常時ポーリングなし）。
ipcMain.handle('auto-tune-in:fetch-all-follow-candidates', () => fetchAllFollowCandidates());

// 配信チェックパネルのプラットフォーム絞り込み（#8対応の永続化）。値自体は従来通り
// store の unifiedFeedPlatformFilter（settings:get-all/set-all でも読める）に保存する。
// パネルがオーバーレイ側BrowserViewへ移った（2026-08-08）ため、巨大な settings:get-all /
// set-all を経由せずこの1項目だけを読み書きできる軽量な専用ハンドラを用意した。
ipcMain.handle('unified-feed:get-platform-filter', () => store.get('unifiedFeedPlatformFilter') || 'all');
ipcMain.handle('unified-feed:set-platform-filter', (_e, filter) => {
  const allowed = ['all', 'twitch', 'youtube', 'kick'];
  store.set('unifiedFeedPlatformFilter', allowed.includes(filter) ? filter : 'all');
  return true;
});

// フィードの「ピン留め」YouTubeチャンネル（自動追加とは独立、オンライン/オフライン問わず常時表示）
ipcMain.handle('feed-pin:get-youtube', () => getFeedPinnedYoutubeChannels());
ipcMain.handle('feed-pin:set-youtube', (_e, list) => setFeedPinnedYoutubeChannels(list));

// ランダム自動切換え（ザッピング）
ipcMain.handle('zapping:get-config', () => ({
  filters: store.get('zappingFilters'),
  active: !!currentZappingChannel,
  currentChannel: currentZappingChannel,
}));

ipcMain.handle('zapping:start', async (_e, filters) => {
  const sanitized = {
    language: String(filters?.language || '').trim(),
    gameName: String(filters?.gameName || '').trim(),
    tags: Array.isArray(filters?.tags) ? filters.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    platform: ['youtube', 'kick'].includes(filters?.platform) ? filters.platform : 'twitch',
  };
  try {
    await startZapping(sanitized);
    return { active: !!currentZappingChannel, currentChannel: currentZappingChannel, error: null };
  } catch (err) {
    return { active: !!currentZappingChannel, currentChannel: currentZappingChannel, error: String(err.message || err) };
  }
});

ipcMain.handle('zapping:stop', () => {
  stopZapping();
  return true;
});

ipcMain.handle('zapping:skip', async () => {
  try {
    await skipZappingNow();
    return { active: !!currentZappingChannel, currentChannel: currentZappingChannel, error: null };
  } catch (err) {
    return { active: !!currentZappingChannel, currentChannel: currentZappingChannel, error: String(err.message || err) };
  }
});

// 入力欄の履歴（上下キー）
ipcMain.handle('history:get', (_e, key) => getInputHistory(key));

ipcMain.handle('history:add', (_e, { key, value }) => addInputHistory(key, value));

// #13対応: 履歴一覧UIの×ボタンから1件削除
ipcMain.handle('history:remove', (_e, { key, value }) => removeInputHistoryItem(key, value));

// エモート（スタンプ）一覧取得
// クリップURLのサムネ表示化用のキャッシュ（同じクリップが何度もチャットに貼られても
// Helix APIを叩き直さないようにする。TTLは設けず、アプリ起動中は保持する簡易キャッシュ）。
const clipInfoCache = new Map();

/**
 * TwitchのクリップID（スラッグ）からサムネイル画像URL・タイトル・配信者名を取得する
 * （Helix `/helix/clips?id=`）。Helix Client ID/Secretが未設定、あるいは取得失敗の場合は
 * nullを返し、呼び出し側（renderer）はサムネ無しの簡易カード表示にフォールバックする。
 */
async function fetchClipInfo(slug) {
  if (!slug) return null;
  if (clipInfoCache.has(slug)) return clipInfoCache.get(slug);
  try {
    const clientId = store.get('helixClientId');
    const token = await getHelixAppToken();
    const res = await httpsRequestJson(`https://api.twitch.tv/helix/clips?id=${encodeURIComponent(slug)}`, {
      headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
    });
    const item = res.status === 200 ? res.json.data?.[0] : null;
    const info = item
      ? {
          thumbnailUrl: item.thumbnail_url || '',
          title: item.title || '',
          broadcasterName: item.broadcaster_name || '',
        }
      : null;
    clipInfoCache.set(slug, info);
    return info;
  } catch (_) {
    // Client ID/Secret未設定・トークン取得失敗・ネットワークエラー等はすべて「情報取得できず」扱いにする
    clipInfoCache.set(slug, null);
    return null;
  }
}

ipcMain.handle('clips:fetch-info', async (_e, slug) => {
  return fetchClipInfo(slug);
});

// クリップカードのクリックで開く先は、実際にTwitchのクリップURL（clips.twitch.tv または
// twitch.tv/*/clip/*）であることをホスト名レベルで検証してからshell.openExternalする。
// チャットメッセージ由来の文字列を無検証でOS既定ブラウザに渡すことになるため、
// クリップURL以外（任意の外部URL）を開けてしまわないようにする安全対策。
ipcMain.handle('clips:open-external', (_e, url) => {
  try {
    const parsed = new URL(url);
    const allowedHosts = ['clips.twitch.tv', 'twitch.tv', 'www.twitch.tv', 'm.twitch.tv'];
    if (parsed.protocol === 'https:' && allowedHosts.includes(parsed.hostname)) {
      shell.openExternal(url);
    }
  } catch (_) {
    /* 不正なURLは無視 */
  }
});

ipcMain.handle('emotes:fetch', async (_e, channelName) => {
  try {
    const platform = store.get('channelPlatforms')[channelName] || 'twitch';
    if (platform === 'youtube') {
      const channelEmotes = await fetchYoutubeEmotesForChannel(channelName);
      return { channelEmotes, globalEmotes: [] };
    }
    // Kickのスタンプ対応は今回のスコープ外。誤ってTwitch Helix APIにKickのチャンネル名を渡してしまう
    // （platform判定漏れによる既定Twitch扱い）事故を防ぐため、ここで明示的にエラーにする。
    if (platform === 'kick') {
      return { error: 'Kickのスタンプ取得は現在対応していません' };
    }
    return await fetchEmotesForChannel(channelName);
  } catch (err) {
    return { error: String(err.message || err) };
  }
});

app.whenReady().then(() => {
  migrateLegacyPaymentBackendUrl();
  createMainWindow();
  // 前回終了時のチャンネルを復元。Drops自動追加/削除で追加されたチャンネルは
  // autoAddedChannels（永続化済み）を見て自動追加扱いのまま復元する。これをやらないと
  // 再起動のたびに旧自動追加チャンネルが「手動追加」扱いになって上限管理から外れ、
  // 上限いっぱいまで新規チャンネルが際限なく追加されてしまう不具合があった。
  const savedChannels = store.get('channels');
  const autoAddedChannels = store.get('autoAddedChannels');
  const channelPlatforms = store.get('channelPlatforms');
  const channelYoutubeIds = store.get('channelYoutubeIds');
  const channelYoutubeVideoIds = store.get('channelYoutubeVideoIds');
  savedChannels.forEach((c) => {
    const rec = autoAddedChannels[c];
    const autoOpts =
      rec && typeof rec === 'string'
        ? { auto: true, autoGame: rec, autoSource: 'drops' } // 旧形式（値がゲーム名の文字列のみ）との互換
        : rec
        ? { auto: true, autoGame: rec.game || null, autoSource: rec.source || 'drops' }
        : {};
    // YouTubeチャンネルはチャンネルIDをキャッシュから復元するため、再起動のたびにAPIキーが
    // 必要になったり、キー未設定・API失敗で復元できなくなったりすることがない
    // （動画URLで追加した分は動画IDそのものをキャッシュしているため、APIすら不要で復元できる）。
    const platform = channelPlatforms[c] || 'twitch';
    const platformOpts =
      platform === 'youtube'
        ? channelYoutubeVideoIds[c]
          ? { platform: 'youtube', youtubeVideoId: channelYoutubeVideoIds[c] }
          : { platform: 'youtube', youtubeChannelId: channelYoutubeIds[c] || null }
        : platform === 'kick'
        ? { platform: 'kick' }
        : {};
    addChannel(c, { ...autoOpts, ...platformOpts });
  });
  syncDropsAutoWatcherState();
  syncAutoTuneInWatcherState();

  // 起動時のアップデート確認は「静かに」行う。ダイアログ等は一切出さず、結果は
  // メニューバーの「アップデートを確認」を開いた時に見える状態にしておくだけ。
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {
        // 起動時の静かなチェックはエラーを表面化させない（手動確認時のみエラーを表示する）。
      });
    }, 5000);
  }
});

app.on('window-all-closed', () => {
  stopDropsAutoWatcher();
  stopAutoTuneInWatcher();
  if (zappingTimer) clearTimeout(zappingTimer);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
