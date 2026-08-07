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
//
// 2026-08-08実機報告を受けた追加修正:
// - プラットフォーム表示順をTwitch→YouTube→Kick固定に変更（各プラットフォーム内は従来通り
//   LIVE優先→視聴者数順）。sortUnifiedFeedItems()参照。
// - 誤って「＋追加」した場合に取り消せるよう、カードに「削除」ボタンを追加（channels:remove再利用）。

const UNIFIED_FEED_AUTO_REFRESH_MS = 20 * 1000;

// 2026-08-08実機報告対応: 「上からTwitch/YouTube/Kickの順を絶対にする」ため、main.js側の
// fetchUnifiedFeed()（配信中→視聴者数順のみ）とは別に、このウィンドウの表示直前でのみ
// プラットフォーム優先ソートをかける。layout-window.js等の他の利用箇所には影響させないため、
// main.js側の共通ソートは変更していない。
const PLATFORM_SORT_ORDER = { twitch: 0, youtube: 1, kick: 2 };

/** Twitch→YouTube→Kickの順、各プラットフォーム内はLIVE優先→視聴者数の多い順。 */
function sortUnifiedFeedItems(items) {
  return [...items].sort((a, b) => {
    const platformDiff = (PLATFORM_SORT_ORDER[a.platform] ?? 99) - (PLATFORM_SORT_ORDER[b.platform] ?? 99);
    if (platformDiff !== 0) return platformDiff;
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return (b.viewerCount || 0) - (a.viewerCount || 0);
  });
}

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

/** プラットフォーム表示名（サイト別グループ見出し用）。 */
function platformDisplayName(platform) {
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'kick') return 'Kick';
  return 'Twitch';
}

