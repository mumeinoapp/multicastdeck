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

// 2026-08-08追加: 要望⑦「自動更新間隔を最長5秒程度まで高速化」対応。
// Twitchは公式Helix APIのため高頻度でも安全だが、YouTube側は非公式HTMLスクレイプ
// （最大60チャンネル・同時4件）のため、単純に全体を5秒化するとレート制限/ブロックの
// リスクが上がる。ユーザー確認の上、Twitch分のみ5秒間隔にし、YouTube分は従来通り
// 20秒間隔を維持する方針にした（両者を別タイマーで独立させる）。
const UNIFIED_FEED_TWITCH_AUTO_REFRESH_MS = 5 * 1000;
const UNIFIED_FEED_YOUTUBE_AUTO_REFRESH_MS = 20 * 1000;
// 段階F追加: Kick分もTwitchと同じ5秒間隔で自動更新する（ユーザー確認済み）。KickはBrowserView
// フルロードを伴うため元々自動更新の対象外だったが、要望によりTwitch/Kick=5秒・YouTube=20秒に
// 統一する。負荷が問題になった場合は間隔の見直しが必要になる可能性がある。
const UNIFIED_FEED_KICK_AUTO_REFRESH_MS = 5 * 1000;
// 段階F追加: 手動更新ボタンの連打によるレート制限リスクを避けるためのクールダウン
// （ユーザー確認の上、サイトを問わず一律5秒に設定）。
const MANUAL_REFRESH_COOLDOWN_MS = 5 * 1000;

// 2026-08-08実機報告対応: 「上からTwitch/YouTube/Kickの順を絶対にする」ため、main.js側の
// fetchUnifiedFeed()（配信中→視聴者数順のみ）とは別に、このウィンドウの表示直前でのみ
// プラットフォーム優先ソートをかける。layout-window.js等の他の利用箇所には影響させないため、
// main.js側の共通ソートは変更していない。
const PLATFORM_SORT_ORDER = { twitch: 0, youtube: 1, kick: 2 };

// 項目⑩追加: 「レイアウト配置」用のクリック選択（layout-window.jsのSLOT_LABELS/MAX_SLOTSと
// 完全に同じ、1〜9枚テンプレートの割当数に合わせた上限）。
const LAYOUT_SLOT_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const LAYOUT_MAX_SLOTS = LAYOUT_SLOT_LABELS.length;

