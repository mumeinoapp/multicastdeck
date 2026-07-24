'use strict';

/**
 * 配信/チャットの BrowserView に注入するプリロード。
 * BrowserViewは常にHTMLより最前面に描画されるため、タイルのドラッグ移動・
 * 端からのリサイズを実現するには、配信/チャット画面そのものの上で
 * mousedown/mouseup を検知する必要がある。ここで検知した操作はIPCで
 * メインプロセスへ送るだけで、実際の位置計算・BrowserViewのbounds更新は
 * すべてメインプロセス側（main.js の tile-interaction 系関数）で行う。
 *
 * contextIsolation:true / sandbox:true の環境でも、preloadスクリプトは
 * 実DOM（window/document）にイベントリスナーを登録できるため、
 * contextBridgeで何かを公開しなくても入力検知自体は可能。
 */
const { ipcRenderer } = require('electron');

// タイル端から何pxまでを「リサイズ用の縁」とみなすか
const EDGE_PX = 10;

let channelName = null;
let viewTarget = 'stream'; // 'stream' | 'chat'（メインプロセス側がこのBrowserViewを一時的に隠す判断に使う）
// メインプロセスから渡される、このBrowserViewで有効な辺（配信側/チャット側で異なる）
let edges = { top: true, bottom: true, left: true, right: true };
let dragging = false;

ipcRenderer.on('tile-edge-config', (_event, payload) => {
  if (!payload) return;
  channelName = payload.channel;
  if (payload.target) viewTarget = payload.target;
  if (payload.edges) edges = payload.edges;
});

function zoneAt(x, y) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const nearTop = edges.top && y <= EDGE_PX;
  const nearBottom = edges.bottom && y >= h - EDGE_PX;
  const nearLeft = edges.left && x <= EDGE_PX;
  const nearRight = edges.right && x >= w - EDGE_PX;
  let dir = '';
  if (nearTop) dir += 'n';
  if (nearBottom) dir += 's';
  if (nearLeft) dir += 'w';
  if (nearRight) dir += 'e';
  return dir; // 空文字なら「移動」ゾーン
}

/**
 * Twitchプレイヤーの音量スライダー・シークバー等、ドラッグ操作そのものが本来の機能であるネイティブUI要素を
 * 判定する（非公式のヒューリスティック判定。Twitch側のDOM構造変更で効かなくなる可能性がある）。
 * これらの要素の上でmousedownした場合はタイル移動/リサイズを開始せず、Twitch本来のドラッグ操作に譲る。
 * そうしないと、音量スライダーをドラッグしようとした時にタイル自体も一緒に動いてしまう（実機で確認された不具合）。
 */
function isNativeDragControl(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest(
    [
      'input[type="range"]',
      '[role="slider"]',
      '[class*="volume-slider" i]',
      '[class*="seekbar" i]',
      '[class*="seek-bar" i]',
      '[class*="progress-bar" i]',
      '[data-a-target*="volume" i]',
      '[data-a-target*="seek" i]',
      '[data-a-target*="progress" i]',
    ].join(', ')
  );
}

function cursorForZone(dir) {
  const map = {
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    nw: 'nwse-resize',
    se: 'nwse-resize',
  };
  return map[dir] || 'move';
}

// ドラッグ中はメインプロセス側でのタイマーポーリング（setInterval）を使わず、
// 実際のmousemoveイベント（＝OSのマウス移動そのもの）にそのまま同期させて座標をIPC送信する。
// 固定間隔ポーリングだとNode側のタイマー精度・処理負荷でカクつく（ガクガクする）ことがあったための変更。
// 高頻度になりすぎないよう requestAnimationFrame で1フレームに1回だけ送るよう間引く。
let rafPending = false;
let latestPoint = null;

window.addEventListener(
  'mousemove',
  (e) => {
    if (dragging) {
      latestPoint = { x: e.screenX, y: e.screenY };
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          if (dragging && latestPoint) {
            ipcRenderer.send('tile-interaction:move', latestPoint);
          }
        });
      }
      return;
    }
    const dir = zoneAt(e.clientX, e.clientY);
    document.documentElement.style.cursor = dir ? cursorForZone(dir) : '';
  },
  true
);

window.addEventListener(
  'mousedown',
  (e) => {
    if (e.button !== 0 || !channelName) return;
    if (isNativeDragControl(e.target)) return; // 音量スライダー等のネイティブ操作を優先
    const dir = zoneAt(e.clientX, e.clientY);
    // チャット欄は「端（リサイズ用の縁）」以外では移動ドラッグを開始しない。
    // チャット欄はスクロール・クリック操作（メッセージリンク等）が多く、
    // 内部クリックでタイル移動が始まってしまうと通常のチャット操作を阻害するため。
    if (viewTarget === 'chat' && !dir) return;
    dragging = true;
    // YouTube等、ページ内にiframe（別ドキュメント）がある場合、ポインタがiframe上に
    // 入った瞬間にこのwindowへmousemove/mouseupが届かなくなり、素早い操作でドラッグ/リサイズが
    // 途中で止まってしまう問題があった。ドラッグ中だけiframeを一時的にクリック透過にして、
    // このページ（縁の部分）が常にマウスイベントを受け取れるようにする。
    document.querySelectorAll('iframe').forEach((f) => {
      f.style.pointerEvents = 'none';
    });
    // preventDefaultは呼ばない：通常のクリック（再生ボタン・チャット欄操作等）を
    // そのまま素通りさせつつ、並行してウィンドウマネージャー的な移動/リサイズを行う。
    ipcRenderer.send('tile-interaction:start', {
      channel: channelName,
      origin: viewTarget,
      type: dir ? 'resize' : 'move',
      dir,
      screenX: e.screenX,
      screenY: e.screenY,
    });
  },
  true
);

function endDrag() {
  if (!dragging) return;
  dragging = false;
  latestPoint = null;
  document.documentElement.style.cursor = '';
  document.querySelectorAll('iframe').forEach((f) => {
    f.style.pointerEvents = '';
  });
  ipcRenderer.send('tile-interaction:end');
}

window.addEventListener('mouseup', endDrag, true);
// 画像等のネイティブドラッグ開始でmouseupが飲み込まれるケースの保険
window.addEventListener('dragstart', endDrag, true);
