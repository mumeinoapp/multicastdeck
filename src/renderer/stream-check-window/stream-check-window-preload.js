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
  // 省略できる（layout-window-preload.js / overlay-panel-preload.jsと同じ挙動）。
  fetchUnifiedFeed: (options) => ipcRenderer.invoke('unified-feed:fetch', options),

  // カードの「＋追加」ボタン用。既存の手動チャンネル追加と全く同じIPC・同じ挙動を再利用する。
  addChannel: (payload) => ipcRenderer.invoke('channels:add', payload),

  // プラットフォーム絞り込み（すべて/Twitch/YouTube/Kick）の永続化。
  // overlay-panel.js側の同名機能(#8対応)と同じstoreキーを共用する。
  getUnifiedFeedPlatformFilter: () => ipcRenderer.invoke('unified-feed:get-platform-filter'),
  setUnifiedFeedPlatformFilter: (filter) => ipcRenderer.invoke('unified-feed:set-platform-filter', filter),
});