/** レイアウト選択の識別キー。layout-window.jsのchannelKey()と同じ形式（platform::channel）。 */
function layoutChannelKey(item) {
  return `${item.platform}::${item.channel}`;
}

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

  // 項目⑩追加: 「レイアウト配置」ボタンと選択件数表示。
  const layoutPlaceBtn = document.getElementById('stream-check-layout-place-btn');
  const layoutSelectionCountEl = document.getElementById('stream-check-layout-selection-count');

  // 2026-08-08修正: 単一のloadingフラグを廃止し、プラットフォームごとに独立したフラグへ変更。
  // 理由: 従来はloadingを共有していたため、Kick（BrowserViewフルロードで数秒〜十数秒かかる）の
  // 取得中はTwitch/YouTube側のtickも「実行中」扱いでスキップされてしまい、結果的にTwitchの
  // 5秒間隔がKickの取得時間に引きずられて実質20秒程度まで遅くなっていた（実機確認で報告された
  // 不具合）。プラットフォームごとに取得中かどうかを分けることで、遅いサイトが他のサイトの
  // 更新をブロックしないようにし、各サイトは自分の取得が終わった時点で即座に画面へ反映される
  // （「更新されたサイトから表示していく」方式）。
  const loadingByPlatform = { twitch: false, youtube: false, kick: false };
  let platformFilter = 'all';
  let unifiedFeedItems = [];
  // 項目⑩追加: クリックした順に並ぶchannelKeyの配列（layout-window.jsのselectedOrderと同じ考え方）。
  // 「自動追加の対象にする」isTarget・「常に表示」isPinnedとは完全に独立したデータ。フィルタ変更や
  // 自動更新でカードが再描画されても選択状態を保つため、render()をまたいで保持する外部変数にする。
  let layoutSelectedOrder = [];
  // channelKey -> unifiedFeedItems内の生item（プラットフォーム絞り込み前の全件から作る。フィルタで
  // 非表示中のカードを選択していても「レイアウト配置」実行時に情報を引けるようにするため）。
  let layoutItemsByKey = new Map();
  // 2026-08-08追加（要望⑦）: Twitch分とYouTube分で更新頻度を分けるため、タイマーを2本に分離。
  // 段階F追加: Kick分も5秒間隔で独立更新するため3本目を追加。
  let twitchAutoTimer = null;
  let youtubeAutoTimer = null;
  let kickAutoTimer = null;
  // 段階F追加: 手動更新ボタンのクールダウン管理用。
  let manualRefreshCooldownTimer = null;

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

  // 段階F追加: 「設定」タブ、追加時にチャットを非表示にするトグル。
  const settingsChatHiddenOnAddInput = document.getElementById('stream-check-settings-chat-hidden-on-add');

  let allFollowCandidates = [];
  let targetsSortMode = 'site'; // 'site' | 'name'
  // addBtnクリック時に毎回IPCを叩かず済むよう、設定タブの値をローカルにも保持しておく
  // （init()で復元、トグル変更時に更新）。
  let addWithChatHiddenDefault = false;

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

    // タイトル・カテゴリはTwitch/Kick/YouTubeいずれも値が入り得る（2026-08-08修正でYouTubeも
    // 対応、main.jsのfetchUnifiedFeed/fetchYoutubeLiveInfoFree参照）。開始時刻（経過時間表示用）は
    // Twitch/Kick/YouTubeいずれも取れる場合と取れない場合があるため、無い場合は単に表示しない。
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
        const result = await window.streamCheckApi.addChannel({
          name: item.channel,
          platform: item.platform,
          // 段階F追加: 「設定」タブのトグルがONの場合、追加と同時にチャットを非表示にする
          // （YouTube/Kickはもともと常時非表示のため実質Twitchのみに効く。main.js addChannel参照）。
          forceChatHidden: addWithChatHiddenDefault,
        });
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

    // 項目⑩追加: カードクリックで「レイアウト配置」用の選択をトグルする。オフラインのカードは
    // 配置対象として意味を持たないため選択不可のままにする（見た目もcursor:pointerを付けない）。
    if (!offline) {
      card.classList.add('is-live-selectable');
      const key = layoutChannelKey(item);
      const selectedIdx = layoutSelectedOrder.indexOf(key);
      if (selectedIdx !== -1) {
        card.classList.add('is-layout-selected');
        const badge = document.createElement('span');
        badge.className = 'stream-check-card-layout-badge';
        badge.textContent = LAYOUT_SLOT_LABELS[selectedIdx];
        card.appendChild(badge);
      }
      card.addEventListener('click', (e) => {
        // チェックボックス・＋追加/削除ボタンのクリックでは選択をトグルしない
        // （「自動追加の対象にする」等、既存機能の操作と衝突させないためのガード）。
        if (e.target.closest('input, button')) return;
        toggleLayoutSelection(item);
      });
    }

    return card;
  }

  /** 「レイアウト配置」用の選択をトグルする（layout-window.jsのカードclickハンドラと同じロジック）。 */
  function toggleLayoutSelection(item) {
    const key = layoutChannelKey(item);
    const idx = layoutSelectedOrder.indexOf(key);
    if (idx !== -1) {
      // 既に選択済み → 選択解除（自動整列: 後続の番号が繰り上がる）
      layoutSelectedOrder.splice(idx, 1);
    } else if (layoutSelectedOrder.length >= LAYOUT_MAX_SLOTS) {
      setStatus(`レイアウト配置に選べるのは最大${LAYOUT_MAX_SLOTS}件までです（解除してから選び直してください）`, true);
      return;
    } else {
      layoutSelectedOrder.push(key);
    }
    render();
  }

  /** レイアウト配置ボタンのdisabled状態・選択件数表示を更新する。render()の末尾から呼ぶ。 */
  function updateLayoutSelectionUI() {
    layoutPlaceBtn.disabled = layoutSelectedOrder.length === 0;
    layoutSelectionCountEl.textContent = layoutSelectedOrder.length
      ? `レイアウト選択: ${layoutSelectedOrder.length}/${LAYOUT_MAX_SLOTS}件`
      : '';
  }

  function render() {
    // 項目⑩追加: レイアウト選択の参照テーブルはプラットフォーム絞り込み前の全件から作る
    // （フィルタで一時的に非表示のカードを選んでいても「レイアウト配置」実行時に情報を引けるように
    // するため）。一覧から完全に消えた（オフライン化して非ピン留めのため除外された等）チャンネルの
    // 選択だけは自動的に外す。オフライン化しただけで一覧に残っている間は選択を保持する
    // （ユーザー確認済み: 復帰を待って配置したいケースを想定）。
    const allKeys = new Set(unifiedFeedItems.map((item) => layoutChannelKey(item)));
    layoutSelectedOrder = layoutSelectedOrder.filter((key) => allKeys.has(key));
    layoutItemsByKey = new Map(unifiedFeedItems.map((item) => [layoutChannelKey(item), item]));

    const filtered = sortUnifiedFeedItems(
      unifiedFeedItems.filter((item) => platformFilter === 'all' || item.platform === platformFilter)
    );
    grid.textContent = '';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'stream-check-card-empty';
      empty.textContent = '現在配信中のフォロー配信者はいません';
      grid.appendChild(empty);
      updateLayoutSelectionUI();
      return;
    }
    filtered.forEach((item) => grid.appendChild(buildCard(item)));
    updateLayoutSelectionUI();
  }

  async function load(options = {}) {
    // 2026-08-08修正: プラットフォームごとに「自分の取得が既に実行中か」だけを見てスキップする。
    // 例えばKick専用タイマーの取得がまだ終わっていない間にKick専用タイマーの次のtickが来た場合は
    // そのtickをスキップするが、Twitch専用タイマーのtickはKickの取得状況に関係なくそのまま実行する
    // （プラットフォーム間で互いに待たせない。手動更新・初回読み込みのように複数プラットフォームを
    // 一度に要求する呼び出しは、その中で既に実行中のプラットフォームだけを除外し、残りだけ取得する）。
    let includeKick = options.includeKick !== false;
    let includeTwitch = options.includeTwitch !== false;
    let includeYoutube = options.includeYoutube !== false;
    if (includeTwitch && loadingByPlatform.twitch) includeTwitch = false;
    if (includeYoutube && loadingByPlatform.youtube) includeYoutube = false;
    if (includeKick && loadingByPlatform.kick) includeKick = false;
    if (!includeTwitch && !includeYoutube && !includeKick) return; // 対象が全て実行中だった場合は何もしない

    if (includeTwitch) loadingByPlatform.twitch = true;
    if (includeYoutube) loadingByPlatform.youtube = true;
    if (includeKick) loadingByPlatform.kick = true;
    refreshBtn.disabled = true;
    setStatus('読み込み中…', false);
    try {
      const result = await window.streamCheckApi.fetchUnifiedFeed({ includeKick, includeTwitch, includeYoutube });
      const items = (result && result.items) || [];
      // 今回取得しなかったプラットフォーム分は、直前まで表示していた内容をそのまま引き継ぐ
      // （overlay-panel.jsのrefreshUnifiedFeed()と同じ、Kickで元々やっていた考え方をTwitch/
      // YouTubeにも一般化したもの）。
      let merged = items;
      if (!includeKick) merged = merged.concat(unifiedFeedItems.filter((item) => item.platform === 'kick'));
      if (!includeTwitch) merged = merged.concat(unifiedFeedItems.filter((item) => item.platform === 'twitch'));
      if (!includeYoutube) merged = merged.concat(unifiedFeedItems.filter((item) => item.platform === 'youtube'));
      unifiedFeedItems = merged;
      render();
      const errors = (result && result.errors) || {};
      const errMessages = [];
      if (includeTwitch && errors.twitch) errMessages.push(`Twitch: ${errors.twitch}`);
      if (includeYoutube && errors.youtube) errMessages.push(`YouTube: ${errors.youtube}`);
      if (includeKick && errors.kick) errMessages.push(`Kick: ${errors.kick}`);
      setStatus(errMessages.join(' / '), errMessages.length > 0);
      updatedAtEl.textContent = `最終更新: ${new Date().toLocaleTimeString('ja-JP')}`;
    } catch (err) {
      grid.textContent = '';
      setStatus(`配信一覧の取得に失敗しました: ${String((err && err.message) || err)}`, true);
    } finally {
      // このload()呼び出しで実際にfetchUnifiedFeedへ渡したプラットフォームだけを解除する
      // （他のプラットフォーム専用タイマーが自分の取得中に立てたフラグを誤って消さないため）。
      if (includeTwitch) loadingByPlatform.twitch = false;
      if (includeYoutube) loadingByPlatform.youtube = false;
      if (includeKick) loadingByPlatform.kick = false;
      // 段階F修正: Twitch/YouTube/Kickの自動更新タイマーはクールダウンを介さず直接load()を
      // 呼ぶため、手動更新のクールダウン中（manualRefreshCooldownActive）に自動更新が完了すると
      // ここで無条件にdisabled=falseへ戻してしまい、ボタン表示（残り秒数）と実際に押せる状態が
      // 食い違うバグがあった。クールダウン中はここでは解除しない。
      refreshBtn.disabled = manualRefreshCooldownActive;
    }
  }

  // 経過時間だけは毎秒再計算する（カード全体の再描画はしない）。
  const elapsedTimer = setInterval(() => {
    grid.querySelectorAll('.stream-check-card-elapsed').forEach((el) => {
      const text = formatElapsedStreamTime(el.dataset.startedAt);
      if (text) el.textContent = text;
    });
  }, 1000);

  // ウィンドウを開いている間、Twitch/YouTube/Kickをそれぞれ独立した間隔で自動更新する
  // （overlay-panel.jsのstartUnifiedFeedAutoTimer()と同じ方針から発展）。
  // 2026-08-08変更（要望⑦）: Twitch(公式API、安全)は5秒間隔、YouTube(非公式HTMLスクレイプ、
  // レート制限リスクあり)は従来通り20秒間隔を維持するため、タイマーを2本に分離した。
  // 段階F変更: Kick分もTwitch同様5秒間隔で自動更新するよう追加（ユーザー確認済み、
  // UNIFIED_FEED_KICK_AUTO_REFRESH_MS参照）。KickはBrowserViewフルロードを伴うため、
  // 負荷が問題になる場合は間隔の見直しが必要になる可能性がある。
  function startAutoTimer() {
    stopAutoTimer();
    twitchAutoTimer = setInterval(
      () => load({ includeKick: false, includeYoutube: false }),
      UNIFIED_FEED_TWITCH_AUTO_REFRESH_MS
    );
    youtubeAutoTimer = setInterval(
      () => load({ includeKick: false, includeTwitch: false }),
      UNIFIED_FEED_YOUTUBE_AUTO_REFRESH_MS
    );
    kickAutoTimer = setInterval(
      () => load({ includeTwitch: false, includeYoutube: false }),
      UNIFIED_FEED_KICK_AUTO_REFRESH_MS
    );
  }
  function stopAutoTimer() {
    if (twitchAutoTimer) {
      clearInterval(twitchAutoTimer);
      twitchAutoTimer = null;
    }
    if (youtubeAutoTimer) {
      clearInterval(youtubeAutoTimer);
      youtubeAutoTimer = null;
    }
    if (kickAutoTimer) {
      clearInterval(kickAutoTimer);
      kickAutoTimer = null;
    }
  }

  window.addEventListener('beforeunload', () => {
    clearInterval(elapsedTimer);
    stopAutoTimer();
    clearInterval(manualRefreshCooldownTimer);
  });

  // 段階F追加: 手動更新ボタンの連打防止クールダウン（5秒、MANUAL_REFRESH_COOLDOWN_MS参照）。
  // クールダウン中はボタンを無効化し、残り秒数をボタン表示に出す。
  // manualRefreshCooldownActiveは、自動更新タイマー由来のload()がクールダウン中に完了して
  // finally句で誤ってdisabledを解除してしまわないようload()側から参照するためのフラグ
  // （load()のfinally句参照）。
  let manualRefreshCooldownActive = false;
  const refreshBtnDefaultLabel = refreshBtn.textContent;
  function startManualRefreshCooldown() {
    clearInterval(manualRefreshCooldownTimer);
    let remainingMs = MANUAL_REFRESH_COOLDOWN_MS;
    manualRefreshCooldownActive = true;
    refreshBtn.disabled = true;
    refreshBtn.textContent = `🔄 更新 (${Math.ceil(remainingMs / 1000)}s)`;
    manualRefreshCooldownTimer = setInterval(() => {
      remainingMs -= 1000;
      if (remainingMs <= 0) {
        clearInterval(manualRefreshCooldownTimer);
        manualRefreshCooldownTimer = null;
        manualRefreshCooldownActive = false;
        refreshBtn.disabled = false;
        refreshBtn.textContent = refreshBtnDefaultLabel;
      } else {
        refreshBtn.textContent = `🔄 更新 (${Math.ceil(remainingMs / 1000)}s)`;
      }
    }, 1000);
  }

  refreshBtn.addEventListener('click', async () => {
    if (refreshBtn.disabled) return; // クールダウン中
    await load();
    startManualRefreshCooldown();
  });
  // ESCキー・OSの閉じるボタンはmain.js側（before-input-event / ウィンドウ標準の閉じるボタン）で
  // 処理される。こちらはヘッダーの×ボタン専用。
  closeBtn.addEventListener('click', () => window.streamCheckApi.closeWindow());

  // 項目⑩追加: 「レイアウト配置」。選択順にmain.jsのapplyLayoutWindowArrange（複窓レイアウト設定
  // ウィンドウの「自動整列」と全く同じ関数・IPC）を呼び、メイン画面のタイルを選択内容で置き換える。
  // 既存タイルは全て閉じられる破壊的操作だが、layout-window側の「自動整列」ボタンと挙動を揃えるため
  // 確認ダイアログは出さない（ユーザー確認済み）。チャット表示は「設定」タブの
  // 「追加時にチャットを非表示にする」設定値をそのまま流用する（専用トグルは新設しない）。
  layoutPlaceBtn.addEventListener('click', async () => {
    if (!layoutSelectedOrder.length) return;
    layoutPlaceBtn.disabled = true;
    setStatus('レイアウトに反映中…', false);
    try {
      const selection = layoutSelectedOrder
        .map((key) => layoutItemsByKey.get(key))
        .filter(Boolean)
        .map((item) => ({
          platform: item.platform,
          channel: item.channel,
          // YouTubeはfetchUnifiedFeedのitem.channelがハンドル文字列そのもの
          // （layout-window.jsの同箇所と同じ扱い）。
          youtubeChannelId: item.platform === 'youtube' ? item.channel : null,
        }));
      const result = await window.streamCheckApi.layoutAutoArrange({
        selection,
        chatVisible: !addWithChatHiddenDefault,
      });
      if (!result || !result.ok) {
        setStatus(`レイアウトへの反映に失敗しました: ${(result && result.error) || '不明なエラー'}`, true);
        return;
      }
      setStatus(`${result.count}件をメイン画面のレイアウトに反映しました`, false);
    } catch (err) {
      setStatus(`レイアウトへの反映に失敗しました: ${String((err && err.message) || err)}`, true);
    } finally {
      layoutPlaceBtn.disabled = layoutSelectedOrder.length === 0;
    }
  });

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

  // ---- 段階F: 設定タブ「追加時にチャットを非表示にする」 ----
  settingsChatHiddenOnAddInput.addEventListener('change', async () => {
    addWithChatHiddenDefault = settingsChatHiddenOnAddInput.checked;
    await window.streamCheckApi.setAddChatHiddenDefault(addWithChatHiddenDefault);
  });

  // ---- 初期化 ----
  (async function init() {
    try {
      const filter = await window.streamCheckApi.getUnifiedFeedPlatformFilter();
      setPlatformFilter(filter || 'all', false);
    } catch (_) {
      setPlatformFilter('all', false);
    }
    try {
      addWithChatHiddenDefault = await window.streamCheckApi.getAddChatHiddenDefault();
      settingsChatHiddenOnAddInput.checked = addWithChatHiddenDefault;
    } catch (_) {
      addWithChatHiddenDefault = false;
    }
    // 2026-08-08修正: 以前は単一の await load() で3プラットフォームを一括取得しており、
    // YouTube（非公式HTMLスクレイプで最大20秒程度かかりうる）の遅さにTwitch/Kick（本来
    // 数秒で終わる）まで引っ張られ、ウィンドウを開いた直後の初回表示が「全サイト20秒待ち」に
    // なってしまっていた不具合の修正。自動更新タイマー（startAutoTimer）と同じ考え方で、
    // Twitch+Kick分とYouTube分を別々のload()呼び出しに分離し、速い方は待たずに即座に表示する。
    // load()内のmerge処理（!includeX時に既存unifiedFeedItemsから該当プラットフォーム分を
    // 引き継ぐロジック）は元々この並行呼び出しを想定して作られているため、そのまま流用できる。
    load({ includeYoutube: false });
    load({ includeTwitch: false, includeKick: false });
    startAutoTimer();
    refreshAutoTuneInStatus();
  })();
});
