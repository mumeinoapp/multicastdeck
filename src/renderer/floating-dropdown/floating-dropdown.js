'use strict';

// 汎用フローティングドロップダウン基盤（MCD大規模アプデ、2026-08-07新設）のレンダラー側ロジック。
// このBrowserView自体は「見た目を描画するだけ」で、履歴データの取得・フィルタ・保存等の
// 状態管理は引き続きメインウィンドウ側（renderer.js）が持つ。メインウィンドウから
// floating-dropdown:content で描画データを受け取り、行がクリックされたら
// window.floatingApi.notify() でメインウィンドウ側へイベントを中継してもらう
// （こちら側はDBや履歴の状態を一切持たない、意図的にダムな作りにしてある）。

const params = new URLSearchParams(window.location.search);
const panelId = params.get('panel') || '';

if (panelId === 'channel-history') {
  mountChannelHistory();
} else if (panelId === 'app-menu') {
  mountAppMenu();
} else if (panelId === 'volume-mixer') {
  mountVolumeMixer();
}

function mountChannelHistory() {
  const root = document.getElementById('channel-history-root');
  root.classList.remove('hidden');

  window.floatingApi.onContent((payload) => {
    if (!payload || payload.id !== 'channel-history') return;
    renderRows(root, payload.rows || []);
  });
}

function renderRows(root, rows) {
  root.innerHTML = '';
  rows.forEach((value) => {
    const row = document.createElement('div');
    row.className = 'input-history-row';

    const label = document.createElement('span');
    label.className = 'input-history-row-label';
    label.textContent = value;
    label.addEventListener('mousedown', (e) => {
      e.preventDefault();
      window.floatingApi.notify('channel-history', 'select', value);
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'input-history-row-remove';
    removeBtn.textContent = '×';
    removeBtn.title = '履歴から削除';
    removeBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.floatingApi.notify('channel-history', 'remove', value);
    });

    row.appendChild(label);
    row.appendChild(removeBtn);
    root.appendChild(row);
  });
}

// 自作メニューバー（ファイル/表示/ヘルプ/バージョン/通知）の小ドロップダウン向け（2026-08-07追加）。
// 実機確認で、これらがposition:absoluteのDOMのままだと配信タイル(BrowserView)の裏に
// 隠れてしまう問題が発覚したため、こちらもfloating-dropdown基盤へ移植した。
// メインウィンドウ側（renderer.js）は「今どのメニューが開いているか」の状態と、対応する
// 既存DOM（#app-menu-bar内の.menu-bar-dropdown、見た目上は配信タイルの裏に隠れたままだが
// レイアウト計算・データソースとしては生きている）から行データを都度読み取ってpushする。
// app-menu余白バグ修正（2026-08-10）: メインウィンドウ側の隠れたDOM(.menu-bar-dropdown、
// style.css基準)から算出したBrowserView矩形は、実際にここで描画する中身(floating-dropdown.css
// 基準、フォントサイズや要素構成が異なる箇所がある)と高さがずれ、ファイル/表示/ヘルプ/
// バージョン/通知の各ドロップダウン下部に余分な空白が生じていた。描画後にroot.scrollHeight
// （実際に必要な高さ）を都度メインプロセスへ報告し、BrowserViewの高さを実寸へ補正してもらう。
// 通知ドロップダウンのみ、意図的に「5件表示してスクロール」の上限(style.cssの
// #notifications-menu-dropdown { max-height: 270px }と対応)を持つため、その場合は報告値を
// 同じ上限でクランプし、既存のスクロールUXを崩さないようにする。
const NOTIFICATIONS_DROPDOWN_MAX_HEIGHT = 270;

function mountAppMenu() {
  const root = document.getElementById('app-menu-root');
  root.classList.remove('hidden');

  window.floatingApi.onContent((payload) => {
    if (!payload || payload.id !== 'app-menu') return;
    root.classList.toggle('wrap-rows', !!payload.wrap);
    renderAppMenuRows(root, payload.rows || []);
    // root.scrollHeightの読み取り自体がレイアウトの再計算を強制するため、renderAppMenuRowsで
    // 組み立てた直後でもタイミングのずれなく正確な高さが取れる（ResizeObserver等は不要）。
    const measuredHeight = payload.wrap
      ? Math.min(root.scrollHeight, NOTIFICATIONS_DROPDOWN_MAX_HEIGHT)
      : root.scrollHeight;
    window.floatingApi.reportContentHeight('app-menu', measuredHeight);
  });
}