/** 「自動追加の対象にする」チェックボックスのtitle（ホバー時の詳細説明）。overlay-panel.jsと同文言。 */
function autoTuneInTargetTitle(platform) {
  return platform === 'youtube'
    ? '自動追加の対象にする（YouTubeはチェックを付けないと自動追加されません）'
    : '自動追加の対象にする（チェックした配信者のみが対象になります）';
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

  // ---- 段階C追加（2026-08-08）: 自動追加の対象を選ぶ／フォロー配信者の自動追加 ----
  const tabBtns = Array.from(document.querySelectorAll('.stream-check-tab-btn'));
  const tabContents = Array.from(document.querySelectorAll('.stream-check-tab-content'));
  const targetsLoadBtn = document.getElementById('stream-check-targets-load-btn');
  const targetsStatusEl = document.getElementById('stream-check-targets-status');
  const targetsListEl = document.getElementById('stream-check-targets-list');
  const targetsSortBtns = Array.from(document.querySelectorAll('.stream-check-window-sort-btn'));

  const autoTuneStatusDot = document.getElementById('stream-check-auto-tune-status-dot');
  const autoTuneStatusEl = document.getElementById('stream-check-auto-tune-status');
  const autoTuneMessageEl = document.getElementById('stream-check-auto-tune-message');
  const autoTuneConnectBtn = document.getElementById('stream-check-auto-tune-connect-btn');
  const autoTuneDisconnectBtn = document.getElementById('stream-check-auto-tune-disconnect-btn');
  const autoTuneEnabledInput = document.getElementById('stream-check-auto-tune-enabled-input');
  const autoTuneMaxInput = document.getElementById('stream-check-auto-tune-max-input');
  const autoTuneHelpBtn = document.getElementById('stream-check-auto-tune-help-btn');

  const authLockEl = document.getElementById('stream-check-auth-lock');
  const authCancelBtn = document.getElementById('stream-check-auth-cancel-btn');

  let allFollowCandidates = [];
  let targetsSortMode = 'site'; // 'site' | 'name'

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

    // 段階C追加: 「自動追加の対象にする」（Twitch/YouTube専用）「常に表示（ピン留め、YouTube専用）」
    // チェックボックス。段階Bではスコープ外だったが、対象選択タブとの相互同期のためカードにも復活させる。
    if (item.platform !== 'kick') {
      const targetCheckbox = document.createElement('input');
      targetCheckbox.type = 'checkbox';
      targetCheckbox.className = 'stream-check-card-target-checkbox';
      targetCheckbox.checked = !!item.isTarget;
      targetCheckbox.title = autoTuneInTargetTitle(item.platform);
      targetCheckbox.addEventListener('change', async (e) => {
        const checked = e.target.checked;
        item.isTarget = checked;
        await toggleAutoTuneInTarget(item.platform, item.channel, checked);
        syncTargetCheckboxAcrossLists(item.platform, item.channel, checked);
      });
      card.appendChild(targetCheckbox);
    }
    if (item.platform === 'youtube') {
      const pinCheckbox = document.createElement('input');
      pinCheckbox.type = 'checkbox';
      pinCheckbox.className = 'stream-check-card-pin-checkbox';
      pinCheckbox.checked = !!item.isPinned;
      pinCheckbox.title = '常に表示（ピン留め、オンライン/オフライン問わず自分で外すまで表示し続ける）';
      pinCheckbox.addEventListener('change', async (e) => {
        const checked = e.target.checked;
        item.isPinned = checked;
        await toggleFeedPin(item.channel, item.displayName, checked);
        syncPinCheckboxAcrossLists(item.channel, checked);
        render();
      });
      card.appendChild(pinCheckbox);
    }

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

    const actions = document.createElement('div');
    actions.className = 'stream-check-card-actions';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'stream-check-card-add-btn';
    addBtn.disabled = item.alreadyAdded || offline;
    addBtn.textContent = item.alreadyAdded ? '表示中' : offline ? 'オフライン' : '＋追加';

    // 2026-08-08実機報告対応: 「間違えて追加しても取り消せるように」＋追加ボタンの下に削除
    // ボタンを追加。まだ追加していないチャンネルでは押せない（disabled）。
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'stream-check-card-remove-btn';
    removeBtn.textContent = '削除';
    removeBtn.disabled = !item.alreadyAdded;

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
        removeBtn.disabled = false;
        // メインウィンドウ側のチップ一覧はmain.jsのchannels:add→'channels:changed'通知を受けて
        // 自動的に更新されるため、ここから追加の通知は不要。
      } catch (err) {
        setStatus(`追加に失敗しました: ${String((err && err.message) || err)}`, true);
        addBtn.disabled = false;
      }
    });

    removeBtn.addEventListener('click', async () => {
      if (!item.alreadyAdded) return;
      removeBtn.disabled = true;
      try {
        await window.streamCheckApi.removeChannel(item.channel);
        item.alreadyAdded = false;
        addBtn.disabled = offline;
        addBtn.textContent = offline ? 'オフライン' : '＋追加';
        // メインウィンドウ側のタイル・チップは既存のchannels:remove IPCハンドラ（main.js
        // removeChannel()内のnotifyRenderer('tile:bar-remove')等、既存のチップ削除ボタンと
        // 全く同じ経路）で除去される。このウィンドウ側から追加の通知は不要。
      } catch (err) {
        setStatus(`削除に失敗しました: ${String((err && err.message) || err)}`, true);
      } finally {
        removeBtn.disabled = !item.alreadyAdded;
      }
    });

    actions.appendChild(addBtn);
    actions.appendChild(removeBtn);
    card.appendChild(actions);

    return card;
  }

  function render() {
    const filtered = sortUnifiedFeedItems(
      unifiedFeedItems.filter((item) => platformFilter === 'all' || item.platform === platformFilter)
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

  // ---- 段階C: 対象指定・ピン留めの保存・同期（overlay-panel.jsのmountUnifiedFeed()から移植） ----

  /** Auto Tune-Inの対象指定リストへのチェックボックスON/OFFを反映する。 */
  async function toggleAutoTuneInTarget(platform, channel, checked) {
    const key = channel.toLowerCase();
    const current = await window.streamCheckApi.getAutoTuneInTargets();
    const next = checked
      ? current.some((t) => t.platform === platform && t.channel.toLowerCase() === key)
        ? current
        : [...current, { platform, channel }]
      : current.filter((t) => !(t.platform === platform && t.channel.toLowerCase() === key));
    await window.streamCheckApi.setAutoTuneInTargets(next);
  }

  /** 配信中一覧タブ・対象選択タブのどちらかでチェックが変わったら、もう一方も見た目を同期する。 */
  function syncTargetCheckboxAcrossLists(platform, channel, checked) {
    const key = channel.toLowerCase();
    const feedItem = unifiedFeedItems.find((f) => f.platform === platform && f.channel.toLowerCase() === key);
    if (feedItem && feedItem.isTarget !== checked) {
      feedItem.isTarget = checked;
      render();
    }
    const allItem = allFollowCandidates.find((f) => f.platform === platform && f.channel.toLowerCase() === key);
    if (allItem && allItem.isTarget !== checked) {
      allItem.isTarget = checked;
      renderTargetsList();
    }
  }

  /** フィードへの「常時表示（ピン留め）」ON/OFFを反映する（YouTube専用）。 */
  async function toggleFeedPin(channel, displayName, checked) {
    const key = channel.toLowerCase();
    const current = await window.streamCheckApi.getFeedPinnedYoutube();
    const next = checked
      ? current.some((p) => p.channel.toLowerCase() === key)
        ? current
        : [...current, { channel, displayName }]
      : current.filter((p) => p.channel.toLowerCase() !== key);
    await window.streamCheckApi.setFeedPinnedYoutube(next);
  }

  function syncPinCheckboxAcrossLists(channel, checked) {
    const key = channel.toLowerCase();
    const feedItem = unifiedFeedItems.find((f) => f.platform === 'youtube' && f.channel.toLowerCase() === key);
    if (feedItem && feedItem.isPinned !== checked) feedItem.isPinned = checked;
    const allItem = allFollowCandidates.find((f) => f.platform === 'youtube' && f.channel.toLowerCase() === key);
    if (allItem && allItem.isPinned !== checked) allItem.isPinned = checked;
  }

  // ---- 段階C: 自動追加の対象を選ぶ（全フォロー/登録一覧） ----

  /** 1行分のDOM（対象指定チェック・ピン留めチェック・バッジ・名前）。XSS対策としてtextContentのみ使用。 */
  function buildTargetRow(item) {
    const row = document.createElement('div');
    row.className = 'stream-check-target-row';

    if (item.platform !== 'kick') {
      const targetCheckbox = document.createElement('input');
      targetCheckbox.type = 'checkbox';
      targetCheckbox.checked = !!item.isTarget;
      targetCheckbox.title = autoTuneInTargetTitle(item.platform);
      targetCheckbox.addEventListener('change', async (e) => {
        const checked = e.target.checked;
        item.isTarget = checked;
        await toggleAutoTuneInTarget(item.platform, item.channel, checked);
        syncTargetCheckboxAcrossLists(item.platform, item.channel, checked);
      });
      row.appendChild(targetCheckbox);
    }
    if (item.platform === 'youtube') {
      const pinCheckbox = document.createElement('input');
      pinCheckbox.type = 'checkbox';
      pinCheckbox.checked = !!item.isPinned;
      pinCheckbox.title = '常に表示（ピン留め、オンライン/オフライン問わず自分で外すまで表示し続ける）';
      pinCheckbox.addEventListener('change', async (e) => {
        const checked = e.target.checked;
        item.isPinned = checked;
        await toggleFeedPin(item.channel, item.displayName, checked);
        syncPinCheckboxAcrossLists(item.channel, checked);
      });
      row.appendChild(pinCheckbox);
    }

    const badge = document.createElement('span');
    badge.className = `stream-check-card-platform-badge ${item.platform}`;
    badge.textContent = platformBadgeText(item.platform);
    row.appendChild(badge);

    const name = document.createElement('span');
    name.className = 'stream-check-target-row-name';
    name.textContent = item.displayName;
    name.title = item.displayName;
    row.appendChild(name);

    return row;
  }

  /** サイト別（Twitch→YouTube→Kick、各内は名前順）にグループ化して描画する。 */
  function renderTargetsGroupedBySite() {
    targetsListEl.textContent = '';
    ['twitch', 'youtube', 'kick'].forEach((platform) => {
      const group = allFollowCandidates
        .filter((item) => item.platform === platform)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));
      if (!group.length) return;
      const heading = document.createElement('div');
      heading.className = 'stream-check-targets-group-heading';
      heading.textContent = platformDisplayName(platform);
      targetsListEl.appendChild(heading);
      group.forEach((item) => targetsListEl.appendChild(buildTargetRow(item)));
    });
  }

  /** 五十音/アルファベット順（プラットフォーム問わず1本の名前順）に描画する。 */
  function renderTargetsSortedByName() {
    targetsListEl.textContent = '';
    const sorted = [...allFollowCandidates].sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));
    sorted.forEach((item) => targetsListEl.appendChild(buildTargetRow(item)));
  }

  function renderTargetsList() {
    if (!allFollowCandidates.length) {
      targetsListEl.textContent = '';
      const empty = document.createElement('div');
      empty.className = 'stream-check-target-empty';
      empty.textContent = '「🔄 全フォロー/登録一覧を読み込む」を押してください';
      targetsListEl.appendChild(empty);
      return;
    }
    if (targetsSortMode === 'name') renderTargetsSortedByName();
    else renderTargetsGroupedBySite();
  }

  targetsSortBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      targetsSortMode = btn.dataset.sort;
      targetsSortBtns.forEach((b) => b.classList.toggle('active', b === btn));
      renderTargetsList();
    });
  });

  targetsLoadBtn.addEventListener('click', async () => {
    targetsStatusEl.textContent = '取得中...(登録数が多いと時間がかかることがあります)';
    targetsStatusEl.classList.remove('error');
    targetsLoadBtn.disabled = true;
    try {
      const { items, errors } = await window.streamCheckApi.fetchAllFollowCandidates();
      allFollowCandidates = items;
      renderTargetsList();
      const errMessages = [];
      if (errors.twitch) errMessages.push(`Twitch: ${errors.twitch}`);
      if (errors.youtube) errMessages.push(`YouTube: ${errors.youtube}`);
      targetsStatusEl.textContent = errMessages.join(' / ') || `${items.length}件取得しました`;
      targetsStatusEl.classList.toggle('error', errMessages.length > 0);
    } catch (err) {
      targetsStatusEl.textContent = `取得に失敗しました: ${String((err && err.message) || err)}`;
      targetsStatusEl.classList.add('error');
    } finally {
      targetsLoadBtn.disabled = false;
    }
  });

  // ---- 段階C: フォロー配信者の自動追加（Twitchアカウント連携） ----

  async function refreshAutoTuneInStatus() {
    const status = await window.streamCheckApi.getAutoTuneInStatus();
    if (status.connected) {
      autoTuneStatusDot.className = 'stream-check-auto-tune-status-dot connected';
      autoTuneStatusEl.textContent = '連携済み Twitch';
      autoTuneConnectBtn.classList.add('hidden');
      autoTuneDisconnectBtn.classList.remove('hidden');
    } else {
      autoTuneStatusDot.className = 'stream-check-auto-tune-status-dot disconnected';
      autoTuneStatusEl.textContent = '未連携 Twitch';
      autoTuneConnectBtn.classList.remove('hidden');
      autoTuneDisconnectBtn.classList.add('hidden');
    }
    autoTuneEnabledInput.disabled = !status.canEnable;
    autoTuneMaxInput.disabled = !status.canEnable;
    autoTuneEnabledInput.checked = status.enabled;
    autoTuneMaxInput.value = status.maxTiles;
  }

  autoTuneConnectBtn.addEventListener('click', async () => {
    autoTuneMessageEl.textContent = '連携処理中...';
    const result = await window.streamCheckApi.startTwitchAuth();
    if (result.ok) {
      autoTuneMessageEl.textContent = `連携しました（${result.login}としてログイン中）`;
    } else if (!result.cancelled) {
      autoTuneMessageEl.textContent = `エラー: ${result.error}`;
    } else {
      autoTuneMessageEl.textContent = '';
    }
    refreshAutoTuneInStatus();
  });

  autoTuneDisconnectBtn.addEventListener('click', async () => {
    await window.streamCheckApi.disconnectTwitchAuth();
    refreshAutoTuneInStatus();
  });

  autoTuneEnabledInput.addEventListener('change', async () => {
    await window.streamCheckApi.setAutoTuneInConfig({ enabled: autoTuneEnabledInput.checked });
  });

  autoTuneMaxInput.addEventListener('change', async () => {
    const v = Math.max(1, Math.min(20, Number(autoTuneMaxInput.value) || 1));
    autoTuneMaxInput.value = v;
    await window.streamCheckApi.setAutoTuneInConfig({ maxTiles: v });
  });

  // 段階E追加: 「詳しく」でメインウィンドウのヘルプ(Twitchタブ・#help-twitch-autotune項目)を開く。
  autoTuneHelpBtn.addEventListener('click', () => {
    window.streamCheckApi.openHelpSection('twitch', 'help-twitch-autotune');
  });

  window.streamCheckApi.onAutoTuneInError(({ message }) => {
    autoTuneMessageEl.textContent = `エラー: ${message}`;
  });

  window.streamCheckApi.onAutoTuneInAuthLost(() => {
    autoTuneMessageEl.textContent = 'Twitchとの連携が切れました。「Twitch連携」から再連携してください。';
    refreshAutoTuneInStatus();
  });

  // 認証画面（BrowserView）がこのウィンドウに重なっている間はロック表示を出す
  // （main.jsのopenTwitchAuthView/closeTwitchAuthViewからの通知、ホストがこのウィンドウの時のみ届く）。
  window.streamCheckApi.onTwitchAuthViewOpened(() => {
    authLockEl.classList.remove('hidden');
  });
  window.streamCheckApi.onTwitchAuthViewClosed(() => {
    authLockEl.classList.add('hidden');
  });
  authCancelBtn.addEventListener('click', () => window.streamCheckApi.cancelTwitchAuth());

  // ---- 段階C: タブ切替（配信中一覧／自動追加の対象） ----
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabBtns.forEach((b) => b.classList.toggle('active', b === btn));
      tabContents.forEach((c) => c.classList.toggle('hidden', c.dataset.tabContent !== tab));
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
    refreshAutoTuneInStatus();
  })();
});
