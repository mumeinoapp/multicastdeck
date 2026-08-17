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

  // app-menu余白バグ修正（2026-08-10）: 実際に描画された中身の高さ(scrollHeight)を
  // メインプロセスへ自己申告し、BrowserViewの矩形（メインウィンドウ側の隠れたDOMから
  // 概算した値）を実寸へ補正してもらう。返信不要のため invoke ではなく send を使う。
  reportContentHeight: (id, height) => ipcRenderer.send('ui:floating-dropdown-report-height', { id, height }),
});
