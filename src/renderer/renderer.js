'use strict';

const channelInput = document.getElementById('channel-input');
const channelPlatformSelect = document.getElementById('channel-platform-select');
const addChannelBtn = document.getElementById('add-channel-btn');
const channelChips = document.getElementById('channel-chips');

// 依頼#15でTwitch Drops開閉・進捗確認・Kick Drops開閉の3ボタンを単一のDropsハブボタン+パネルに統合。
// #drops-progress-resultはDrops専用ではなく他のエラー通知とも共有するステータス表示のため、
// そちらは維持しつつ、進捗確認結果自体はパネル内の専用要素(#drops-hub-progress-result)に出す。
const dropsProgressResult = document.getElementById('drops-progress-result');
// 2026-08-07: 旧#status-bar（ヘッダー下の全幅帯）を廃止し、menu-bar行右端の#status-indicatorに統合。
const statusIndicator = document.getElementById('status-indicator');
const dropsHubBtn = document.getElementById('drops-hub-btn');
const dropsHubModal = document.getElementById('drops-hub-modal');
const dropsHubCloseBtn = document.getElementById('drops-hub-close-btn');
const dropsHubTwitchToggleBtn = document.getElementById('drops-hub-twitch-toggle-btn');
const dropsHubProgressBtn = document.getElementById('drops-hub-progress-btn');
const dropsHubProgressResult = document.getElementById('drops-hub-progress-result');
const dropsHubKickToggleBtn = document.getElementById('drops-hub-kick-toggle-btn');

// 「使い方/注記」「初回案内」は2026-08-07、配信を消さないオーバーレイ方式
// （openOverlayPanel、main.js/overlay-panel参照）へ移植済み。DOM自体をindex.htmlから
// 削除したため、ここでの要素参照・リスナー登録も不要になった。

// ---- 有料機能（Pro機能）のロックUI ----
// premiumUnlockedは会員登録ログイン後の/statusレスポンス（Stripe決済状況）で決まる
// （main.jsのrefreshProAuthStatus参照）。開発者本人のメールでログインした場合のみ、
// main.js側で決済状況によらず自動でtrueになる。
const PRO_BUTTON_IDS = ['zapping-btn', 'unified-feed-btn'];
let premiumUnlocked = false;

function applyPremiumLockUiStates() {
  PRO_BUTTON_IDS.forEach((id) => {
    document.getElementById(id)?.classList.toggle('locked', !premiumUnlocked);
  });
  chatIntegrationModeTimelineBtn?.classList.toggle('locked', !premiumUnlocked);
  // 依頼#15: Dropsハブパネル自体は無料開放だが、パネル内のDrops自動追加/削除だけは
  // 引き続きPro限定（元は配信チェックのPro機能内にあったため）。ロック中は「追加」ボタンに
  // 🔒表示を出す（実際のクリック制御はdropsAutoAddBtn/removeボタンのハンドラ側で行う）。
  document.getElementById('drops-auto-add-btn')?.classList.toggle('locked', !premiumUnlocked);
}

// centered化（2026-08-07）に伴う外側クリック閉じ対応で追加。openOverlayPanelSafe()を
// 呼んだ直後の1回だけ、documentのclickリスナーでの「外側クリック閉じ」を無視させるための
// フラグ。役割：あるオーバーレイパネルが開いている状態で、別のオーバーレイパネルを開く
// ボタン（例: 配信タイル下のロックボタン→premium-locked）をクリックした場合、そのボタンの
// クリックハンドラがopenOverlayPanel（新パネルを開くIPC）を発行した直後、同じクリックが
// documentまでバブリングして「外側クリック」判定に引っかかる。IPCの往復は非同期な一方、
// documentへのバブリングは同期的に続くため、この時点ではoverlayPanelOpenIdはまだ古い値
// （直前に開いていたパネルのID）のままで、誤って「閉じる」が呼ばれ、新パネルが開いた
// 直後にすぐ閉じてしまう（画面がチラつく）競合が起きる。async関数はawaitに達するまで
// 同期的に実行されるため、await直前でこのフラグを立てておけば、同じクリックの
// バブリング中にdocumentリスナーが読む時点で確実にtrueになっている。
let suppressNextOutsideClick = false;
async function openOverlayPanelSafe(panelId) {
  suppressNextOutsideClick = true;
  await window.api.openOverlayPanel(panelId);
}

// 2026-08-07: 配信を消さないオーバーレイ方式（openOverlayPanel）へ移植済み。
// 中身（DOM・タブ切り替え・「使い方/注記」への導線）はoverlay-panel/overlay-panel.jsへ
// そのまま移した（見た目・挙動は変えていない）。
async function showPremiumLockedModal() {
  await openOverlayPanelSafe('premium-locked');
}
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
  updateChipMetaBadges();
}

// updateChipMetaBadges()のfetchAllStreamMeta()呼び出しはKick分がBrowserView生成を伴い重いため、
// refreshChips()（ドラッグ&ドロップ・チャットトグル等、頻繁に呼ばれうる箇所11箇所から呼ばれる）
// のたびに毎回叩き直さないよう、直近の取得結果を短時間キャッシュしてスロットリングする。
let streamMetaCache = {};
let streamMetaLastFetchAt = 0;
const STREAM_META_MIN_REFETCH_MS = 5000;

