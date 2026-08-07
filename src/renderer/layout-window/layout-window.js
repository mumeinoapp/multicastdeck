'use strict';

// 複窓レイアウト設定ウィンドウ（2026-08-08新設、第1段階／第2段階でクリック選択追加／
// 第3段階でメイン画面への反映を追加）の描画ロジック。
//
// 第1段階のスコープは「開くと現在配信中のチャンネル一覧がカードのグリッドで並ぶ（見るだけ）」まで。
// 第2段階として、配信者アイコンをクリックした順に選択し（最大9件）、選択済みカードを再クリックすると
// 選択解除（自動整列＝残りの選択が詰めて繰り上がる）できるロジックを追加した。
// 第3段階として、ユーザーとの追加相談の結果、当初案の「MAIN/SUB1〜3固定4枠」は廃止し、
// 選択順に応じた1〜9枚の見栄え重視テンプレート（main.js側computeTemplateRects、既存の
// 「自動整列」機能の中身も同じテンプレートに統一済み）へ一本化した。このウィンドウの「自動整列」
// ボタンを押すと、選択内容でメイン画面の全タイルを完全に置き換える（未選択の既存タイルは閉じる）。
// 加えて「クリックで即時追加」トグル（ONの間は選択と同時にメイン画面へその場でチャンネルを追加、
// 既存の手動追加と同じchannels:add IPCを再利用）と、「チャット表示」トグル（自動整列実行時に
// 選択チャンネル全体の個別チャット埋め込み表示を一括ON/OFF、Twitchのみ意味を持つ）を追加した。
// データ取得は既存の unified-feed（main.jsのfetchUnifiedFeed）をそのまま再利用しており、
// 既存の配信チェックパネル側のコードには一切手を加えていない（完全に独立した新規コードパス）。

// 選択順の番号バッジ（最大9件、元依頼一覧item20のスクリーンショット仕様＝1〜9枚テンプレートに合わせる）。
const SLOT_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const MAX_SLOTS = SLOT_LABELS.length;

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

