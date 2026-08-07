'use strict';

// 複窓レイアウト設定ウィンドウ（2026-08-08新設、第1段階）の描画ロジック。
//
// 第1段階のスコープは「開くと現在配信中のチャンネル一覧がカードのグリッドで並ぶ（見るだけ）」まで。
// クリックによるMAIN/SUB割り当てと、メイン画面の配信タイル配置への反映は第2段階以降で追加する。
// データ取得は既存の unified-feed（main.jsのfetchUnifiedFeed）をそのまま再利用しており、
// 既存の配信チェックパネル側のコードには一切手を加えていない（完全に独立した新規コードパス）。

// アバター画像が無い／読み込み失敗した時のフォールバック（overlay-panel.js と同じ図柄）。
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
// renderer.js の formatElapsedStreamTime() と同じ仕様（表示の見え方を揃えるため）。独立ウィンドウ
// からはあちらのスコープを参照できないため、この小さな関数だけ同じ実装を置いている。
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
  const grid = document.getElementById('layout-card-grid');
  const statusEl = document.getElementById('layout-status');
  const refreshBtn = document.getElementById('layout-refresh-btn');
  const closeBtn = document.getElementById('layout-close-btn');

  let loading = false;

  function setStatus(text, isError) {
    statusEl.textContent = text || '';
    statusEl.classList.toggle('error', !!isError);
  }

  /** カード1枚分のDOMを組み立てる。ユーザー由来の文字列は必ずtextContentで入れる（XSS対策）。 */
  function buildCard(item) {
    const card = document.createElement('div');
    card.className = 'layout-card';
    card.dataset.platform = item.platform;
    card.dataset.channel = item.channel;

    const avatar = document.createElement('img');
    avatar.className = 'layout-card-avatar';
    avatar.alt = '';
    avatar.onerror = () => {
      avatar.onerror = null; // フォールバック画像自体の読み込み失敗で無限ループしないように
      avatar.src = FALLBACK_AVATAR_DATA_URI;
    };
    avatar.src = item.avatarUrl || FALLBACK_AVATAR_DATA_URI;
    card.appendChild(avatar);

    const main = document.createElement('div');
    main.className = 'layout-card-main';

    const nameRow = document.createElement('div');
    nameRow.className = 'layout-card-name-row';

    const badge = document.createElement('span');
    badge.className = `layout-card-platform-badge ${item.platform}`;
    badge.textContent = platformBadgeText(item.platform);
    nameRow.appendChild(badge);

    const name = document.createElement('span');
    name.className = 'layout-card-name';
    name.textContent = item.displayName || item.channel;
    name.title = item.displayName || item.channel;
    nameRow.appendChild(name);

    const live = document.createElement('span');
    live.className = 'layout-card-live';
    const liveDot = document.createElement('span');
    liveDot.className = 'layout-card-live-dot';
    live.appendChild(liveDot);
    live.appendChild(document.createTextNode('LIVE'));
    nameRow.appendChild(live);

    main.appendChild(nameRow);

    // 以下のタイトル・カテゴリ・経過時間は現状Twitchのみ値が入る（main.jsのfetchUnifiedFeed参照）。
    // YouTube/Kickは値を持たないため、単に表示しない。
    if (item.title) {
      const title = document.createElement('div');
      title.className = 'layout-card-title';
      title.textContent = item.title;
      title.title = item.title;
      main.appendChild(title);
    }

    const metaRow = document.createElement('div');
    metaRow.className = 'layout-card-meta-row';

    if (item.category) {
      const category = document.createElement('span');
      category.className = 'layout-card-category';
      category.textContent = item.category;
      category.title = item.category;
      metaRow.appendChild(category);
    }

    if (typeof item.viewerCount === 'number') {
      const viewers = document.createElement('span');
      viewers.className = 'layout-card-viewers';
      viewers.textContent = `${item.viewerCount.toLocaleString()}人`;
      metaRow.appendChild(viewers);
    }

    // 経過時間は1秒ごとに再計算するため、開始時刻をdata属性に持たせておく（tick側で参照する）。
    const elapsedText = formatElapsedStreamTime(item.startedAt);
    if (elapsedText) {
      const elapsed = document.createElement('span');
      elapsed.className = 'layout-card-elapsed';
      elapsed.dataset.startedAt = item.startedAt;
      elapsed.textContent = elapsedText;
      metaRow.appendChild(elapsed);
    }

    if (metaRow.childElementCount > 0) main.appendChild(metaRow);

    card.appendChild(main);

    // 第2段階（MAIN/SUBの割り当て）で本実装する予定の place holder。現状は何も起きない。
    card.addEventListener('click', () => {
      console.log('[layout-window] card clicked (第2段階で実装):', item.platform, item.channel);
    });

    return card;
  }

  function render(items) {
    grid.textContent = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'layout-card-empty';
      empty.textContent = '現在配信中のフォロー配信者はいません';
      grid.appendChild(empty);
      return;
    }
    items.forEach((item) => grid.appendChild(buildCard(item)));
  }

  async function load() {
    if (loading) return;
    loading = true;
    refreshBtn.disabled = true;
    setStatus('読み込み中…', false);
    try {
      const result = await window.layoutApi.fetchUnifiedFeed({ includeKick: false });
      const items = (result && result.items ? result.items : []).filter((item) => item.isLive);
      render(items);
      // fetchUnifiedFeedはプラットフォームごとに部分的な失敗を許容する（errorsに入るだけで
      // 例外にはならない）ため、取得できた分は表示したうえで失敗分だけを注記する。
      const errors = (result && result.errors) || {};
      const failed = Object.keys(errors);
      if (failed.length) {
        setStatus(`${items.length}件表示中（${failed.join(' / ')}の取得に失敗しました）`, true);
      } else {
        setStatus(`${items.length}件`, false);
      }
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
    grid.querySelectorAll('.layout-card-elapsed').forEach((el) => {
      const text = formatElapsedStreamTime(el.dataset.startedAt);
      if (text) el.textContent = text;
    });
  }, 1000);
  window.addEventListener('beforeunload', () => clearInterval(elapsedTimer));

  refreshBtn.addEventListener('click', () => load());
  // ESCキー・OSの閉じるボタンはmain.js側（before-input-event / ウィンドウ標準の閉じるボタン）で
  // 処理される。こちらはヘッダーの×ボタン専用。
  closeBtn.addEventListener('click', () => window.layoutApi.closeWindow());

  load();
});
