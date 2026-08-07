'use strict';

// 汎用オーバーレイパネル基盤（MCD大規模アプデ#16向け、2026-08-07新設）のレンダラー側ロジック。
// 2026-08-07 追加分: help/welcome/premium-locked/feedbackの4モーダルを、メインウィンドウの
// index.html/renderer.jsから移植した（配信を消さないオーバーレイ方式への移行）。
// DOM構造・id・classはindex.html側の元のものと完全一致させてあり、JSロジックも
// window.api.hideContentViews()/showContentViews()呼び出しを取り除いた以外は元のまま
// （BrowserView最前面表示のため、そもそも配信タイルを一時退避させる必要が無くなったため）。
// 2026-08-08追加分: 会員登録(#pro-auth-modal)も同様にこちらへ移植した。決済(Stripe Checkout)
// 自体はmain.js側でshell.openExternalにより外部ブラウザへ委譲する既存方式のままで、
// pro-auth:*のIPCハンドラ・決済ロジックは一切変更していない（呼び出し口をwindow.overlayApi
// 経由に変えただけ）。

const params = new URLSearchParams(window.location.search);
const panelId = params.get('panel') || '';

const CENTERED_MODAL_IDS = ['help', 'welcome', 'premium-locked', 'feedback', 'pro-auth'];

// help-modalは他モーダルからの導線（welcome/premium-lockedの「使い方/注記を見る」）でも
// 使うため、初回mount済みかどうかをここで管理し、リスナーの二重登録を避ける。
// 2026-08-08修正（実機報告の根本原因判明）: 以前はこの宣言がmountHelp()関数定義の直前
// （ファイル後半）にあったが、下のトップレベルコード（if文内のmountCenteredModal(panelId)
// 呼び出し）がスクリプト実行順としてこの宣言より先に走り、panelId==='help'の場合
// mountHelp()内でhelpMountedを参照した瞬間にTDZ（`let`の初期化前アクセス）で
// `Uncaught ReferenceError: Cannot access 'helpMounted' before initialization`が発生していた。
// このエラーはモジュールのトップレベル実行を丸ごと停止させるため、使い方/注記モーダルの
// タブ・閉じるボタン・外側クリックなど、以降に定義されるはずだった全てのイベントリスナーが
// 一切登録されず「何をクリックしても無反応」という実機報告と完全に一致する（宣言をここへ
// 巻き上げて、呼び出しより確実に先に評価されるようにした）。
let helpMounted = false;

// Escapeキーで現在表示中のモーダルを閉じる際、各モーダル固有の副作用（welcomeの
// setFirstLaunchDone等）を確実に実行するための差し替え口。mount*関数側で上書きする。
// （メインウィンドウ側のforwardEscapeKey→ui:escape-pressed→closeTopmostPanelWithEscape→
// closeOverlayPanelは並行して発火するが、そちらはIPC越しにこのBrowserView自体を閉じる
// だけなので、副作用はこちら側で先に確実に実行しておく必要がある）
let activeEscapeClose = () => window.overlayApi.close();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') activeEscapeClose();
});

