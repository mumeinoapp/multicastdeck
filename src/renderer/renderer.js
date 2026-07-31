'use strict';

const channelInput = document.getElementById('channel-input');
const channelPlatformSelect = document.getElementById('channel-platform-select');
const addChannelBtn = document.getElementById('add-channel-btn');
const channelChips = document.getElementById('channel-chips');

const dropsToggleBtn = document.getElementById('drops-toggle-btn');
const dropsProgressBtn = document.getElementById('drops-progress-btn');
const dropsProgressResult = document.getElementById('drops-progress-result');
const kickDropsToggleBtn = document.getElementById('kick-drops-toggle-btn');

// 「使い方/注記」はツールバーからは撤去し、ネイティブメニュー「ヘルプ」内の項目から開く（main.js参照）
const helpModal = document.getElementById('help-modal');
const helpCloseBtn = document.getElementById('help-close-btn');
const helpTabBtns = Array.from(document.querySelectorAll('.help-tab-btn'));
const helpTabContents = Array.from(document.querySelectorAll('[data-help-content]'));

const welcomeModal = document.getElementById('welcome-modal');
const welcomeCloseBtn = document.getElementById('welcome-close-btn');
const welcomeOpenHelpBtn = document.getElementById('welcome-open-help-btn');

// ---- 有料機能（Pro機能）のロックUI ----
// premiumUnlockedは会員登録ログイン後の/statusレスポンス（Stripe決済状況）で決まる
// （main.jsのrefreshProAuthStatus参照）。開発者本人のメールでログインした場合のみ、
// main.js側で決済状況によらず自動でtrueになる。
const PRO_BUTTON_IDS = ['zapping-btn', 'unified-feed-btn'];
const premiumLockedModal = document.getElementById('premium-locked-modal');
const premiumLockedCloseBtn = document.getElementById('premium-locked-close-btn');
const premiumLockedOpenHelpBtn = document.getElementById('premium-locked-open-help-btn');
let premiumUnlocked = false;

function applyPremiumLockUiStates() {
  PRO_BUTTON_IDS.forEach((id) => {
    document.getElementById(id)?.classList.toggle('locked', !premiumUnlocked);
  });
  chatIntegrationModeTimelineBtn?.classList.toggle('locked', !premiumUnlocked);
}

async function showPremiumLockedModal() {
  await window.api.hideContentViews();
  premiumLockedModal.classList.remove('hidden');
}
premiumLockedCloseBtn.addEventListener('click', async () => {
  premiumLockedModal.classList.add('hidden');
  await window.api.showContentViews();
});
premiumLockedOpenHelpBtn.addEventListener('click', async () => {
  premiumLockedModal.classList.add('hidden');
  helpModal.classList.remove('hidden');
  helpTabBtns.forEach((b) => b.classList.toggle('active', b.dataset.helpTab === 'premium'));
  helpTabContents.forEach((c) => c.classList.toggle('hidden', c.dataset.helpContent !== 'premium'));
});
window.api.onPremiumChanged((value) => {
  premiumUnlocked = !!value;
  applyPremiumLockUiStates();
});
(async () => {
  premiumUnlocked = await window.api.getPremiumUnlocked();
  applyPremiumLockUiStates();
})();

// 全タブ統合チャットのコメント本文フォント。保存済みの値を起動時に一度読み込み、
// CSS変数へ反映しておく（パネルを開く前でも、次に開いた時点で正しいフォントになる）。
function applyCommentFontFamily(fontFamily) {
  document.documentElement.style.setProperty('--comment-font-family', fontFamily || 'inherit');
}
(async () => {
  const s = await window.api.getAllSettings();
  applyCommentFontFamily(s.commentFontFamily);
})();

let dropsOpen = false;
let kickDropsOpen = false;

let currentChannels = [];
// { [channelName]: 'twitch'|'youtube'|'kick' } チャットパネル・スタンプ等、Kick未対応機能から
// Kickチャンネルを除外するためにrefreshChipsのたびに更新して使い回す。
let currentChannelPlatforms = {};

async function refreshChips() {
  const [channels, chatHiddenMap, dropsAutoStatus, zappingConfig, tuneInAddedChannels, channelPlatforms] = await Promise.all([
    window.api.listChannels(),
    window.api.getChatHiddenMap(),
    window.api.getDropsAutoStatus(),
    window.api.getZappingConfig(),
    window.api.getAutoTuneInAddedChannels(),
    window.api.getChannelPlatforms(),
  ]);
  currentChannels = channels;
  currentChannelPlatforms = channelPlatforms;
  const tuneInAddedSet = new Set(tuneInAddedChannels);
  channelChips.innerHTML = '';
  channels.forEach((name) => {
    const hidden = !!chatHiddenMap[name];
    const autoGame = dropsAutoStatus[name];
    const isTuneInAdded = tuneInAddedSet.has(name);
    const isZapping = zappingConfig.active && zappingConfig.currentChannel === name;
    const platform = channelPlatforms[name] || 'twitch';
    const isYoutube = platform === 'youtube';
    const isKick = platform === 'kick';
    // KickはYouTube同様、チャット統合が今回のスコープ外のため常時非表示固定（トグルUI自体を出さない）
    const chatToggleDisabled = isYoutube || isKick;
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.draggable = true;
    chip.dataset.name = name;
    chip.innerHTML = `
      ${isYoutube ? '<span class="platform-badge" title="YouTube">▶️</span>' : ''}
      ${isKick ? '<span class="platform-badge" title="Kick">🟢</span>' : ''}
      <span class="chip-name-wrap"><span class="chip-name">${name}</span></span>
      ${autoGame ? `<span class="auto-badge" title="Drops自動追加（対象ゲーム: ${autoGame}）">🎯</span>` : ''}
      ${isTuneInAdded ? '<span class="auto-badge" title="フォロー配信者の自動追加">🔁</span>' : ''}
      ${isZapping ? '<span class="zapping-badge" title="ザッピング中のタイル">🎲</span>' : ''}
      ${chatToggleDisabled ? '' : `<span class="chat-toggle${hidden ? ' active' : ''}" data-name="${name}" title="チャット表示の切り替え（このチャンネルだけ配信映像のみにする）">${hidden ? '🔇' : '💬'}</span>`}
      <span class="remove" data-name="${name}">×</span>
    `;
    channelChips.appendChild(chip);
  });
  channelChips.querySelectorAll('.remove').forEach((el) => {
    el.addEventListener('click', async (e) => {
      await window.api.removeChannel(e.target.dataset.name);
      refreshChips();
      refreshEmoteChannelOptions();
      refreshChatIntegrationIfOpen();
    });
  });
  channelChips.querySelectorAll('.chat-toggle').forEach((el) => {
    el.addEventListener('click', async (e) => {
      const name = e.target.dataset.name;
      const nowHidden = !e.target.classList.contains('active');
      await window.api.setChatHidden(name, nowHidden);
      refreshChips();
    });
  });
  setupChipDragReorder();
  setupChipNameMarquee();
  refreshEmoteChannelOptions();
}

/**
 * チャンネル名が固定幅の枠に収まりきらない場合だけ、チップにカーソルを合わせている間
 * 枠内で左へスライドして全体を読めるようにする（アイコン類を押し出さないための固定幅化とセット）。
 * はみ出し量に応じてアニメーション時間を変えることで、長い名前でも極端に速く/遅くなりすぎないようにする。
 */
function setupChipNameMarquee() {
  channelChips.querySelectorAll('.chip-name-wrap').forEach((wrap) => {
    const nameEl = wrap.querySelector('.chip-name');
    const overflow = nameEl.scrollWidth - wrap.clientWidth;
    if (overflow > 2) {
      wrap.classList.add('overflowing');
      const duration = Math.max(0.6, overflow / 30); // 秒。はみ出しが大きいほどゆっくりスライドする
      nameEl.style.setProperty('--marquee-offset', `${-overflow}px`);
      nameEl.style.transitionDuration = `${duration}s`;
    }
  });
}

// チップ一覧はトラックパッドの横スワイプ以外に、通常のマウスホイール（縦スクロール）でも
// 横スクロールできるようにする（チップ数が増えても専用の左右スクロール操作を覚えずに済むように）。
channelChips.addEventListener(
  'wheel',
  (e) => {
    if (e.deltaY === 0) return;
    e.preventDefault();
    channelChips.scrollLeft += e.deltaY;
  },
  { passive: false }
);

// チャンネルチップをドラッグ&ドロップで並び替え、レイアウトの表示順に反映する（レイアウト自由化の一部）
function setupChipDragReorder() {
  let dragged = null;
  channelChips.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('dragstart', () => {
      dragged = chip;
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    chip.addEventListener('dragover', (e) => {
      e.preventDefault();
      chip.classList.add('drag-over');
    });
    chip.addEventListener('dragleave', () => chip.classList.remove('drag-over'));
    chip.addEventListener('drop', async (e) => {
      e.preventDefault();
      chip.classList.remove('drag-over');
      if (!dragged || dragged === chip) return;
      const chips = Array.from(channelChips.querySelectorAll('.chip'));
      const fromIdx = chips.indexOf(dragged);
      const toIdx = chips.indexOf(chip);
      chips.splice(fromIdx, 1);
      chips.splice(toIdx, 0, dragged);
      if (toIdx < fromIdx) chip.before(dragged);
      else chip.after(dragged);
      const newOrder = Array.from(channelChips.querySelectorAll('.chip')).map((c) => c.dataset.name);
      await window.api.reorderChannels(newOrder);
    });
  });
}

// ---- ヘッダー操作ボタンのドラッグ&ドロップ並び替え ----
// チャンネルチップと同じ考え方。並び順は data-key の配列としてstoreに保存し、次回起動時にも復元する。
const actionButtonsContainer = document.getElementById('action-buttons');

/** 保存済みの並び順があれば、起動時にDOM上の並びへ反映する */
async function restoreActionButtonOrder() {
  const order = await window.api.getHeaderButtonOrder();
  if (!order || !order.length) return;
  const buttons = Array.from(actionButtonsContainer.querySelectorAll('.action-btn'));
  const byKey = new Map(buttons.map((b) => [b.dataset.key, b]));
  order.forEach((key) => {
    const btn = byKey.get(key);
    if (btn) actionButtonsContainer.appendChild(btn);
  });
  // 保存済み順序に含まれていない（アップデートで新規追加された）ボタンは末尾に残る
}

function setupActionButtonsDragReorder() {
  let dragged = null;
  actionButtonsContainer.querySelectorAll('.action-btn').forEach((btn) => {
    btn.addEventListener('dragstart', () => {
      dragged = btn;
      btn.classList.add('dragging');
    });
    btn.addEventListener('dragend', () => btn.classList.remove('dragging'));
    btn.addEventListener('dragover', (e) => {
      e.preventDefault();
      btn.classList.add('drag-over');
    });
    btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
    btn.addEventListener('drop', async (e) => {
      e.preventDefault();
      btn.classList.remove('drag-over');
      if (!dragged || dragged === btn) return;
      const buttons = Array.from(actionButtonsContainer.querySelectorAll('.action-btn'));
      const fromIdx = buttons.indexOf(dragged);
      const toIdx = buttons.indexOf(btn);
      buttons.splice(fromIdx, 1);
      buttons.splice(toIdx, 0, dragged);
      if (toIdx < fromIdx) btn.before(dragged);
      else btn.after(dragged);
      const newOrder = Array.from(actionButtonsContainer.querySelectorAll('.action-btn')).map((b) => b.dataset.key);
      await window.api.setHeaderButtonOrder(newOrder);
    });
  });
}

// ---- 入力欄の履歴（上下矢印キーで過去の入力を再現） ----
// シェルのコマンド履歴と同様に、上矢印で新しい方から遡り、下矢印で戻る。
// 履歴をたどっている途中でユーザーが直接タイプしたら、履歴ナビゲーションは解除する。
function attachInputHistory(inputEl, historyKey) {
  let history = [];
  let index = -1; // -1 = 履歴をたどっていない（ユーザーが入力中の値をそのまま表示）
  let draftValue = '';

  async function loadHistory() {
    history = await window.api.getInputHistory(historyKey);
  }
  loadHistory();

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      if (!history.length) return;
      e.preventDefault();
      if (index === -1) draftValue = inputEl.value;
      index = Math.min(index + 1, history.length - 1);
      inputEl.value = history[index];
    } else if (e.key === 'ArrowDown') {
      if (index === -1) return;
      e.preventDefault();
      index -= 1;
      inputEl.value = index === -1 ? draftValue : history[index];
    }
  });

  // プログラムでの value 書き換え（上下キー操作）は 'input' イベントを発火しないため、
  // ここに来るのはユーザーが実際にタイプした場合のみ＝履歴ナビゲーションをリセットする
  inputEl.addEventListener('input', () => {
    index = -1;
  });

  return {
    async commit(value) {
      await window.api.addInputHistory(historyKey, value);
      await loadHistory();
      index = -1;
      draftValue = '';
    },
  };
}

const channelInputHistory = attachInputHistory(channelInput, 'channelName');

