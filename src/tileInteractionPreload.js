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

// タイル端から何pxまでを「リサイズ用の縁」とみなすか（既定値。YouTubeタイルはmain.jsの
// sendEdgeConfig()からedgePxで上書きされる、下記ipcRenderer.on参照）
let EDGE_PX = 10;

let channelName = null;
let viewTarget = 'stream'; // 'stream' | 'chat'（メインプロセス側がこのBrowserViewを一時的に隠す判断に使う）
// メインプロセスから渡される、このBrowserViewで有効な辺（配信側/チャット側で異なる）
let edges = { top: true, bottom: true, left: true, right: true };
let dragging = false;
// 2026-08-09追加（実機報告対応）: 通常は「移動ゾーン」のmousedownではpreventDefaultしない
// （中央の移動ゾーン・通常クリックには影響しないようにするため、下記mousedownハンドラの
// コメント参照）。ただしYouTubeタイルの自前ラッパー（main.js ensureYoutubeEmbedServer）は
// 縁の部分に保護すべきクリック可能要素が無い一方、Chromiumの既定のテキスト選択/ネイティブ
// ドラッグが誤発生してタイル全体が選択されたように見える不具合が実機で確認されたため、
// このフラグがtrueの間は移動ゾーンでも常にpreventDefaultする（main.js側からYouTubeタイルにのみ
// alwaysPreventDefault:trueが送られてくる）。
let alwaysPreventDefault = false;

ipcRenderer.on('tile-edge-config', (_event, payload) => {
  if (!payload) return;
  channelName = payload.channel;
  if (payload.target) viewTarget = payload.target;
  if (payload.edges) edges = payload.edges;
  if (typeof payload.edgePx === 'number' && payload.edgePx > 0) EDGE_PX = payload.edgePx;
  alwaysPreventDefault = !!payload.alwaysPreventDefault;
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

/**
 * Chromiumは<img>/<a href>要素を既定でネイティブドラッグ可能(draggable=true)として扱う。
 * Twitch本体のDOMは移動ゾーン（タイル中央）にもアバター画像等の<img>を重ねて表示しており、
 * そこでmousedown直後にわずかでもポインタが動くとネイティブHTML5ドラッグが開始してしまい、
 * 以降mousemoveがこのwindowへ届かなくなって（dragstart時にendDragが走るだけで移動は止まる）
 * タイル移動が実質不可能になる不具合があった（2026-08-17報告）。Kick/YouTubeの埋め込みには
 * 同様の<img>オーバーレイが無いため再現しない。ネイティブドラッグの起点になり得る要素上でだけ
 * mousedownでpreventDefaultすることで、通常のクリック（mouseupで発火するclick自体は
 * preventDefaultの影響を受けない）は温存しつつドラッグ横取りだけを止める。
 */
function isNativeDraggableElement(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest('img, a[href]');
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
    // preventDefaultは基本的に呼ばない：通常のクリック（再生ボタン・チャット欄操作等）を
    // そのまま素通りさせつつ、並行してウィンドウマネージャー的な移動/リサイズを行う。
    // ただし「リサイズ用の縁」(dir が空でない)でmousedownした場合に限っては例外的に呼ぶ。
    // Twitch本体のDOM（タイトル・LIVEバッジ・アバター画像等のオーバーレイ要素）が縁の帯に
    // 重なっていると、画像の既定のネイティブドラッグ（HTML5 Drag and Drop）がこちらのカスタム
    // リサイズより先に開始してしまい、以降mousemoveが届かなくなって「数px動くと途切れる」不具合の
    // 原因になっていた。リサイズ開始時のみpreventDefaultすることでネイティブドラッグ自体の開始を
    // 抑止する（中央の移動ゾーン・通常クリックには影響しないため、再生ボタン等の操作性は維持される）。
    // 2026-08-09追加: alwaysPreventDefault（YouTubeタイルのみtrue）の場合は、移動ゾーンの
    // mousedownでも同様にpreventDefaultする。YouTubeの自前ラッパーの縁には保護すべき
    // クリック可能要素が無いため、常時preventDefaultしても再生ボタン等への影響が無い
    // （実際のYouTube UIはクロスオリジンiframeの中）。
    if (dir || alwaysPreventDefault || isNativeDraggableElement(e.target)) e.preventDefault();
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