// 2026-08-08修正: YouTubeアイコン未表示バグの真因対策（main.js側で正規化済みだが、念のため
// こちら側でも安全網として正規化する。stream-check-window.jsの同名関数と同じ実装、詳細は
// あちらのコメント参照）。avatarUrlがまれにプロトコル相対URL（"//..."）で渡ってくることがあり、
// このウィンドウもfile://で読み込まれているため、そのままimg.srcへ入れると誤って解決される。
function normalizeAvatarUrl(url) {
  if (!url) return url;
  return url.indexOf('//') === 0 ? `https:${url}` : url;
}

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
  const immediateAddToggle = document.getElementById('layout-immediate-add-toggle');
  const chatVisibleToggle = document.getElementById('layout-chat-visible-toggle');
  const autoArrangeBtn = document.getElementById('layout-auto-arrange-btn');

  let loading = false;
  // クリックした順に並ぶ「channelKey」の配列。並び順＝1〜9テンプレートの割り当て順（先頭が1番目）。
  // 配列operationだけで自動整列になる: 途中の要素をsplice(idx,1)で抜けば後続が自動的に繰り上がる。
  let selectedOrder = [];
  let selectionNotice = null; // 上限到達時などの一時メッセージ（再描画やload()の通常メッセージで上書きされる）
  // channelKey -> fetchUnifiedFeedの生item。render()のたびに作り直す（自動整列実行時に
  // platform/channel等の完全な情報を組み立てるために必要）。
  let itemsByKey = new Map();

  function channelKey(item) {
    return `${item.platform}::${item.channel}`;
  }

  function setStatus(text, isError) {
    statusEl.textContent = text || '';
    statusEl.classList.toggle('error', !!isError);
  }

  function updateAutoArrangeButtonState() {
    autoArrangeBtn.disabled = selectedOrder.length === 0;
  }

  /** 現在のselectedOrderに基づき、既に描画済みの全カードの選択枠表示（番号バッジ・枠線）だけを
   *  更新する。グリッド全体の再構築（render）は行わないため、スクロール位置や経過時間タイマーの
   *  対象要素はそのまま保たれる。 */
  function updateSelectionUI() {
    grid.querySelectorAll('.layout-card').forEach((card) => {
      const key = `${card.dataset.platform}::${card.dataset.channel}`;
      const idx = selectedOrder.indexOf(key);
      card.classList.toggle('is-selected', idx !== -1);
      let badge = card.querySelector('.layout-card-slot-badge');
      if (idx !== -1) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'layout-card-slot-badge';
          card.appendChild(badge);
        }
        badge.textContent = SLOT_LABELS[idx];
      } else if (badge) {
        badge.remove();
      }
    });
    updateAutoArrangeButtonState();
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
    avatar.src = normalizeAvatarUrl(item.avatarUrl) || FALLBACK_AVATAR_DATA_URI;
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

    card.addEventListener('click', async () => {
      const key = channelKey(item);
      const idx = selectedOrder.indexOf(key);
      let didSelect = false;
      if (idx !== -1) {
        // 既に選択済み → 選択解除（自動整列: 後続の番号が繰り上がる）
        selectedOrder.splice(idx, 1);
      } else if (selectedOrder.length >= MAX_SLOTS) {
        // 1〜9枚テンプレートの上限。読み込み中メッセージ等を上書きしないよう一時表示のみ行う。
        setStatus(`選択できるのは最大${MAX_SLOTS}件までです（解除してから選び直してください）`, true);
        selectionNotice = true;
        return;
      } else {
        selectedOrder.push(key);
        didSelect = true;
      }
      if (selectionNotice) {
        // 上限通知を出した直後の操作でクリアされた場合、通常の件数表示に戻す。
        selectionNotice = null;
        const count = grid.querySelectorAll('.layout-card').length;
        setStatus(`${count}件`, false);
      }
      updateSelectionUI();

      // 「クリックで即時追加」ON時、新規選択（解除ではない）の場合のみメイン画面へその場で追加する。
      // 解除側（未選択タイルを閉じる）は破壊的操作のため、自動整列ボタンを押した時にのみ行う。
      if (didSelect && immediateAddToggle.checked) {
        try {
          const result = await window.layoutApi.addChannel({ name: item.channel, platform: item.platform });
          if (result && !result.ok && result.error && result.error !== '既に追加されています') {
            setStatus(`${item.displayName || item.channel}の追加に失敗しました: ${result.error}`, true);
          }
        } catch (err) {
          setStatus(`${item.displayName || item.channel}の追加に失敗しました: ${String((err && err.message) || err)}`, true);
        }
      }
    });

    return card;
  }

  function render(items) {
    // 配信が終了する等で一覧から消えたチャンネルの選択は自動的に外す（幽霊枠を残さない）。
    // 自動整列（splice）で行うため、残った選択の順序・繰り上がりはそのまま保たれる。
    const liveKeys = new Set(items.map((item) => channelKey(item)));
    selectedOrder = selectedOrder.filter((key) => liveKeys.has(key));
    itemsByKey = new Map(items.map((item) => [channelKey(item), item]));

    grid.textContent = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'layout-card-empty';
      empty.textContent = '現在配信中のフォロー配信者はいません';
      grid.appendChild(empty);
      updateAutoArrangeButtonState();
      return;
    }
    items.forEach((item) => grid.appendChild(buildCard(item)));
    updateSelectionUI();
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

  autoArrangeBtn.addEventListener('click', async () => {
    if (!selectedOrder.length) return;
    autoArrangeBtn.disabled = true;
    setStatus('反映中…', false);
    try {
      const selection = selectedOrder
        .map((key) => itemsByKey.get(key))
        .filter(Boolean)
        .map((item) => ({
          platform: item.platform,
          channel: item.channel,
          // YouTubeはfetchUnifiedFeedのitem.channelがハンドル文字列そのもの
          // （applySharedLayoutのフォールバック分岐と同じ扱い）。
          youtubeChannelId: item.platform === 'youtube' ? item.channel : null,
        }));
      const result = await window.layoutApi.autoArrange({
        selection,
        chatVisible: chatVisibleToggle.checked,
      });
      if (!result || !result.ok) {
        setStatus(`反映に失敗しました: ${(result && result.error) || '不明なエラー'}`, true);
        return;
      }
      setStatus(`${result.count}件をメイン画面に反映しました`, false);
    } catch (err) {
      setStatus(`反映に失敗しました: ${String((err && err.message) || err)}`, true);
    } finally {
      autoArrangeBtn.disabled = selectedOrder.length === 0;
    }
  });

  load();
});