addChannelBtn.addEventListener('click', async () => {
  const name = channelInput.value.trim();
  if (!name) return;
  const platform = channelPlatformSelect.value || 'twitch';
  const result = await window.api.addChannel(name, platform);
  if (!result || !result.ok) {
    setStatusBanner(`チャンネルの追加に失敗しました: ${result ? result.error : '不明なエラー'}`);
    return;
  }
  await channelInputHistory.commit(name);
  channelInput.value = '';
  refreshChips();
});

channelInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addChannelBtn.click();
});

dropsToggleBtn.addEventListener('click', async () => {
  if (dropsOpen) {
    await window.api.closeDrops();
    dropsOpen = false;
    dropsToggleBtn.textContent = 'Twitch Drops';
    dropsProgressBtn.disabled = true;
    dropsProgressResult.textContent = '';
  } else {
    await window.api.openDrops();
    dropsOpen = true;
    dropsToggleBtn.textContent = 'Twitch Drops を閉じる';
    dropsProgressBtn.disabled = false;
  }
});

// KickのDrops&報酬（インベントリ）ページ。Twitch版と同様、実ページをそのまま表示するのみで
// 進捗の自動読み取りには対応しない（KickとTwitchでDOM構造が異なるため）。
kickDropsToggleBtn.addEventListener('click', async () => {
  if (kickDropsOpen) {
    await window.api.closeKickDrops();
    kickDropsOpen = false;
    kickDropsToggleBtn.textContent = 'Kick Drops';
  } else {
    await window.api.openKickDrops();
    kickDropsOpen = true;
    kickDropsToggleBtn.textContent = 'Kick Drops を閉じる';
  }
});

// 「確認操作をした時だけ」DOM読み取りを実行する（常時監視はしない設計）
dropsProgressBtn.addEventListener('click', async () => {
  dropsProgressResult.textContent = '読み取り中...';
  const result = await window.api.readDropsProgress();
  if (result.error) {
    dropsProgressResult.textContent = `取得失敗（非公式機能のため仕様変更の影響の可能性）: ${result.error}`;
    return;
  }
  if (!result.count) {
    dropsProgressResult.textContent = '進捗バーが見つかりませんでした。Dropsページの表示状態をご確認ください。';
    return;
  }
  const first = result.items[0];
  dropsProgressResult.textContent = `進捗: ${first.valueNow ?? '?'} / ${first.valueMax ?? '?'}（${result.count}件検出）`;
});

// 自作メニューバーの「ヘルプ > 使い方 / 注記」からも同じ処理を呼べるよう、名前付き関数にしてある。
async function openHelpModal() {
  await window.api.hideContentViews();
  helpModal.classList.remove('hidden');
}
window.api.onOpenHelp(openHelpModal);
helpCloseBtn.addEventListener('click', async () => {
  helpModal.classList.add('hidden');
  await window.api.showContentViews();
});
helpTabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.helpTab;
    helpTabBtns.forEach((b) => b.classList.toggle('active', b === btn));
    helpTabContents.forEach((c) => c.classList.toggle('hidden', c.dataset.helpContent !== tab));
  });
});

// 自作メニューバーの「ヘルプ > 初回案内」からも同じ処理を呼べるよう、名前付き関数にしてある。
async function openWelcomeModal() {
  await window.api.hideContentViews();
  welcomeModal.classList.remove('hidden');
}
window.api.onOpenWelcome(openWelcomeModal);
welcomeCloseBtn.addEventListener('click', async () => {
  welcomeModal.classList.add('hidden');
  await window.api.showContentViews();
  await window.api.setFirstLaunchDone();
});
welcomeOpenHelpBtn.addEventListener('click', async () => {
  welcomeModal.classList.add('hidden');
  helpModal.classList.remove('hidden');
  await window.api.setFirstLaunchDone();
});

// 初回起動時のみ自動で案内ポップアップを表示
(async () => {
  const done = await window.api.getFirstLaunchDone();
  if (!done) {
    await window.api.hideContentViews();
    welcomeModal.classList.remove('hidden');
  }
})();

// ---- 設定モーダル ----

const settingsOpenBtn = document.getElementById('settings-open-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsSaveBtn = document.getElementById('settings-save-btn');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const parentDomainInput = document.getElementById('parent-domain-input');
const layoutColumnsInput = document.getElementById('layout-columns-input');
const commentFontSelect = document.getElementById('comment-font-select');
const helixClientIdInput = document.getElementById('helix-client-id-input');
const helixClientSecretInput = document.getElementById('helix-client-secret-input');
const youtubeApiKeyInput = document.getElementById('youtube-api-key-input');
const kickClientIdInput = document.getElementById('kick-client-id-input');
const kickClientSecretInput = document.getElementById('kick-client-secret-input');

// アップデート確認はメニューバーの「アップデートを確認」（ネイティブメニュー）だけで完結するため、
// レンダラー側の処理は不要（main.js参照）。

settingsOpenBtn.addEventListener('click', async () => {
  if (!settingsModal.classList.contains('hidden')) {
    settingsCloseBtn.click();
    return;
  }
  await window.api.openSidePanel('settings', 380);
  const s = await window.api.getAllSettings();
  parentDomainInput.value = s.parentDomain;
  layoutColumnsInput.value = s.layoutColumns;
  commentFontSelect.value = s.commentFontFamily || '';
  helixClientIdInput.value = s.helixClientId;
  helixClientSecretInput.value = s.helixClientSecret;
  youtubeApiKeyInput.value = s.youtubeDataApiKey || '';
  kickClientIdInput.value = s.kickClientId || '';
  kickClientSecretInput.value = s.kickClientSecret || '';
  settingsModal.classList.remove('hidden');
  refreshAccountList();
  refreshDropsAutoList();
});

settingsCloseBtn.addEventListener('click', async () => {
  await forceCloseAccountLoginIfOpen();
  settingsModal.classList.add('hidden');
  await window.api.closeSidePanel('settings');
});

settingsSaveBtn.addEventListener('click', async () => {
  await forceCloseAccountLoginIfOpen();
  await window.api.setAllSettings({
    parentDomain: parentDomainInput.value.trim() || 'localhost',
    layoutColumns: Number(layoutColumnsInput.value) || 0,
    commentFontFamily: commentFontSelect.value,
    helixClientId: helixClientIdInput.value.trim(),
    helixClientSecret: helixClientSecretInput.value.trim(),
    youtubeDataApiKey: youtubeApiKeyInput.value.trim(),
    kickClientId: kickClientIdInput.value.trim(),
    kickClientSecret: kickClientSecretInput.value.trim(),
  });
  applyCommentFontFamily(commentFontSelect.value);
  settingsModal.classList.add('hidden');
  await window.api.closeSidePanel('settings');
});

// ---- 会員登録（メール＋確認コード認証） ----

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

// メニューバーの「会員登録」（一番右）から開く中央ポップアップ。以前は設定パネルの
// 一項目だったが独立させたため、開閉はサイドパネル系（openSidePanel等）ではなく
// help-modal/welcome-modalと同じ「hideContentViewsしてから.hiddenを外す」方式にしている。
async function openProAuthModal() {
  await window.api.hideContentViews();
  proAuthModal.classList.remove('hidden');
  refreshProAuthPanel();
}
proAuthCloseBtn.addEventListener('click', async () => {
  proAuthModal.classList.add('hidden');
  await window.api.showContentViews();
});

// ---- フィードバック（件名・本文のみ。宛先はmumeinoapp@gmail.com固定。main.js参照） ----
const feedbackModal = document.getElementById('feedback-modal');
const feedbackCloseBtn = document.getElementById('feedback-close-btn');
const feedbackSendBtn = document.getElementById('feedback-send-btn');
const feedbackSubjectInput = document.getElementById('feedback-subject-input');
const feedbackBodyInput = document.getElementById('feedback-body-input');
const feedbackMessage = document.getElementById('feedback-message');

async function openFeedbackModal() {
  await window.api.hideContentViews();
  feedbackMessage.textContent = '';
  feedbackModal.classList.remove('hidden');
}
feedbackCloseBtn.addEventListener('click', async () => {
  feedbackModal.classList.add('hidden');
  await window.api.showContentViews();
});
function setFeedbackMessage(text, isError = false) {
  feedbackMessage.textContent = text || '';
  feedbackMessage.style.color = isError ? '#f04747' : '';
}

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
    await window.api.appMenu.sendFeedback(subject, body);
    setFeedbackMessage('送信しました。ありがとうございます！');
    feedbackSubjectInput.value = '';
    feedbackBodyInput.value = '';
  } catch (err) {
    setFeedbackMessage(`送信に失敗しました（${err.message || err}）。しばらくしてからもう一度お試しください。`, true);
  } finally {
    feedbackSendBtn.disabled = false;
  }
});

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
  const config = await window.api.getProAuthConfig();
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

proAuthRequestCodeBtn.addEventListener('click', async () => {
  setProAuthMessage('');
  const email = proAuthEmailInput.value.trim();
  if (!email) {
    setProAuthMessage('メールアドレスを入力してください', true);
    return;
  }
  // バックエンドURLを未保存のまま使えるよう、コード送信前に反映しておく
  await window.api.setPaymentBackendUrl(proAuthBackendUrlInput.value.trim());
  try {
    proAuthRequestCodeBtn.disabled = true;
    await window.api.requestProAuthCode(email);
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
    await window.api.verifyProAuthCode(email, code);
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
    await window.api.refreshProAuthStatus();
    setProAuthMessage('最新の状態に更新しました。');
    await refreshProAuthPanel();
  } catch (err) {
    setProAuthMessage(String(err.message || err), true);
  } finally {
    proAuthRefreshStatusBtn.disabled = false;
  }
});

proAuthLogoutBtn.addEventListener('click', async () => {
  await window.api.logoutProAuth();
  setProAuthMessage('ログアウトしました。');
  await refreshProAuthPanel();
});

proCheckoutCardBtn.addEventListener('click', async () => {
  setProAuthMessage('');
  try {
    proCheckoutCardBtn.disabled = true;
    await window.api.startProCheckout('card');
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
    await window.api.startProCheckout('other', months);
    setProAuthMessage('ブラウザで決済ページを開きました。お手続き後、「最新の状態に更新」で反映を確認してください。');
  } catch (err) {
    setProAuthMessage(String(err.message || err), true);
  } finally {
    proCheckoutOtherBtn.disabled = false;
  }
});

// ---- スタンプ（エモート）パネル ----

const emotesBtn = document.getElementById('emotes-btn');
const emotesPanel = document.getElementById('emotes-panel');
const emotesCloseBtn = document.getElementById('emotes-close-btn');
const emotesChannelSelect = document.getElementById('emotes-channel-select');
const emotesFetchBtn = document.getElementById('emotes-fetch-btn');
const emotesStatus = document.getElementById('emotes-status');
const emotesGrid = document.getElementById('emotes-grid');
const favoritesGrid = document.getElementById('favorites-grid');

function refreshEmoteChannelOptions() {
  // Kickのスタンプ取得は今回のスコープ外のため、選択肢から除外する
  emotesChannelSelect.innerHTML = currentChannels
    .filter((c) => currentChannelPlatforms[c] !== 'kick')
    .map((c) => `<option value="${c}">${c}</option>`)
    .join('');
}

emotesBtn.addEventListener('click', async () => {
  if (!emotesPanel.classList.contains('hidden')) {
    emotesCloseBtn.click();
    return;
  }
  await window.api.openSidePanel('emotes', 360);
  emotesPanel.classList.remove('hidden');
  renderFavorites();
});
emotesCloseBtn.addEventListener('click', async () => {
  emotesPanel.classList.add('hidden');
  await window.api.closeSidePanel('emotes');
});

async function renderFavorites() {
  const favorites = await window.api.getFavorites();
  favoritesGrid.innerHTML = '';
  if (!favorites.length) {
    favoritesGrid.innerHTML = '<div class="note">まだお気に入りはありません</div>';
    return;
  }
  favorites.forEach((emote) => favoritesGrid.appendChild(buildEmoteCell(emote, true, { insertMode: true })));
}

