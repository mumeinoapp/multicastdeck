'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  addChannel: (name, platform) => ipcRenderer.invoke('channels:add', { name, platform: platform || 'twitch' }),
  removeChannel: (name) => ipcRenderer.invoke('channels:remove', name),
  listChannels: () => ipcRenderer.invoke('channels:list'),
  reorderChannels: (order) => ipcRenderer.invoke('channels:reorder', order),
  getChannelPlatforms: () => ipcRenderer.invoke('channels:get-platforms'),

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

  // Kickアカウント連携（OAuth 2.1 + PKCE、視聴自体はログイン不要）
  startKickAuth: () => ipcRenderer.invoke('kick-auth:start'),
  cancelKickAuth: () => ipcRenderer.invoke('kick-auth:cancel'),
  disconnectKickAuth: () => ipcRenderer.invoke('kick-auth:disconnect'),
  getKickAuthStatus: () => ipcRenderer.invoke('kick-auth:get-status'),
  onKickAuthLost: (cb) => ipcRenderer.on('kick-auth:auth-lost', () => cb()),

  fetchUnifiedFeed: () => ipcRenderer.invoke('unified-feed:fetch'),
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
  openVolumeDropdown: () => ipcRenderer.invoke('ui:open-volume-dropdown'),
  closeVolumeDropdown: () => ipcRenderer.invoke('ui:close-volume-dropdown'),

  exportLayoutShareUrl: () => ipcRenderer.invoke('layout-share:export'),
  importLayoutShareUrl: (url) => ipcRenderer.invoke('layout-share:import', url),

  getAccountStatus: () => ipcRenderer.invoke('accounts:get-status'),
  openAccountLogin: (platform) => ipcRenderer.invoke('accounts:open-login', platform),
  closeAccountLogin: () => ipcRenderer.invoke('accounts:close-login'),
  verifyAllAccounts: () => ipcRenderer.invoke('accounts:verify-all'),

  autoArrangeTiles: () => ipcRenderer.invoke('layout:auto-arrange'),
  // BrowserViewに覆われない隙間でマウスを離した場合の保険（通常は各BrowserView内のプリロードが処理する）
  endTileInteraction: () => ipcRenderer.invoke('layout:interaction-end'),

  getChatHiddenMap: () => ipcRenderer.invoke('channels:get-chat-hidden-map'),
  setChatHidden: (channel, hidden) => ipcRenderer.invoke('channels:set-chat-hidden', { channel, hidden }),

  getChannelVolumes: () => ipcRenderer.invoke('channels:get-volumes'),
  setChannelVolume: (channel, volume) => ipcRenderer.invoke('channels:set-volume', { channel, volume }),

  getInputHistory: (key) => ipcRenderer.invoke('history:get', key),
  addInputHistory: (key, value) => ipcRenderer.invoke('history:add', { key, value }),

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
