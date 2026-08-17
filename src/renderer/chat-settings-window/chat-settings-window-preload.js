'use strict';

// チャット統合の設定ウィンドウ（2026-08-09新設）専用のpreload。
// メインウィンドウのwindow.api（src/preload.js）、stream-check-windowのwindow.streamCheckApi
// と同じ方針で、このウィンドウが必要とする最小限のAPIだけをwindow.chatSettingsApiとして公開する。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatSettingsApi', {
  // ヘッダーの×ボタン用。ESCキー・OSの閉じるボタンはmain.js側で直接処理される。
  closeWindow: () => ipcRenderer.invoke('chat-settings-window:close'),

  // 常時検知ワード一覧。setは配列全体を渡して丸ごと保存する方式（main.js側でトリム・重複除外）。
  getWatchWords: () => ipcRenderer.invoke('chat-watch-words:get'),
  setWatchWords: (list) => ipcRenderer.invoke('chat-watch-words:set', list),

  // 遡り中は全タブ統合の自動更新を止めるトグル。
  getScrollLock: () => ipcRenderer.invoke('chat-scroll-lock:get'),
  setScrollLock: (enabled) => ipcRenderer.invoke('chat-scroll-lock:set', enabled),
});