function buildEmoteCell(emote, isFavorited, { insertMode = false } = {}) {
  const cell = document.createElement('div');
  cell.className = 'emote-cell' + (isFavorited ? ' favorited' : '') + (emote.subOnly ? ' sub-only' : '');
  const badge = emote.subOnly ? '<span class="sub-only-badge" title="サブスク限定スタンプ（そのチャンネルにサブスクしていないと使用できません）">🔒Sub</span>' : '';
  cell.innerHTML = `<div class="emote-img-wrap"><img src="${emote.imageUrl}" alt="${emote.name}" />${badge}</div><span>${emote.name}</span>`;
  cell.title = (emote.subOnly ? 'サブスク限定スタンプです。そのチャンネルにサブスクしていないと使用できません。\n' : '') + (insertMode
    ? 'クリックで選択中のチャンネルのチャット欄に挿入 / Shift+クリックでお気に入り解除'
    : 'クリックでコード(:name:)をコピー / Shift+クリックでお気に入り登録');
  cell.addEventListener('click', async (e) => {
    if (e.shiftKey) {
      await window.api.toggleFavorite(emote);
      renderFavorites();
      cell.classList.toggle('favorited');
      return;
    }
    if (insertMode) {
      // 時系列統合モードでチャット統合パネルを開いている時は、裏側の埋め込みビューを自動操作
      // するのではなく、画面に見えている時系列統合の送信欄にそのまま挿入する
      // （タブモードの場合は従来通り、対象チャンネルの埋め込みチャット欄へ自動挿入する）。
      if (!chatIntegrationPanel.classList.contains('hidden') && chatIntegrationMode === 'timeline') {
        if (!chatIntegrationSelectedChannel) {
          emotesStatus.textContent = '全タブ統合の送信先チャンネルを上のタブから選択してください。';
          return;
        }
        const sep = chatIntegrationSendInput.value && !chatIntegrationSendInput.value.endsWith(' ') ? ' ' : '';
        chatIntegrationSendInput.value += `${sep}${emote.name} `;
        chatIntegrationSendInput.focus();
        emotesStatus.textContent = `「${emote.name}」を「${chatIntegrationSelectedChannel}」への送信欄に挿入しました。`;
        return;
      }
      const channel = emotesChannelSelect.value;
      if (!channel) {
        emotesStatus.textContent = '挿入先チャンネルを上のプルダウンから選択してください。';
        return;
      }
      const result = await window.api.insertEmoteIntoChat(channel, emote.name);
      if (!result || !result.ok) {
        emotesStatus.textContent = `挿入に失敗しました: ${result ? result.error : '不明なエラー'}`;
        return;
      }
      emotesStatus.textContent = `「${emote.name}」を「${channel}」のチャット欄に挿入しました。`;
      return;
    }
    try {
      await navigator.clipboard.writeText(emote.name);
      emotesStatus.textContent = `「${emote.name}」をコピーしました。公式チャット欄に貼り付けてください。`;
    } catch (_) {
      emotesStatus.textContent = 'クリップボードへのコピーに失敗しました。';
    }
  });
  return cell;
}

emotesFetchBtn.addEventListener('click', async () => {
  const channel = emotesChannelSelect.value;
  if (!channel) {
    emotesStatus.textContent = '先に配信チャンネルを追加してください。';
    return;
  }
  emotesStatus.textContent = '取得中...';
  emotesGrid.innerHTML = '';
  const result = await window.api.fetchEmotes(channel);
  if (result.error) {
    emotesStatus.textContent = `取得失敗: ${result.error}`;
    return;
  }
  const favorites = await window.api.getFavorites();
  const isFav = (e) => favorites.some((f) => f.id === e.id && f.channel === e.channel);
  [...result.channelEmotes, ...result.globalEmotes].forEach((emote) => {
    emotesGrid.appendChild(buildEmoteCell(emote, isFav(emote)));
  });
  emotesStatus.textContent = `${result.channelEmotes.length + result.globalEmotes.length}件取得しました（Shift+クリックでお気に入り登録）`;
});

// ---- アカウント連携（方式B） ----

const PLATFORM_LABELS = { twitch: 'Twitch', youtube: 'YouTube' };
// 緑丸/赤丸だけだと分かりにくいという指摘を受け、状態を表す文言も併記する
const STATUS_LABELS = { connected: '連携済み', disconnected: '未連携', unknown: '確認中' };

const accountList = document.getElementById('account-list');
const verifyAccountsBtn = document.getElementById('verify-accounts-btn');
const verifyAccountsStatus = document.getElementById('verify-accounts-status');
const accountLoginCloseBtn = document.getElementById('account-login-close-btn');

function buildAccountRow(platform, status) {
  const row = document.createElement('div');
  row.className = 'account-row';
  row.dataset.platform = platform;
  row.innerHTML = `
    <span class="status-dot ${status}" data-role="dot"></span>
    <span class="status-label" data-role="status-label">${STATUS_LABELS[status] || status}</span>
    <span class="account-name">${PLATFORM_LABELS[platform] || platform}</span>
    <button class="account-login-btn" data-platform="${platform}">ログイン</button>
  `;
  row.querySelector('.account-login-btn').addEventListener('click', () => openAccountLogin(platform));
  return row;
}

async function refreshAccountList() {
  const status = await window.api.getAccountStatus();
  accountList.innerHTML = '';
  Object.keys(PLATFORM_LABELS).forEach((platform) => {
    accountList.appendChild(buildAccountRow(platform, status[platform] || 'unknown'));
  });
  await refreshKickRow();
}

function setAccountDot(platform, status) {
  const row = accountList.querySelector(`.account-row[data-platform="${platform}"]`);
  if (!row) return;
  const dot = row.querySelector('[data-role="dot"]');
  dot.className = `status-dot ${status}`;
  const label = row.querySelector('[data-role="status-label"]');
  if (label) label.textContent = STATUS_LABELS[status] || status;
}

// ログイン画面が開いている間は他の操作(設定を開き直す等)で状態が食い違って
// 操作不能になるのを防ぐため、ヘッダーの他ボタンを一時的に無効化する
const zappingBtn = document.getElementById('zapping-btn');
const volumeMixerBtn = document.getElementById('volume-mixer-btn');
const chatIntegrationBtn = document.getElementById('chat-integration-btn');
const unifiedFeedBtnForLock = document.getElementById('unified-feed-btn');

const HEADER_BUTTONS_TO_LOCK = [
  addChannelBtn,
  dropsToggleBtn,
  dropsProgressBtn,
  kickDropsToggleBtn,
  emotesBtn,
  settingsOpenBtn,
  zappingBtn,
  volumeMixerBtn,
  chatIntegrationBtn,
  unifiedFeedBtnForLock,
  // layoutShareBtnはこのファイルの後方で定義されるため、TDZを避けてIDで直接取得する
  document.getElementById('layout-share-btn'),
];

function setHeaderLockedForLogin(locked) {
  HEADER_BUTTONS_TO_LOCK.forEach((btn) => {
    btn.disabled = locked;
  });
}

async function openAccountLogin(platform) {
  // ログイン画面は全幅表示のため、開いている可能性のあるサイドパネルは全て閉じる
  // （layout-share-panelはこのファイルの後方で定義されるため、TDZを避けてIDで直接取得する）
  [
    settingsModal,
    zappingModal,
    emotesPanel,
    volumeMixerPanel,
    chatIntegrationPanel,
    document.getElementById('layout-share-panel'),
    document.getElementById('unified-feed-modal'),
  ].forEach((el) => el.classList.add('hidden'));
  await window.api.hideChatIntegrationTab();
  disconnectIrc();
  await window.api.closeAllSidePanels();
  await window.api.closeVolumeDropdown();
  accountLoginCloseBtn.classList.remove('hidden');
  accountLoginCloseBtn.dataset.platform = platform;
  setHeaderLockedForLogin(true);
  await window.api.openAccountLogin(platform);
}

/**
 * ログイン画面（BrowserView）を閉じ、ヘッダーのロック・ボタン表示を確実に元に戻す。
 * 「設定を閉じる」等、ログイン中でなくても安全に呼べるように、
 * ログイン画面を開いていない場合は何もしない。
 */
async function forceCloseAccountLoginIfOpen() {
  if (accountLoginCloseBtn.classList.contains('hidden')) return;
  try {
    await window.api.closeAccountLogin();
  } catch (err) {
    console.error('ログイン画面のクローズに失敗しました:', err);
  } finally {
    accountLoginCloseBtn.classList.add('hidden');
    setHeaderLockedForLogin(false);
  }
}

// 「ログイン画面を閉じる」はログイン画面が開いている時だけ意味を持つ操作なので、
// 設定画面には戻さずそのまま配信画面に戻す（＝設定の「閉じる」と同じ着地点にする）。
accountLoginCloseBtn.addEventListener('click', async () => {
  await forceCloseAccountLoginIfOpen();
  settingsModal.classList.add('hidden');
  try {
    await window.api.closeAllSidePanels();
  } catch (err) {
    console.error('コンテンツビューの再表示に失敗しました:', err);
  }
});

// 「ログイン状況を確認」＝ここでのみ実ページを開いてDOMを確認する（常時監視はしない設計）
verifyAccountsBtn.addEventListener('click', async () => {
  verifyAccountsStatus.textContent = '確認中...(各サイトを一時的に読み込みます)';
  verifyAccountsBtn.disabled = true;
  try {
    const result = await window.api.verifyAllAccounts();
    Object.entries(result).forEach(([platform, status]) => setAccountDot(platform, status));
    verifyAccountsStatus.textContent = '確認が完了しました。';
  } catch (err) {
    verifyAccountsStatus.textContent = `確認に失敗しました: ${err.message || err}`;
  } finally {
    verifyAccountsBtn.disabled = false;
  }
});

// ---- Drops自動追加/削除 ----
// 対象ゲームは追加/削除のたびに即座にメインプロセスへ保存する（設定モーダルの「保存」ボタンとは独立）。

const dropsAutoList = document.getElementById('drops-auto-list');
const dropsAutoGameInput = document.getElementById('drops-auto-game-input');
const dropsAutoMaxInput = document.getElementById('drops-auto-max-input');
const dropsAutoAddBtn = document.getElementById('drops-auto-add-btn');
const dropsAutoStatus = document.getElementById('drops-auto-status');

let dropsAutoConfig = [];

async function refreshDropsAutoList() {
  dropsAutoConfig = await window.api.getDropsAutoConfig();
  renderDropsAutoList();
  // 上限数の入力欄は前回追加時に使った値を初期表示にする（毎回デフォルト3に戻らないように）
  dropsAutoMaxInput.value = await window.api.getDropsAutoDefaultMax();
}

function renderDropsAutoList() {
  dropsAutoList.innerHTML = '';
  if (!dropsAutoConfig.length) {
    dropsAutoList.innerHTML = '<div class="note">まだ対象ゲームは設定されていません</div>';
    return;
  }
  dropsAutoConfig.forEach(({ gameName, maxTiles }) => {
    const row = document.createElement('div');
    row.className = 'drops-auto-row';
    row.innerHTML = `
      <span class="drops-auto-game-name">${gameName}</span>
      <span class="drops-auto-max">最大${maxTiles}枠</span>
      <span class="remove" data-name="${gameName}">×</span>
    `;
    row.querySelector('.remove').addEventListener('click', async () => {
      dropsAutoConfig = dropsAutoConfig.filter((c) => c.gameName !== gameName);
      await window.api.setDropsAutoConfig(dropsAutoConfig);
      renderDropsAutoList();
    });
    dropsAutoList.appendChild(row);
  });
}

dropsAutoAddBtn.addEventListener('click', async () => {
  const gameName = dropsAutoGameInput.value.trim();
  const maxTiles = Number(dropsAutoMaxInput.value) || 0;
  if (!gameName || maxTiles <= 0) {
    dropsAutoStatus.textContent = 'ゲーム名と上限枠数（1以上）を入力してください。';
    return;
  }
  if (dropsAutoConfig.some((c) => c.gameName.toLowerCase() === gameName.toLowerCase())) {
    dropsAutoStatus.textContent = 'このゲームは既に登録されています。';
    return;
  }
  dropsAutoConfig = [...dropsAutoConfig, { gameName, maxTiles }];
  await window.api.setDropsAutoConfig(dropsAutoConfig);
  await dropsAutoGameInputHistory.commit(gameName);
  await window.api.setDropsAutoDefaultMax(maxTiles); // 次回このパネルを開いた時の初期値として記憶する
  dropsAutoGameInput.value = '';
  dropsAutoStatus.textContent = '';
  renderDropsAutoList();
});

const dropsAutoGameInputHistory = attachInputHistory(dropsAutoGameInput, 'dropsAutoGameName');

window.api.onDropsAutoError(({ gameName, message }) => {
  dropsAutoStatus.textContent = `「${gameName}」の自動追加チェックに失敗しました: ${message}`;
});

// ---- Auto Tune-In（フォロー中配信者の自動タイル追加） ----
// フォロー一覧の取得にはTwitchのユーザーOAuthトークン（user:read:followsスコープ）が必要なため、
// Drops自動追加のClient Credentials（アプリ単位トークン）とは別に、個人アカウントとしての
// 連携（認可コードグラントフロー）をこのパネルから開始できるようにしている。

const autoTuneInStatusDot = document.getElementById('auto-tune-in-status-dot');
const autoTuneInStatusEl = document.getElementById('auto-tune-in-status');
const autoTuneInMessageEl = document.getElementById('auto-tune-in-message');
const autoTuneInConnectBtn = document.getElementById('auto-tune-in-connect-btn');
const autoTuneInDisconnectBtn = document.getElementById('auto-tune-in-disconnect-btn');
const autoTuneInEnabledInput = document.getElementById('auto-tune-in-enabled-input');
const autoTuneInMaxInput = document.getElementById('auto-tune-in-max-input');
const twitchAuthCloseBtn = document.getElementById('twitch-auth-close-btn');

