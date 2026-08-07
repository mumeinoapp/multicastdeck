'use strict';

// 配信チェックウィンドウ（2026-08-07新設、段階A）の描画ロジック。2026-08-08段階Bで
// カード一覧・プラットフォーム絞り込み・自動更新を実装した。
//
// 移植元: overlay-panel.js の mountUnifiedFeed()（プラットフォーム絞り込み・自動更新
// タイマー・＋追加ボタン・カード骨格）と、layout-window.js の buildCard()（アバター・
// タイトル・カテゴリ・経過時間の表示、XSS対策としてtextContentのみでDOM構築する方針）を
// 組み合わせて再構成したもの。
//
// 段階Bのスコープ外（今回は実装しない、段階C以降で対応）:
// - 「自動追加の対象にする」チェックボックス（Auto Tune-In対象指定）
// - 「常に表示（ピン留め）」チェックボックス（YouTube専用）
// - 「自動追加の対象を選ぶ（全フォロー/登録一覧）」「フォロー配信者の自動追加」の各セクション
// これらの受け皿が無い段階Bでは、ピン留め済みでオフラインのチャンネルは「OFFLINE」表示のカードとして
// 出すだけに留める（ピン設定自体の変更はできない）。旧overlay-panel側のmountUnifiedFeed()は
// これらの機能を提供し続けるため、段階Dで撤去するまでそのまま残す。

const UNIFIED_FEED_AUTO_REFRESH_MS = 20 * 1000;

// アバター画像が無い／読み込み失敗した時のフォールバック（overlay-panel.js / layout-window.js と同じ図柄）。
// CSPの都合でHTML属性の onerror= は使えないため、JS側でハンドラを付けて差し替える。
const FALLBACK_AVATAR_DATA_URI =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">' +
      '<circle cx="24" cy="24" r="24" fill="#3a3a44"/>' +
      '<circle cx="24" cy="18.5" r="7.8" fill="#6b7280"/>' +
      '<path d="M7.8 43.2c2.2-8.6 8.8-13.2 16.2-13.2s14 4.6 16.2 13.2z" fill="#6b7280"/>' +
      '</svg>'
  );

/** 配信開始時刻（ISO8601文字列）から現在までの経過時間を "1:23:45" / "23:45" 形式で返す。無効な値ならnull。 */
// layout-window.js の formatElapsedStreamTime() / renderer.js の同名関数と同じ仕様（表示の見え方を
// 揃えるため）。独立ウィンドウからはそれらのスコープを参照できないため、同じ実装をここにも置いている。
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

