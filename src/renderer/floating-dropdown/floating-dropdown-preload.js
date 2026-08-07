'use strict';

// 汎用フローティングドロップダウン基盤（MCD大規模アプデ、2026-08-07新設）専用のpreload。
// overlay-panel-preload.js と同じ思想で、メインウィンドウの window.api とは分離した
// 最小限のAPIのみ公開する。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floatingApi', {
  // メインウィンドウ側からのコンテンツ更新（表示する行データ等）を購読する。
  onContent: (cb) => ipcRenderer.on('floating-dropdown:content', (_e, payload) => cb(payload)),

  // 行クリック・削除ボタン等のユーザー操作を、開いた側のidと紐づけてメインウィンドウへ中継してもらう。
  notify: (id, type, value) => ipcRenderer.invoke('ui:floating-dropdown-event', { id, type, value }),
});