async function refreshAutoTuneInStatus() {
  const status = await window.api.getAutoTuneInStatus();
  if (status.connected) {
    autoTuneInStatusDot.className = 'status-dot connected';
    // 設定画面のアカウント連携行（連携済み→サイト名の順）と表記を揃える。ユーザー名は表示しない。
    autoTuneInStatusEl.textContent = '連携済み Twitch';
    autoTuneInConnectBtn.classList.add('hidden');
    autoTuneInDisconnectBtn.classList.remove('hidden');
  } else {
    autoTuneInStatusDot.className = 'status-dot disconnected';
    autoTuneInStatusEl.textContent = '未連携 Twitch（YouTubeのみの場合は連携不要です）';
    autoTuneInConnectBtn.classList.remove('hidden');
    autoTuneInDisconnectBtn.classList.add('hidden');
  }
  // 有効化はTwitch連携済み、またはYouTube対象指定が1件以上あれば可能
  // （YouTubeの配信中判定は公開ページ確認のためログイン・OAuth連携が不要）
  autoTuneInEnabledInput.disabled = !status.canEnable;
  autoTuneInMaxInput.disabled = !status.canEnable;
  autoTuneInEnabledInput.checked = status.enabled;
  autoTuneInMaxInput.value = status.maxTiles;
}

autoTuneInConnectBtn.addEventListener('click', async () => {
  // OAuth連携画面はウィンドウ全幅で表示するため、開いているサイドパネル（フィード含む）は一旦閉じる
  await window.api.closeAllSidePanels();
  unifiedFeedModal.classList.add('hidden');
  twitchAuthCloseBtn.classList.remove('hidden');
  setHeaderLockedForLogin(true);
  autoTuneInMessageEl.textContent = '連携処理中... 開いた画面でTwitchにログイン・認可してください。';

  const result = await window.api.startTwitchAuth();

  twitchAuthCloseBtn.classList.add('hidden');
  setHeaderLockedForLogin(false);
  await window.api.openSidePanel('unified-feed', 340);
  unifiedFeedModal.classList.remove('hidden');

  if (result.ok) {
    autoTuneInMessageEl.textContent = `連携しました（${result.login}としてログイン中）`;
  } else if (!result.cancelled) {
    autoTuneInMessageEl.textContent = `エラー: ${result.error}`;
  } else {
    autoTuneInMessageEl.textContent = '';
  }
  refreshAutoTuneInStatus();
});

twitchAuthCloseBtn.addEventListener('click', async () => {
  await window.api.cancelTwitchAuth();
});

autoTuneInDisconnectBtn.addEventListener('click', async () => {
  await window.api.disconnectTwitchAuth();
  refreshAutoTuneInStatus();
});

autoTuneInEnabledInput.addEventListener('change', async () => {
  await window.api.setAutoTuneInConfig({ enabled: autoTuneInEnabledInput.checked });
  refreshChips();
});

autoTuneInMaxInput.addEventListener('change', async () => {
  const v = Math.max(1, Math.min(20, Number(autoTuneInMaxInput.value) || 1));
  autoTuneInMaxInput.value = v;
  await window.api.setAutoTuneInConfig({ maxTiles: v });
});

window.api.onAutoTuneInError(({ message }) => {
  if (!unifiedFeedModal.classList.contains('hidden')) autoTuneInMessageEl.textContent = `エラー: ${message}`;
});

window.api.onAutoTuneInAuthLost(() => {
  setStatusBanner('Twitchとの連携が切れました。「📡 フィード」パネルから再連携してください（フォロー配信者の自動追加は停止しています）。');
  if (!unifiedFeedModal.classList.contains('hidden')) refreshAutoTuneInStatus();
});

// ---- Kickアカウント連携（OAuth 2.1 + PKCE） ----
// 視聴自体（player.kick.com埋め込み）はログイン不要。ここは「連携済みかどうかの表示・接続/切断」のみ
// （Twitchのようなタイル自動追加等の機能とは連動しない）。認可画面は既定のブラウザで開くため、
// Twitchのようなアプリ内ヘッダーロック・埋め込みビューのクローズボタンは不要。
// UI自体は下部の統合「アカウント連携」セクション（#account-list）内にTwitch/YouTubeと並ぶ行として
// 動的に追加する（buildAccountRowとは操作方法が異なる＝ログインではなくOAuth接続/切断のため専用の行を組む）。

const kickAuthMessageEl = document.getElementById('kick-auth-message');

function buildKickAccountRow(status) {
  const row = document.createElement('div');
  row.className = 'account-row';
  row.dataset.platform = 'kick';
  const dotClass = status.connected ? 'connected' : 'disconnected';
  const label = status.connected ? '連携済み' : '未連携';
  const name = status.connected ? `Kick（${status.login}）` : 'Kick';
  // Twitch/YouTubeの行は「name(flex伸長)→ログインボタン」で自然に右寄せになるが、
  // Kickはボタンが2種類（サイトログイン／連携する・連携解除）あるため、右側で縦2段に積む形にし、
  // 空いた縦幅にstatus-labelが行全体のalign-items:centerでちょうど中間の高さに収まるようにしている。
  row.innerHTML = `
    <span class="status-dot ${dotClass}" data-role="dot"></span>
    <span class="status-label" data-role="status-label">${label}</span>
    <span class="account-name">${name}</span>
    <div class="kick-account-actions">
      <button data-role="site-login" class="account-login-btn" title="チャット送信にはこのログインが別途必要です（上のOAuth連携とは別物）">ログイン</button>
      <button data-role="connect" class="account-login-btn${status.connected ? ' hidden' : ''}">連携する</button>
      <button data-role="cancel" class="account-login-btn hidden">キャンセル</button>
      <button data-role="disconnect" class="account-login-btn${status.connected ? '' : ' hidden'}">連携解除</button>
    </div>
  `;
  row.querySelector('[data-role="connect"]').addEventListener('click', () => startKickAuthFlow(row));
  row.querySelector('[data-role="cancel"]').addEventListener('click', async () => {
    await window.api.cancelKickAuth();
  });
  row.querySelector('[data-role="disconnect"]').addEventListener('click', async () => {
    await window.api.disconnectKickAuth();
    await refreshKickRow();
  });
  // OAuth連携（連携する/連携を解除）は「連携済み」表示のためだけの別方式で、
  // kick.com自体へのCookieログインとは連動しない。チャット統合（送信）はチャットページの
  // 実際のCookieセッションを必要とするため、persist:kickパーティションに対してこのボタンで
  // 別途ブラウザログインしてもらう必要がある（Twitch/YouTubeの「方式B」ログインと同じ仕組み）。
  row.querySelector('[data-role="site-login"]').addEventListener('click', () => openAccountLogin('kick'));
  return row;
}

async function refreshKickRow() {
  const status = await window.api.getKickAuthStatus();
  const existing = accountList.querySelector('.account-row[data-platform="kick"]');
  const row = buildKickAccountRow(status);
  if (existing) existing.replaceWith(row);
  else accountList.appendChild(row);
  return row;
}

async function startKickAuthFlow(row) {
  row.querySelector('[data-role="connect"]').classList.add('hidden');
  row.querySelector('[data-role="cancel"]').classList.remove('hidden');
  kickAuthMessageEl.textContent = '連携処理中... 開いた既定のブラウザでKickにログイン・認可してください。';

  const result = await window.api.startKickAuth();

  if (result.ok) {
    kickAuthMessageEl.textContent = `連携しました（${result.login}としてログイン中）`;
  } else if (!result.cancelled) {
    kickAuthMessageEl.textContent = `エラー: ${result.error}`;
  } else {
    kickAuthMessageEl.textContent = '';
  }
  await refreshKickRow();
}

window.api.onKickAuthLost(() => {
  setStatusBanner('Kickとの連携が切れました。設定画面から再連携してください。');
  if (!settingsModal.classList.contains('hidden')) refreshKickRow();
});

// ---- ランダム自動切換え（ザッピング） ----

const zappingModal = document.getElementById('zapping-modal');
const zappingCloseBtn = document.getElementById('zapping-close-btn');
const zappingPlatformSelect = document.getElementById('zapping-platform-select');
const zappingYoutubeNote = document.getElementById('zapping-youtube-note');
const zappingKickNote = document.getElementById('zapping-kick-note');
const zappingLanguageLabel = document.getElementById('zapping-language-label');
const zappingLanguageInput = document.getElementById('zapping-language-input');
const zappingGameInput = document.getElementById('zapping-game-input');
const zappingTagsInput = document.getElementById('zapping-tags-input');
const zappingStartBtn = document.getElementById('zapping-start-btn');
const zappingSkipBtn = document.getElementById('zapping-skip-btn');
const zappingStopBtn = document.getElementById('zapping-stop-btn');
const zappingStatus = document.getElementById('zapping-status');

function setZappingButtonsState(active) {
  zappingStartBtn.disabled = active;
  zappingSkipBtn.disabled = !active;
  zappingStopBtn.disabled = !active;
  zappingPlatformSelect.disabled = active; // 動作中はプラットフォーム切替不可（一旦停止してから変更する）
}

/** YouTube選択時は言語フィルタが非対応なため、入力欄を隠して注記を表示する（Kickは言語フィルタ対応） */
function updateZappingPlatformUi() {
  const isYoutube = zappingPlatformSelect.value === 'youtube';
  const isKick = zappingPlatformSelect.value === 'kick';
  zappingYoutubeNote.classList.toggle('hidden', !isYoutube);
  zappingKickNote.classList.toggle('hidden', !isKick);
  zappingLanguageLabel.classList.toggle('hidden', isYoutube);
  zappingLanguageInput.classList.toggle('hidden', isYoutube);
}
zappingPlatformSelect.addEventListener('change', updateZappingPlatformUi);

async function refreshZappingPanel() {
  const config = await window.api.getZappingConfig();
  zappingPlatformSelect.value = config.filters.platform || 'twitch';
  zappingLanguageInput.value = config.filters.language || '';
  zappingGameInput.value = config.filters.gameName || '';
  zappingTagsInput.value = (config.filters.tags || []).join(', ');
  updateZappingPlatformUi();
  setZappingButtonsState(config.active);
  zappingStatus.textContent = config.active ? `現在表示中: ${config.currentChannel}` : '';
}

zappingBtn.addEventListener('click', async () => {
  if (!premiumUnlocked) { showPremiumLockedModal(); return; }
  if (!zappingModal.classList.contains('hidden')) {
    zappingCloseBtn.click();
    return;
  }
  await window.api.openSidePanel('zapping', 340);
  zappingModal.classList.remove('hidden');
  refreshZappingPanel();
});

zappingCloseBtn.addEventListener('click', async () => {
  zappingModal.classList.add('hidden');
  await window.api.closeSidePanel('zapping');
});

function collectZappingFilters() {
  const platform = ['youtube', 'kick'].includes(zappingPlatformSelect.value) ? zappingPlatformSelect.value : 'twitch';
  return {
    platform,
    language: zappingLanguageInput.value.trim(),
    gameName: zappingGameInput.value.trim(),
    tags: zappingTagsInput.value.split(',').map((t) => t.trim()).filter(Boolean),
  };
}

zappingStartBtn.addEventListener('click', async () => {
  zappingStatus.textContent = '開始しています...';
  const result = await window.api.startZapping(collectZappingFilters());
  setZappingButtonsState(result.active);
  if (result.active) {
    zappingStatus.textContent = `現在表示中: ${result.currentChannel}`;
  } else {
    zappingStatus.textContent = result.error ? `開始できませんでした: ${result.error}` : '開始できませんでした。';
  }
  refreshChips();
});

zappingSkipBtn.addEventListener('click', async () => {
  zappingStatus.textContent = '切り替えています...';
  const result = await window.api.skipZapping();
  if (result.active) {
    zappingStatus.textContent = `現在表示中: ${result.currentChannel}`;
  } else {
    zappingStatus.textContent = result.error ? `切り替えに失敗しました: ${result.error}` : '';
  }
  refreshChips();
});

zappingStopBtn.addEventListener('click', async () => {
  await window.api.stopZapping();
  setZappingButtonsState(false);
  zappingStatus.textContent = '停止しました。';
  refreshChips();
});

window.api.onZappingStatus(({ message }) => {
  if (!zappingModal.classList.contains('hidden')) zappingStatus.textContent = message;
});
window.api.onZappingError(({ message }) => {
  zappingStatus.textContent = `エラー: ${message}`;
});

// ---- プラットフォーム横断の統一フィード（ロードマップ項目6） ----
// フォロー中/登録中で現在配信中の配信者だけを一覧表示する。自動追加はせず「＋追加」クリックのみ。
// 常時ポーリングはせず、パネルを開いた時・「🔄 更新」ボタン押下時のみメインプロセスへ問い合わせる。

