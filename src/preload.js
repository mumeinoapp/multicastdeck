'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  addChannel: (name, platform) => ipcRenderer.invoke('channels:add', { name, platform: platform || 'twitch' }),
  removeChannel: (name) => ipcRenderer.invoke('channels:remove', name),
  listChannels: () => ipcRenderer.invoke('channels:list'),
  reorderChannels: (order) => ipcRenderer.invoke('channels:reorder', order),
  getChannelPlatforms: () => ipcRenderer.invoke('channels:get-platforms'),
  // チップの視聴者数バッジ・ツールチップ表示用（タイトル・カテゴリ・視聴者数）
  getStreamMeta: () => ipcRenderer.invoke('channels:get-stream-meta'),

  // #6対応: 通知タブ（配信開始通知）
  getNotificationsState: () => ipcRenderer.invoke('notifications:get-state'),
  markNotificationsRead: () => ipcRenderer.invoke('notifications:mark-read'),
  onNotificationsStateChanged: (cb) => ipcRenderer.on('notifications:state-changed', (_e, state) => cb(state)),

  openDrops: () => ipcRenderer.invoke('drops:open'),
  closeDrops: () => ipcRenderer.invoke('drops:close'),
  readDropsProgress: () => ipcRenderer.invoke('drops:read-progress'),

  openKickDrops: () => ipcRenderer.invoke('kick-drops:open'),
  closeKickDrops: () => ipcRenderer.invoke('kick-drops:close'),

  getFavorites: () => ipcRenderer.invoke('settings:get-favorites'),
  setFavorites: (favs) => ipcRenderer.invoke('settings:set-favorites', favs),
  toggleFavorite: (emote) => ipcRenderer.invoke('favorites:toggle', emote),

  getAllSettings: () => ipcRenderer.invoke('settings:get-all'),
  setAllSettings: (partial) => ipcRenderer.invoke('settings:set-all', partial),

  fetchEmotes: (channel) => ipcRenderer.invoke('emotes:fetch', channel),
  insertEmoteIntoChat: (channel, text) => ipcRenderer.invoke('emotes:insert-into-chat', { channel, text }),

  getDropsAutoConfig: () => ipcRenderer.invoke('drops-auto:get-config'),
  setDropsAutoConfig: (list) => ipcRenderer.invoke('drops-auto:set-config', list),
  getDropsAutoStatus: () => ipcRenderer.invoke('drops-auto:get-status'),
  getDropsAutoDefaultMax: () => ipcRenderer.invoke('drops-auto:get-default-max'),
  setDropsAutoDefaultMax: (value) => ipcRenderer.invoke('drops-auto:set-default-max', value),

  startTwitchAuth: () => ipcRenderer.invoke('auto-tune-in:start-auth'),
  cancelTwitchAuth: () => ipcRenderer.invoke('auto-tune-in:cancel-auth'),
  disconnectTwitchAuth: () => ipcRenderer.invoke('auto-tune-in:disconnect'),
  getAutoTuneInStatus: () => ipcRenderer.invoke('auto-tune-in:get-status'),
  setAutoTuneInConfig: (partial) => ipcRenderer.invoke('auto-tune-in:set-config', partial),
  getAutoTuneInAddedChannels: () => ipcRenderer.invoke('auto-tune-in:get-added-channels'),
  onAutoTuneInError: (cb) => ipcRenderer.on('auto-tune-in:error', (_e, payload) => cb(payload)),
  onAutoTuneInAuthLost: (cb) => ipcRenderer.on('auto-tune-in:auth-lost', () => cb()),
  // TwitchのOAuth連携画面（アプリ内BrowserView）の開閉通知。2026-08-08、連携開始ボタンが
  // 配信チェックパネル（オーバーレイパネル側のBrowserView）へ移ったことに伴う追加。
  // メインウィンドウ側でしか出来ないヘッダーのロック・「連携画面を閉じる」ボタンの出し入れを、
  // クリックハンドラの中ではなくこの通知を受けて行う（main.jsのopenTwitchAuthView/closeTwitchAuthView）。
  onTwitchAuthViewOpened: (cb) => ipcRenderer.on('auto-tune-in:auth-view-opened', () => cb()),
  onTwitchAuthViewClosed: (cb) => ipcRenderer.on('auto-tune-in:auth-view-closed', () => cb()),

  // Kickアカウント連携（OAuth 2.1 + PKCE、視聴自体はログイン不要）
  startKickAuth: () => ipcRenderer.invoke('kick-auth:start'),
  cancelKickAuth: () => ipcRenderer.invoke('kick-auth:cancel'),
  disconnectKickAuth: () => ipcRenderer.invoke('kick-auth:disconnect'),
  getKickAuthStatus: () => ipcRenderer.invoke('kick-auth:get-status'),
  onKickAuthLost: (cb) => ipcRenderer.on('kick-auth:auth-lost', () => cb()),

  // options.includeKick=false で、BrowserViewフルロードを伴い重いKick取得を省略できる
  // （統一フィードパネルを開いている間の自動更新ループ用）
  fetchUnifiedFeed: (options) => ipcRenderer.invoke('unified-feed:fetch', options),
  getAutoTuneInTargets: () => ipcRenderer.invoke('auto-tune-in:get-targets'),
  setAutoTuneInTargets: (targets) => ipcRenderer.invoke('auto-tune-in:set-targets', targets),
  fetchAllFollowCandidates: () => ipcRenderer.invoke('auto-tune-in:fetch-all-follow-candidates'),
  getFeedPinnedYoutube: () => ipcRenderer.invoke('feed-pin:get-youtube'),
  setFeedPinnedYoutube: (list) => ipcRenderer.invoke('feed-pin:set-youtube', list),

  getZappingConfig: () => ipcRenderer.invoke('zapping:get-config'),
  startZapping: (filters) => ipcRenderer.invoke('zapping:start', filters),
  stopZapping: () => ipcRenderer.invoke('zapping:stop'),
  skipZapping: () => ipcRenderer.invoke('zapping:skip'),

  hideContentViews: () => ipcRenderer.invoke('ui:hide-content-views'),
  showContentViews: () => ipcRenderer.invoke('ui:show-content-views'),
  openSidePanel: (id, width) => ipcRenderer.invoke('ui:open-side-panel', { id, width }),
  closeSidePanel: (id) => ipcRenderer.invoke('ui:close-side-panel', id),
  closeAllSidePanels: () => ipcRenderer.invoke('ui:close-all-side-panels'),
  onSidePanelsChanged: (cb) => ipcRenderer.on('ui:side-panels-changed', (_e, positions) => cb(positions)),

  // 汎用フローティングドロップダウン基盤（#16向け、2026-08-07新設）。チャンネル名履歴・
  // 音量ミキサー等、位置・サイズが可変な小さな浮遊UI向け。専用BrowserViewを最前面表示する
  // ため、旧rectOverlayShow/Hide（重なったタイルを一時退避する方式）とは異なり配信タイルを
  // 一切removeBrowserViewしない。
  floatingDropdown: {
    open: (id, rect) => ipcRenderer.invoke('ui:floating-dropdown-open', { id, rect }),
    setRect: (id, rect) => ipcRenderer.invoke('ui:floating-dropdown-set-rect', { id, rect }),
    close: (id) => ipcRenderer.invoke('ui:floating-dropdown-close', id),
    setContent: (id, payload) => ipcRenderer.invoke('ui:floating-dropdown-set-content', { id, payload }),
    onEvent: (cb) => ipcRenderer.on('floating-dropdown:event', (_e, evt) => cb(evt)),
  },

  // 汎用オーバーレイパネル基盤（#16向け、2026-08-07新設）。openSidePanel系とは独立したAPI。
  openOverlayPanel: (panelId) => ipcRenderer.invoke('ui:open-overlay-panel', panelId),
  closeOverlayPanel: () => ipcRenderer.invoke('ui:close-overlay-panel'),
  getOverlayPanelState: () => ipcRenderer.invoke('ui:get-overlay-panel-state'),
  onOverlayPanelChanged: (cb) => ipcRenderer.on('ui:overlay-panel-changed', (_e, state) => cb(state)),

  // タイル情報帯（配信者名・タイトル・視聴者数・配信時間、2026-08-07新設）。矩形はmain.js側
  // （applyTileBoundsFromRect）でstreamViewのbounds計算と同時に算出しpushされる。
  onTileBarBounds: (cb) => ipcRenderer.on('tile:bar-bounds', (_e, rect) => cb(rect)),
  onTileBarRemove: (cb) => ipcRenderer.on('tile:bar-remove', (_e, channel) => cb(channel)),
  onTileBarsVisible: (cb) => ipcRenderer.on('tile:bars-visible', (_e, visible) => cb(visible)),

  exportLayoutShareUrl: () => ipcRenderer.invoke('layout-share:export'),
  importLayoutShareUrl: (url) => ipcRenderer.invoke('layout-share:import', url),

  getAccountStatus: () => ipcRenderer.invoke('accounts:get-status'),
  openAccountLogin: (platform) => ipcRenderer.invoke('accounts:open-login', platform),
  closeAccountLogin: () => ipcRenderer.invoke('accounts:close-login'),
  verifyAllAccounts: () => ipcRenderer.invoke('accounts:verify-all'),

  autoArrangeTiles: () => ipcRenderer.invoke('layout:auto-arrange'),
  // BrowserViewに覆われない隙間でマウスを離した場合の保険（通常は各BrowserView内のプリロードが処理する）
  endTileInteraction: () => ipcRenderer.invoke('layout:interaction-end'),
  // タイル情報帯（#tile-info-bars、BrowserViewではなくホストウィンドウ自身のHTML）からの
  // ドラッグ移動／リサイズ開始・追従。tileInteractionPreload.jsがBrowserView内から送るのと
  // 同じ 'tile-interaction:start'/'move' チャンネルへそのまま中継する（メインプロセス側の
  // 処理はどちらの発生元でも共通）。
  startTileInteraction: (payload) => ipcRenderer.send('tile-interaction:start', payload),
  moveTileInteraction: (point) => ipcRenderer.send('tile-interaction:move', point),

  getChatHiddenMap: () => ipcRenderer.invoke('channels:get-chat-hidden-map'),
  setChatHidden: (channel, hidden) => ipcRenderer.invoke('channels:set-chat-hidden', { channel, hidden }),

  getChatIntegrationHiddenMap: () => ipcRenderer.invoke('chat-integration:get-hidden-map'),
  setChatIntegrationHidden: (channel, hidden) => ipcRenderer.invoke('chat-integration:set-hidden', { channel, hidden }),

  getChannelVolumes: () => ipcRenderer.invoke('channels:get-volumes'),
  setChannelVolume: (channel, volume) => ipcRenderer.invoke('channels:set-volume', { channel, volume }),

  getInputHistory: (key) => ipcRenderer.invoke('history:get', key),
  addInputHistory: (key, value) => ipcRenderer.invoke('history:add', { key, value }),
  // #13対応: 履歴一覧UIの×ボタンから1件削除
  removeInputHistory: (key, value) => ipcRenderer.invoke('history:remove', { key, value }),

  // 全タブ統合チャットに貼られたクリップURLのサムネ表示化用
  fetchClipInfo: (slug) => ipcRenderer.invoke('clips:fetch-info', slug),
  openClipExternal: (url) => ipcRenderer.invoke('clips:open-external', url),

  showChatIntegrationTab: (channel) => ipcRenderer.invoke('chat-integration:show-tab', channel),
  hideChatIntegrationTab: () => ipcRenderer.invoke('chat-integration:hide-tab'),
  syncYoutubeChatWatch: (channelNames) => ipcRenderer.invoke('chat-integration:sync-youtube-watch', channelNames),
  stopYoutubeChatWatch: () => ipcRenderer.invoke('chat-integration:stop-youtube-watch'),
  onYoutubeChatMessage: (cb) => ipcRenderer.on('youtube-chat:message', (_e, payload) => cb(payload)),
  sendTimelineMessage: (channel, message) => ipcRenderer.invoke('chat-integration:send-message', { channel, message }),
  resolveKickChatroomId: (channel) => ipcRenderer.invoke('kick:resolve-chatroom-id', channel),

  onChannelLoadError: (cb) => ipcRenderer.on('channel:load-error', (_e, payload) => cb(payload)),
  onDropsLoadError: (cb) => ipcRenderer.on('drops:load-error', (_e, payload) => cb(payload)),
  onKickDropsLoadError: (cb) => ipcRenderer.on('kick-drops:load-error', (_e, payload) => cb(payload)),
  onAccountLoadError: (cb) => ipcRenderer.on('account:load-error', (_e, payload) => cb(payload)),
  onDropsAutoError: (cb) => ipcRenderer.on('drops-auto:error', (_e, payload) => cb(payload)),
  onChannelsChanged: (cb) => ipcRenderer.on('channels:changed', () => cb()),
  onEscapePressed: (cb) => ipcRenderer.on('ui:escape-pressed', () => cb()),
  onZappingStatus: (cb) => ipcRenderer.on('zapping:status', (_e, payload) => cb(payload)),
  onZappingError: (cb) => ipcRenderer.on('zapping:error', (_e, payload) => cb(payload)),

  onOpenWelcome: (cb) => ipcRenderer.on('ui:open-welcome', () => cb()),
  getFirstLaunchDone: () => ipcRenderer.invoke('app:get-first-launch-done'),
  setFirstLaunchDone: () => ipcRenderer.invoke('app:set-first-launch-done'),

  getPremiumUnlocked: () => ipcRenderer.invoke('app:get-premium-unlocked'),
  onPremiumChanged: (cb) => ipcRenderer.on('premium:changed', (_e, value) => cb(value)),

  getHeaderButtonOrder: () => ipcRenderer.invoke('ui:get-header-button-order'),
  setHeaderButtonOrder: (order) => ipcRenderer.invoke('ui:set-header-button-order', order),

  // 会員登録（メール＋確認コード認証、multistream-payment-backend連携）
  getProAuthConfig: () => ipcRenderer.invoke('pro-auth:get-config'),
  setPaymentBackendUrl: (url) => ipcRenderer.invoke('pro-auth:set-backend-url', url),
  requestProAuthCode: (email) => ipcRenderer.invoke('pro-auth:request-code', email),
  verifyProAuthCode: (email, code) => ipcRenderer.invoke('pro-auth:verify-code', { email, code }),
  refreshProAuthStatus: () => ipcRenderer.invoke('pro-auth:refresh-status'),
  logoutProAuth: () => ipcRenderer.invoke('pro-auth:logout'),
  startProCheckout: (method, months) => ipcRenderer.invoke('pro-auth:start-checkout', { method, months }),

  onOpenHelp: (cb) => ipcRenderer.on('ui:open-help', () => cb()),

  // 自作メニューバー（ファイル/表示/ヘルプ/バージョン。ネイティブのMenuは廃止済み。index.html
  // #app-menu-bar、renderer.js参照）。実処理はmain.js側のapp-menu:*ハンドラに委譲する。
  appMenu: {
    getState: () => ipcRenderer.invoke('app-menu:get-state'),
    onStateChanged: (cb) => ipcRenderer.on('app-menu:state-changed', (_e, state) => cb(state)),
    quit: () => ipcRenderer.invoke('app-menu:quit'),
    reload: () => ipcRenderer.invoke('app-menu:reload'),
    toggleDevTools: () => ipcRenderer.invoke('app-menu:toggle-devtools'),
    relayout: () => ipcRenderer.invoke('app-menu:relayout'),
    openExternal: (url) => ipcRenderer.invoke('app-menu:open-external', url),
    checkUpdate: () => ipcRenderer.invoke('app-menu:check-update'),
    downloadUpdate: () => ipcRenderer.invoke('app-menu:download-update'),
    installUpdate: (forceRunAfter) => ipcRenderer.invoke('app-menu:install-update', { forceRunAfter: !!forceRunAfter }),
    sendFeedback: (subject, body) => ipcRenderer.invoke('app-menu:send-feedback', { subject, body }),
  },
});