function renderAppMenuRows(root, rows) {
  // 通知タブ刷新（2026-08-09）: YouTube通知対象の追加入力欄は、通知の新着受信のたびに
  // notifications:state-changed経由で本関数が再実行されrootが作り直されるため、何も対策しないと
  // 入力途中のテキストが消えてしまう。再構築前に既存入力欄の値・フォーカス有無を退避し、
  // 再構築後に復元する。
  const existingInput = root.querySelector('.youtube-target-add-input');
  const preservedInputValue = existingInput ? existingInput.value : '';
  const preservedInputFocused = existingInput === document.activeElement;

  root.innerHTML = '';
  rows.forEach((row) => {
    if (row.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'menu-bar-dropdown-separator';
      root.appendChild(sep);
      return;
    }
    // 通知タブ刷新（2026-08-09）: 通知行はアイコンバッジ+テキストの2要素構成で、クリックすると
    // その配信をメイン画面へ追加する専用の行タイプ。実際にユーザーがクリックするのはこちら側
    // （BrowserViewのコピー）のため、mousedownで'app-menu'パネルへaction通知を送る。
    if (row.type === 'notification') {
      const el = document.createElement('div');
      el.className = 'menu-bar-dropdown-item notification-item';
      if (row.alreadyAdded) el.classList.add('already-added');

      // renderer.js側のnotificationPlatformBadge()と同じ分岐（通知タブ刷新2026-08-09でYouTube追加）。
      const badgeCls = row.platform === 'kick' ? 'kick' : row.platform === 'youtube' ? 'youtube' : 'twitch';
      const glyph = row.platform === 'kick' ? 'K' : row.platform === 'youtube' ? '▶' : '●';
      const badge = document.createElement('span');
      badge.className = `notif-platform-badge ${badgeCls}`;
      badge.textContent = glyph;
      el.appendChild(badge);

      const text = document.createElement('span');
      text.className = 'notif-item-text';
      text.textContent = row.text || row.channel || '';
      el.appendChild(text);

      if (!row.alreadyAdded) {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          window.floatingApi.notify('app-menu', 'action', {
            action: 'add-channel-from-notification',
            channel: row.channel,
            platform: row.platform,
          });
        });
      }
      root.appendChild(el);
      return;
    }
    // 通知タブ刷新（2026-08-09）: YouTube通知対象リストの1件（チャンネル名＋×削除ボタン）。
    if (row.type === 'youtube-target-item') {
      const el = document.createElement('div');
      el.className = 'menu-bar-dropdown-item youtube-target-item';

      const text = document.createElement('span');
      text.className = 'youtube-target-item-text';
      text.textContent = row.label || row.channel || '';
      el.appendChild(text);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'youtube-target-remove-btn';
      removeBtn.textContent = '×';
      removeBtn.title = '通知対象から削除';
      removeBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.floatingApi.notify('app-menu', 'youtube-target-remove', { channel: row.channel });
      });
      el.appendChild(removeBtn);

      root.appendChild(el);
      return;
    }
    // 通知タブ刷新（2026-08-09）: YouTube通知対象を追加するための入力欄＋追加ボタン。
    if (row.type === 'youtube-target-add') {
      const el = document.createElement('div');
      el.className = 'menu-bar-dropdown-item youtube-target-add';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'youtube-target-add-input';
      input.placeholder = '@ハンドル / チャンネル名';
      // メニュー全体のドラッグ・閉じる判定に巻き込まれないよう伝播を止める。
      input.addEventListener('mousedown', (e) => e.stopPropagation());

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'youtube-target-add-btn';
      addBtn.textContent = '追加';

      const submit = () => {
        const value = input.value.trim();
        if (!value) return;
        window.floatingApi.notify('app-menu', 'youtube-target-add', { channel: value });
        input.value = '';
      };
      addBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        submit();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });

      el.appendChild(input);
      el.appendChild(addBtn);
      root.appendChild(el);
      return;
    }
    const el = document.createElement('div');
    el.className = 'menu-bar-dropdown-item';
    el.textContent = row.label;
    if (row.type === 'disabled') {
      el.classList.add('disabled');
    } else {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        window.floatingApi.notify('app-menu', 'action', { action: row.action, url: row.url });
      });
    }
    root.appendChild(el);
  });

  // 退避しておいた入力欄の値・フォーカスを復元する（通知タブ刷新2026-08-09）。
  if (preservedInputValue) {
    const newInput = root.querySelector('.youtube-target-add-input');
    if (newInput) {
      newInput.value = preservedInputValue;
      if (preservedInputFocused) newInput.focus();
    }
  }
}