const unifiedFeedBtn = document.getElementById('unified-feed-btn');
const unifiedFeedModal = document.getElementById('unified-feed-modal');
const unifiedFeedCloseBtn = document.getElementById('unified-feed-close-btn');
const unifiedFeedRefreshBtn = document.getElementById('unified-feed-refresh-btn');
const unifiedFeedUpdatedAt = document.getElementById('unified-feed-updated-at');
const unifiedFeedStatus = document.getElementById('unified-feed-status');
const unifiedFeedList = document.getElementById('unified-feed-list');
const unifiedFeedFilterBtns = Array.from(document.querySelectorAll('.unified-feed-filter-btn'));

let unifiedFeedItems = [];
let unifiedFeedPlatformFilter = 'all';

/**
 * Auto Tune-Inの対象指定リストへのチェックボックスON/OFFを反映する。
 * 現在値をメインプロセスから取り直してから編集・保存するため、フィード一覧・全一覧のどちらから
 * 操作しても矛盾なく反映される（多少IPC呼び出しは増えるがチェック操作は頻繁ではないため許容）。
 */
async function toggleAutoTuneInTarget(platform, channel, checked) {
  const key = channel.toLowerCase();
  const current = await window.api.getAutoTuneInTargets();
  const next = checked
    ? current.some((t) => t.platform === platform && t.channel.toLowerCase() === key)
      ? current
      : [...current, { platform, channel }]
    : current.filter((t) => !(t.platform === platform && t.channel.toLowerCase() === key));
  await window.api.setAutoTuneInTargets(next);
}

/** フィード一覧・全一覧のどちらかでチェックが変わったら、もう一方に同じチャンネルがあれば見た目も同期する */
function syncTargetCheckboxAcrossLists(platform, channel, checked) {
  const key = channel.toLowerCase();
  const feedItem = unifiedFeedItems.find((f) => f.platform === platform && f.channel.toLowerCase() === key);
  if (feedItem && feedItem.isTarget !== checked) {
    feedItem.isTarget = checked;
    renderUnifiedFeedList();
  }
  const allItem = allFollowCandidates.find((f) => f.platform === platform && f.channel.toLowerCase() === key);
  if (allItem && allItem.isTarget !== checked) {
    allItem.isTarget = checked;
    renderAllFollowList();
  }
}

/**
 * フィードへの「常時表示（ピン留め）」ON/OFFを反映する。自動追加の対象指定とは完全に独立した
 * 別のリストで、YouTube専用（Twitchはもともと「フォロー中なら誰でも」がデフォルトでフィードに
 * 出るためピン留めの必要性が薄い）。
 */
async function toggleFeedPin(channel, displayName, checked) {
  const key = channel.toLowerCase();
  const current = await window.api.getFeedPinnedYoutube();
  const next = checked
    ? current.some((p) => p.channel.toLowerCase() === key)
      ? current
      : [...current, { channel, displayName }]
    : current.filter((p) => p.channel.toLowerCase() !== key);
  await window.api.setFeedPinnedYoutube(next);
}

/**
 * フィード一覧・全一覧のどちらかでピン留めが変わったら、もう一方に同じチャンネルがあれば見た目も同期する。
 * ピン留めを外した非配信中チャンネルは、厳密には次の「🔄 更新」でフィードから消えるが、
 * その場ですぐ違和感が出ないよう表示上も「offline」扱いのままにしておく（誤操作で急に消えないようにする狙いもある）。
 */
function syncPinCheckboxAcrossLists(channel, checked) {
  const key = channel.toLowerCase();
  const feedItem = unifiedFeedItems.find((f) => f.platform === 'youtube' && f.channel.toLowerCase() === key);
  if (feedItem && feedItem.isPinned !== checked) feedItem.isPinned = checked;
  const allItem = allFollowCandidates.find((f) => f.platform === 'youtube' && f.channel.toLowerCase() === key);
  if (allItem && allItem.isPinned !== checked) allItem.isPinned = checked;
}

/**
 * 「自動追加の対象にする」チェックボックスのtitle（ホバー時の詳細説明）。
 * インライン注記は「使い方/注記」参照に短縮したため、実際の詳細はここでの
 * ホバー説明と使い方/注記モーダル側にのみ持たせている。
 */
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

function renderUnifiedFeedList() {
  unifiedFeedList.innerHTML = '';
  const filtered = unifiedFeedItems.filter(
    (item) => unifiedFeedPlatformFilter === 'all' || item.platform === unifiedFeedPlatformFilter
  );
  if (!filtered.length) {
    unifiedFeedList.innerHTML = '<div class="note">現在配信中のフォロー配信者はいません</div>';
    return;
  }
  filtered.forEach((item) => {
    const row = document.createElement('div');
    const offline = item.isPinned && !item.isLive;
    row.className = `unified-feed-row${item.alreadyAdded ? ' already-added' : ''}${offline ? ' offline' : ''}`;
    const viewers = offline
      ? 'オフライン'
      : typeof item.viewerCount === 'number'
      ? `${item.viewerCount.toLocaleString()}人`
      : '';
    // ピン留めチェックボックスはYouTube専用（Twitchはもともと「フォロー中なら誰でも」がデフォルトでフィードに出るため対象外）
    const pinHtml =
      item.platform === 'youtube'
        ? `<input type="checkbox" class="unified-feed-pin-checkbox" ${item.isPinned ? 'checked' : ''} title="常に表示（ピン留め、オンライン/オフライン問わず自分で外すまで表示し続ける）" />`
        : '<span class="unified-feed-pin-spacer"></span>';
    // 自動追加（Auto Tune-In）対象指定チェックボックスはTwitch/YouTube専用。
    // KickはAuto Tune-In自体が未対応（60秒間隔の常時ポーリングをKickに対して行う重さ・Bot対策リスクを
    // 避けるため）なので、チェックボックスを出さず単なる余白にする。
    const targetHtml =
      item.platform === 'kick'
        ? '<span class="unified-feed-target-spacer"></span>'
        : `<input type="checkbox" class="unified-feed-target-checkbox" ${item.isTarget ? 'checked' : ''} title="${autoTuneInTargetTitle(item.platform)}" />`;
    row.innerHTML = `
      ${targetHtml}
      ${pinHtml}
      ${platformBadgeHtml(item.platform)}
      <span class="unified-feed-name">${escapeHtml(item.displayName)}</span>
      <span class="unified-feed-viewers">${viewers}</span>
      <button class="unified-feed-add-btn" ${item.alreadyAdded || offline ? 'disabled' : ''}>${
      item.alreadyAdded ? '表示中' : offline ? 'オフライン' : '＋追加'
    }</button>
    `;
    const targetCheckbox = row.querySelector('.unified-feed-target-checkbox');
    if (targetCheckbox) {
      targetCheckbox.addEventListener('change', async (e) => {
        const checked = e.target.checked;
        item.isTarget = checked;
        await toggleAutoTuneInTarget(item.platform, item.channel, checked);
        renderUnifiedFeedList();
        syncTargetCheckboxAcrossLists(item.platform, item.channel, checked);
        refreshAutoTuneInStatus();
      });
    }
    const pinCheckbox = row.querySelector('.unified-feed-pin-checkbox');
    if (pinCheckbox) {
      pinCheckbox.addEventListener('change', async (e) => {
        const checked = e.target.checked;
        item.isPinned = checked;
        await toggleFeedPin(item.channel, item.displayName, checked);
        renderUnifiedFeedList();
        syncPinCheckboxAcrossLists(item.channel, checked);
      });
    }
    row.querySelector('.unified-feed-add-btn').addEventListener('click', async () => {
      if (offline) return;
      const result = await window.api.addChannel(item.channel, item.platform);
      if (!result || !result.ok) {
        unifiedFeedStatus.textContent = `追加に失敗しました: ${result ? result.error : '不明なエラー'}`;
        return;
      }
      item.alreadyAdded = true;
      renderUnifiedFeedList();
      refreshChips();
    });
    unifiedFeedList.appendChild(row);
  });
}

// ---- 自動追加の対象を選ぶ（全フォロー/登録一覧、オンライン・オフライン問わず） ----
// フィード一覧と違い配信中判定をしないため取得が軽く済むが、それでもYouTubeはページ読み込みが
// 発生するため、専用の「読み込む」ボタン押下時のみ取得する（パネルを開くだけでは自動取得しない）。

const autoTuneInLoadAllBtn = document.getElementById('auto-tune-in-load-all-btn');
const autoTuneInAllStatus = document.getElementById('auto-tune-in-all-status');
const autoTuneInAllList = document.getElementById('auto-tune-in-all-list');

let allFollowCandidates = [];

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
    const { items, errors } = await window.api.fetchAllFollowCandidates();
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

async function refreshUnifiedFeed() {
  unifiedFeedStatus.textContent = '取得中...';
  unifiedFeedRefreshBtn.disabled = true;
  try {
    const { items, errors } = await window.api.fetchUnifiedFeed();
    unifiedFeedItems = items;
    renderUnifiedFeedList();
    const errMessages = [];
    if (errors.twitch) errMessages.push(`Twitch: ${errors.twitch}`);
    if (errors.youtube) errMessages.push(`YouTube: ${errors.youtube}`);
    if (errors.kick) errMessages.push(`Kick: ${errors.kick}`);
    unifiedFeedStatus.textContent = errMessages.join(' / ');
    unifiedFeedUpdatedAt.textContent = `最終更新: ${new Date().toLocaleTimeString('ja-JP')}`;
  } catch (err) {
    unifiedFeedStatus.textContent = `取得に失敗しました: ${err.message || err}`;
  } finally {
    unifiedFeedRefreshBtn.disabled = false;
  }
}

unifiedFeedBtn.addEventListener('click', async () => {
  if (!premiumUnlocked) { showPremiumLockedModal(); return; }
  if (!unifiedFeedModal.classList.contains('hidden')) {
    unifiedFeedCloseBtn.click();
    return;
  }
  await window.api.openSidePanel('unified-feed', 340);
  unifiedFeedModal.classList.remove('hidden');
  refreshUnifiedFeed();
  refreshAutoTuneInStatus();
});

unifiedFeedCloseBtn.addEventListener('click', async () => {
  unifiedFeedModal.classList.add('hidden');
  await window.api.closeSidePanel('unified-feed');
});

unifiedFeedRefreshBtn.addEventListener('click', () => refreshUnifiedFeed());

unifiedFeedFilterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    unifiedFeedPlatformFilter = btn.dataset.platform;
    unifiedFeedFilterBtns.forEach((b) => b.classList.toggle('active', b === btn));
    renderUnifiedFeedList();
  });
});

// ---- 音量ミキサー（ストリームごとの個別音量調整） ----
// チップ内にスライダーを直接置くと、Twitchネイティブの音量スライダーで実機発生したのと同様に
// チップのドラッグ&ドロップ並び替えと干渉する上、チップ列が窮屈になるため、
// ヘッダーの「🔊 音量」ボタンから開く専用パネル（Windowsの音量ミキサー風）に分離した。

const volumeMixerPanel = document.getElementById('volume-mixer-panel');
const volumeMixerList = document.getElementById('volume-mixer-list');

// ミュート解除時に直前の音量へ戻すため、クライアント側でチャンネル名ごとに覚えておく
const lastNonZeroVolumeByChannel = {};

async function renderVolumeMixer() {
  const [channels, volumeMap] = await Promise.all([window.api.listChannels(), window.api.getChannelVolumes()]);
  volumeMixerList.innerHTML = '';
  if (!channels.length) {
    volumeMixerList.innerHTML = '<div class="note" style="padding:6px;">配信がありません</div>';
    return;
  }
  channels.forEach((name) => {
    const volume = name in volumeMap ? volumeMap[name] : 100;
    if (volume > 0) lastNonZeroVolumeByChannel[name] = volume;
    const row = document.createElement('div');
    row.className = 'volume-row';
    row.title = name;
    row.innerHTML = `
      <span class="volume-icon" data-name="${name}" title="クリックでミュート切替">${volume === 0 ? '🔇' : '🔊'}</span>
      <span class="volume-row-name">${name}</span>
      <input type="range" min="0" max="100" value="${volume}" data-name="${name}" />
    `;
    volumeMixerList.appendChild(row);
  });

  volumeMixerList.querySelectorAll('.volume-icon').forEach((el) => {
    el.addEventListener('click', async (e) => {
      const name = e.currentTarget.dataset.name;
      const row = e.currentTarget.closest('.volume-row');
      const slider = row.querySelector('input[type="range"]');
      const current = Number(slider.value);
      const next = current > 0 ? 0 : lastNonZeroVolumeByChannel[name] || 100;
      await window.api.setChannelVolume(name, next);
      renderVolumeMixer();
    });
  });
  volumeMixerList.querySelectorAll('input[type="range"]').forEach((el) => {
    el.addEventListener('input', async (e) => {
      const name = e.target.dataset.name;
      const value = Number(e.target.value);
      if (value > 0) lastNonZeroVolumeByChannel[name] = value;
      const row = e.target.closest('.volume-row');
      row.querySelector('.volume-icon').textContent = value === 0 ? '🔇' : '🔊';
      await window.api.setChannelVolume(name, value);
    });
  });
}