/** 配信開始時刻（ISO8601文字列）から現在までの経過時間を "1:23:45" / "23:45" 形式で返す。無効な値ならnull。 */
function formatElapsedStreamTime(startedAtIso) {
  if (!startedAtIso) return null;
  const startedMs = new Date(startedAtIso).getTime();
  if (Number.isNaN(startedMs)) return null;
  const diffSec = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * 直近取得済みのstreamMetaCacheを使って、チップの視聴者数バッジ・ツールチップ
 * （タイトル・カテゴリ・視聴者数・配信経過時間）を再描画する。ネットワークアクセスは行わない
 * （経過時間だけは毎秒再計算する必要があるため、取得処理とDOM反映を分離している）。
 * refreshChips()と違いチップDOM自体は再構築せず、既存の.viewer-badge要素とtitle属性だけを
 * 差し替える（マーキーアニメーションの再生状態やドラッグ中の状態を壊さないため）。
 */
function applyStreamMetaToChips() {
  const meta = streamMetaCache;
  channelChips.querySelectorAll('.chip').forEach((chip) => {
    const name = chip.dataset.name;
    const badge = chip.querySelector('.viewer-badge');
    const info = meta[name];
    if (!info) {
      if (badge) {
        badge.textContent = '';
        badge.classList.add('pending');
        badge.title = '';
      }
      chip.removeAttribute('title');
      return;
    }
    const compactViewers =
      info.viewerCount >= 10000
        ? `${(info.viewerCount / 10000).toFixed(1)}万`
        : info.viewerCount.toLocaleString();
    const elapsed = formatElapsedStreamTime(info.startedAt);
    if (badge) {
      badge.textContent = `👁 ${compactViewers}${elapsed ? ` ・⏱${elapsed}` : ''}`;
      badge.classList.remove('pending');
    }
    const detailParts = [];
    if (info.title) detailParts.push(info.title);
    if (info.gameName) detailParts.push(`カテゴリ: ${info.gameName}`);
    detailParts.push(`視聴者数: ${info.viewerCount.toLocaleString()}人`);
    if (elapsed) detailParts.push(`配信時間: ${elapsed}`);
    const detail = detailParts.join('\n');
    chip.title = detail;
    if (badge) badge.title = detail;
  });
}

// ---- タイル情報帯（配信者名・タイトル・視聴者数・配信時間、2026-08-07新設） ----
// 配信サイト側のページには一切手を加えず、各タイルのstreamView(配信映像)直下に
// アプリ自身が作るHTML帯を重ねて表示する。矩形はmain.js側(applyTileBoundsFromRect)から
// tile:bar-bounds イベントで都度pushされ、中身のテキストはチップと同じstreamMetaCacheを
// 再利用する（新規の取得処理は行わない）。
const tileInfoBarsContainer = document.getElementById('tile-info-bars');
const tileBarEls = new Map(); // channelName -> HTMLElement

function ensureTileBarEl(channel) {
  let el = tileBarEls.get(channel);
  if (!el) {
    el = document.createElement('div');
    el.className = 'tile-info-bar';
    el.dataset.name = channel;
    el.innerHTML = `
      <span class="tile-info-bar-name"></span>
      <span class="tile-info-bar-title"></span>
      <span class="tile-info-bar-category"></span>
      <span class="tile-info-bar-stats"></span>
    `;
    tileInfoBarsContainer.appendChild(el);
    tileBarEls.set(channel, el);
  }
  return el;
}

window.api.onTileBarBounds((rect) => {
  const el = ensureTileBarEl(rect.channel);
  el.style.left = `${rect.x}px`;
  el.style.top = `${rect.y}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
});

window.api.onTileBarRemove((channel) => {
  const el = tileBarEls.get(channel);
  if (el) {
    el.remove();
    tileBarEls.delete(channel);
  }
});

window.api.onTileBarsVisible((visible) => {
  tileInfoBarsContainer.classList.toggle('bars-hidden', !visible);
});

// ---- タイル情報帯を掴んでのドラッグ移動／下端リサイズ ----
// tile-info-bar はstreamViewのbounds縮小で生まれた隙間に重なるホストウィンドウ側のHTMLで、
// BrowserView本体（tileInteractionPreload.jsがmousedown等を検知）の外側にある。
// 従来はこの帯にドラッグ検知が一切配線されておらず、streamViewの下端（従来はここがドラッグの
// 掴みどころだった）を掴んだつもりが実際にはこの帯の上でmousedownしてしまい、ドラッグが
// 開始しない、または開始直後にポインタがBrowserView外（＝この帯の上）へ抜けてmousemoveが
// 届かなくなり即座に外れる、という不具合が起きていた。BrowserView側と同じ
// tile-interaction:start/move/end プロトコルをホストウィンドウ側からも発行することで解消する。
const TILE_INFO_BAR_RESIZE_EDGE_PX = 6;
let infoBarDragging = false;
let infoBarRafPending = false;
let infoBarLatestPoint = null;

function infoBarResizeZone(el, clientY) {
  const rect = el.getBoundingClientRect();
  return clientY >= rect.bottom - TILE_INFO_BAR_RESIZE_EDGE_PX ? 's' : '';
}

tileInfoBarsContainer.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const el = e.target.closest('.tile-info-bar');
  if (!el) return;
  const channel = el.dataset.name;
  if (!channel) return;
  const dir = infoBarResizeZone(el, e.clientY);
  infoBarDragging = true;
  document.body.style.cursor = dir ? 'ns-resize' : 'move';
  window.api.startTileInteraction({
    channel,
    origin: 'stream',
    type: dir ? 'resize' : 'move',
    dir,
    screenX: e.screenX,
    screenY: e.screenY,
  });
});

tileInfoBarsContainer.addEventListener('mousemove', (e) => {
  if (infoBarDragging) return;
  const el = e.target.closest('.tile-info-bar');
  document.body.style.cursor = el && infoBarResizeZone(el, e.clientY) ? 'ns-resize' : '';
});

window.addEventListener('mousemove', (e) => {
  if (!infoBarDragging) return;
  infoBarLatestPoint = { x: e.screenX, y: e.screenY };
  if (!infoBarRafPending) {
    infoBarRafPending = true;
    requestAnimationFrame(() => {
      infoBarRafPending = false;
      if (infoBarDragging && infoBarLatestPoint) {
        window.api.moveTileInteraction(infoBarLatestPoint);
      }
    });
  }
});

function endInfoBarDrag() {
  if (!infoBarDragging) return;
  infoBarDragging = false;
  infoBarLatestPoint = null;
  document.body.style.cursor = '';
  window.api.endTileInteraction();
}
window.addEventListener('mouseup', endInfoBarDrag);
window.addEventListener('blur', endInfoBarDrag);

/**
 * streamMetaCache（チップと共有）を使って、タイル情報帯の表示内容を更新する。
 * YouTubeはfetchAllStreamMeta非対応（既存の意図的な仕様）のため配信者名のみ表示し、
 * タイトル・視聴者数・経過時間の欄は空のままにする（「取得不可」等のノイズ文言は出さない）。
 */
function applyStreamMetaToTileBars() {
  const meta = streamMetaCache;
  tileBarEls.forEach((el, channel) => {
    // 削除済みチャンネル（tile:bar-removeの取りこぼし対策の後始末、二重化しておく）
    if (!currentChannels.includes(channel)) {
      el.remove();
      tileBarEls.delete(channel);
      return;
    }
    const nameEl = el.querySelector('.tile-info-bar-name');
    const titleEl = el.querySelector('.tile-info-bar-title');
    const categoryEl = el.querySelector('.tile-info-bar-category');
    const statsEl = el.querySelector('.tile-info-bar-stats');
    nameEl.textContent = channel;

    const isYoutube = currentChannelPlatforms[channel] === 'youtube';
    if (isYoutube) {
      titleEl.textContent = '';
      categoryEl.textContent = '';
      statsEl.textContent = '';
      return;
    }

    const info = meta[channel];
    if (!info) {
      titleEl.textContent = '';
      categoryEl.textContent = '';
      statsEl.textContent = '';
      return;
    }
    const compactViewers =
      info.viewerCount >= 10000
        ? `${(info.viewerCount / 10000).toFixed(1)}万`
        : info.viewerCount.toLocaleString();
    const elapsed = formatElapsedStreamTime(info.startedAt);
    titleEl.textContent = info.title || '';
    categoryEl.textContent = info.gameName || '';
    statsEl.textContent = `👁${compactViewers}${elapsed ? ` ・⏱${elapsed}` : ''}`;
  });
}

/**
 * チップの視聴者数バッジ・ツールチップを更新する。60秒間隔の定期ポーリング（下部のsetInterval）と、
 * チャンネル増減時等（refreshChips末尾）の両方から呼ばれる。直近取得から
 * STREAM_META_MIN_REFETCH_MS 未満の場合は再フェッチせずキャッシュ値をDOMへ反映するだけに留める
 * （refreshChipsの頻発呼び出しでKick BrowserViewが乱発されるのを防ぐ）。
 */
async function updateChipMetaBadges() {
  const now = Date.now();
  if (now - streamMetaLastFetchAt >= STREAM_META_MIN_REFETCH_MS) {
    streamMetaLastFetchAt = now;
    try {
      streamMetaCache = await window.api.getStreamMeta();
    } catch (_) {
      // 取得失敗時は前回のキャッシュのまま据え置く（バッジを崩さない）
    }
  }
  applyStreamMetaToChips();
  applyStreamMetaToTileBars();
}

const CHIP_META_INTERVAL_MS = 60 * 1000;
setInterval(updateChipMetaBadges, CHIP_META_INTERVAL_MS);
// 配信経過時間はリアルタイム表示の要件があるため、ネットワークアクセスを伴わないDOM再描画のみを
// 毎秒回す（取得自体は上記の60秒間隔のまま）。タイル情報帯も同じ理由で毎秒再描画する。
setInterval(applyStreamMetaToChips, 1000);
setInterval(applyStreamMetaToTileBars, 1000);

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

// #13対応: チャンネル名入力欄の履歴だけは、矢印キーでの選択(attachInputHistory)ではなく
// 入力欄の下に一覧を出すオリジナルUIに変更（各行の右に×ボタンで個別削除できる）。
// Drops自動追加/削除のゲーム名入力欄（dropsAutoGameInput）は従来通り矢印キー方式のまま。
// 汎用フローティングドロップダウン基盤（MCD大規模アプデ、2026-08-07新設）専用idと
// このモジュール内での開閉状態。closeTopmostPanelWithEscape（Escapeキー処理）から
// 参照できるよう、setupChannelNameHistoryDropdown内で実装を差し替える形にしてある
// （overlay-panel.jsのactiveEscapeCloseと同じパターン）。
const CHANNEL_HISTORY_FLOATING_ID = 'channel-history';
let closeChannelHistoryDropdown = () => {};
// 自作メニューバー（ファイル/表示/ヘルプ/バージョン/通知）の小ドロップダウン用（2026-08-07追加、
// 実機確認で配信タイルの裏に隠れる問題が発覚したためfloating-dropdown化）。setupAppMenuBar内で
// 実装を差し替える（closeChannelHistoryDropdownと同じパターン）。
let closeAppMenuDropdowns = () => {};
// 音量ミキサー用（2026-08-07、旧rectOverlayHiding方式からfloating-dropdown化に伴い追加）。
// setupVolumeMixerDropdown内で実装を差し替える（closeChannelHistoryDropdownと同じパターン）。
let closeVolumeMixerDropdown = () => {};

function setupChannelNameHistoryDropdown(inputEl, historyKey) {
  let history = [];
  // ElectronのBrowserView（配信映像・チャット埋め込み）はネイティブ合成レイヤーのため、
  // このドロップダウンをHTML/CSS側でどれだけ手前に置いても配信画面の裏に隠れてしまう。
  // 以前は「ドロップダウンの矩形と重なっているタイルだけを一時退避させる」rectOverlayShow/Hide
  // 方式を使っていたが、「配信タイルを絶対に消さない」方針への転換（2026-08-07）に伴い、
  // ドロップダウンの中身自体を専用のBrowserView（floating-dropdown、main.js側で
  // setTopBrowserViewにより最前面表示）で描画する方式に切り替えた。履歴データの取得・
  // フィルタ・永続化はこれまで通りこちら側（メインウィンドウのレンダラー）で行い、
  // floating-dropdown側には描画用の行データだけをfloatingDropdown.setContentで渡す。
  let floatOpen = false;

  async function loadHistory() {
    history = await window.api.getInputHistory(historyKey);
  }

  function currentMatches() {
    const q = inputEl.value.trim().toLowerCase();
    if (!q) return history;
    return history.filter((v) => v.toLowerCase().includes(q));
  }

  function closeDropdown() {
    if (floatOpen) {
      floatOpen = false;
      window.api.floatingDropdown.close(CHANNEL_HISTORY_FLOATING_ID);
    }
  }
  closeChannelHistoryDropdown = closeDropdown;

  // 入力欄(.channel-input-wrap)の直下に表示する矩形をビューポート基準（BrowserViewのbounds
  // 座標系と同じ）で計算する。高さは行数に応じて可変（旧CSSのmax-height:240pxを踏襲）。
  function computeRect(rowCount) {
    const wrap = inputEl.closest('.channel-input-wrap') || inputEl.parentElement;
    const rect = wrap.getBoundingClientRect();
    const ROW_HEIGHT = 31; // floating-dropdown.css .input-history-row のpadding込み実測相当
    const height = Math.min(240, Math.max(ROW_HEIGHT, rowCount * ROW_HEIGHT));
    return {
      x: rect.left,
      y: rect.bottom + 2,
      width: rect.width,
      height,
    };
  }

  function render() {
    const matches = currentMatches();
    if (!matches.length) {
      closeDropdown();
      return;
    }
    const rect = computeRect(matches.length);
    if (!floatOpen) {
      floatOpen = true;
      window.api.floatingDropdown.open(CHANNEL_HISTORY_FLOATING_ID, rect);
    } else {
      window.api.floatingDropdown.setRect(CHANNEL_HISTORY_FLOATING_ID, rect);
    }
    window.api.floatingDropdown.setContent(CHANNEL_HISTORY_FLOATING_ID, { rows: matches });
  }

  inputEl.addEventListener('focus', () => render());
  inputEl.addEventListener('input', () => render());
  // floating-dropdown側の行をクリックすると、別BrowserViewへOSレベルのフォーカスが移るため
  // inputElのblurは通常通り発火する。closeDropdown()はBrowserViewをremoveBrowserViewする
  // だけでwebContents自体は破棄しないため、この直後にfloating-dropdown側から届く
  // select/removeイベント（下記onEvent参照）は問題なく処理できる。
  inputEl.addEventListener('blur', () => closeDropdown());
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDropdown();
  });
  window.addEventListener('resize', () => {
    if (floatOpen) render();
  });
  document.getElementById('control-bar')?.addEventListener(
    'scroll',
    () => {
      if (floatOpen) render();
    },
    { passive: true }
  );

  loadHistory();

  return {
    async commit(value) {
      await window.api.addInputHistory(historyKey, value);
      await loadHistory();
    },
    // floating-dropdown側からの行選択/削除イベント処理（main.js側のIPC中継経由で届く）。
    async handleEvent(evt) {
      if (evt.type === 'select') {
        inputEl.value = evt.value;
        closeDropdown();
        inputEl.focus();
      } else if (evt.type === 'remove') {
        // ×ボタンはfloating-dropdown側（別BrowserView）でmousedownされるため、OSレベルの
        // フォーカスがそちらへ移りinputElのblurが同期的に発火し、closeDropdown()により
        // floatOpen が既にfalseになっている場合がある（select時と同じ理由）。ここで
        // if(floatOpen)のまま再描画をスキップすると「×を押すたびにドロップダウンが閉じる」
        // 挙動になり煩わしいため、まだ絞り込み結果が残っているならfloatOpenの値に関わらず
        // 必ずrender()して開き直す（render()自体がmatches空なら閉じる判定を持っている）。
        // 続けて削除操作を行えるよう、入力欄へフォーカスも戻す。
        await window.api.removeInputHistory(historyKey, evt.value);
        await loadHistory();
        render();
        inputEl.focus();
      }
    },
  };
}

const channelInputHistory = setupChannelNameHistoryDropdown(channelInput, 'channelName');
window.api.floatingDropdown.onEvent((evt) => {
  if (evt.id !== CHANNEL_HISTORY_FLOATING_ID) return;
  channelInputHistory.handleEvent(evt);
});

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

// 依頼#15: ヘッダーの単一Dropsハブボタン。Twitch/Kick Dropsページ表示中はワンクリックで
// 閉じられる旧仕様（drops-toggle-btn/kick-drops-toggle-btnが常時ヘッダーにあった挙動）を
// 保つため、表示中はハブパネルより優先してそちらを閉じる。
dropsHubBtn.addEventListener('click', async () => {
  if (dropsOpen) {
    await window.api.closeDrops();
    dropsOpen = false;
    updateDropsHubBtnLabel();
    return;
  }
  if (kickDropsOpen) {
    await window.api.closeKickDrops();
    kickDropsOpen = false;
    updateDropsHubBtnLabel();
    return;
  }
  if (!dropsHubModal.classList.contains('hidden')) {
    dropsHubCloseBtn.click();
    return;
  }
  await window.api.openSidePanel('drops-hub', 340);
  dropsHubModal.classList.remove('hidden');
  refreshDropsAutoList();
});

dropsHubCloseBtn.addEventListener('click', async () => {
  dropsHubModal.classList.add('hidden');
  await window.api.closeSidePanel('drops-hub');
});

dropsHubTwitchToggleBtn.addEventListener('click', async () => {
  if (dropsOpen) {
    await window.api.closeDrops();
    dropsOpen = false;
    dropsHubProgressResult.textContent = '';
  } else {
    await window.api.openDrops();
    dropsOpen = true;
  }
  updateDropsHubBtnLabel();
});

// 「確認操作をした時だけ」DOM読み取りを実行する（常時監視はしない設計）
dropsHubProgressBtn.addEventListener('click', async () => {
  dropsHubProgressResult.textContent = '読み取り中...';
  const result = await window.api.readDropsProgress();
  if (result.error) {
    dropsHubProgressResult.textContent = `取得失敗（非公式機能のため仕様変更の影響の可能性）: ${result.error}`;
    return;
  }
  if (!result.count) {
    dropsHubProgressResult.textContent = '進捗バーが見つかりませんでした。Dropsページの表示状態をご確認ください。';
    return;
  }
  const first = result.items[0];
  dropsHubProgressResult.textContent = `進捗: ${first.valueNow ?? '?'} / ${first.valueMax ?? '?'}（${result.count}件検出）`;
});

// KickのDrops&報酬（インベントリ）ページ。Twitch版と同様、実ページをそのまま表示するのみで
// 進捗の自動読み取りには対応しない（KickとTwitchでDOM構造が異なるため）。
dropsHubKickToggleBtn.addEventListener('click', async () => {
  if (kickDropsOpen) {
    await window.api.closeKickDrops();
    kickDropsOpen = false;
  } else {
    await window.api.openKickDrops();
    kickDropsOpen = true;
  }
  updateDropsHubBtnLabel();
});

function updateDropsHubBtnLabel() {
  if (dropsOpen) {
    dropsHubBtn.textContent = '🎁 Twitch Drops を閉じる';
  } else if (kickDropsOpen) {
    dropsHubBtn.textContent = '🎁 Kick Drops を閉じる';
  } else {
    dropsHubBtn.textContent = '🎁 Drops';
  }
  dropsHubTwitchToggleBtn.textContent = dropsOpen ? 'Twitch Dropsを閉じる（またはヘッダーの🎁から）' : 'Twitch Dropsを開く';
  dropsHubKickToggleBtn.textContent = kickDropsOpen ? 'Kick Dropsを閉じる（またはヘッダーの🎁から）' : 'Kick Dropsを開く';
  dropsHubProgressBtn.disabled = !dropsOpen;
}
updateDropsHubBtnLabel();

// 2026-08-07: 配信を消さないオーバーレイ方式（openOverlayPanel）へ移植済み。中身（タブ切替・
// 初回案内からの導線・setFirstLaunchDone呼び出し等）はoverlay-panel/overlay-panel.jsへ
// そのまま移した（見た目・挙動は変えていない）。onOpenHelp/onOpenWelcome（main.js側からの
// トリガーIPC。現状どこからも発火されていない旧経路）はそのまま残してよいため未変更。
async function openHelpModal() {
  await openOverlayPanelSafe('help');
}
window.api.onOpenHelp(openHelpModal);

async function openWelcomeModal() {
  await openOverlayPanelSafe('welcome');
}
window.api.onOpenWelcome(openWelcomeModal);

// 初回起動時のみ自動で案内ポップアップを表示。
// 注意: これはクリックイベントを起点としない呼び出しのため、あえてopenOverlayPanelSafe
// ではなくwindow.api.openOverlayPanelを直接呼ぶ（openOverlayPanelSafeが立てる
// suppressNextOutsideClickフラグは、それを消費するはずの「同じクリックのdocumentへの
// バブリング」が存在しないため立てっぱなしになり、起動後ユーザーが最初に行う外側クリックが
// 誤って無視され、ウェルカムモーダルを閉じるのに2回クリックが必要になってしまうため）。
(async () => {
  const done = await window.api.getFirstLaunchDone();
  if (!done) {
    await window.api.openOverlayPanel('welcome');
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

// ---- 会員登録（メール＋確認コード認証、決済フロー） ----
// 2026-08-08: 配信を消さないオーバーレイ方式（openOverlayPanel）へ移植済み。中身
// （ログイン・購入導線・決済関連ロジックの呼び出し）はoverlay-panel/overlay-panel.jsへ
// そのまま移した（main.js側のpro-auth:*ハンドラ・決済ロジックは一切変更していない）。
async function openProAuthModal() {
  await openOverlayPanelSafe('pro-auth');
}

// ---- フィードバック（件名・本文のみ。宛先はmumeinoapp@gmail.com固定。main.js参照） ----
// 2026-08-07: 配信を消さないオーバーレイ方式（openOverlayPanel）へ移植済み。中身
// （送信処理・エラー表示等）はoverlay-panel/overlay-panel.jsへそのまま移した
// （見た目・挙動は変えていない）。
async function openFeedbackModal() {
  await openOverlayPanelSafe('feedback');
}

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
  dropsHubBtn,
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
    chatIntegrationPanel,
    document.getElementById('layout-share-panel'),
    document.getElementById('drops-hub-modal'),
  ].forEach((el) => el.classList.add('hidden'));
  // 配信チェック（統一フィード）は2026-08-08にオーバーレイパネル基盤へ移植済み。開いていれば
  // 閉じる（パネル側BrowserViewの取り外し・自動更新タイマーの停止はメインプロセス側と
  // overlay-panel.js側で完結する）。
  await window.api.closeOverlayPanel();
  await window.api.hideChatIntegrationTab();
  disconnectIrc();
  await window.api.closeAllSidePanels();
  closeVolumeMixerDropdown();
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
      // 依頼#15でDrops自動追加/削除をPro限定の配信チェックパネルから無料の
      // Dropsハブパネルへ移設したため、追加/削除の操作自体は引き続きPro限定として明示的にガードする。
      if (!premiumUnlocked) { showPremiumLockedModal(); return; }
      dropsAutoConfig = dropsAutoConfig.filter((c) => c.gameName !== gameName);
      await window.api.setDropsAutoConfig(dropsAutoConfig);
      renderDropsAutoList();
    });
    dropsAutoList.appendChild(row);
  });
}

dropsAutoAddBtn.addEventListener('click', async () => {
  if (!premiumUnlocked) { showPremiumLockedModal(); return; }
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
// 2026-08-08: 設定UI一式（連携状態の表示・連携/解除ボタン・有効化チェック・上限枠）は
// 配信チェックパネルごとオーバーレイパネル基盤へ移植した
// （src/renderer/overlay-panel/overlay-panel.js の mountUnifiedFeed 参照）。
// メインウィンドウ側に残るのは、パネル側からは出来ない「TwitchのOAuth連携画面（アプリ内
// BrowserView）を開いている間のヘッダーロックと『連携画面を閉じる』ボタンの出し入れ」だけ。
// 開閉のきっかけは main.js が送る auto-tune-in:auth-view-opened / -closed 通知で受け取る。

const twitchAuthCloseBtn = document.getElementById('twitch-auth-close-btn');

window.api.onTwitchAuthViewOpened(() => {
  twitchAuthCloseBtn.classList.remove('hidden');
  setHeaderLockedForLogin(true);
});

window.api.onTwitchAuthViewClosed(() => {
  twitchAuthCloseBtn.classList.add('hidden');
  setHeaderLockedForLogin(false);
});

twitchAuthCloseBtn.addEventListener('click', async () => {
  await window.api.cancelTwitchAuth();
});

window.api.onAutoTuneInAuthLost(() => {
  setStatusBanner('Twitchとの連携が切れました。「📡 フィード」パネルから再連携してください（フォロー配信者の自動追加は停止しています）。');
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

// ---- プラットフォーム横断の統一フィード（配信チェック、ロードマップ項目6） ----
// 2026-08-08: パネルの中身（配信中一覧のカード表示・自動追加の対象選択・フォロー配信者の
// 自動追加設定）は、まるごと汎用オーバーレイパネル基盤へ移植した
// （src/renderer/overlay-panel/{index.html,overlay-panel.js,overlay-panel.css}）。
// 旧方式は openSidePanel('unified-feed', 340) で配信タイルの幅を縮めて隙間を空けるサイドパネル
// だったが、現在は配信タイルを一切縮めない・消さない専用BrowserViewのオーバーレイになっている。
// メインウィンドウ側に残るのはヘッダーボタンとPro機能ガードのみ。

const unifiedFeedBtn = document.getElementById('unified-feed-btn');

// 2026-08-07、方針転換によりオーバーレイパネル方式から独立BrowserWindow方式へ切替（段階A）。
// 複窓レイアウト設定と同じ考え方で、押したら「開く（既に開いていればフォーカスするだけ）」の
// 単純な導線にする。トグルクローズはウィンドウ自身の×ボタン・ESCキーが担当する
// （createStreamCheckWindow()参照）。旧overlayPanelOpenId==='unified-feed'の分岐は
// 段階Dでoverlay-panel側のunified-feedコードを撤去する際にあわせて整理する。
unifiedFeedBtn.addEventListener('click', async () => {
  if (!premiumUnlocked) { showPremiumLockedModal(); return; }
  await window.api.openStreamCheckWindow();
});

// ---- 音量ミキサー（ストリームごとの個別音量調整） ----
// チップ内にスライダーを直接置くと、Twitchネイティブの音量スライダーで実機発生したのと同様に
// チップのドラッグ&ドロップ並び替えと干渉する上、チップ列が窮屈になるため、
// ヘッダーの「🔊 音量」ボタンから開く専用パネル（Windowsの音量ミキサー風）に分離した。
//
// 2026-08-07セッションで、旧rectOverlayHiding方式（ドロップダウンと重なる配信タイルを
// 一時的にremoveBrowserViewして退避させる方式）から、チャンネル名履歴・app-menuと同じ
// floating-dropdown基盤（専用BrowserViewをsetTopBrowserViewで最前面表示、配信タイルは
// 一切removeBrowserViewしない）へ移植した。状態管理（チャンネル一覧・音量値の取得、
// ミュート解除時に戻す直前音量の記憶）は引き続きこちら側（メインウィンドウのレンダラー）で
// 行い、floating-dropdown側には描画用の行データだけをfloatingDropdown.setContentで渡す。
const VOLUME_MIXER_FLOATING_ID = 'volume-mixer';

function setupVolumeMixerDropdown(btn) {
  let floatOpen = false;
  // ミュート解除時に直前の音量へ戻すため、クライアント側でチャンネル名ごとに覚えておく
  const lastNonZeroVolumeByChannel = {};

  function closeDropdown() {
    if (floatOpen) {
      floatOpen = false;
      window.api.floatingDropdown.close(VOLUME_MIXER_FLOATING_ID);
    }
  }
  closeVolumeMixerDropdown = closeDropdown;

  // ボタン直下・右端揃えで表示する矩形をビューポート基準（BrowserViewのbounds座標系と同じ）で
  // 計算する。幅は旧CSSのwidth:190pxを踏襲、高さは行数に応じて可変（旧max-height:260pxを踏襲）。
  function computeRect(rowCount) {
    const rect = btn.getBoundingClientRect();
    const ROW_HEIGHT = 30; // floating-dropdown.css .volume-row のpadding込み実測相当
    const width = 190;
    const height = Math.min(260, Math.max(ROW_HEIGHT, rowCount * ROW_HEIGHT));
    return {
      x: Math.max(0, rect.right - width),
      y: rect.bottom + 2,
      width,
      height,
    };
  }

  async function render() {
    const [channels, volumeMap] = await Promise.all([window.api.listChannels(), window.api.getChannelVolumes()]);
    const rows = channels.map((name) => {
      const volume = name in volumeMap ? volumeMap[name] : 100;
      if (volume > 0) lastNonZeroVolumeByChannel[name] = volume;
      return { name, volume, muted: volume === 0 };
    });
    const rect = computeRect(rows.length || 1);
    if (!floatOpen) {
      floatOpen = true;
      window.api.floatingDropdown.open(VOLUME_MIXER_FLOATING_ID, rect);
    } else {
      window.api.floatingDropdown.setRect(VOLUME_MIXER_FLOATING_ID, rect);
    }
    window.api.floatingDropdown.setContent(VOLUME_MIXER_FLOATING_ID, { rows, empty: !channels.length });
  }

  // ドロップダウン形式：ボタンを押すたびに開閉をトグルする（専用の閉じるボタンは持たない）
  btn.addEventListener('click', async () => {
    if (!floatOpen) {
      await render();
    } else {
      closeDropdown();
    }
  });

  // ドロップダウンの外側をクリックしたら閉じる（一般的なドロップダウンの挙動に合わせる）。
  // floating-dropdown側は別BrowserViewのためこのdocumentのclickイベントは届かず、
  // 実質「ボタン以外の場所をクリックした」場合にのみここが呼ばれる。
  document.addEventListener('click', (e) => {
    if (!floatOpen) return;
    if (btn.contains(e.target)) return;
    closeDropdown();
  });

  return {
    isOpen: () => floatOpen,
    // チャンネル構成が変わった時（ザッピングの自動切替等）、開いていれば一覧を更新する
    refreshIfOpen: () => {
      if (floatOpen) render();
    },
    // floating-dropdown側からのミュート切替/音量変更イベント処理（main.js側のIPC中継経由で届く）。
    async handleEvent(evt) {
      if (evt.type === 'toggle-mute') {
        const name = evt.value;
        const current = (await window.api.getChannelVolumes())[name] ?? 100;
        const next = current > 0 ? 0 : lastNonZeroVolumeByChannel[name] || 100;
        await window.api.setChannelVolume(name, next);
        render();
      } else if (evt.type === 'set-volume') {
        const { name, value } = evt.value;
        if (value > 0) lastNonZeroVolumeByChannel[name] = value;
        await window.api.setChannelVolume(name, value);
        // ドラッグ中に高頻度で発火するイベントのため、ここではrender()（=setContentの
        // 再送）を呼ばない。呼ぶとfloating-dropdown側でDOMのスライダー値がサーバ側の値で
        // 上書きされ、ドラッグ中のつまみがカクつく/戻る現象が起きるため。
      }
    },
  };
}

const volumeMixer = setupVolumeMixerDropdown(volumeMixerBtn);
window.api.floatingDropdown.onEvent((evt) => {
  if (evt.id !== VOLUME_MIXER_FLOATING_ID) return;
  volumeMixer.handleEvent(evt);
});

function refreshVolumeMixerIfOpen() {
  volumeMixer.refreshIfOpen();
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
const chatIntegrationTimelineWrap = document.getElementById('chat-integration-timeline-wrap');
const chatIntegrationTimeline = document.getElementById('chat-integration-timeline');
const chatIntegrationJumpBottomBtn = document.getElementById('chat-integration-jump-bottom-btn');
const chatIntegrationSendRow = document.getElementById('chat-integration-send-row');
const chatIntegrationSendInput = document.getElementById('chat-integration-send-input');
const chatIntegrationSendBtn = document.getElementById('chat-integration-send-btn');

let chatIntegrationMode = 'tab'; // 'tab' | 'timeline'
let chatIntegrationSelectedChannel = null;
// #7対応: { [channelName]: true } チャット統合パネル（主に全タブ統合＝timelineモード）の表示対象から
// 除外中のチャンネル。renderChatIntegrationTabs()のたびにmain process側の永続化値で更新する。
let chatIntegrationHiddenMap = {};

/**
 * @param {string} mode 'tab' | 'timeline'
 * @param {boolean} [persist=true] falseを渡すと保存済み設定の復元時などstore書き込みを省略する
 *   （起動直後の復元処理で、読み込んだ直後の値をそのまま書き戻す無駄なIPCを避けるため）
 */
function setChatIntegrationMode(mode, persist = true) {
  chatIntegrationMode = mode;
  chatIntegrationModeTabBtn.classList.toggle('active', mode === 'tab');
  chatIntegrationModeTimelineBtn.classList.toggle('active', mode === 'timeline');
  chatIntegrationTabs.classList.toggle('timeline-mode', mode === 'timeline');
  chatIntegrationTimelineWrap.classList.toggle('hidden', mode !== 'timeline');
  chatIntegrationSendRow.classList.toggle('hidden', mode !== 'timeline');
  // タブモードから戻ってきた際、実際のスクロール位置と無関係にボタンが表示されたまま
  // 残ることがあるため、timelineモードに入るたびに現在位置で判定し直す。
  if (mode === 'timeline') {
    chatIntegrationJumpBottomBtn.classList.toggle('hidden', isChatTimelineNearBottom());
  }
  // #8対応: 再起動後も選択中のモードを維持できるよう永続化する。
  if (persist) window.api.setAllSettings({ chatIntegrationMode: mode });
}

/**
 * タイムラインが最下部（＝最新のチャット表示位置）付近にあるかどうかを判定するための閾値(px)。
 * この範囲内であれば「最下部にいる」とみなし、範囲外なら少しでも上にスクロールしている
 * とみなして「↓ 最新へ」ボタンを表示する。
 */
const CHAT_TIMELINE_BOTTOM_THRESHOLD = 16;

function isChatTimelineNearBottom() {
  return (
    chatIntegrationTimeline.scrollHeight -
      chatIntegrationTimeline.scrollTop -
      chatIntegrationTimeline.clientHeight <
    CHAT_TIMELINE_BOTTOM_THRESHOLD
  );
}

/** タイムラインを最下部（最新のチャット表示位置）まで即座にスクロールし、ジャンプボタンを隠す */
function scrollChatTimelineToBottom() {
  chatIntegrationTimeline.scrollTop = chatIntegrationTimeline.scrollHeight;
  chatIntegrationJumpBottomBtn.classList.add('hidden');
}

// スクロール位置が一番下ではなく少しでも上になっている場合は「↓ 最新へ」ボタンを表示し、
// クリックひとつで最新のチャット表示位置（一番下）まで戻れるようにする。
chatIntegrationTimeline.addEventListener('scroll', () => {
  chatIntegrationJumpBottomBtn.classList.toggle('hidden', isChatTimelineNearBottom());
});
chatIntegrationJumpBottomBtn.addEventListener('click', scrollChatTimelineToBottom);

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
  const [channels, hiddenMap] = await Promise.all([
    window.api.listChannels(),
    window.api.getChatIntegrationHiddenMap(),
  ]);
  chatIntegrationHiddenMap = hiddenMap || {};
  chatIntegrationTabs.innerHTML = '';
  channels.forEach((name) => {
    const hidden = !!chatIntegrationHiddenMap[name];
    const tab = document.createElement('div');
    tab.className = 'chat-tab' + (name === chatIntegrationSelectedChannel ? ' active' : '');
    tab.dataset.name = name;
    tab.innerHTML = `
      <span class="chat-tab-name">${escapeHtml(name)}</span>
      <span class="chat-tab-toggle${hidden ? ' active' : ''}" data-name="${escapeHtml(name)}" title="全タブ統合（時系列）での、このチャンネルの発言表示を切り替え">${hidden ? '🔇' : '💬'}</span>
    `;
    tab.addEventListener('click', () => selectChatIntegrationTab(name));
    chatIntegrationTabs.appendChild(tab);
  });
  // #7対応: タブ名の横のトグルだけはタブ選択（selectChatIntegrationTab）を発火させたくないため、
  // クリックイベントの伝播をここで止めてから個別に処理する。
  chatIntegrationTabs.querySelectorAll('.chat-tab-toggle').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = el.dataset.name;
      const nowHidden = !el.classList.contains('active');
      await window.api.setChatIntegrationHidden(name, nowHidden);
      if (nowHidden) {
        chatIntegrationHiddenMap[name] = true;
      } else {
        delete chatIntegrationHiddenMap[name];
      }
      el.classList.toggle('active', nowHidden);
      el.textContent = nowHidden ? '🔇' : '💬';
    });
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
  chatIntegrationJumpBottomBtn.classList.add('hidden');
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
  return { channel, username, message, color, emotesTag, platform: 'twitch' };
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
/**
 * チャット本文中のTwitchクリップURL（clips.twitch.tv/xxx、または twitch.tv/チャンネル名/clip/xxx）
 * を検出する。以前はURLがそのまま文字列で表示されるだけだったが、Twitch本家同様にサムネ付きの
 * カード表示にしてクリックで開けるようにするための下準備。
 * マッチ位置（index）はJS文字列のUTF-16コードユニット単位。呼び出し側でTwitch用のUTF-8バイト
 * オフセットに変換するか、Kick/その他用にそのまま文字インデックスとして使うかを選ぶ。
 */
const CLIP_URL_PATTERN =
  /https?:\/\/(?:clips\.twitch\.tv\/([A-Za-z0-9_-]+)|(?:www\.|m\.)?twitch\.tv\/[A-Za-z0-9_]+\/clip\/([A-Za-z0-9_-]+))(?:\?\S*)?/g;

function extractClipUrlRanges(message) {
  if (!message) return [];
  const matches = [];
  CLIP_URL_PATTERN.lastIndex = 0;
  let m;
  while ((m = CLIP_URL_PATTERN.exec(message)) !== null) {
    const slug = m[1] || m[2];
    if (slug) {
      matches.push({ type: 'clip', charStart: m.index, charEnd: m.index + m[0].length, url: m[0], slug });
    }
  }
  return matches;
}

/** サムネ未取得時点でも表示できる、クリップカードの初期HTML（🎬アイコン＋「クリップを見る」）を返す */
function buildClipCardHtml(url, slug) {
  return (
    `<span class="chat-clip-card" data-clip-url="${escapeHtml(url)}" data-clip-slug="${escapeHtml(
      slug
    )}" title="${escapeHtml(url)}">` +
    `<span class="chat-clip-thumb-wrap"><span class="chat-clip-thumb-placeholder">🎬</span></span>` +
    `<span class="chat-clip-label">クリップを見る</span></span>`
  );
}