// 音量ミキサー（旧rectOverlayHiding方式から移植、2026-08-07セッション内追加）。
// メインウィンドウ側（renderer.js）がチャンネル一覧・音量値の取得と永続化(setChannelVolume)を
// 担い、こちら側は描画とスライダー/ミュートアイコンのユーザー操作の中継のみを行う。
//
// 注意: スライダードラッグ中は`input`イベントが高頻度で発火する。行データ(rows)のチャンネン
// 集合が前回と変わっていない場合はDOM(input要素含む)を作り直さず値だけ更新することで、
// メインウィンドウ→（notify）→main→（setContent再送）→こちら、という一往復の間に
// ドラッグ中のつまみがカクつく／戻る現象を避ける。ミュートアイコンの見た目切り替えは
// 応答性を優先し、mainへの往復を待たずこちら側でローカルに即時反映する。
let volumeMixerRowKey = '';

function mountVolumeMixer() {
  const root = document.getElementById('volume-mixer-root');
  root.classList.remove('hidden');

  window.floatingApi.onContent((payload) => {
    if (!payload || payload.id !== 'volume-mixer') return;
    renderVolumeMixerRows(root, payload.rows || [], !!payload.empty);
  });
}

function renderVolumeMixerRows(root, rows, empty) {
  const key = rows.map((r) => r.name).join('');

  if (empty || rows.length === 0) {
    volumeMixerRowKey = '';
    root.innerHTML = '';
    const note = document.createElement('div');
    note.className = 'volume-mixer-empty';
    note.textContent = '配信がありません';
    root.appendChild(note);
    return;
  }

  if (key !== volumeMixerRowKey) {
    // チャンネル構成が変わった場合のみDOMを作り直す
    volumeMixerRowKey = key;
    root.innerHTML = '';
    rows.forEach((row) => {
      root.appendChild(buildVolumeRow(row));
    });
    return;
  }

  // チャンネル構成が同じ場合は既存の行の値だけ更新する（ドラッグ中のカクつき防止）
  const rowEls = root.querySelectorAll('.volume-row');
  rows.forEach((row, index) => {
    const rowEl = rowEls[index];
    if (!rowEl) return;
    updateVolumeRow(rowEl, row);
  });
}

function buildVolumeRow(row) {
  const rowEl = document.createElement('div');
  rowEl.className = 'volume-row';
  rowEl.dataset.name = row.name;

  const icon = document.createElement('span');
  icon.className = 'volume-icon';
  icon.addEventListener('mousedown', (e) => {
    e.preventDefault();
    window.floatingApi.notify('volume-mixer', 'toggle-mute', rowEl.dataset.name);
  });

  const name = document.createElement('span');
  name.className = 'volume-row-name';
  name.textContent = row.name;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.addEventListener('input', () => {
    icon.textContent = Number(slider.value) === 0 ? '🔇' : '🔊';
    window.floatingApi.notify('volume-mixer', 'set-volume', {
      name: rowEl.dataset.name,
      value: Number(slider.value),
    });
  });

  rowEl.appendChild(icon);
  rowEl.appendChild(name);
  rowEl.appendChild(slider);
  updateVolumeRow(rowEl, row);
  return rowEl;
}

function updateVolumeRow(rowEl, row) {
  const icon = rowEl.querySelector('.volume-icon');
  const slider = rowEl.querySelector('input[type="range"]');
  icon.textContent = row.muted ? '🔇' : '🔊';
  // ユーザーがドラッグ中のスライダーの値をサーバ側の値で上書きしないよう、
  // フォーカスが当たっている（＝操作中の可能性が高い）スライダーへの値の再代入はスキップする
  if (document.activeElement !== slider) {
    slider.value = String(row.volume);
  }
}