// 音量ミキサーは常設のサイドパネルではなく、必要な時だけ出す最前面ドロップダウンにしているため、
// 他パネルのようなタイル領域縮小（openSidePanel）は使わず、専用IPCで開閉する。
async function openVolumeMixer() {
  await window.api.openVolumeDropdown();
  volumeMixerPanel.classList.remove('hidden');
  renderVolumeMixer();
}

async function closeVolumeMixer() {
  volumeMixerPanel.classList.add('hidden');
  await window.api.closeVolumeDropdown();
}

// ドロップダウン形式：ボタンを押すたびに開閉をトグルする（専用の閉じるボタンは持たない）
volumeMixerBtn.addEventListener('click', async () => {
  if (volumeMixerPanel.classList.contains('hidden')) {
    await openVolumeMixer();
  } else {
    await closeVolumeMixer();
  }
});

// ドロップダウンの外側をクリックしたら閉じる（一般的なドロップダウンの挙動に合わせる）
document.addEventListener('click', (e) => {
  if (volumeMixerPanel.classList.contains('hidden')) return;
  if (volumeMixerPanel.contains(e.target) || volumeMixerBtn.contains(e.target)) return;
  closeVolumeMixer();
});

// チャンネル構成が変わった時（ザッピングの自動切替等）、パネルを開いていれば一覧を更新する
function refreshVolumeMixerIfOpen() {
  if (!volumeMixerPanel.classList.contains('hidden')) renderVolumeMixer();
}

// ---- チャット統合パネル（タブ切替 / 時系列統合） ----
// 「タブ」モードは、選択中の1チャンネル分だけTwitch公式埋め込みチャットのBrowserViewを
// メインプロセス側で使い回して表示する（main.jsのshowChatIntegrationTab参照）。
// 「時系列統合」モードは、Twitch IRC（wss://irc-ws.chat.twitch.tv）に匿名（justinfan方式・
// 読み取り専用、ログイン不要）で直接WebSocket接続し、複数チャンネルのチャットメッセージを
// 1つのタイムラインに時系列で合流表示する自作の簡易チャットクライアント。
// レンダラーはNode統合が無効（contextIsolation）でもブラウザ標準のWebSocket APIは使えるため、
// メインプロセスを経由せずここで直接IRCと通信している。

const chatIntegrationPanel = document.getElementById('chat-integration-panel');
const chatIntegrationCloseBtn = document.getElementById('chat-integration-close-btn');
const chatIntegrationModeTabBtn = document.getElementById('chat-integration-mode-tab-btn');
const chatIntegrationModeTimelineBtn = document.getElementById('chat-integration-mode-timeline-btn');
const chatIntegrationTabs = document.getElementById('chat-integration-tabs');
const chatIntegrationTimeline = document.getElementById('chat-integration-timeline');
const chatIntegrationSendRow = document.getElementById('chat-integration-send-row');
const chatIntegrationSendInput = document.getElementById('chat-integration-send-input');
const chatIntegrationSendBtn = document.getElementById('chat-integration-send-btn');

let chatIntegrationMode = 'tab'; // 'tab' | 'timeline'
let chatIntegrationSelectedChannel = null;

function setChatIntegrationMode(mode) {
  chatIntegrationMode = mode;
  chatIntegrationModeTabBtn.classList.toggle('active', mode === 'tab');
  chatIntegrationModeTimelineBtn.classList.toggle('active', mode === 'timeline');
  chatIntegrationTabs.classList.toggle('timeline-mode', mode === 'timeline');
  chatIntegrationTimeline.classList.toggle('hidden', mode !== 'timeline');
  chatIntegrationSendRow.classList.toggle('hidden', mode !== 'timeline');
}

/** 時系列統合モードの送信欄から、上のタブで選択中のチャンネルへメッセージを送る */
async function sendTimelineChatMessage() {
  const text = chatIntegrationSendInput.value.trim();
  if (!text) return;
  if (!chatIntegrationSelectedChannel) {
    setStatusBanner('送信先のチャンネルを上のタブから選択してください');
    return;
  }
  chatIntegrationSendBtn.disabled = true;
  const result = await window.api.sendTimelineMessage(chatIntegrationSelectedChannel, text);
  chatIntegrationSendBtn.disabled = false;
  if (!result || !result.ok) {
    setStatusBanner(`メッセージの送信に失敗しました: ${result ? result.error : '不明なエラー'}`);
    return;
  }
  chatIntegrationSendInput.value = '';
}

chatIntegrationSendBtn.addEventListener('click', sendTimelineChatMessage);
chatIntegrationSendInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendTimelineChatMessage();
});

async function renderChatIntegrationTabs() {
  const channels = await window.api.listChannels();
  chatIntegrationTabs.innerHTML = '';
  channels.forEach((name) => {
    const tab = document.createElement('div');
    tab.className = 'chat-tab' + (name === chatIntegrationSelectedChannel ? ' active' : '');
    tab.textContent = name;
    tab.dataset.name = name;
    tab.addEventListener('click', () => selectChatIntegrationTab(name));
    chatIntegrationTabs.appendChild(tab);
  });

  if (chatIntegrationMode === 'tab') {
    if (!chatIntegrationSelectedChannel || !channels.includes(chatIntegrationSelectedChannel)) {
      chatIntegrationSelectedChannel = channels[0] || null;
    }
    if (chatIntegrationSelectedChannel) {
      await window.api.showChatIntegrationTab(chatIntegrationSelectedChannel);
    } else {
      await window.api.hideChatIntegrationTab();
    }
    chatIntegrationTabs.querySelectorAll('.chat-tab').forEach((el) => {
      el.classList.toggle('active', el.dataset.name === chatIntegrationSelectedChannel);
    });
  }
}

async function selectChatIntegrationTab(name) {
  chatIntegrationSelectedChannel = name;
  chatIntegrationTabs.querySelectorAll('.chat-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.name === name);
  });
  if (chatIntegrationMode === 'tab') {
    await window.api.showChatIntegrationTab(name);
  } else {
    chatIntegrationSendInput.placeholder = `「${name}」へ送信`;
  }
}

chatIntegrationBtn.addEventListener('click', async () => {
  if (!chatIntegrationPanel.classList.contains('hidden')) {
    chatIntegrationCloseBtn.click();
    return;
  }
  await window.api.openSidePanel('chat-integration', 340);
  chatIntegrationPanel.classList.remove('hidden');
  await renderChatIntegrationTabs();
  if (chatIntegrationMode === 'timeline') {
    connectIrc();
    syncYoutubeChatWatch();
    connectKickPusher();
  }
});

chatIntegrationCloseBtn.addEventListener('click', async () => {
  chatIntegrationPanel.classList.add('hidden');
  await window.api.hideChatIntegrationTab();
  stopTimelineIntegration();
  await window.api.closeSidePanel('chat-integration');
});

chatIntegrationModeTabBtn.addEventListener('click', async () => {
  if (chatIntegrationMode === 'tab') return;
  stopTimelineIntegration();
  setChatIntegrationMode('tab');
  await renderChatIntegrationTabs();
});

chatIntegrationModeTimelineBtn.addEventListener('click', async () => {
  if (!premiumUnlocked) { showPremiumLockedModal(); return; }
  if (chatIntegrationMode === 'timeline') return;
  await window.api.hideChatIntegrationTab();
  setChatIntegrationMode('timeline');
  connectIrc();
  syncYoutubeChatWatch();
  connectKickPusher();
});

function refreshChatIntegrationIfOpen() {
  if (chatIntegrationPanel.classList.contains('hidden')) return;
  renderChatIntegrationTabs();
  if (chatIntegrationMode === 'timeline') {
    syncIrcChannels();
    syncYoutubeChatWatch();
    syncKickChatrooms();
  }
}

/** 時系列統合モードを離れる/パネルを閉じる際に、Twitch IRC・YouTube裏読み込み・Kick Pusher全てを止める */
function stopTimelineIntegration() {
  disconnectIrc();
  window.api.stopYoutubeChatWatch();
  disconnectKickPusher();
}

// ---- 時系列統合モードの実体: Twitch IRC 匿名WebSocket接続 ----

let ircSocket = null;
const ircJoinedChannels = new Set();
let ircReconnectTimer = null;

function connectIrc() {
  if (ircSocket) return;
  chatIntegrationTimeline.innerHTML = '';
  ircJoinedChannels.clear();
  const nick = 'justinfan' + Math.floor(10000 + Math.random() * 89999);
  try {
    ircSocket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  } catch (_) {
    return;
  }
  ircSocket.addEventListener('open', () => {
    ircSocket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    ircSocket.send('PASS SCHMOOPIIE'); // 匿名(justinfan)読み取り専用接続では内容は無視される
    ircSocket.send(`NICK ${nick}`);
    syncIrcChannels();
  });
  ircSocket.addEventListener('message', (event) => handleIrcData(event.data));
  ircSocket.addEventListener('close', () => {
    ircSocket = null;
    ircJoinedChannels.clear();
    // パネルが時系列統合モードで開いたままなら再接続を試みる
    if (chatIntegrationMode === 'timeline' && !chatIntegrationPanel.classList.contains('hidden')) {
      ircReconnectTimer = setTimeout(connectIrc, 3000);
    }
  });
  ircSocket.addEventListener('error', () => {
    /* closeイベントで再接続処理するため、ここでは無視 */
  });
}

function disconnectIrc() {
  if (ircReconnectTimer) {
    clearTimeout(ircReconnectTimer);
    ircReconnectTimer = null;
  }
  if (ircSocket) {
    try {
      ircSocket.close();
    } catch (_) {
      /* ignore */
    }
  }
  ircSocket = null;
  ircJoinedChannels.clear();
}

/** 現在開いているチャンネル一覧に合わせてIRCのJOIN/PARTを同期する（Twitchチャンネルのみ対象） */
async function syncIrcChannels() {
  if (!ircSocket || ircSocket.readyState !== WebSocket.OPEN) return;
  const [channels, platforms] = await Promise.all([window.api.listChannels(), window.api.getChannelPlatforms()]);
  const twitchChannels = channels.filter((c) => (platforms[c] || 'twitch') === 'twitch');
  const wanted = new Set(twitchChannels.map((c) => c.toLowerCase()));
  wanted.forEach((c) => {
    if (!ircJoinedChannels.has(c)) {
      ircSocket.send(`JOIN #${c}`);
      ircJoinedChannels.add(c);
    }
  });
  ircJoinedChannels.forEach((c) => {
    if (!wanted.has(c)) {
      ircSocket.send(`PART #${c}`);
      ircJoinedChannels.delete(c);
    }
  });
}

/** 現在開いているYouTubeチャンネルに合わせて、裏読み込みでのチャット取り込みを同期する */
async function syncYoutubeChatWatch() {
  const [channels, platforms] = await Promise.all([window.api.listChannels(), window.api.getChannelPlatforms()]);
  const youtubeChannels = channels.filter((c) => platforms[c] === 'youtube');
  await window.api.syncYoutubeChatWatch(youtubeChannels);
}

function handleIrcData(raw) {
  raw
    .split('\r\n')
    .filter(Boolean)
    .forEach((line) => {
      if (line.startsWith('PING')) {
        ircSocket.send('PONG :tmi.twitch.tv');
        return;
      }
      const msg = parseIrcPrivmsg(line);
      if (msg) appendTimelineMessage(msg);
    });
}

