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
function mountAppMenu() {
  const root = document.getElementById('app-menu-root');
  root.classList.remove('hidden');

  window.floatingApi.onContent((payload) => {
    if (!payload || payload.id !== 'app-menu') return;
    root.classList.toggle('wrap-rows', !!payload.wrap);
    renderAppMenuRows(root, payload.rows || []);
  });
}

function renderAppMenuRows(root, rows) {
  root.innerHTML = '';
  rows.forEach((row) => {
    if (row.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'menu-bar-dropdown-separator';
      root.appendChild(sep);
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
