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

// 2026-08-08追加（配信チェック/unified-feedのカード化移植分）: mountUnifiedFeed()内で参照する
// モジュールスコープの状態・定数。ファイル末尾寄りのmountUnifiedFeed()定義の直前に置いていたが、
// このファイル冒頭のトップレベルコード（if文内のmountGenericPanel(panelId)呼び出し、下記）が
// スクリプト実行順としてこれらの宣言より先に走るため、mountUnifiedFeed()の同期処理部分から
// 直接参照した場合にTDZ例外になりうる、helpMountedと全く同じ落とし穴（上のコメント参照）。
// 現状は該当変数への最初のアクセスが非同期コールバック内のみのため実害は出ていないが、
// 再発防止のためここへ巻き上げておく。
const FALLBACK_AVATAR_DATA_URI =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
      '<circle cx="20" cy="20" r="20" fill="#3a3a44"/>' +
      '<circle cx="20" cy="15.5" r="6.5" fill="#6b7280"/>' +
      '<path d="M6.5 36c1.8-7.2 7.3-11 13.5-11s11.7 3.8 13.5 11z" fill="#6b7280"/>' +
      '</svg>'
  );
const UNIFIED_FEED_AUTO_REFRESH_MS = 20 * 1000;
let unifiedFeedItems = [];
let unifiedFeedPlatformFilter = 'all';
let allFollowCandidates = [];
let unifiedFeedAutoTimer = null;

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
  // 配信チェック（統一フィード）はドッキング型（非centered）だが、汎用プレースホルダではなく
  // 専用UIを持つため、ここで分岐する。
  if (id === 'unified-feed') {
    document.getElementById('overlay-panel-generic').classList.add('hidden');
    mountUnifiedFeed();
    return;
  }

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