/** IRCの1行を簡易パースする。PRIVMSG（実際のチャットメッセージ）以外はnullを返す。 */
function parseIrcPrivmsg(line) {
  let rest = line;
  let tags = {};
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    const tagStr = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
    tagStr.split(';').forEach((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return;
      tags[pair.slice(0, eq)] = pair.slice(eq + 1);
    });
  }
  let prefix = '';
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  const msgSepIdx = rest.indexOf(' :');
  const head = (msgSepIdx === -1 ? rest : rest.slice(0, msgSepIdx)).split(' ');
  const command = head[0];
  if (command !== 'PRIVMSG') return null;
  const channel = (head[1] || '').replace(/^#/, '');
  const message = msgSepIdx === -1 ? '' : rest.slice(msgSepIdx + 2);
  const username = tags['display-name'] || prefix.split('!')[0] || '?';
  const color = tags['color'] || '';
  const emotesTag = tags['emotes'] || '';
  return { channel, username, message, color, emotesTag };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * 指定バイト位置がUTF-8文字の先頭（文字境界）かどうかを判定する。
 * 継続バイト（0x80-0xBF、上位ビットが10xxxxxx）の位置は文字の途中なので境界ではない。
 * 稀にTwitch側のemotesタグのオフセットがずれている場合や、マルチバイト文字（絵文字・
 * 日本語等）を含むメッセージで範囲がずれた場合に、UTF-8シーケンスを分断して
 * デコードすると文字化け（U+FFFD）になるため、その予防チェックに使う。
 */
function isUtf8CharBoundary(bytes, index) {
  if (index <= 0 || index >= bytes.length) return true;
  return (bytes[index] & 0xc0) !== 0x80;
}

/**
 * Twitch IRCのemotesタグ（例: "25:0-4,12-16/1902:6-10"）を解析し、対象範囲を
 * スタンプ画像<img>に置き換えたHTMLを返す。emotesTagが無い/壊れている場合は
 * 通常のエスケープ済みテキストにフォールバックする。
 * 範囲指定はUTF-8バイトオフセットのため、TextEncoder/Decoderでバイト単位に処理する。
 * 絵文字・日本語等のマルチバイト文字を含むメッセージで稀に範囲がずれることがあり、
 * その場合は文字の途中でバイト列を切ってしまい文字化け（U+FFFD）が発生するため、
 * 範囲の開始・終了が文字境界と一致しないものは安全側に倒して個別にスキップする
 * （メッセージ全体はフォールバックさせず、そのスタンプ1個だけテキスト表示に留める）。
 */
function buildEmoteAwareMessageHtml(message, emotesTag) {
  if (!emotesTag) return escapeHtml(message);
  try {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const bytes = encoder.encode(message);
    const ranges = [];
    emotesTag.split('/').forEach((entry) => {
      const [id, positions] = entry.split(':');
      if (!id || !positions) return;
      positions.split(',').forEach((pos) => {
        const [startStr, endStr] = pos.split('-');
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0 || end >= bytes.length) return;
        // 開始・終了(の次のバイト)が文字境界からずれている場合、Twitch側のオフセット不整合
        // が疑われるため、この範囲は画像化せず通常テキストとして残す（文字化け防止）。
        if (!isUtf8CharBoundary(bytes, start) || !isUtf8CharBoundary(bytes, end + 1)) return;
        ranges.push({ id, start, end });
      });
    });
    if (ranges.length === 0) return escapeHtml(message);
    ranges.sort((a, b) => a.start - b.start);

    let html = '';
    let cursor = 0;
    ranges.forEach((r) => {
      if (r.start < cursor) return; // 重複/不正な範囲はスキップ
      if (r.start > cursor) {
        html += escapeHtml(decoder.decode(bytes.slice(cursor, r.start)));
      }
      const emoteText = decoder.decode(bytes.slice(r.start, r.end + 1));
      const src = `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(r.id)}/default/dark/1.0`;
      // CDN側にその解像度/テーマの画像が無い等で読み込みに失敗した場合、ブロークン
      // イメージのアイコン＋altテキストが表示されてしまい文字化けのように見えるため、
      // 失敗時はプレーンテキストのノードに置き換えて自然に読める状態にフォールバックする。
      html += `<img class="chat-emote" src="${src}" alt="${escapeHtml(emoteText)}" title="${escapeHtml(
        emoteText
      )}" onerror="this.replaceWith(document.createTextNode(this.alt));this.onerror=null;">`;
      cursor = r.end + 1;
    });
    if (cursor < bytes.length) {
      html += escapeHtml(decoder.decode(bytes.slice(cursor)));
    }
    return html;
  } catch (_) {
    return escapeHtml(message);
  }
}

const CHAT_TIMELINE_MAX_LINES = 300;

function appendTimelineMessage({ channel, username, message, color, emotesTag }) {
  const nearBottom =
    chatIntegrationTimeline.scrollHeight - chatIntegrationTimeline.scrollTop - chatIntegrationTimeline.clientHeight <
    40;
  const line = document.createElement('div');
  line.className = 'chat-line';
  line.innerHTML = `<span class="chat-channel">[${escapeHtml(channel)}]</span><span class="chat-user" style="color:${
    color || '#9147ff'
  }">${escapeHtml(username)}</span>: <span class="chat-message-text">${buildEmoteAwareMessageHtml(
    message,
    emotesTag
  )}</span>`;
  chatIntegrationTimeline.appendChild(line);
  while (chatIntegrationTimeline.children.length > CHAT_TIMELINE_MAX_LINES) {
    chatIntegrationTimeline.removeChild(chatIntegrationTimeline.firstChild);
  }
  if (nearBottom) {
    chatIntegrationTimeline.scrollTop = chatIntegrationTimeline.scrollHeight;
  }
}

// YouTube側は裏読み込み（youtubeChatScraperPreload.js）で拾ったメッセージがメインプロセス経由で届く。
// Twitchのcolorタグに相当するものが無いため、YouTube発言と分かるよう固定色（赤系）にしている。
window.api.onYoutubeChatMessage(({ channel, username, message }) => {
  appendTimelineMessage({ channel, username, message, color: '#ff4d4d' });
});

// ---- 時系列統合モードの実体: Kickチャット（Pusher WebSocket、匿名購読） ----
// KickのライブチャットはPusherというホスト型WebSocketサービス経由。Twitch IRCと同じく
// メインプロセスを経由せずここ（renderer）から直接接続する（WebSocketはCORSの制約を受けないため）。
// 購読には数値のchatroom_idが必要で、チャンネル名からの解決だけはCORSを避けるため
// メインプロセス側のNode https（window.api.resolveKickChatroomId）に任せている。
// 既知の注意点: kick.com/api/v2/channels/{slug}はCloudflareのBot対策の影響を受けることがあり、
// 実機でIDが解決できない場合はそのチャンネルの発言だけタイムラインに出ない（他機能には影響しない）。
const KICK_PUSHER_WS_URL = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false';

let kickSocket = null;
let kickReconnectTimer = null;
const kickChannelToChatroomId = new Map(); // 小文字チャンネル名 -> chatroom_id
const kickChatroomIdToChannel = new Map(); // chatroom_id -> 元のチャンネル名（表示用に大文字小文字を保つ）

function connectKickPusher() {
  if (kickSocket) return;
  kickChannelToChatroomId.clear();
  kickChatroomIdToChannel.clear();
  try {
    kickSocket = new WebSocket(KICK_PUSHER_WS_URL);
  } catch (_) {
    return;
  }
  kickSocket.addEventListener('open', () => {
    // pusher:connection_established を待たずに購読要求を送っても実害は無いが、
    // 一応イベント受信後にまとめて同期する（syncKickChatrooms側でsocket未OPENなら何もしないため安全）。
    syncKickChatrooms();
  });
  kickSocket.addEventListener('message', (event) => handleKickPusherData(event.data));
  kickSocket.addEventListener('close', () => {
    kickSocket = null;
    kickChannelToChatroomId.clear();
    kickChatroomIdToChannel.clear();
    if (chatIntegrationMode === 'timeline' && !chatIntegrationPanel.classList.contains('hidden')) {
      kickReconnectTimer = setTimeout(connectKickPusher, 3000);
    }
  });
  kickSocket.addEventListener('error', () => {
    /* closeイベントで再接続処理するため、ここでは無視 */
  });
}

function disconnectKickPusher() {
  if (kickReconnectTimer) {
    clearTimeout(kickReconnectTimer);
    kickReconnectTimer = null;
  }
  if (kickSocket) {
    try {
      kickSocket.close();
    } catch (_) {
      /* ignore */
    }
  }
  kickSocket = null;
  kickChannelToChatroomId.clear();
  kickChatroomIdToChannel.clear();
}

