'use strict';

// 汎用オーバーレイパネル基盤（MCD大規模アプデ#16向け、2026-08-07新設）専用のpreload。
// メインウィンドウの window.api（src/preload.js）とは意図的に分離し、オーバーレイパネル側の
// HTMLが必要とする最小限のAPIだけを公開する（将来パネルごとに増える処理を、メインウィンドウの
// 巨大なAPI面に混ぜ込まないようにするための設計）。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
  close: () => ipcRenderer.invoke('ui:close-overlay-panel'),

  // help/welcome/premium-locked/feedbackモーダル移植分（配信を消さないオーバーレイ方式への
  // 移行）で必要な最小限のAPIのみ追加。IPCチャンネル名はsrc/preload.jsの同名メソッドと完全に
  // 一致させてある（main.js側のハンドラを共用するため、呼び出し口が増えるだけで処理は変えていない）。
  getFirstLaunchDone: () => ipcRenderer.invoke('app:get-first-launch-done'),
  setFirstLaunchDone: () => ipcRenderer.invoke('app:set-first-launch-done'),
  sendFeedback: (subject, body) => ipcRenderer.invoke('app-menu:send-feedback', { subject, body }),

  // フィードバック下書きの保存/復元（2026-08-07、centered化＝外側クリックで閉じられる
  // ようになったことに伴う追加。閉じてもBrowserView自体はabout:blankへ遷移し中身が
  // 破棄されるため、メインプロセス側にドラフトを保持する）。
  getFeedbackDraft: () => ipcRenderer.invoke('ui:get-feedback-draft'),
  setFeedbackDraft: (subject, body) => ipcRenderer.invoke('ui:set-feedback-draft', { subject, body }),
});
