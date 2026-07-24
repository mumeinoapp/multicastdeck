'use strict';

/**
 * 「時系列統合」モードでYouTubeのライブチャットを取り込むための裏読み込み専用プリロード。
 * このBrowserViewはウィンドウにaddBrowserViewしない（画面には一切表示しない）。
 * https://www.youtube.com/live_chat?v=... （公式のライブチャット埋め込みページ、APIキー不要）を
 * 読み込ませた上で、新しく追加されるチャットメッセージのDOM要素をMutationObserverで検知し、
 * 発言者名・本文だけを抜き出してメインプロセスへ送る。
 *
 * 非公式のDOM構造依存（Drops進捗確認等と同じ位置づけのヒューリスティック）のため、
 * YouTube側のページ構造変更で動かなくなる可能性がある。
 */
const { ipcRenderer } = require('electron');

let channelName = null;

ipcRenderer.on('youtube-chat-watch:init', (_event, payload) => {
  channelName = payload?.channel || null;
});

/** 1件のチャットメッセージ要素から発言者名・本文を抜き出す */
function extractMessage(node) {
  try {
    const author = node.querySelector('#author-name');
    const message = node.querySelector('#message');
    if (!author || !message) return null;
    const username = author.textContent.trim();
    const text = message.textContent.trim();
    if (!username || !text) return null;
    return { username, message: text };
  } catch (_) {
    return null;
  }
}

function isChatMessageNode(node) {
  if (!node || node.nodeType !== 1) return false;
  const tag = (node.tagName || '').toLowerCase();
  // 通常のテキストメッセージ / メンバー限定メッセージ の両方を拾う
  return tag === 'yt-live-chat-text-message-renderer' || tag === 'yt-live-chat-paid-message-renderer';
}

function attachObserver() {
  const container =
    document.querySelector('yt-live-chat-item-list-renderer #items') || document.getElementById('items');
  if (!container) {
    // ページ読み込み直後はまだ存在しないことがあるため、少し待って再試行する
    setTimeout(attachObserver, 1000);
    return;
  }
  const observer = new MutationObserver((mutations) => {
    if (!channelName) return;
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!isChatMessageNode(node)) return;
        const parsed = extractMessage(node);
        if (!parsed) return;
        ipcRenderer.send('youtube-chat:message', {
          channel: channelName,
          username: parsed.username,
          message: parsed.message,
        });
      });
    });
  });
  observer.observe(container, { childList: true });
}

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(attachObserver, 1500);
});