/** 現在開いているKickチャンネルに合わせて、Pusherチャンネルの購読/解除を同期する */
async function syncKickChatrooms() {
  if (!kickSocket || kickSocket.readyState !== WebSocket.OPEN) return;
  const [channels, platforms] = await Promise.all([window.api.listChannels(), window.api.getChannelPlatforms()]);
  const kickChannels = channels.filter((c) => platforms[c] === 'kick');
  const wantedNames = new Set(kickChannels.map((c) => c.toLowerCase()));

  // 無くなったチャンネルの購読解除
  Array.from(kickChannelToChatroomId.keys()).forEach((lower) => {
    if (!wantedNames.has(lower)) {
      const id = kickChannelToChatroomId.get(lower);
      try {
        kickSocket.send(JSON.stringify({ event: 'pusher:unsubscribe', data: { channel: `chatrooms.${id}.v2` } }));
      } catch (_) {
        /* ignore */
      }
      kickChannelToChatroomId.delete(lower);
      kickChatroomIdToChannel.delete(id);
    }
  });

  // 新しく追加されたチャンネルの購読（chatroom_idの解決はメインプロセス経由）
  await Promise.all(
    kickChannels.map(async (name) => {
      const lower = name.toLowerCase();
      if (kickChannelToChatroomId.has(lower)) return;
      const result = await window.api.resolveKickChatroomId(name);
      if (!result || !result.ok) {
        const detail = (result && result.error) || '不明なエラー';
        console.error(`Kickチャンネル「${name}」のchatroom_id解決に失敗しました:`, detail);
        setStatusBanner(`全タブ統合: Kick「${name}」のチャットが取得できませんでした（${detail}）`);
        return;
      }
      // 解決の間に別チャンネルへ切り替わっている/ソケットが切れている可能性があるため再確認
      if (!kickSocket || kickSocket.readyState !== WebSocket.OPEN) return;
      kickChannelToChatroomId.set(lower, result.chatroomId);
      kickChatroomIdToChannel.set(result.chatroomId, name);
      kickSocket.send(
        JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${result.chatroomId}.v2` } })
      );
    })
  );
}

/** Kickのアイデンティティ色（identity.color、#RRGGBB）が無い場合のフォールバック（Kickブランドカラー） */
const KICK_DEFAULT_CHAT_COLOR = '#53fc18';

function handleKickPusherData(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (_) {
    return;
  }
  if (msg.event !== 'App\\Events\\ChatMessageEvent') return;
  const chatroomMatch = /^chatrooms\.(\d+)\.v2$/.exec(msg.channel || '');
  if (!chatroomMatch) return;
  const channel = kickChatroomIdToChannel.get(Number(chatroomMatch[1]));
  if (!channel) return;
  let data;
  try {
    data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
  } catch (_) {
    return;
  }
  const sender = (data && data.sender) || {};
  const username = sender.username || sender.slug || '?';
  const color = (sender.identity && sender.identity.color) || KICK_DEFAULT_CHAT_COLOR;
  const message = (data && data.content) || '';
  if (!message) return;
  appendTimelineMessage({ channel, username, message, color });
}

// ---- タイル自由配置・自由リサイズ（ウィンドウマネージャー相当） ----
// 実際のドラッグ移動／端リサイズは、配信・チャットのBrowserView自体に注入したプリロード
// （tileInteractionPreload.js）がmousedown/mouseupを検知し、メインプロセス側で
// カーソル位置をポーリングしながら行う。レンダラー側はボタン操作の中継のみ。

const layoutAutoArrangeBtn = document.getElementById('layout-auto-arrange-btn');

layoutAutoArrangeBtn.addEventListener('click', async () => {
  await window.api.autoArrangeTiles();
});

// ---- レイアウトのURL共有 ----
// 現在開いているチャンネル構成＋タイル配置（位置・サイズ・チャット表示有無）だけをURL化する。
// Drops自動追加設定やHelixキー等の個人設定は含めない。取込みはカスタムプロトコルではなく
// 貼り付け方式（検証しやすく、実装も軽いためユーザーと合意）。

const layoutShareBtn = document.getElementById('layout-share-btn');
const layoutSharePanel = document.getElementById('layout-share-panel');
const layoutShareCloseBtn = document.getElementById('layout-share-close-btn');
const layoutShareGenerateBtn = document.getElementById('layout-share-generate-btn');
const layoutShareOutput = document.getElementById('layout-share-output');
const layoutShareCopyBtn = document.getElementById('layout-share-copy-btn');
const layoutShareInput = document.getElementById('layout-share-input');
const layoutShareImportBtn = document.getElementById('layout-share-import-btn');
const layoutShareStatus = document.getElementById('layout-share-status');

layoutShareBtn.addEventListener('click', async () => {
  if (!layoutSharePanel.classList.contains('hidden')) {
    layoutShareCloseBtn.click();
    return;
  }
  await window.api.openSidePanel('layout-share', 380);
  layoutSharePanel.classList.remove('hidden');
  layoutShareStatus.textContent = '';
});

layoutShareCloseBtn.addEventListener('click', async () => {
  layoutSharePanel.classList.add('hidden');
  await window.api.closeSidePanel('layout-share');
});

layoutShareGenerateBtn.addEventListener('click', async () => {
  const result = await window.api.exportLayoutShareUrl();
  if (!result.ok) {
    layoutShareStatus.textContent = `エラー: ${result.error}`;
    return;
  }
  layoutShareOutput.value = result.url;
  layoutShareStatus.textContent = '';
});

layoutShareCopyBtn.addEventListener('click', async () => {
  if (!layoutShareOutput.value) {
    layoutShareStatus.textContent = 'まず「現在の構成からURLを生成」を押してください';
    return;
  }
  await navigator.clipboard.writeText(layoutShareOutput.value);
  layoutShareStatus.textContent = 'コピーしました';
});

layoutShareImportBtn.addEventListener('click', async () => {
  const url = layoutShareInput.value.trim();
  if (!url) {
    layoutShareStatus.textContent = 'URLを貼り付けてください';
    return;
  }
  layoutShareStatus.textContent = '読み込み中...';
  const result = await window.api.importLayoutShareUrl(url);
  if (!result.ok) {
    layoutShareStatus.textContent = `エラー: ${result.error}`;
    return;
  }
  layoutShareStatus.textContent = `${result.count}件のチャンネル構成を読み込みました`;
  layoutShareInput.value = '';
  refreshChips();
  refreshEmoteChannelOptions();
});

// BrowserViewに覆われない隙間（ヘッダー等）でマウスを離してしまった場合の保険
document.addEventListener('mouseup', () => {
  window.api.endTileInteraction();
});

// ---- エラー通知 ----

window.api.onChannelLoadError(({ channel, target, message }) => {
  setStatusBanner(`「${channel}」の${target === 'stream' ? '配信' : 'チャット'}読み込みに失敗しました: ${message}`);
});
window.api.onKickDropsLoadError(({ message }) => {
  setStatusBanner(`Kick Dropsページの読み込みに失敗しました: ${message}`);
});

window.api.onDropsLoadError(({ message }) => {
  setStatusBanner(`Dropsページの読み込みに失敗しました: ${message}`);
});
window.api.onAccountLoadError(({ platform, message }) => {
  setStatusBanner(`${PLATFORM_LABELS[platform] || platform}のログイン画面読み込みに失敗しました: ${message}`);
});
// Drops自動追加/削除はメインプロセス側で完結する変更のため、チップ一覧を明示的に更新する
window.api.onChannelsChanged(() => {
  refreshChips();
  refreshVolumeMixerIfOpen();
  refreshChatIntegrationIfOpen();
});

// 複数のサイドパネルを同時に開いた時、後から開いたパネルほど画面右端に近い位置に積み上げる。
// メインプロセス側（openPanels管理）から各パネルの右オフセットが送られてくるたびに反映する。
// 音量ミキサーは常設のサイドパネルではなく最前面ドロップダウンのため、このスタック管理には含めない
// （常に画面右端固定＝CSSのright:0のまま）。
const SIDE_PANEL_ELEMENTS = {
  settings: settingsModal,
  zapping: zappingModal,
  emotes: emotesPanel,
  'chat-integration': chatIntegrationPanel,
  'layout-share': layoutSharePanel,
  'unified-feed': unifiedFeedModal,
};

window.api.onSidePanelsChanged((positions) => {
  Object.entries(SIDE_PANEL_ELEMENTS).forEach(([id, el]) => {
    if (id in positions) {
      el.style.right = `${positions[id]}px`;
    } else {
      el.style.right = '0px';
    }
  });
});

function setStatusBanner(text) {
  dropsProgressResult.textContent = text;
  // ステータスバーは高さ固定で折り返せないため、長文は末尾が省略表示になる。
  // title属性にも全文を入れておき、hoverで全文を確認できるようにする。
  dropsProgressResult.title = text;
}

// ---- ESCキーで各パネル/モーダルを閉じる ----
// 開いている可能性のあるパネルを優先度順にチェックし、最初に見つかったものだけを閉じる
// （通常は同時に1つしか開かない設計だが、念のため順序を決めておく）。
// 各パネル既存の「閉じる」ボタンをクリックしたのと同じ状態に揃えたいので、実際にボタンをクリックする。
function closeTopmostPanelWithEscape() {
  if (!accountLoginCloseBtn.classList.contains('hidden')) {
    accountLoginCloseBtn.click();
    return;
  }
  if (!twitchAuthCloseBtn.classList.contains('hidden')) {
    twitchAuthCloseBtn.click();
    return;
  }
  if (!settingsModal.classList.contains('hidden')) {
    settingsCloseBtn.click();
    return;
  }
  if (!zappingModal.classList.contains('hidden')) {
    zappingCloseBtn.click();
    return;
  }
  if (!unifiedFeedModal.classList.contains('hidden')) {
    unifiedFeedCloseBtn.click();
    return;
  }
  if (!chatIntegrationPanel.classList.contains('hidden')) {
    chatIntegrationCloseBtn.click();
    return;
  }
  if (!layoutSharePanel.classList.contains('hidden')) {
    layoutShareCloseBtn.click();
    return;
  }
  if (!emotesPanel.classList.contains('hidden')) {
    emotesCloseBtn.click();
    return;
  }
  if (!volumeMixerPanel.classList.contains('hidden')) {
    closeVolumeMixer();
    return;
  }
  if (!welcomeModal.classList.contains('hidden')) {
    welcomeCloseBtn.click();
    return;
  }
  if (!helpModal.classList.contains('hidden')) {
    helpCloseBtn.click();
    return;
  }
  if (!proAuthModal.classList.contains('hidden')) {
    proAuthCloseBtn.click();
    return;
  }
  if (!feedbackModal.classList.contains('hidden')) {
    feedbackCloseBtn.click();
    return;
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeTopmostPanelWithEscape();
});

// 配信/チャット/Drops/ログイン画面などBrowserView側にフォーカスがある時のEscapeは、
// メインプロセス経由でここに転送されてくる（forwardEscapeKey参照）
window.api.onEscapePressed(() => closeTopmostPanelWithEscape());

(async function init() {
  refreshChips();
  await restoreActionButtonOrder();
  setupActionButtonsDragReorder();
})();

// ---- 自作メニューバー（ファイル/表示/ヘルプ/バージョン） ----
// ネイティブのMenuを廃止し、開閉・見た目・「バージョン」の動的な中身をすべてここで描画する。
// 実処理（終了・再読み込み・アップデート確認など）はmain.js側のapp-menu:*ハンドラに委譲する
// （window.api.appMenu、preload.js参照）。
(function setupAppMenuBar() {
  const appMenuBar = document.getElementById('app-menu-bar');
  const versionMenuItem = appMenuBar.querySelector('.menu-bar-item[data-menu="version"]');
  const versionMenuDropdown = document.getElementById('version-menu-dropdown');

  let latestState = null;

  function closeAllMenuBarDropdowns() {
    appMenuBar.querySelectorAll('.menu-bar-item.open').forEach((el) => el.classList.remove('open'));
  }

  // ファイル/表示/バージョンのドロップダウンはBrowserView（配信タイル）より背後に描画されて
  // しまう不具合があった（BrowserViewはCSSのz-indexとは無関係に常にHTML描画の手前に来るため）。
  // help-modal等と同じ「開く前にhideContentViews、閉じたらshowContentViews」方式で解消する。
  // ただしヘルプ/初回案内/会員登録/フィードバック（open-help等）は開いた先のモーダル自身が
  // 同じ処理を行うため、ここではshowContentViewsを呼ばない（一瞬表示→非表示のちらつき防止）。
  async function closeMenuBarDropdownsAndRestoreViews() {
    const hadOpen = !!appMenuBar.querySelector('.menu-bar-item.open');
    closeAllMenuBarDropdowns();
    if (hadOpen) await window.api.showContentViews();
  }

  /** disabledなクリックできない項目（現在の状態表示だけの行）を1つ作る。 */
  function makeDisabledItem(label) {
    const el = document.createElement('div');
    el.className = 'menu-bar-dropdown-item disabled';
    el.textContent = label;
    return el;
  }

  /** クリックできる項目を1つ作る。 */
  function makeActionItem(label, onClick) {
    const el = document.createElement('div');
    el.className = 'menu-bar-dropdown-item';
    el.textContent = label;
    el.addEventListener('click', async (e) => {
      // data-action属性を持たないため、ここで止めないとクリックがappMenuBarの
      // クリックハンドラまでバブリングし、「.menu-bar-item」判定分岐に落ちて
      // バージョンドロップダウンが再度開いてしまう（閉じたはずが開き直る不具合）。
      e.stopPropagation();
      await closeMenuBarDropdownsAndRestoreViews();
      onClick();
    });
    return el;
  }

  function makeSeparator() {
    const el = document.createElement('div');
    el.className = 'menu-bar-dropdown-separator';
    return el;
  }

  /**
   * 「バージョン」ドロップダウンの中身を状態に応じて描画する。以前のネイティブメニュー版
   * （main.jsのbuildUpdaterSubmenu、削除済み）と同じ内容をHTMLで再現している。
   */
  function renderVersionDropdown(state) {
    versionMenuDropdown.innerHTML = '';
    versionMenuDropdown.appendChild(makeDisabledItem(`現在のバージョン: ${state.appVersion}`));
    versionMenuDropdown.appendChild(makeSeparator());

    const updater = state.updater || { status: 'idle' };
    switch (updater.status) {
      case 'checking':
        versionMenuDropdown.appendChild(makeDisabledItem('確認中…'));
        break;
      case 'available':
        versionMenuDropdown.appendChild(makeDisabledItem(`新しいバージョン ${updater.version} があります`));
        versionMenuDropdown.appendChild(makeActionItem('ダウンロードする', () => window.api.appMenu.downloadUpdate()));
        break;
      case 'downloading':
        versionMenuDropdown.appendChild(makeDisabledItem(`ダウンロード中… ${updater.percent}%`));
        break;
      case 'downloaded':
        versionMenuDropdown.appendChild(makeDisabledItem(`バージョン ${updater.version} の準備ができました`));
        // 「PC自体を再起動する」と誤解されやすいという指摘を受け、「アプリの再起動」であることが
        // わかるよう文言に(アプリ)を明記。選択肢も1つに戻す（forceRunAfter=trueで常にアプリを
        // 自動再起動する。インストーラーの終了選択に委ねる「今すぐ更新」単独ボタンは削除した）。
        versionMenuDropdown.appendChild(makeActionItem('今すぐ更新して再起動(アプリ)', () => window.api.appMenu.installUpdate(true)));
        break;
      case 'not-available':
        versionMenuDropdown.appendChild(makeDisabledItem('最新の状態です'));
        versionMenuDropdown.appendChild(makeActionItem('アップデートを確認', () => window.api.appMenu.checkUpdate()));
        break;
      case 'error':
        versionMenuDropdown.appendChild(makeDisabledItem('確認できませんでした'));
        versionMenuDropdown.appendChild(makeActionItem('アップデートを確認', () => window.api.appMenu.checkUpdate()));
        break;
      default:
        versionMenuDropdown.appendChild(makeActionItem('アップデートを確認', () => window.api.appMenu.checkUpdate()));
    }
  }

  /** state-changed通知・初回取得の両方で呼ぶ。バッジ表示、動的ラベル、バージョン中身を更新する。 */
  function renderAppMenuState(state) {
    latestState = state;
    versionMenuItem.classList.toggle('has-update-badge', !!state.hasUpdateBadge);
    renderVersionDropdown(state);
  }

  appMenuBar.addEventListener('click', async (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.dataset.action;
      // open-help/open-welcome/open-pro-auth/open-feedbackは、開いた先のモーダル自身が
      // hideContentViewsを行うのでここでは復元しない（closeAllMenuBarDropdownsのみ）。
      // それ以外は「メニューを閉じて終わり」の操作なのでコンテンツ表示を復元する。
      const restoresViews = !['open-help', 'open-welcome', 'open-pro-auth', 'open-feedback'].includes(action);
      if (restoresViews) {
        await closeMenuBarDropdownsAndRestoreViews();
      } else {
        closeAllMenuBarDropdowns();
      }
      switch (action) {
        case 'quit':
          await window.api.appMenu.quit();
          break;
        case 'reload':
          await window.api.appMenu.reload();
          break;
        case 'toggle-devtools':
          await window.api.appMenu.toggleDevTools();
          break;
        case 'relayout':
          await window.api.appMenu.relayout();
          break;
        case 'open-help':
          openHelpModal();
          break;
        case 'open-welcome':
          openWelcomeModal();
          break;
        case 'open-external':
          await window.api.appMenu.openExternal(actionEl.dataset.url);
          break;
        case 'open-pro-auth':
          openProAuthModal();
          break;
        case 'open-feedback':
          openFeedbackModal();
          break;
      }
      return;
    }
    const item = e.target.closest('.menu-bar-item');
    if (!item) return;
    const wasOpen = item.classList.contains('open');
    if (wasOpen) {
      await closeMenuBarDropdownsAndRestoreViews();
      return;
    }
    closeAllMenuBarDropdowns();
    item.classList.add('open');
    if (item.querySelector('.menu-bar-dropdown')) await window.api.hideContentViews();
  });

  // メニューが1つ開いている間は、他の項目にマウスを乗せただけで切り替わるようにする
  // （ネイティブのメニューバーと同じ挙動）。
  appMenuBar.querySelectorAll('.menu-bar-item').forEach((item) => {
    item.addEventListener('mouseenter', () => {
      // 「会員登録」のようにドロップダウンを持たない項目（クリックで即ポップアップを開く
      // だけの項目）は、ホバーでの自動切り替え対象から外す。
      if (!item.querySelector('.menu-bar-dropdown')) return;
      const openItem = appMenuBar.querySelector('.menu-bar-item.open');
      if (openItem && openItem !== item) {
        openItem.classList.remove('open');
        item.classList.add('open');
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#app-menu-bar')) closeMenuBarDropdownsAndRestoreViews();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenuBarDropdownsAndRestoreViews();
  });

  window.api.appMenu.onStateChanged((state) => renderAppMenuState(state));
  (async () => {
    const state = await window.api.appMenu.getState();
    renderAppMenuState(state);
  })();
})();