// 2026-08-08修正（実機報告）: カード内（.modal-content）でmousedownして選択操作等で
// カード外（背景の透明部分）までドラッグし、そこでmouseupすると、clickイベントの
// target判定はmouseup位置基準になるためe.target===modal（背景）になり、カード内で
// 操作を始めたつもりでもモーダルが閉じてしまっていた。mousedownの開始位置も記録し、
// 「mousedownとclickの両方が背景要素そのものだった」場合に限って閉じるようにする。
function bindBackdropClose(modal, onClose) {
  let downOnBackdrop = false;
  modal.addEventListener('mousedown', (e) => {
    downOnBackdrop = e.target === modal;
  });
  modal.addEventListener('click', (e) => {
    if (downOnBackdrop && e.target === modal) onClose();
    downOnBackdrop = false;
  });
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
  // （#help-modal自身＝透明な背景部分）のクリックで閉じられるようにする。bindBackdropClose
  // はmousedown/click双方が背景要素そのものだった場合のみ発火するため、カード内で操作を
  // 始めて外までドラッグしてしまった場合には誤って閉じない（2026-08-08 実機報告で修正）。
  bindBackdropClose(helpModal, () => window.overlayApi.close());
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
  // 2026-08-08追加: カード外側クリックで閉じる（help-modalと同じ理由。bindBackdropClose参照）。
  // setFirstLaunchDoneの副作用も揃えるため、closeBtnと同じcloseWelcome()を使う。
  bindBackdropClose(welcomeModal, closeWelcome);
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
  // 2026-08-08追加: カード外側クリックで閉じる（help-modalと同じ理由。bindBackdropClose参照）。
  bindBackdropClose(premiumLockedModal, () => window.overlayApi.close());
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
  // 2026-08-08追加: カード外側クリックで閉じる（help-modalと同じ理由。bindBackdropClose参照）。
  // 下書きは既存のinput時保存（saveDraft）で常に最新が保持されているため、ここで追加の
  // 保存処理は不要。
  bindBackdropClose(feedbackModal, () => window.overlayApi.close());
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
  // 2026-08-08追加: カード外側クリックで閉じる（help-modal等と同じ理由。bindBackdropClose参照）。
  bindBackdropClose(proAuthModal, () => window.overlayApi.close());

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

// ---- 配信チェック（統一フィード） ----
// 2026-08-08、メインウィンドウのrenderer.jsから移植。
// 旧: window.api.openSidePanel('unified-feed', 340) で配信タイルの幅を縮めて隙間を空ける
//     サイドパネル方式＋メインウィンドウのDOM。
// 新: オーバーレイパネル基盤（配信タイルを一切縮めない・消さない専用BrowserViewを最前面に重ねる）。
// window.api.* の呼び出しはすべて window.overlayApi.* に置き換えてある（IPCチャンネル名は同一で、
// main.js側のハンドラ・ビジネスロジックは変更していない）。
//
// 「配信中一覧」だけはカード表示（アバター画像付き）に作り直した。並び順の
// 「対象指定を最優先」ルールはmain.js側のfetchUnifiedFeed()から廃止済み（配信中→視聴者数順）。
// 「自動追加の対象を選ぶ」「フォロー配信者の自動追加」の2セクションは別段階で作り直す予定のため、
// マークアップ・ロジックともに元のまま引き継いでいる。
//
// 状態（一覧の中身・絞り込み・自動更新タイマー）はこのモジュールスコープに持つ。パネルを閉じると
// BrowserViewがabout:blankへ遷移して破棄されるため状態も消えるが、開くたびに取得し直す設計
// （旧renderer.js側は常駐するメインウィンドウに状態を持っていたが、ここでは意図的に簡素化している）。

/** メインウィンドウのrenderer.jsにある同名関数と同じ実装（テキストをHTMLとして安全に埋め込む） */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// FALLBACK_AVATAR_DATA_URI / UNIFIED_FEED_AUTO_REFRESH_MS / unifiedFeedItems等の状態は
// TDZ対策のためファイル冒頭（CENTERED_MODAL_IDS宣言の直後）へ移動済み。

function mountUnifiedFeed() {
  const unifiedFeedModal = document.getElementById('unified-feed-modal');
  const unifiedFeedCloseBtn = document.getElementById('unified-feed-close-btn');
  const unifiedFeedRefreshBtn = document.getElementById('unified-feed-refresh-btn');
  const unifiedFeedUpdatedAt = document.getElementById('unified-feed-updated-at');
  const unifiedFeedStatus = document.getElementById('unified-feed-status');
  const unifiedFeedList = document.getElementById('unified-feed-list');
  const unifiedFeedFilterBtns = Array.from(document.querySelectorAll('.unified-feed-filter-btn'));

  const autoTuneInLoadAllBtn = document.getElementById('auto-tune-in-load-all-btn');
  const autoTuneInAllStatus = document.getElementById('auto-tune-in-all-status');
  const autoTuneInAllList = document.getElementById('auto-tune-in-all-list');

  const autoTuneInStatusDot = document.getElementById('auto-tune-in-status-dot');
  const autoTuneInStatusEl = document.getElementById('auto-tune-in-status');
  const autoTuneInMessageEl = document.getElementById('auto-tune-in-message');
  const autoTuneInConnectBtn = document.getElementById('auto-tune-in-connect-btn');
  const autoTuneInDisconnectBtn = document.getElementById('auto-tune-in-disconnect-btn');
  const autoTuneInEnabledInput = document.getElementById('auto-tune-in-enabled-input');
  const autoTuneInMaxInput = document.getElementById('auto-tune-in-max-input');

  showEl(unifiedFeedModal);
  activeEscapeClose = () => window.overlayApi.close();

  // ---- 対象指定（Auto Tune-In）／ピン留めの保存・同期 ----

  /**
   * Auto Tune-Inの対象指定リストへのチェックボックスON/OFFを反映する。
   * 現在値をメインプロセスから取り直してから編集・保存するため、フィード一覧・全一覧のどちらから
   * 操作しても矛盾なく反映される。
   */
  async function toggleAutoTuneInTarget(platform, channel, checked) {
    const key = channel.toLowerCase();
    const current = await window.overlayApi.getAutoTuneInTargets();
    const next = checked
      ? current.some((t) => t.platform === platform && t.channel.toLowerCase() === key)
        ? current
        : [...current, { platform, channel }]
      : current.filter((t) => !(t.platform === platform && t.channel.toLowerCase() === key));
    await window.overlayApi.setAutoTuneInTargets(next);
  }

  /** フィード一覧・全一覧のどちらかでチェックが変わったら、もう一方に同じチャンネルがあれば見た目も同期する */
  function syncTargetCheckboxAcrossLists(platform, channel, checked) {
    const key = channel.toLowerCase();
    const feedItem = unifiedFeedItems.find((f) => f.platform === platform && f.channel.toLowerCase() === key);
    if (feedItem && feedItem.isTarget !== checked) {
      feedItem.isTarget = checked;
      renderUnifiedFeedCards();
    }
    const allItem = allFollowCandidates.find((f) => f.platform === platform && f.channel.toLowerCase() === key);
    if (allItem && allItem.isTarget !== checked) {
      allItem.isTarget = checked;
      renderAllFollowList();
    }
  }

  /**
   * フィードへの「常時表示（ピン留め）」ON/OFFを反映する。自動追加の対象指定とは完全に独立した
   * 別のリストで、YouTube専用。
   */
  async function toggleFeedPin(channel, displayName, checked) {
    const key = channel.toLowerCase();
    const current = await window.overlayApi.getFeedPinnedYoutube();
    const next = checked
      ? current.some((p) => p.channel.toLowerCase() === key)
        ? current
        : [...current, { channel, displayName }]
      : current.filter((p) => p.channel.toLowerCase() !== key);
    await window.overlayApi.setFeedPinnedYoutube(next);
  }

  /**
   * ピン留めが変わったら、もう一方のリストに同じチャンネルがあれば見た目も同期する。
   * ピン留めを外した非配信中チャンネルは次の「🔄 更新」でフィードから消えるが、
   * その場ですぐ消えると誤操作時に分かりにくいため表示上は「offline」扱いのまま残す。
   */
  function syncPinCheckboxAcrossLists(channel, checked) {
    const key = channel.toLowerCase();
    const feedItem = unifiedFeedItems.find((f) => f.platform === 'youtube' && f.channel.toLowerCase() === key);
    if (feedItem && feedItem.isPinned !== checked) feedItem.isPinned = checked;
    const allItem = allFollowCandidates.find((f) => f.platform === 'youtube' && f.channel.toLowerCase() === key);
    if (allItem && allItem.isPinned !== checked) allItem.isPinned = checked;
  }

  /** 「自動追加の対象にする」チェックボックスのtitle（ホバー時の詳細説明）。 */
  function autoTuneInTargetTitle(platform) {
    return platform === 'youtube'
      ? '自動追加の対象にする（YouTubeはチェックを付けないと自動追加されません）'
      : '自動追加の対象にする（チェックした配信者のみが対象になります）';
  }

  /** プラットフォームバッジのHTML。YouTubeは公式カラーの赤にするため絵文字ではなくCSS着色のアイコンを使う。 */
  function platformBadgeHtml(platform) {
    if (platform === 'youtube') return '<span class="unified-feed-platform-badge youtube">▶</span>';
    if (platform === 'kick') return '<span class="unified-feed-platform-badge kick">K</span>';
    return '<span class="unified-feed-platform-badge twitch">●</span>';
  }

  // ---- 配信中一覧（カード表示） ----
  // 旧 renderUnifiedFeedList()（1行フラットな .unified-feed-row）をカード（.unified-feed-card）へ
  // 作り直したもの。表示する情報・操作（対象指定チェック／ピン留めチェック／＋追加ボタンの
  // ラベルと活性条件）は旧実装と完全に同じ。
  function renderUnifiedFeedCards() {
    unifiedFeedList.innerHTML = '';
    const filtered = unifiedFeedItems.filter(
      (item) => unifiedFeedPlatformFilter === 'all' || item.platform === unifiedFeedPlatformFilter
    );
    if (!filtered.length) {
      unifiedFeedList.innerHTML = '<div class="note">現在配信中のフォロー配信者はいません</div>';
      return;
    }
    filtered.forEach((item) => {
      const card = document.createElement('div');
      const offline = item.isPinned && !item.isLive;
      card.className = `unified-feed-card${item.alreadyAdded ? ' already-added' : ''}${offline ? ' offline' : ''}`;
      const viewers = offline
        ? 'オフライン'
        : typeof item.viewerCount === 'number'
        ? `${item.viewerCount.toLocaleString()}人`
        : '';
      // ピン留めチェックボックスはYouTube専用。出ない行にも同じ幅のスペーサーを置いて列位置を揃える。
      const pinHtml =
        item.platform === 'youtube'
          ? `<input type="checkbox" class="unified-feed-pin-checkbox" ${item.isPinned ? 'checked' : ''} title="常に表示（ピン留め、オンライン/オフライン問わず自分で外すまで表示し続ける）" />`
          : '<span class="unified-feed-pin-spacer"></span>';
      // 自動追加（Auto Tune-In）対象指定チェックボックスはTwitch/YouTube専用。
      // KickはAuto Tune-In自体が未対応なのでスペーサーにする。
      const targetHtml =
        item.platform === 'kick'
          ? '<span class="unified-feed-target-spacer"></span>'
          : `<input type="checkbox" class="unified-feed-target-checkbox" ${item.isTarget ? 'checked' : ''} title="${autoTuneInTargetTitle(item.platform)}" />`;
      const liveHtml = offline
        ? ''
        : '<span class="unified-feed-card-live"><span class="unified-feed-card-live-dot"></span>LIVE</span>';
      card.innerHTML = `
        ${targetHtml}
        ${pinHtml}
        <img class="unified-feed-card-avatar" alt="" />
        <div class="unified-feed-card-main">
          <div class="unified-feed-card-name-row">
            ${platformBadgeHtml(item.platform)}
            <span class="unified-feed-card-name">${escapeHtml(item.displayName)}</span>
            ${liveHtml}
          </div>
        </div>
        <span class="unified-feed-card-viewers">${viewers}</span>
        <button class="unified-feed-card-add-btn" ${item.alreadyAdded || offline ? 'disabled' : ''}>${
        item.alreadyAdded ? '表示中' : offline ? 'オフライン' : '＋追加'
      }</button>
      `;

      // アバターは装飾要素。URLが無い／読み込みに失敗した場合は必ずフォールバックアイコンにする
      // （CSPの都合でHTML属性のonerror=は使えないため、JS側でハンドラを付ける）。
      const avatarImg = card.querySelector('.unified-feed-card-avatar');
      avatarImg.onerror = () => {
        avatarImg.onerror = null; // フォールバック画像自体の読み込み失敗で無限ループしないように
        avatarImg.src = FALLBACK_AVATAR_DATA_URI;
      };
      avatarImg.src = item.avatarUrl || FALLBACK_AVATAR_DATA_URI;

      const targetCheckbox = card.querySelector('.unified-feed-target-checkbox');
      if (targetCheckbox) {
        targetCheckbox.addEventListener('change', async (e) => {
          const checked = e.target.checked;
          item.isTarget = checked;
          await toggleAutoTuneInTarget(item.platform, item.channel, checked);
          renderUnifiedFeedCards();
          syncTargetCheckboxAcrossLists(item.platform, item.channel, checked);
          refreshAutoTuneInStatus();
        });
      }
      const pinCheckbox = card.querySelector('.unified-feed-pin-checkbox');
      if (pinCheckbox) {
        pinCheckbox.addEventListener('change', async (e) => {
          const checked = e.target.checked;
          item.isPinned = checked;
          await toggleFeedPin(item.channel, item.displayName, checked);
          renderUnifiedFeedCards();
          syncPinCheckboxAcrossLists(item.channel, checked);
        });
      }
      card.querySelector('.unified-feed-card-add-btn').addEventListener('click', async () => {
        if (offline) return;
        const result = await window.overlayApi.addChannel(item.channel, item.platform);
        if (!result || !result.ok) {
          unifiedFeedStatus.textContent = `追加に失敗しました: ${result ? result.error : '不明なエラー'}`;
          return;
        }
        item.alreadyAdded = true;
        renderUnifiedFeedCards();
        // メインウィンドウ側のチップ一覧はmain.jsのchannels:add→'channels:changed'通知を受けて
        // 自動的に更新されるため、ここからrefreshChips()相当を呼ぶ必要はない。
      });
      unifiedFeedList.appendChild(card);
    });
  }

  // ---- 自動追加の対象を選ぶ（全フォロー/登録一覧、オンライン・オフライン問わず） ----
  // ここは別段階で作り直す予定のため、旧実装（.unified-feed-row のフラットな行）のまま。

  function renderAllFollowList() {
    autoTuneInAllList.innerHTML = '';
    if (!allFollowCandidates.length) return;
    allFollowCandidates.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'unified-feed-row';
      const pinHtml =
        item.platform === 'youtube'
          ? `<input type="checkbox" class="unified-feed-pin-checkbox" ${item.isPinned ? 'checked' : ''} title="常に表示（ピン留め、オンライン/オフライン問わず自分で外すまで表示し続ける）" />`
          : '<span class="unified-feed-pin-spacer"></span>';
      row.innerHTML = `
        <input type="checkbox" class="unified-feed-target-checkbox" ${item.isTarget ? 'checked' : ''} title="${autoTuneInTargetTitle(item.platform)}" />
        ${pinHtml}
        ${platformBadgeHtml(item.platform)}
        <span class="unified-feed-name">${escapeHtml(item.displayName)}</span>
      `;
      row.querySelector('.unified-feed-target-checkbox').addEventListener('change', async (e) => {
        const checked = e.target.checked;
        item.isTarget = checked;
        await toggleAutoTuneInTarget(item.platform, item.channel, checked);
        syncTargetCheckboxAcrossLists(item.platform, item.channel, checked);
        refreshAutoTuneInStatus();
      });
      const pinCheckbox = row.querySelector('.unified-feed-pin-checkbox');
      if (pinCheckbox) {
        pinCheckbox.addEventListener('change', async (e) => {
          const checked = e.target.checked;
          item.isPinned = checked;
          await toggleFeedPin(item.channel, item.displayName, checked);
          syncPinCheckboxAcrossLists(item.channel, checked);
        });
      }
      autoTuneInAllList.appendChild(row);
    });
  }

  autoTuneInLoadAllBtn.addEventListener('click', async () => {
    autoTuneInAllStatus.textContent = '取得中...(フォロー/登録一覧を読み込みます。登録数が多いと時間がかかることがあります)';
    autoTuneInLoadAllBtn.disabled = true;
    try {
      const { items, errors } = await window.overlayApi.fetchAllFollowCandidates();
      allFollowCandidates = items;
      renderAllFollowList();
      const errMessages = [];
      if (errors.twitch) errMessages.push(`Twitch: ${errors.twitch}`);
      if (errors.youtube) errMessages.push(`YouTube: ${errors.youtube}`);
      autoTuneInAllStatus.textContent = errMessages.join(' / ') || `${items.length}件取得しました`;
    } catch (err) {
      autoTuneInAllStatus.textContent = `取得に失敗しました: ${err.message || err}`;
    } finally {
      autoTuneInLoadAllBtn.disabled = false;
    }
  });

  // ---- フォロー配信者の自動追加（Twitchアカウント連携・有効化・上限枠） ----
  // ここも別段階で作り直す予定のため、旧実装のロジックをそのまま引き継いでいる。

  async function refreshAutoTuneInStatus() {
    const status = await window.overlayApi.getAutoTuneInStatus();
    if (status.connected) {
      autoTuneInStatusDot.className = 'status-dot connected';
      autoTuneInStatusEl.textContent = '連携済み Twitch';
      autoTuneInConnectBtn.classList.add('hidden');
      autoTuneInDisconnectBtn.classList.remove('hidden');
    } else {
      autoTuneInStatusDot.className = 'status-dot disconnected';
      autoTuneInStatusEl.textContent = '未連携 Twitch（YouTubeのみの場合は連携不要です）';
      autoTuneInConnectBtn.classList.remove('hidden');
      autoTuneInDisconnectBtn.classList.add('hidden');
    }
    autoTuneInEnabledInput.disabled = !status.canEnable;
    autoTuneInMaxInput.disabled = !status.canEnable;
    autoTuneInEnabledInput.checked = status.enabled;
    autoTuneInMaxInput.value = status.maxTiles;
  }

  autoTuneInConnectBtn.addEventListener('click', async () => {
    // 旧実装ではここでサイドパネルを閉じ→OAuth画面→再度開き直していたが、オーバーレイパネル方式では
    // このパネル自体を閉じるとBrowserViewがabout:blankへ遷移してJSごと破棄され、下の
    // await startTwitchAuth() が結果を受け取れなくなる。OAuth画面のBrowserViewは後から
    // addBrowserViewされるぶん自動的にこのパネルより前面に来て全面を覆うため、閉じる必要もない
    // （連携完了後はmain.jsのcloseTwitchAuthView()がこのパネルを再度setTopBrowserViewで最前面に戻す）。
    // メインウィンドウ側のヘッダーロック・「連携画面を閉じる」ボタンの表示は、main.jsが送る
    // auto-tune-in:auth-view-opened / -closed 通知でrenderer.jsが行う。
    autoTuneInMessageEl.textContent = '連携処理中... 開いた画面でTwitchにログイン・認可してください。';

    const result = await window.overlayApi.startTwitchAuth();

    if (result.ok) {
      autoTuneInMessageEl.textContent = `連携しました（${result.login}としてログイン中）`;
    } else if (!result.cancelled) {
      autoTuneInMessageEl.textContent = `エラー: ${result.error}`;
    } else {
      autoTuneInMessageEl.textContent = '';
    }
    refreshAutoTuneInStatus();
  });

  autoTuneInDisconnectBtn.addEventListener('click', async () => {
    await window.overlayApi.disconnectTwitchAuth();
    refreshAutoTuneInStatus();
  });

  autoTuneInEnabledInput.addEventListener('change', async () => {
    await window.overlayApi.setAutoTuneInConfig({ enabled: autoTuneInEnabledInput.checked });
  });

  autoTuneInMaxInput.addEventListener('change', async () => {
    const v = Math.max(1, Math.min(20, Number(autoTuneInMaxInput.value) || 1));
    autoTuneInMaxInput.value = v;
    await window.overlayApi.setAutoTuneInConfig({ maxTiles: v });
  });

  window.overlayApi.onAutoTuneInError(({ message }) => {
    autoTuneInMessageEl.textContent = `エラー: ${message}`;
  });

  window.overlayApi.onAutoTuneInAuthLost(() => {
    autoTuneInMessageEl.textContent =
      'Twitchとの連携が切れました。下の「Twitchアカウントと連携する」から再連携してください（フォロー配信者の自動追加は停止しています）。';
    refreshAutoTuneInStatus();
  });

  // ---- 取得・自動更新 ----
  // パネルを開いている間、Twitch/YouTube分だけを短い間隔で自動更新する。Kick分はBrowserViewの
  // フルロードを伴い重いため自動更新の対象からは外し、初回取得・手動更新ボタン押下時のみ取得する。
  // includeKick=falseで取得した際は、直前まで表示していたKick分の結果をそのまま引き継ぐ。

  function startUnifiedFeedAutoTimer() {
    stopUnifiedFeedAutoTimer();
    unifiedFeedAutoTimer = setInterval(() => refreshUnifiedFeed({ includeKick: false }), UNIFIED_FEED_AUTO_REFRESH_MS);
  }

  function stopUnifiedFeedAutoTimer() {
    if (unifiedFeedAutoTimer) {
      clearInterval(unifiedFeedAutoTimer);
      unifiedFeedAutoTimer = null;
    }
  }

  async function refreshUnifiedFeed(options = {}) {
    const includeKick = options.includeKick !== false;
    unifiedFeedStatus.textContent = '取得中...';
    unifiedFeedRefreshBtn.disabled = true;
    try {
      const { items, errors } = await window.overlayApi.fetchUnifiedFeed({ includeKick });
      if (includeKick) {
        unifiedFeedItems = items;
      } else {
        const previousKickItems = unifiedFeedItems.filter((item) => item.platform === 'kick');
        unifiedFeedItems = items.concat(previousKickItems);
      }
      renderUnifiedFeedCards();
      const errMessages = [];
      if (errors.twitch) errMessages.push(`Twitch: ${errors.twitch}`);
      if (errors.youtube) errMessages.push(`YouTube: ${errors.youtube}`);
      if (includeKick && errors.kick) errMessages.push(`Kick: ${errors.kick}`);
      unifiedFeedStatus.textContent = errMessages.join(' / ');
      unifiedFeedUpdatedAt.textContent = `最終更新: ${new Date().toLocaleTimeString('ja-JP')}`;
    } catch (err) {
      unifiedFeedStatus.textContent = `取得に失敗しました: ${err.message || err}`;
    } finally {
      unifiedFeedRefreshBtn.disabled = false;
    }
  }

  unifiedFeedRefreshBtn.addEventListener('click', () => refreshUnifiedFeed());

  // 閉じる操作はメインプロセス側（closeOverlayPanel）がBrowserViewの取り外し・about:blank遷移まで
  // 面倒を見るため、旧実装のclosePanel系の後始末は不要。
  unifiedFeedCloseBtn.addEventListener('click', () => {
    stopUnifiedFeedAutoTimer();
    window.overlayApi.close();
  });
  activeEscapeClose = () => {
    stopUnifiedFeedAutoTimer();
    window.overlayApi.close();
  };
  // 外側クリック等でメインプロセス側から閉じられた場合も、about:blank遷移前に確実に止めておく。
  window.addEventListener('pagehide', stopUnifiedFeedAutoTimer);

  /**
   * @param {string} filter 'all'|'twitch'|'youtube'|'kick'
   * @param {boolean} [persist=true] falseを渡すと保存済み設定の復元時などstore書き込みを省略する
   */
  function setUnifiedFeedPlatformFilter(filter, persist = true) {
    unifiedFeedPlatformFilter = filter;
    unifiedFeedFilterBtns.forEach((b) => b.classList.toggle('active', b.dataset.platform === filter));
    // #8対応: 再起動後も選択中の絞り込みを維持できるよう永続化する。
    if (persist) window.overlayApi.setUnifiedFeedPlatformFilter(filter);
  }

  unifiedFeedFilterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setUnifiedFeedPlatformFilter(btn.dataset.platform);
      renderUnifiedFeedCards();
    });
  });

  // ---- 初期化 ----
  // 旧実装ではメインウィンドウの起動時に絞り込みを復元していたが、パネル側に状態を持つようになった
  // ため、パネルを開くたびにここで読み直す（persist=falseで、読んだ値の無駄な書き戻しを避ける）。
  (async function initUnifiedFeed() {
    try {
      const filter = await window.overlayApi.getUnifiedFeedPlatformFilter();
      setUnifiedFeedPlatformFilter(filter || 'all', false);
    } catch (_) {
      setUnifiedFeedPlatformFilter('all', false);
    }
    refreshUnifiedFeed();
    refreshAutoTuneInStatus();
    startUnifiedFeedAutoTimer();
  })();
}