/** プラットフォームバッジ用の記号（overlay-panel.js の platformBadgeHtml と同じ図柄）。 */
function platformBadgeText(platform) {
  if (platform === 'youtube') return '▶';
  if (platform === 'kick') return 'K';
  return '●';
}

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('stream-check-card-grid');
  const statusEl = document.getElementById('stream-check-status');
  const updatedAtEl = document.getElementById('stream-check-updated-at');
  const refreshBtn = document.getElementById('stream-check-refresh-btn');
  const closeBtn = document.getElementById('stream-check-close-btn');
  const filterBtns = Array.from(document.querySelectorAll('.stream-check-window-filter-btn'));

  let loading = false;
  let platformFilter = 'all';
  let unifiedFeedItems = [];
  let autoTimer = null;

  function setStatus(text, isError) {
    statusEl.textContent = text || '';
    statusEl.classList.toggle('error', !!isError);
  }

  /** カード1枚分のDOMを組み立てる。ユーザー由来の文字列は必ずtextContentで入れる（XSS対策）。 */
  function buildCard(item) {
    // ピン留め済み（YouTube専用機能、段階Bでは編集不可）でオフラインのチャンネルは、旧実装と
    // 同じくOFFLINE表示のまま一覧に残す。それ以外は全て配信中（fetchUnifiedFeedがそもそも
    // 配信中のものしか返さないため）。
    const offline = !item.isLive;

    const card = document.createElement('div');
    card.className = `stream-check-card${offline ? ' offline' : ''}`;
    card.dataset.platform = item.platform;
    card.dataset.channel = item.channel;

    const avatar = document.createElement('img');
    avatar.className = 'stream-check-card-avatar';
    avatar.alt = '';
    avatar.onerror = () => {
      avatar.onerror = null; // フォールバック画像自体の読み込み失敗で無限ループしないように
      avatar.src = FALLBACK_AVATAR_DATA_URI;
    };
    avatar.src = item.avatarUrl || FALLBACK_AVATAR_DATA_URI;
    card.appendChild(avatar);

    const main = document.createElement('div');
    main.className = 'stream-check-card-main';

    const nameRow = document.createElement('div');
    nameRow.className = 'stream-check-card-name-row';

    const badge = document.createElement('span');
    badge.className = `stream-check-card-platform-badge ${item.platform}`;
    badge.textContent = platformBadgeText(item.platform);
    nameRow.appendChild(badge);

    const name = document.createElement('span');
    name.className = 'stream-check-card-name';
    name.textContent = item.displayName || item.channel;
    name.title = item.displayName || item.channel;
    nameRow.appendChild(name);

    if (!offline) {
      const live = document.createElement('span');
      live.className = 'stream-check-card-live';
      const liveDot = document.createElement('span');
      liveDot.className = 'stream-check-card-live-dot';
      live.appendChild(liveDot);
      live.appendChild(document.createTextNode('LIVE'));
      nameRow.appendChild(live);
    }

    main.appendChild(nameRow);

    // タイトル・カテゴリ・経過時間は現状Twitch/Kickのみ値が入る（main.jsのfetchUnifiedFeed参照）。
    // YouTubeは値を持たないため、単に表示しない。
    if (item.title) {
      const title = document.createElement('div');
      title.className = 'stream-check-card-title';
      title.textContent = item.title;
      title.title = item.title;
      main.appendChild(title);
    }

    const metaRow = document.createElement('div');
    metaRow.className = 'stream-check-card-meta-row';

    if (item.category) {
      const category = document.createElement('span');
      category.className = 'stream-check-card-category';
      category.textContent = item.category;
      category.title = item.category;
      metaRow.appendChild(category);
    }

    if (offline) {
      const viewers = document.createElement('span');
      viewers.className = 'stream-check-card-viewers';
      viewers.textContent = 'オフライン';
      metaRow.appendChild(viewers);
    } else if (typeof item.viewerCount === 'number') {
      const viewers = document.createElement('span');
      viewers.className = 'stream-check-card-viewers';
      viewers.textContent = `${item.viewerCount.toLocaleString()}人`;
      metaRow.appendChild(viewers);
    }

    // 経過時間は1秒ごとに再計算するため、開始時刻をdata属性に持たせておく（tick側で参照する）。
    const elapsedText = !offline ? formatElapsedStreamTime(item.startedAt) : null;
    if (elapsedText) {
      const elapsed = document.createElement('span');
      elapsed.className = 'stream-check-card-elapsed';
      elapsed.dataset.startedAt = item.startedAt;
      elapsed.textContent = elapsedText;
      metaRow.appendChild(elapsed);
    }

    if (metaRow.childElementCount > 0) main.appendChild(metaRow);

    card.appendChild(main);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'stream-check-card-add-btn';
    addBtn.disabled = item.alreadyAdded || offline;
    addBtn.textContent = item.alreadyAdded ? '表示中' : offline ? 'オフライン' : '＋追加';
    addBtn.addEventListener('click', async () => {
      if (offline || item.alreadyAdded) return;
      addBtn.disabled = true;
      try {
        const result = await window.streamCheckApi.addChannel({ name: item.channel, platform: item.platform });
        if (!result || !result.ok) {
          setStatus(`追加に失敗しました: ${result ? result.error : '不明なエラー'}`, true);
          addBtn.disabled = false;
          return;
        }
        item.alreadyAdded = true;
        addBtn.textContent = '表示中';
        // メインウィンドウ側のチップ一覧はmain.jsのchannels:add→'channels:changed'通知を受けて
        // 自動的に更新されるため、ここから追加の通知は不要。
      } catch (err) {
        setStatus(`追加に失敗しました: ${String((err && err.message) || err)}`, true);
        addBtn.disabled = false;
      }
    });
    card.appendChild(addBtn);

    return card;
  }

  function render() {
    const filtered = unifiedFeedItems.filter(
      (item) => platformFilter === 'all' || item.platform === platformFilter
    );
    grid.textContent = '';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'stream-check-card-empty';
      empty.textContent = '現在配信中のフォロー配信者はいません';
      grid.appendChild(empty);
      return;
    }
    filtered.forEach((item) => grid.appendChild(buildCard(item)));
  }

  async function load(options = {}) {
    if (loading) return;
    const includeKick = options.includeKick !== false;
    loading = true;
    refreshBtn.disabled = true;
    setStatus('読み込み中…', false);
    try {
      const result = await window.streamCheckApi.fetchUnifiedFeed({ includeKick });
      const items = (result && result.items) || [];
      if (includeKick) {
        unifiedFeedItems = items;
      } else {
        // 自動更新（includeKick:false）時は、直前まで表示していたKick分の結果をそのまま引き継ぐ
        // （overlay-panel.jsのrefreshUnifiedFeed()と同じ挙動）。
        const previousKickItems = unifiedFeedItems.filter((item) => item.platform === 'kick');
        unifiedFeedItems = items.concat(previousKickItems);
      }
      render();
      const errors = (result && result.errors) || {};
      const errMessages = [];
      if (errors.twitch) errMessages.push(`Twitch: ${errors.twitch}`);
      if (errors.youtube) errMessages.push(`YouTube: ${errors.youtube}`);
      if (includeKick && errors.kick) errMessages.push(`Kick: ${errors.kick}`);
      setStatus(errMessages.join(' / '), errMessages.length > 0);
      updatedAtEl.textContent = `最終更新: ${new Date().toLocaleTimeString('ja-JP')}`;
    } catch (err) {
      grid.textContent = '';
      setStatus(`配信一覧の取得に失敗しました: ${String((err && err.message) || err)}`, true);
    } finally {
      loading = false;
      refreshBtn.disabled = false;
    }
  }

  // 経過時間だけは毎秒再計算する（カード全体の再描画はしない）。
  const elapsedTimer = setInterval(() => {
    grid.querySelectorAll('.stream-check-card-elapsed').forEach((el) => {
      const text = formatElapsedStreamTime(el.dataset.startedAt);
      if (text) el.textContent = text;
    });
  }, 1000);

  // ウィンドウを開いている間、Twitch/YouTube分だけを短い間隔で自動更新する。Kick分はBrowserViewの
  // フルロードを伴い重いため自動更新の対象からは外し、初回取得・手動更新ボタン押下時のみ取得する
  // （overlay-panel.jsのstartUnifiedFeedAutoTimer()と同じ方針）。
  function startAutoTimer() {
    stopAutoTimer();
    autoTimer = setInterval(() => load({ includeKick: false }), UNIFIED_FEED_AUTO_REFRESH_MS);
  }
  function stopAutoTimer() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  window.addEventListener('beforeunload', () => {
    clearInterval(elapsedTimer);
    stopAutoTimer();
  });

  refreshBtn.addEventListener('click', () => load());
  // ESCキー・OSの閉じるボタンはmain.js側（before-input-event / ウィンドウ標準の閉じるボタン）で
  // 処理される。こちらはヘッダーの×ボタン専用。
  closeBtn.addEventListener('click', () => window.streamCheckApi.closeWindow());

  /**
   * @param {string} filter 'all'|'twitch'|'youtube'|'kick'
   * @param {boolean} [persist=true] falseを渡すと保存済み設定の復元時などstore書き込みを省略する
   */
  function setPlatformFilter(filter, persist = true) {
    platformFilter = filter;
    filterBtns.forEach((b) => b.classList.toggle('active', b.dataset.platform === filter));
    if (persist) window.streamCheckApi.setUnifiedFeedPlatformFilter(filter);
  }

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setPlatformFilter(btn.dataset.platform);
      render();
    });
  });

  // ---- 初期化 ----
  (async function init() {
    try {
      const filter = await window.streamCheckApi.getUnifiedFeedPlatformFilter();
      setPlatformFilter(filter || 'all', false);
    } catch (_) {
      setPlatformFilter('all', false);
    }
    await load();
    startAutoTimer();
  })();
});