if (CENTERED_MODAL_IDS.includes(panelId)) {
  document.getElementById('overlay-panel-generic').classList.add('hidden');
  // html自体にクラスを付与する（bodyだけだと、html要素の不透明背景がbodyのtransparentの
  // 下から透けずに残ってしまうため）。
  document.documentElement.classList.add('centered-modal');
  mountCenteredModal(panelId);
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

function mountCenteredModal(id) {
  if (id === 'help') mountHelp();
  else if (id === 'welcome') mountWelcome();
  else if (id === 'premium-locked') mountPremiumLocked();
  else if (id === 'feedback') mountFeedback();
  else if (id === 'pro-auth') mountProAuth();
}

function showEl(el) {
  el.classList.remove('hidden');
}
function hideEl(el) {
  el.classList.add('hidden');
}

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
  // 2026-08-08追加: overlayPanelViewがコンテンツ領域全体まで広がったことに伴い、カード外側
  // （#help-modal自身＝透明な背景部分）のクリックで閉じられるようにする。e.target===helpModal
  // の時だけ発火させることで、カード内（.modal-content内の要素）へのクリックはバブリングして
  // きても誤って閉じないようにしている。
  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) window.overlayApi.close();
  });
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
  // 2026-08-08追加: カード外側クリックで閉じる（help-modalと同じ理由）。setFirstLaunchDone
  // の副作用も揃えるため、closeBtnと同じcloseWelcome()を使う。
  welcomeModal.addEventListener('click', (e) => {
    if (e.target === welcomeModal) closeWelcome();
  });
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
  // 2026-08-08追加: カード外側クリックで閉じる（help-modalと同じ理由）。
  premiumLockedModal.addEventListener('click', (e) => {
    if (e.target === premiumLockedModal) window.overlayApi.close();
  });
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

  // 下書き復元（centered化で外側クリックでも閉じられるようになったため、入力途中の内容を
  // 消さないよう、メインプロセス側に保持している下書きをここで反映する）。
  window.overlayApi.getFeedbackDraft().then((draft) => {
    if (!draft) return;
    feedbackSubjectInput.value = draft.subject || '';
    feedbackBodyInput.value = draft.body || '';
  });

  function saveDraft() {
    window.overlayApi.setFeedbackDraft(feedbackSubjectInput.value, feedbackBodyInput.value);
  }
  feedbackSubjectInput.addEventListener('input', saveDraft);
  feedbackBodyInput.addEventListener('input', saveDraft);

  feedbackCloseBtn.addEventListener('click', () => window.overlayApi.close());
  // 2026-08-08追加: カード外側クリックで閉じる（help-modalと同じ理由）。下書きは既存の
  // input時保存（saveDraft）で常に最新が保持されているため、ここで追加の保存処理は不要。
  feedbackModal.addEventListener('click', (e) => {
    if (e.target === feedbackModal) window.overlayApi.close();
  });
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
      window.overlayApi.setFeedbackDraft('', '');
    } catch (err) {
      setFeedbackMessage(`送信に失敗しました（${err.message || err}）。しばらくしてからもう一度お試しください。`, true);
    } finally {
      feedbackSendBtn.disabled = false;
    }
  });
}

