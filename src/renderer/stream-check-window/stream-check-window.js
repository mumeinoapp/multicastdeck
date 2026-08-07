'use strict';

// 配信チェックウィンドウ（2026-08-07新設、段階A）の描画ロジック。
//
// 段階Aのスコープは「独立ウィンドウが開く/閉じる/ドラッグできる/ESCで閉じる/メインウィンドウを
// 閉じると道連れになる」という土台の動作確認のみ。中身はプレースホルダー表示のみで、
// 配信中一覧の取得・表示ロジックは段階B以降で追加する（layout-window.jsのfetchUnifiedFeed
// 呼び出しパターンを参考に、overlay-panel.jsのmountUnifiedFeed()から移植していく）。

document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('stream-check-close-btn');
  // ESCキー・OSの閉じるボタンはmain.js側（before-input-event / ウィンドウ標準の閉じるボタン）で
  // 処理される。こちらはヘッダーの×ボタン専用。
  closeBtn.addEventListener('click', () => window.streamCheckApi.closeWindow());
});
