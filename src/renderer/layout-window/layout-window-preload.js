'use strict';

// 複窓レイアウト設定ウィンドウ（2026-08-08新設）専用のpreload。
// メインウィンドウの window.api（src/preload.js）やオーバーレイパネルの window.overlayApi
// （overlay-panel-preload.js）とは意図的に分離し、このウィンドウが必要とする最小限のAPIだけを
// 公開する（独立ウィンドウ側の都合でメインウィンドウの巨大なAPI面を触らずに済むようにするため）。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('layoutApi', {
  // 配信中チャンネル一覧。IPCチャンネル名はsrc/preload.js / overlay-panel-preload.js の
  // 同名メソッドと完全に一致させてある（main.js側のfetchUnifiedFeed()をそのまま共用する）。
  // options.includeKick=false でKick分（BrowserViewフルロードを伴い重い）を省略できる。
  fetchUnifiedFeed: (options) => ipcRenderer.invoke('unified-feed:fetch', options),

  // ヘッダーの×ボタン用。ESCキー・OSの閉じるボタンはmain.js側で直接処理される。
  closeWindow: () => ipcRenderer.invoke('layout-window:close'),
});
