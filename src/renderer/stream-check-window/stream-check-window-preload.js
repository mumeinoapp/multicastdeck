'use strict';

// 配信チェックウィンドウ（2026-08-07新設、段階A。2026-08-08段階Bでfetch/addChannel/
// プラットフォーム絞り込みを追加）専用のpreload。
// メインウィンドウの window.api（src/preload.js）、オーバーレイパネルの window.overlayApi
// （overlay-panel-preload.js）、複窓レイアウト設定の window.layoutApi
// （layout-window-preload.js）とは意図的に分離し、このウィンドウが必要とする最小限のAPIだけを
// 公開する。IPCチャンネル名はそれら既存preloadの同名メソッドと完全に一致させてあり、
// main.js側のfetchUnifiedFeed()等の既存ハンドラをそのまま無改造で共用する。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('streamCheckApi', {
  // ヘッダーの×ボタン用。ESCキー・OSの閉じるボタンはmain.js側で直接処理される。
  closeWindow: () => ipcRenderer.invoke('stream-check-window:close'),

  // 配信中チャンネル一覧。options.includeKick=false でKick分（BrowserViewフルロードを伴い重い）を
  // 省略できる（layout-window-preload.js / overlay-panel-preload.jsと同じ挙動）。2026-08-08追加
  // （要望⑦）: 同様にoptions.includeTwitch=false / includeYoutube=falseで各プラットフォーム分を
  // 個別に省略でき、Twitch(5秒間隔)とYouTube(20秒間隔)を別タイマーで自動更新するのに使う。
  fetchUnifiedFeed: (options) => ipcRenderer.invoke('unified-feed:fetch', options),

  // カードの「＋追加」ボタン用。既存の手動チャンネル追加と全く同じIPC・同じ挙動を再利用する。
  addChannel: (payload) => ipcRenderer.invoke('channels:add', payload),

  // カードの「削除」ボタン用（2026-08-08追加、実機報告対応）。既存のチップ×ボタンと全く同じ
  // channels:remove IPCを再利用する。
  removeChannel: (channelName) => ipcRenderer.invoke('channels:remove', channelName),

  // プラットフォーム絞り込み（すべて/Twitch/YouTube/Kick）の永続化。
  // overlay-panel.js側の同名機能(#8対応)と同じstoreキーを共用する。
  getUnifiedFeedPlatformFilter: () => ipcRenderer.invoke('unified-feed:get-platform-filter'),
  setUnifiedFeedPlatformFilter: (filter) => ipcRenderer.invoke('unified-feed:set-platform-filter', filter),

  // ---- 段階C追加（2026-08-08）: 自動追加の対象を選ぶ／フォロー配信者の自動追加 ----
  // IPCチャンネル名はoverlay-panel-preload.jsの同名メソッドと完全に一致させてある
  // （main.js側のハンドラを無改造で共用するため）。startTwitchAuthのみ、main.js側で
  // event.senderからホストウィンドウ（このウィンドウ自身）を解決するよう修正済みなので、
  // こちら側からは特別な引数は不要。
  getAutoTuneInTargets: () => ipcRenderer.invoke('auto-tune-in:get-targets'),
  setAutoTuneInTargets: (targets) => ipcRenderer.invoke('auto-tune-in:set-targets', targets),
  fetchAllFollowCandidates: () => ipcRenderer.invoke('auto-tune-in:fetch-all-follow-candidates'),

  getFeedPinnedYoutube: () => ipcRenderer.invoke('feed-pin:get-youtube'),
  setFeedPinnedYoutube: (list) => ipcRenderer.invoke('feed-pin:set-youtube', list),

  getAutoTuneInStatus: () => ipcRenderer.invoke('auto-tune-in:get-status'),
  setAutoTuneInConfig: (partial) => ipcRenderer.invoke('auto-tune-in:set-config', partial),
  startTwitchAuth: () => ipcRenderer.invoke('auto-tune-in:start-auth'),
  cancelTwitchAuth: () => ipcRenderer.invoke('auto-tune-in:cancel-auth'),
  disconnectTwitchAuth: () => ipcRenderer.invoke('auto-tune-in:disconnect'),
  onAutoTuneInError: (cb) => ipcRenderer.on('auto-tune-in:error', (_e, payload) => cb(payload)),
  onAutoTuneInAuthLost: (cb) => ipcRenderer.on('auto-tune-in:auth-lost', () => cb()),
  // 認証画面（BrowserView）がこのウィンドウ自身に重なった/外れたタイミングの通知
  // （main.js openTwitchAuthView/closeTwitchAuthView参照、ホストがこのウィンドウの時のみ届く）。
  onTwitchAuthViewOpened: (cb) => ipcRenderer.on('auto-tune-in:auth-view-opened', () => cb()),
  onTwitchAuthViewClosed: (cb) => ipcRenderer.on('auto-tune-in:auth-view-closed', () => cb()),

  // 段階E追加: 圧縮バーの「詳しく」導線用。メインウィンドウを前面に出し、ヘルプの指定タブ・
  // 指定項目まで開く（main.js ui:open-help-section参照）。
  openHelpSection: (tab, anchor) => ipcRenderer.invoke('ui:open-help-section', tab, anchor),

  // 段階F追加: 「設定」タブ、追加時にチャットを非表示にするトグルの永続化。
  getAddChatHiddenDefault: () => ipcRenderer.invoke('stream-check-window:get-add-chat-hidden-default'),
  setAddChatHiddenDefault: (value) => ipcRenderer.invoke('stream-check-window:set-add-chat-hidden-default', value),

  // 項目⑩追加: 「レイアウト配置」ボタン用。複窓レイアウト設定ウィンドウ（layout-window-preload.js）
  // のautoArrangeと完全に同じIPCチャンネル・引数形式（{selection, chatVisible}）をそのまま再利用する
  // （main.js側のapplyLayoutWindowArrangeは呼び出し元ウィンドウを区別しない汎用実装のため）。
  layoutAutoArrange: (payload) => ipcRenderer.invoke('layout-window:auto-arrange', payload),

  // 依頼#33追加: このウィンドウ自体はメインウィンドウのpremiumUnlocked変数を直接参照できないため、
  // メインウィンドウのpreload.jsと同じチャンネル（app:get-premium-unlocked / premium:changed）を
  // そのまま再利用して取得する（main.js側のnotifyRendererがstreamCheckWindowにもこの通知を
  // 中継するよう対応済み。OVERLAY_PANEL_FORWARDED_CHANNELS参照）。
  getPremiumUnlocked: () => ipcRenderer.invoke('app:get-premium-unlocked'),
  onPremiumChanged: (cb) => ipcRenderer.on('premium:changed', (_e, value) => cb(value)),
});
