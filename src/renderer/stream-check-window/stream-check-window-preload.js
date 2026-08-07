'use strict';

// 配信チェックウィンドウ（2026-08-07新設、段階A）専用のpreload。
// メインウィンドウの window.api（src/preload.js）、オーバーレイパネルの window.overlayApi
// （overlay-panel-preload.js）、複窓レイアウト設定の window.layoutApi
// （layout-window-preload.js）とは意図的に分離し、このウィンドウが必要とする最小限のAPIだけを
// 公開する。段階Aでは「閉じる」のみ。段階B以降でfetchUnifiedFeedやaddChannel等を
// layout-window-preload.jsと同じ要領で追加していく。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('streamCheckApi', {
  // ヘッダーの×ボタン用。ESCキー・OSの閉じるボタンはmain.js側で直接処理される。
  closeWindow: () => ipcRenderer.invoke('stream-check-window:close'),
});