// ---- 会員登録（メール＋確認コード認証、決済フロー） ----
// 2026-08-08、メインウィンドウのrenderer.jsから移植（DOM構造・id・class・ロジックは完全に
// 一致させてあり、window.api呼び出しをwindow.overlayApi呼び出しに変えた以外は元のまま）。
// 決済(Stripe Checkout)自体はmain.js側のpro-auth:start-checkoutハンドラがshell.openExternalで
// 外部ブラウザを開く既存方式のままで、ここでは一切扱わない（本モジュールはURL取得のIPC呼び出し
// と結果メッセージ表示のみ）。
function mountProAuth() {
  const proAuthModal = document.getElementById('pro-auth-modal');
  const proAuthCloseBtn = document.getElementById('pro-auth-close-btn');
  const proAuthBackendUrlInput = document.getElementById('pro-auth-backend-url-input');
  const proAuthLoggedOutArea = document.getElementById('pro-auth-logged-out-area');
  const proAuthLoggedInArea = document.getElementById('pro-auth-logged-in-area');
  const proAuthEmailInput = document.getElementById('pro-auth-email-input');
  const proAuthCodeInput = document.getElementById('pro-auth-code-input');
  const proAuthRequestCodeBtn = document.getElementById('pro-auth-request-code-btn');
  const proAuthVerifyCodeBtn = document.getElementById('pro-auth-verify-code-btn');
  const proAuthLoggedInEmail = document.getElementById('pro-auth-logged-in-email');
  const proAuthStatusText = document.getElementById('pro-auth-status-text');
  const proAuthRefreshStatusBtn = document.getElementById('pro-auth-refresh-status-btn');
  const proAuthLogoutBtn = document.getElementById('pro-auth-logout-btn');
  const proAuthMessage = document.getElementById('pro-auth-message');
  const proCheckoutCardBtn = document.getElementById('pro-checkout-card-btn');
  const proCheckoutMonthsSelect = document.getElementById('pro-checkout-months-select');
  const proCheckoutOtherBtn = document.getElementById('pro-checkout-other-btn');

  showEl(proAuthModal);
  activeEscapeClose = () => window.overlayApi.close();

  function setProAuthMessage(text, isError = false) {
    proAuthMessage.textContent = text || '';
    proAuthMessage.style.color = isError ? '#f04747' : '';
  }

  function describeProStatus(status) {
    if (!status) return '確認中…';
    if (status.error) return `確認できませんでした（${status.error}）`;
    const active = !!(status.active || status.premiumUnlocked);
    return active ? '有効（Pro機能アンロック中）' : '未加入、または期限切れ';
  }

  async function refreshProAuthPanel() {
    const config = await window.overlayApi.getProAuthConfig();
    proAuthBackendUrlInput.value = config.backendUrl || '';
    if (config.loggedIn) {
      proAuthLoggedOutArea.classList.add('hidden');
      proAuthLoggedInArea.classList.remove('hidden');
      proAuthLoggedInEmail.textContent = config.email || '';
      proAuthStatusText.textContent = describeProStatus(config.proStatus);
    } else {
      proAuthLoggedOutArea.classList.remove('hidden');
      proAuthLoggedInArea.classList.add('hidden');
    }
  }
  refreshProAuthPanel();

  proAuthCloseBtn.addEventListener('click', () => window.overlayApi.close());
  // 2026-08-08追加: カード外側クリックで閉じる（help-modal等と同じ理由）。
  proAuthModal.addEventListener('click', (e) => {
    if (e.target === proAuthModal) window.overlayApi.close();
  });

  proAuthRequestCodeBtn.addEventListener('click', async () => {
    setProAuthMessage('');
    const email = proAuthEmailInput.value.trim();
    if (!email) {
      setProAuthMessage('メールアドレスを入力してください', true);
      return;
    }
    // バックエンドURLを未保存のまま使えるよう、コード送信前に反映しておく
    await window.overlayApi.setPaymentBackendUrl(proAuthBackendUrlInput.value.trim());
    try {
      proAuthRequestCodeBtn.disabled = true;
      await window.overlayApi.requestProAuthCode(email);
      setProAuthMessage('確認コードを送信しました。メールをご確認ください。');
    } catch (err) {
      setProAuthMessage(String(err.message || err), true);
    } finally {
      proAuthRequestCodeBtn.disabled = false;
    }
  });

  proAuthVerifyCodeBtn.addEventListener('click', async () => {
    setProAuthMessage('');
    const email = proAuthEmailInput.value.trim();
    const code = proAuthCodeInput.value.trim();
    if (!email || !code) {
      setProAuthMessage('メールアドレスと確認コードを入力してください', true);
      return;
    }
    try {
      proAuthVerifyCodeBtn.disabled = true;
      await window.overlayApi.verifyProAuthCode(email, code);
      proAuthCodeInput.value = '';
      setProAuthMessage('ログインしました。');
      await refreshProAuthPanel();
    } catch (err) {
      setProAuthMessage(String(err.message || err), true);
    } finally {
      proAuthVerifyCodeBtn.disabled = false;
    }
  });

  proAuthRefreshStatusBtn.addEventListener('click', async () => {
    setProAuthMessage('');
    try {
      proAuthRefreshStatusBtn.disabled = true;
      await window.overlayApi.refreshProAuthStatus();
      setProAuthMessage('最新の状態に更新しました。');
      await refreshProAuthPanel();
    } catch (err) {
      setProAuthMessage(String(err.message || err), true);
    } finally {
      proAuthRefreshStatusBtn.disabled = false;
    }
  });

  proAuthLogoutBtn.addEventListener('click', async () => {
    await window.overlayApi.logoutProAuth();
    setProAuthMessage('ログアウトしました。');
    await refreshProAuthPanel();
  });

  proCheckoutCardBtn.addEventListener('click', async () => {
    setProAuthMessage('');
    try {
      proCheckoutCardBtn.disabled = true;
      await window.overlayApi.startProCheckout('card');
      setProAuthMessage('ブラウザで決済ページを開きました。お手続き後、「最新の状態に更新」で反映を確認してください。');
    } catch (err) {
      setProAuthMessage(String(err.message || err), true);
    } finally {
      proCheckoutCardBtn.disabled = false;
    }
  });

  proCheckoutOtherBtn.addEventListener('click', async () => {
    setProAuthMessage('');
    const months = Number(proCheckoutMonthsSelect.value) || 1;
    try {
      proCheckoutOtherBtn.disabled = true;
      await window.overlayApi.startProCheckout('other', months);
      setProAuthMessage('ブラウザで決済ページを開きました。お手続き後、「最新の状態に更新」で反映を確認してください。');
    } catch (err) {
      setProAuthMessage(String(err.message || err), true);
    } finally {
      proCheckoutOtherBtn.disabled = false;
    }
  });
}