/**
 * Twitch IRCのemotesタグ（例: "25:0-4,12-16/1902:6-10"）とクリップURLを解析し、対象範囲を
 * スタンプ画像<img>／クリップカードに置き換えたHTMLを返す。
 * どちらの対象も無い場合は通常のエスケープ済みテキストにフォールバックする。
 * emotesタグの範囲指定はUTF-8バイトオフセットのため、TextEncoder/Decoderでバイト単位に処理する。
 * クリップURLはJS文字列（UTF-16）のインデックスで見つかるため、バイトオフセットに変換してから
 * emoteの範囲と同じ配列にまとめ、位置順にソートして「生成済みHTML文字列への後付け置換」を一切
 * 行わずに1回のパスで組み立てる（HTML構造・属性値をまたいだ誤置換を避けるため）。
 * 絵文字・日本語等のマルチバイト文字を含むメッセージで稀に範囲がずれることがあり、
 * その場合は文字の途中でバイト列を切ってしまい文字化け（U+FFFD）が発生するため、
 * 範囲の開始・終了が文字境界と一致しないものは安全側に倒して個別にスキップする
 * （メッセージ全体はフォールバックさせず、そのスタンプ1個だけテキスト表示に留める）。
 */
function buildEmoteAwareMessageHtml(message, emotesTag) {
  if (!message) return '';
  try {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const bytes = encoder.encode(message);
    const ranges = [];
    if (emotesTag) {
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
          ranges.push({ type: 'emote', start, end, id });
        });
      });
    }
    // クリップURLの文字インデックス（UTF-16）をUTF-8バイトオフセットに変換して同じ配列に統合
    extractClipUrlRanges(message).forEach((c) => {
      const start = encoder.encode(message.slice(0, c.charStart)).length;
      const end = encoder.encode(message.slice(0, c.charEnd)).length - 1;
      if (end < start || end >= bytes.length) return;
      ranges.push({ type: 'clip', start, end, url: c.url, slug: c.slug });
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
      if (r.type === 'clip') {
        html += buildClipCardHtml(r.url, r.slug);
      } else {
        const emoteText = decoder.decode(bytes.slice(r.start, r.end + 1));
        const src = `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(r.id)}/default/dark/1.0`;
        // CDN側にその解像度/テーマの画像が無い等で読み込みに失敗した場合、ブロークン
        // イメージのアイコン＋altテキストが表示されてしまい文字化けのように見えるため、
        // 失敗時はプレーンテキストのノードに置き換えて自然に読める状態にフォールバックする。
        html += `<img class="chat-emote" src="${src}" alt="${escapeHtml(emoteText)}" title="${escapeHtml(
          emoteText
        )}" onerror="this.replaceWith(document.createTextNode(this.alt));this.onerror=null;">`;
      }
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

/**
 * Kickのチャット本文中のインラインスタンプ記法（例: "[emote:12345:PogChamp]"）とクリップURLを
 * 解析し、対象範囲をスタンプ画像<img>／クリップカードに置き換えたHTMLを返す。Kick側はTwitchの
 * ようなバイトオフセットのタグではなく、本文自体にこの記法が埋め込まれてくるため、JS文字列の
 * インデックスのままemote範囲・クリップ範囲を統合し、位置順に1回のパスで組み立てる
 * （Twitch用と同様、生成済みHTML文字列への後付け置換は行わない）。
 * どの記法にも一致しない部分（あるいは記法自体が無い場合）は通常のエスケープ済みテキストにする。
 */
function buildKickEmoteAwareMessageHtml(message) {
  if (!message) return '';
  try {
    const ranges = [];
    const emotePattern = /\[emote:(\d+):([^\]]*)\]/g;
    let match;
    while ((match = emotePattern.exec(message)) !== null) {
      ranges.push({
        type: 'emote',
        start: match.index,
        end: emotePattern.lastIndex - 1,
        id: match[1],
        name: match[2],
      });
    }
    extractClipUrlRanges(message).forEach((c) => {
      ranges.push({ type: 'clip', start: c.charStart, end: c.charEnd - 1, url: c.url, slug: c.slug });
    });
    if (ranges.length === 0) return escapeHtml(message);
    ranges.sort((a, b) => a.start - b.start);

    let html = '';
    let cursor = 0;
    ranges.forEach((r) => {
      if (r.start < cursor) return; // 重複/不正な範囲はスキップ
      if (r.start > cursor) {
        html += escapeHtml(message.slice(cursor, r.start));
      }
      if (r.type === 'clip') {
        html += buildClipCardHtml(r.url, r.slug);
      } else {
        const src = `https://files.kick.com/emotes/${encodeURIComponent(r.id)}/fullsize`;
        const label = r.name || r.id;
        html += `<img class="chat-emote" src="${src}" alt="${escapeHtml(label)}" title="${escapeHtml(
          label
        )}" onerror="this.replaceWith(document.createTextNode(this.alt));this.onerror=null;">`;
      }
      cursor = r.end + 1;
    });
    if (cursor < message.length) {
      html += escapeHtml(message.slice(cursor));
    }
    return html;
  } catch (_) {
    return escapeHtml(message);
  }
}

/** クリップカードのサムネ画像・タイトルを非同期取得して差し込む（未設定/取得失敗時は🎬アイコンのまま） */
function hydrateClipCards(line) {
  line.querySelectorAll('.chat-clip-card').forEach((card) => {
    const slug = card.dataset.clipSlug;
    if (!slug) return;
    window.api
      .fetchClipInfo(slug)
      .then((info) => {
        if (!info) return;
        // 差し込むまでの間にタイムラインの行数上限（CHAT_TIMELINE_MAX_LINES）超過で
        // このカードごと削除されている可能性があるため、DOM上にまだ存在するか確認してから触る。
        if (!card.isConnected) return;
        if (info.thumbnailUrl) {
          const thumbWrap = card.querySelector('.chat-clip-thumb-wrap');
          if (thumbWrap) {
            // Helixのサムネ幅・高さプレースホルダー（%{width}x%{height}）を実サイズに差し替える
            const src = info.thumbnailUrl.replace('%{width}', '160').replace('%{height}', '90');
            thumbWrap.innerHTML = `<img class="chat-clip-thumb" src="${escapeHtml(
              src
            )}" alt="${escapeHtml(info.title || 'クリップ')}" onerror="this.remove();">`;
          }
        }
        if (info.title) {
          const label = card.querySelector('.chat-clip-label');
          if (label) label.textContent = info.broadcasterName ? `${info.title}（${info.broadcasterName}）` : info.title;
        }
      })
      .catch(() => {
        /* Helix未設定・取得失敗時は🎬アイコンのままにしておく（実害なし） */
      });
  });
}

const CHAT_TIMELINE_MAX_LINES = 300;

/**
 * #7対応: チャット統合パネル（全タブ統合＝timelineモード）の表示対象からチャンネルが
 * 除外されているかどうかを判定する。IRC/YouTube/Kickいずれも発言のchannel名の大文字小文字が
 * 登録名と厳密に一致するとは限らないため、小文字化して比較する。
 */
function isChannelHiddenFromChatIntegration(channel) {
  if (!channel) return false;
  const lower = channel.toLowerCase();
  return Object.keys(chatIntegrationHiddenMap).some((name) => name.toLowerCase() === lower);
}

function appendTimelineMessage({ channel, username, message, color, emotesTag, platform }) {
  if (isChannelHiddenFromChatIntegration(channel)) return;
  // 追加前の時点でのスクロール位置を見て、最下部付近にいたかどうかを判定する
  // （最下部にいた場合のみ新着メッセージに追従し、少しでも上にスクロールして過去ログを
  // 読んでいる場合は追従させず「↓ 最新へ」ボタン側に誘導する）。
  const wasNearBottom = isChatTimelineNearBottom();
  const line = document.createElement('div');
  line.className = 'chat-line';
  const messageHtml =
    platform === 'kick' ? buildKickEmoteAwareMessageHtml(message) : buildEmoteAwareMessageHtml(message, emotesTag);
  line.innerHTML = `<span class="chat-channel">[${escapeHtml(channel)}]</span><span class="chat-user" style="color:${
    color || '#9147ff'
  }">${escapeHtml(username)}</span>: <span class="chat-message-text">${messageHtml}</span>`;
  chatIntegrationTimeline.appendChild(line);
  hydrateClipCards(line);
  while (chatIntegrationTimeline.children.length > CHAT_TIMELINE_MAX_LINES) {
    chatIntegrationTimeline.removeChild(chatIntegrationTimeline.firstChild);
  }
  if (wasNearBottom) {
    chatIntegrationTimeline.scrollTop = chatIntegrationTimeline.scrollHeight;
  } else {
    chatIntegrationJumpBottomBtn.classList.remove('hidden');
  }
}

// クリップカードのクリックで、検証済みのURLだけをOS既定ブラウザで開く（メインプロセス側の
// clips:open-externalでもホスト名を再検証しているため、ここは主にUXのための一次判定）。
chatIntegrationTimeline.addEventListener('click', (event) => {
  const card = event.target.closest('.chat-clip-card');
  if (!card) return;
  const url = card.dataset.clipUrl;
  if (url) window.api.openClipExternal(url);
});

// YouTube側は裏読み込み（youtubeChatScraperPreload.js）で拾ったメッセージがメインプロセス経由で届く。
// Twitchのcolorタグに相当するものが無いため、YouTube発言と分かるよう固定色（赤系）にしている。
window.api.onYoutubeChatMessage(({ channel, username, message }) => {
  appendTimelineMessage({ channel, username, message, color: '#ff4d4d', platform: 'youtube' });
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
  appendTimelineMessage({ channel, username, message, color, platform: 'kick' });
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
  // 'unified-feed'（配信チェック）は2026-08-08にオーバーレイパネル基盤へ移植したため、
  // openSidePanel系のスタック管理対象からは外れている。
  'drops-hub': dropsHubModal,
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

// 汎用オーバーレイパネル基盤（#16向け、2026-08-07新設）。openSidePanel系のSIDE_PANEL_ELEMENTSとは
// 独立して、現在開いているオーバーレイパネルのIDだけをrenderer側にも同期しておく
// （ESCキー優先順位判定用。第1段階ではまだ実際に開くボタンは無いが、次回以降ここに乗るパネルの
// ためのESC対応を先に用意しておく）。
let overlayPanelOpenId = null;
window.api.onOverlayPanelChanged(({ openId }) => {
  overlayPanelOpenId = openId;
});

// centered化（2026-08-07、help/welcome/premium-locked/feedback）に伴い、外側クリックで
// 閉じられるようにする。仕組みはvolume-mixer等のfloating-dropdownと同じ：これらのモーダルは
// 専用BrowserViewとしてカードサイズぶんだけ最前面に表示されるため、その内部でのクリックは
// このメインウィンドウのdocumentには届かない。よってdocument側でclickを検知できた時点で
// 「モーダルの外側（＝配信タイルやメインウィンドウのUI）をクリックした」と判定できる。
// なお、モーダルを開くボタン自体のクリックはこのイベントと同じclickだが、
// openOverlayPanel→IPC往復→onOverlayPanelChangedの反映は非同期のため、このリスナーが
// 同期的に評価される時点ではoverlayPanelOpenIdはまだ更新されておらず、開いた直後に
// 誤って閉じてしまうことはない。
// 配信チェック等のドッキング型パネルは、旧サイドパネル方式と同じく「閉じるボタン/Escape/
// ヘッダーボタンの再クリックでのみ閉じる」挙動を維持する（画面右端に常駐させたまま、ヘッダーの
// 他ボタンを操作できるようにするため）。外側クリックで閉じるのはcentered系モーダルのみ。
const OVERLAY_PANEL_DOCKED_IDS = new Set(['unified-feed']);

document.addEventListener('click', () => {
  if (suppressNextOutsideClick) {
    // 別のオーバーレイパネルを開くボタン自身のクリックだった場合はここで消費するだけで、
    // 閉じる処理は行わない（openOverlayPanelSafe側のコメント参照）。
    suppressNextOutsideClick = false;
    return;
  }
  if (!overlayPanelOpenId) return;
  if (OVERLAY_PANEL_DOCKED_IDS.has(overlayPanelOpenId)) return;
  window.api.closeOverlayPanel();
});

function setStatusBanner(text) {
  dropsProgressResult.textContent = text;
  // #status-indicatorは高さ固定で折り返せないため、長文は末尾が省略表示になる。
  // title属性にも全文を入れておき、hoverで全文を確認できるようにする。
  dropsProgressResult.title = text;
  // 中身が空の間は#status-indicatorの幅を0に畳んでmenu-bar行の場所を取らないようにする
  // （2026-08-07: 旧#status-barの全幅固定表示からmenu-bar行右端への統合に伴う変更）。
  statusIndicator.classList.toggle('has-text', !!text);
}

// ---- ESCキーで各パネル/モーダルを閉じる ----
// 開いている可能性のあるパネルを優先度順にチェックし、最初に見つかったものだけを閉じる
// （通常は同時に1つしか開かない設計だが、念のため順序を決めておく）。
// 各パネル既存の「閉じる」ボタンをクリックしたのと同じ状態に揃えたいので、実際にボタンをクリックする。
function closeTopmostPanelWithEscape() {
  // TwitchのOAuth連携画面は、配信チェックパネル（オーバーレイパネル）より後にaddBrowserViewされる
  // ぶん常に前面かつ全面を覆う。よってオーバーレイパネルより先に判定し、Escapeでは連携のキャンセルを
  // 優先する（先にパネルを閉じてしまうと、連携結果を待っているパネル側のJSごと破棄されてしまう）。
  if (!twitchAuthCloseBtn.classList.contains('hidden')) {
    twitchAuthCloseBtn.click();
    return;
  }
  // 汎用オーバーレイパネル（#16向け）はBrowserView最前面表示のため、開いていれば最優先で閉じる。
  if (overlayPanelOpenId) {
    window.api.closeOverlayPanel();
    return;
  }
  // チャンネル名履歴ドロップダウン（floating-dropdown）。inputEl自体にフォーカスがある間は
  // inputEl側のkeydownリスナーで閉じるが、floating-dropdown側のBrowserViewへフォーカスが
  // 移っている場合はforwardEscapeKey経由でこちらに届く。
  closeChannelHistoryDropdown();
  // 自作メニューバーの小ドロップダウン（floating-dropdown、2026-08-07追加）。同上の理由。
  closeAppMenuDropdowns();
  // 音量ミキサー（floating-dropdown、2026-08-07追加）。同上の理由。
  closeVolumeMixerDropdown();
  if (!accountLoginCloseBtn.classList.contains('hidden')) {
    accountLoginCloseBtn.click();
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
  if (!dropsHubModal.classList.contains('hidden')) {
    dropsHubCloseBtn.click();
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
  // 音量ミキサーは2026-08-07にfloating-dropdown化済みのため、この関数の先頭にある
  // closeVolumeMixerDropdown()呼び出しで既にカバーされている。
  // help/welcome/premium-locked/feedback/pro-authは配信を消さないオーバーレイ方式
  // （openOverlayPanel、pro-authは2026-08-08移植）へ移植済みのため、この関数の先頭にある
  // overlayPanelOpenIdチェックで既にカバーされている（DOM自体をindex.htmlから削除したため、
  // ここでの参照も削除した）。
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
  // #8対応: 全タブ統合チャットの表示モードを、保存済みの値から復元する
  // （persist=falseで、読み込んだ値をそのまま書き戻す無駄なIPCを避ける）。
  // 「時系列統合」モードはPro限定機能（chatIntegrationModeTimelineBtnのクリックハンドラでのみ
  // premiumUnlockedを判定してガードしている）。保存時はProだったが、その後Pro状態が失効した
  // ユーザーがいた場合に、このガードを経由せず'timeline'を復元してしまわないよう、ここでも
  // 独立してPro状態を確認する（起動時のトップレベルIIFEで更新中のpremiumUnlocked変数は
  // このタイミングで確定している保証がないため、直接IPCで取り直す）。
  const [s, isPremium] = await Promise.all([window.api.getAllSettings(), window.api.getPremiumUnlocked()]);
  const restoredChatMode = s.chatIntegrationMode === 'timeline' && isPremium ? 'timeline' : 'tab';
  setChatIntegrationMode(restoredChatMode, false);
  // 統一フィードの絞り込みの復元は、パネル自体がオーバーレイパネル側へ移った2026-08-08以降、
  // パネルを開いたタイミングでoverlay-panel.js側が行う（#8対応の永続化先のstoreキーは同じ）。
})();

// ---- 自作メニューバー（ファイル/表示/ヘルプ/バージョン） ----
// ネイティブのMenuを廃止し、開閉・見た目・「バージョン」の動的な中身をすべてここで描画する。
// 実処理（終了・再読み込み・アップデート確認など）はmain.js側のapp-menu:*ハンドラに委譲する
// （window.api.appMenu、preload.js参照）。
(function setupAppMenuBar() {
  const appMenuBar = document.getElementById('app-menu-bar');
  const versionMenuItem = appMenuBar.querySelector('.menu-bar-item[data-menu="version"]');
  const versionMenuDropdown = document.getElementById('version-menu-dropdown');
  // #6対応: 通知タブ（配信開始通知）
  const notificationsMenuItem = appMenuBar.querySelector('.menu-bar-item[data-menu="notifications"]');
  const notificationsMenuDropdown = document.getElementById('notifications-menu-dropdown');

  let latestState = null;

  // 2026-08-07追加: 実機確認で「ファイル/表示/ヘルプ/バージョン/通知の小ドロップダウンが
  // 配信タイル(BrowserView)の裏に隠れる」問題が発覚したため、floating-dropdown基盤（'app-menu'
  // パネル）へ移植した。既存の.menu-bar-dropdown DOM自体は削除せず残してある（見た目としては
  // 配信タイルの裏に隠れたままだが、getBoundingClientRect()によるサイズ・位置計算と
  // 中身のデータソースとして引き続き利用する）。ユーザーに実際に見える・クリックされるのは
  // floating-dropdown側のBrowserViewコピーの方。
  let appMenuFloatOpen = false;

  /** .menu-bar-dropdown のDOM子要素を、floating-dropdown側へ渡す行データに変換する。 */
  function domDropdownToRows(dropdownEl) {
    return Array.from(dropdownEl.children).map((el) => {
      if (el.classList.contains('menu-bar-dropdown-separator')) return { type: 'separator' };
      if (el.classList.contains('disabled')) return { type: 'disabled', label: el.textContent };
      return { type: 'action', label: el.textContent, action: el.dataset.action, url: el.dataset.url };
    });
  }

  /** 指定itemの.menu-bar-dropdownの現在の位置・サイズ・中身をfloating-dropdown側へ反映する。 */
  function syncFloatingAppMenu(item) {
    const dropdownEl = item.querySelector('.menu-bar-dropdown');
    if (!dropdownEl) return; // フィードバック/会員登録はドロップダウンを持たない単独項目
    const rect = dropdownEl.getBoundingClientRect();
    const floatRect = { x: rect.left, y: rect.top, width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
    if (!appMenuFloatOpen) {
      appMenuFloatOpen = true;
      window.api.floatingDropdown.open('app-menu', floatRect);
    } else {
      window.api.floatingDropdown.setRect('app-menu', floatRect);
    }
    window.api.floatingDropdown.setContent('app-menu', {
      rows: domDropdownToRows(dropdownEl),
      wrap: item === notificationsMenuItem,
    });
  }

  function closeFloatingAppMenu() {
    if (!appMenuFloatOpen) return;
    appMenuFloatOpen = false;
    window.api.floatingDropdown.close('app-menu');
  }

  function closeAllMenuBarDropdowns() {
    appMenuBar.querySelectorAll('.menu-bar-item.open').forEach((el) => el.classList.remove('open'));
    closeFloatingAppMenu();
  }
  // closeTopmostPanelWithEscape（forwardEscapeKey経由。floating-dropdown側のBrowserViewへ
  // フォーカスが移っている状態でのEscapeもここを通る）からも、.menu-bar-item.openクラスの
  // 除去まで含めて完全に閉じられるよう、closeFloatingAppMenuではなくcloseAllMenuBarDropdowns
  // 相当を割り当てる（レビュー指摘: closeFloatingAppMenuだけだとopenクラスが残留し、
  // ラベルの誤ハイライトや次回状態更新時の意図しない再オープンにつながる懸念があったため）。
  closeAppMenuDropdowns = closeAllMenuBarDropdowns;

  /**
   * data-action付きの各項目（静的なfile/view/help内の項目、フィードバック/会員登録の単独項目、
   * 動的なバージョン項目）で共通のアクション実行ロジック。旧実装ではappMenuBarのクリック
   * ハンドラ内に直書きのswitch文としてあったが、floating-dropdown側からのIPCイベント
   * （実際にユーザーがクリックするのはこちら）でも同じ分岐が必要になったため関数化した。
   */
  async function dispatchMenuAction(action, url) {
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
      // 複窓レイアウト設定（2026-08-08新設）。既存のオーバーレイパネル方式とは別系統の
      // 独立したBrowserWindowをmain.js側で開く。
      case 'open-layout-window':
        await window.api.openLayoutWindow();
        break;
      case 'open-help':
        openHelpModal();
        break;
      case 'open-welcome':
        openWelcomeModal();
        break;
      case 'open-external':
        await window.api.appMenu.openExternal(url);
        break;
      case 'open-pro-auth':
        openProAuthModal();
        break;
      case 'open-feedback':
        openFeedbackModal();
        break;
      case 'download-update':
        await window.api.appMenu.downloadUpdate();
        break;
      case 'install-update':
        await window.api.appMenu.installUpdate(true);
        break;
      case 'check-update':
        await window.api.appMenu.checkUpdate();
        break;
    }
  }

  /** disabledなクリックできない項目（現在の状態表示だけの行）を1つ作る。 */
  function makeDisabledItem(label) {
    const el = document.createElement('div');
    el.className = 'menu-bar-dropdown-item disabled';
    el.textContent = label;
    return el;
  }

  /**
   * クリックできる項目を1つ作る。actionIdはdispatchMenuActionが解釈できる識別子
   * （'download-update'等）。data-actionとして持たせることで、floating側から
   * domDropdownToRows経由でも同じactionIdを拾える（＝実際にクリックされるのは
   * floating側のコピーだが、こちら（隠れているDOM本体）にも同じ情報を持たせておく必要がある）。
   */
  function makeActionItem(label, actionId) {
    const el = document.createElement('div');
    el.className = 'menu-bar-dropdown-item';
    el.textContent = label;
    el.dataset.action = actionId;
    el.addEventListener('click', (e) => {
      // data-action属性を持つため、通常はこのリスナーではなくappMenuBar側の
      // [data-action]委譲ハンドラで処理される。ここでのリスナーは、万一この隠れたDOMが
      // 直接クリックされるケース（開発者ツール等での操作）向けの保険として残している。
      e.stopPropagation();
      closeAllMenuBarDropdowns();
      dispatchMenuAction(actionId);
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
        versionMenuDropdown.appendChild(makeActionItem('ダウンロードする', 'download-update'));
        break;
      case 'downloading':
        versionMenuDropdown.appendChild(makeDisabledItem(`ダウンロード中… ${updater.percent}%`));
        break;
      case 'downloaded':
        versionMenuDropdown.appendChild(makeDisabledItem(`バージョン ${updater.version} の準備ができました`));
        // 「PC自体を再起動する」と誤解されやすいという指摘を受け、「アプリの再起動」であることが
        // わかるよう文言に(アプリ)を明記。選択肢も1つに戻す（forceRunAfter=trueで常にアプリを
        // 自動再起動する。インストーラーの終了選択に委ねる「今すぐ更新」単独ボタンは削除した）。
        versionMenuDropdown.appendChild(makeActionItem('今すぐ更新して再起動(アプリ)', 'install-update'));
        break;
      case 'not-available':
        versionMenuDropdown.appendChild(makeDisabledItem('最新の状態です'));
        versionMenuDropdown.appendChild(makeActionItem('アップデートを確認', 'check-update'));
        break;
      case 'error':
        versionMenuDropdown.appendChild(makeDisabledItem('確認できませんでした'));
        versionMenuDropdown.appendChild(makeActionItem('アップデートを確認', 'check-update'));
        break;
      default:
        versionMenuDropdown.appendChild(makeActionItem('アップデートを確認', 'check-update'));
    }
  }

  /** state-changed通知・初回取得の両方で呼ぶ。バッジ表示、動的ラベル、バージョン中身を更新する。 */
  function renderAppMenuState(state) {
    latestState = state;
    versionMenuItem.classList.toggle('has-update-badge', !!state.hasUpdateBadge);
    renderVersionDropdown(state);
    // 開いている最中に状態が変化した場合（アップデート確認中→見つかった等）、floating側の
    // 表示中コピーも追従させる。
    if (versionMenuItem.classList.contains('open')) syncFloatingAppMenu(versionMenuItem);
  }

  /** #6対応: 配信開始通知1件のプラットフォーム表示名（通知対象はTwitch/Kickのみ）。 */
  function notificationPlatformLabel(platform) {
    return platform === 'kick' ? 'Kick' : 'Twitch';
  }

  /** 「通知」ドロップダウンの中身を新しい順に描画する。 */
  function renderNotificationsDropdown(state) {
    notificationsMenuDropdown.innerHTML = '';
    const items = (state.items || []).slice(-20).reverse();
    if (!items.length) {
      notificationsMenuDropdown.appendChild(makeDisabledItem('通知はまだありません'));
      return;
    }
    items.forEach((n) => {
      const time = new Date(n.detectedAt).toLocaleString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const label = `🔴 ${n.channel}（${notificationPlatformLabel(n.platform)}）配信開始 ${time}`;
      notificationsMenuDropdown.appendChild(makeDisabledItem(label));
    });
  }

  /** state-changed通知・初回取得の両方で呼ぶ。バッジ表示・一覧の中身を更新する。 */
  function renderNotificationsState(state) {
    notificationsMenuItem.classList.toggle('has-update-badge', !!state.hasUnread);
    renderNotificationsDropdown(state);
    // 開いている最中に新着通知が届いた場合、floating側の表示中コピーも追従させる。
    if (notificationsMenuItem.classList.contains('open')) syncFloatingAppMenu(notificationsMenuItem);
  }

  appMenuBar.addEventListener('click', async (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      closeAllMenuBarDropdowns();
      await dispatchMenuAction(actionEl.dataset.action, actionEl.dataset.url);
      return;
    }
    const item = e.target.closest('.menu-bar-item');
    if (!item) return;
    const wasOpen = item.classList.contains('open');
    closeAllMenuBarDropdowns();
    if (!wasOpen) {
      item.classList.add('open');
      syncFloatingAppMenu(item);
      // #6対応: 通知タブを開いた＝内容を確認したとみなし、赤丸バッジを消す（既読化）。
      if (item === notificationsMenuItem) window.api.markNotificationsRead();
    }
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
        syncFloatingAppMenu(item);
        // #6対応: ホバーでの切り替えで通知タブが開いた場合も既読化する（クリック時と同様）。
        if (item === notificationsMenuItem) window.api.markNotificationsRead();
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#app-menu-bar')) closeAllMenuBarDropdowns();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllMenuBarDropdowns();
  });

  // floating-dropdown側（実際にユーザーがクリックする側）からの行クリックをこちらへ中継。
  window.api.floatingDropdown.onEvent(async (evt) => {
    if (evt.id !== 'app-menu' || evt.type !== 'action') return;
    closeAllMenuBarDropdowns();
    await dispatchMenuAction(evt.value?.action, evt.value?.url);
  });

  window.api.appMenu.onStateChanged((state) => renderAppMenuState(state));
  (async () => {
    const state = await window.api.appMenu.getState();
    renderAppMenuState(state);
  })();

  // #6対応: 通知タブ。配信開始検知はmain.js側でchannels:get-stream-metaのポーリング
  // （updateChipMetaBadges、CHIP_META_INTERVAL_MS=60秒間隔）のたびに行われ、新規通知が
  // あればnotifications:state-changedがpushされる。ここでは初回状態の取得と購読のみ行う。
  window.api.onNotificationsStateChanged((state) => renderNotificationsState(state));
  (async () => {
    const state = await window.api.getNotificationsState();
    renderNotificationsState(state);
  })();
})();
