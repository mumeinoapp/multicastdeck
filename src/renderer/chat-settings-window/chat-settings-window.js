'use strict';

// チャット統合の設定ウィンドウ（2026-08-09新設）本体ロジック。
// window.chatSettingsApi（chat-settings-window-preload.js）経由でmain.js側のelectron-store値を
// 読み書きするだけの単純な画面。保存が確定するたびに、main.js側がメインウィンドウへ
// 'chat-watch-words:changed' / 'chat-scroll-lock:changed' をbroadcastし、開いたままの
// チャット統合パネル（renderer.js）にも即座に反映される。

const closeBtn = document.getElementById('chat-settings-close-btn');
const scrollLockCheckbox = document.getElementById('chat-settings-scroll-lock-checkbox');
const watchInput = document.getElementById('chat-settings-watch-input');
const watchAddBtn = document.getElementById('chat-settings-watch-add-btn');
const watchListEl = document.getElementById('chat-settings-watch-list');
const watchEmptyEl = document.getElementById('chat-settings-watch-empty');

closeBtn.addEventListener('click', () => window.chatSettingsApi.closeWindow());

// ---- 遡り中は自動更新を止める トグル ----
async function initScrollLockToggle() {
  const enabled = await window.chatSettingsApi.getScrollLock();
  scrollLockCheckbox.checked = !!enabled;
}
scrollLockCheckbox.addEventListener('change', () => {
  window.chatSettingsApi.setScrollLock(scrollLockCheckbox.checked);
});

// ---- 常時検知ワード ----
let watchWords = [];

function renderWatchWords() {
  watchListEl.innerHTML = '';
  watchEmptyEl.classList.toggle('hidden', watchWords.length > 0);
  watchWords.forEach((word) => {
    const li = document.createElement('li');
    const textSpan = document.createElement('span');
    textSpan.className = 'watch-word-text';
    textSpan.textContent = word;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.title = `「${word}」を常時検知から削除`;
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removeWatchWord(word));
    li.appendChild(textSpan);
    li.appendChild(removeBtn);
    watchListEl.appendChild(li);
  });
}

async function persistWatchWords() {
  watchWords = await window.chatSettingsApi.setWatchWords(watchWords);
  renderWatchWords();
}

function addWatchWordFromInput() {
  const word = watchInput.value.trim();
  if (!word) return;
  const lower = word.toLowerCase();
  if (watchWords.some((w) => w.toLowerCase() === lower)) {
    watchInput.value = '';
    return; // 既に登録済み。無音で何もしない（エラー表示するほどの操作でもないため）。
  }
  watchWords.push(word);
  watchInput.value = '';
  persistWatchWords();
}

function removeWatchWord(word) {
  watchWords = watchWords.filter((w) => w !== word);
  persistWatchWords();
}

watchAddBtn.addEventListener('click', addWatchWordFromInput);
watchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addWatchWordFromInput();
});

async function initWatchWords() {
  watchWords = (await window.chatSettingsApi.getWatchWords()) || [];
  renderWatchWords();
}

initScrollLockToggle();
initWatchWords();
