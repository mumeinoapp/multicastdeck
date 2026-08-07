'use strict';

// 汎用オーバーレイパネル基盤（MCD大規模アプデ#16向け、2026-08-07新設）のレンダラー側ロジック。
// 2026-08-07 追加分: help/welcome/premium-locked/feedbackの4モーダルを、メインウィンドウの
// index.html/renderer.jsから移植した（配信を消さないオーバーレイ方式への移行）。
// DOM構造・id・classはindex.html側の元のものと完全一致させてあり、JSロジックも
// window.api.hideContentViews()/showContentViews()呼び出しを取り除いた以外は元のまま
// （BrowserView最前面表示のため、そもそも配信タイルを一時退避させる必要が無くなったため）。
// 会員登録(#pro-auth-modal、決済フロー)は今回のスコープ外（次回セッションで対応）。

const params = new URLSearchParams(window.location.search);
const panelId = params.get('panel') || '';

const FULLWINDOW_MODAL_IDS = ['help', 'welcome', 'premium-locked', 'feedback'];

// Escapeキーで現在表示中のモーダルを閉じる際、各モーダル固有の副作用（welcomeの
// setFirstLaunchDone等）を確実に実行するための差し替え口。mount*関数側で上書きする。
// （メインウィンドウ側のforwardEscapeKey→ui:escape-pressed→closeTopmostPanelWithEscape→
// closeOverlayPanelは並行して発火するが、そちらはIPC越しにこのBrowserView自体を閉じる
// だけなので、副作用はこちら側で先に確実に実行しておく必要がある）
let activeEscapeClose = () => window.overlayApi.close();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') activeEscapeClose();
});

if (FULLWINDOW_MODAL_IDS.includes(panelId)) {
  document.getElementById('overlay-panel-generic').classList.add('hidden');
  mountFullwindowModal(panelId);
} else {
  mountGenericPanel(panelId);
}

function mountGenericPanel(id) {
  const titleEl = document.getElementById('overlay-panel-title');
  const bodyEl = document.getElementById('overlay-panel-body');
  const closeBtn = document.getElementById('overlay-panel-close');

  titleEl.textContent = id ? `パネル: ${id}` : 'パネル';
  bodyEl.textContent = `汎用オーバーレイパネル基盤（動作確認用）\npanelId = "${id}"\n\nこのパネルはBrowserView最前面オーバーレイ方式で表示されています。\n配信タイルの幅は変更されていません。`;

  closeBtn.addEventListener('click', () => window.overlayApi.close());
}

function mountFullwindowModal(id) {
  if (id === 'help') mountHelp();
  else if (id === 'welcome') mountWelcome();
  else if (id === 'premium-locked') mountPremiumLocked();
  else if (id === 'feedback') mountFeedback();
}

function showEl(el) {
  el.classList.remove('hidden');
}
function hideEl(el) {
  el.classList.add('hidden');
}

// help-modalは他モーダルからの導線（welcome/premium-lockedの「使い方/注記を見る」）でも
// 使うため、初回mount済みかどうかをここで管理し、リスナーの二重登録を避ける。
let helpMounted = false;
function mountHelp() {
  const helpModal = document.getElementById('help-modal');
  const helpCloseBtn = document.getElementById('help-close-btn');
  showEl(helpModal);
  activeEscapeClose = () => window.overlayApi.close();
  if (helpMounted) return;
  helpMounted = true;

  const helpTabBtns = Array.from(document.querySelectorAll('.help-tab-btn'));
  const helpTabContents = Array.from(document.querySelectorAll('[data-help-content]'));

  helpCloseBtn.addEventListener('click', () => window.overlayApi.close());
  helpTabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.helpTab;
      helpTabBtns.forEach((b) => b.classList.toggle('active', b === btn));
      helpTabContents.forEach((c) => c.classList.toggle('hidden', c.dataset.helpContent !== tab));
    });
  });
}

function selectHelpTab(tabName) {
  const helpTabBtns = Array.from(document.querySelectorAll('.help-tab-btn'));
  const helpTabContents = Array.from(document.querySelectorAll('[data-help-content]'));
  helpTabBtns.forEach((b) => b.classList.toggle('active', b.dataset.helpTab === tabName));
  helpTabContents.forEach((c) => c.classList.toggle('hidden', c.dataset.helpContent !== tabName));
}

function mountWelcome() {
  const welcomeModal = document.getElementById('welcome-modal');
  const welcomeCloseBtn = document.getElementById('welcome-close-btn');
  const welcomeOpenHelpBtn = document.getElementById('welcome-open-help-btn');
  showEl(welcomeModal);

  async function closeWelcome() {
    await window.overlayApi.setFirstLaunchDone();
    window.overlayApi.close();
  }
  activeEscapeClose = closeWelcome;

  welcomeCloseBtn.addEventListener('click', closeWelcome);
  welcomeOpenHelpBtn.addEventListener('click', async () => {
    await window.overlayApi.setFirstLaunchDone();
    hideEl(welcomeModal);
    mountHelp();
  });
}

function mountPremiumLocked() {
  const premiumLockedModal = document.getElementById('premium-locked-modal');
  const premiumLockedCloseBtn = document.getElementById('premium-locked-close-btn');
  const premiumLockedOpenHelpBtn = document.getElementById('premium-locked-open-help-btn');
  showEl(premiumLockedModal);
  activeEscapeClose = () => window.overlayApi.close();

  premiumLockedCloseBtn.addEventListener('click', () => window.overlayApi.close());
  premiumLockedOpenHelpBtn.addEventListener('click', () => {
    hideEl(premiumLockedModal);
    mountHelp();
    selectHelpTab('premium');
  });
}

function mountFeedback() {
  const feedbackModal = document.getElementById('feedback-modal');
  const feedbackCloseBtn = document.getElementById('feedback-close-btn');
  const feedbackSendBtn = document.getElementById('feedback-send-btn');
  const feedbackSubjectInput = document.getElementById('feedback-subject-input');
  const feedbackBodyInput = document.getElementById('feedback-body-input');
  const feedbackMessage = document.getElementById('feedback-message');

  feedbackMessage.textContent = '';
  showEl(feedbackModal);
  activeEscapeClose = () => window.overlayApi.close();

  function setFeedbackMessage(text, isError = false) {
    feedbackMessage.textContent = text || '';
    feedbackMessage.style.color = isError ? '#f04747' : '';
  }

  feedbackCloseBtn.addEventListener('click', () => window.overlayApi.close());
  feedbackSendBtn.addEventListener('click', async () => {
    const subject = feedbackSubjectInput.value.trim();
    const body = feedbackBodyInput.value.trim();
    if (!subject && !body) {
      setFeedbackMessage('件名か本文のどちらかを入力してください。', true);
      return;
    }
    try {
      feedbackSendBtn.disabled = true;
      setFeedbackMessage('送信中…');
      await window.overlayApi.sendFeedback(subject, body);
      setFeedbackMessage('送信しました。ありがとうございます！');
      feedbackSubjectInput.value = '';
      feedbackBodyInput.value = '';
    } catch (err) {
      setFeedbackMessage(`送信に失敗しました（${err.message || err}）。しばらくしてからもう一度お試しください。`, true);
    } finally {
      feedbackSendBtn.disabled = false;
    }
  });
}
