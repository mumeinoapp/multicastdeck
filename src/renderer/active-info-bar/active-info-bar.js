'use strict';

// アクティブタイルのメタ情報帯（2026-08-09新設）本体ロジック。
// 表示内容の更新（onSetChannel/onContent）と、下端・左下・右下を掴んでのリサイズ操作を担う。
// リサイズ操作の実装は src/renderer/renderer.js の #tile-info-bars 向けロジック
// （infoBarResizeZone/infoBarCursorForZone等）と意図的に同じ挙動・同じ定数値にしてある
// （このビューは「アクティブな時だけ前面に来る、同じ見た目のバーの分身」のため、挙動が
// 食い違うと混乱を招く）。ビュー自体がバーの矩形そのものなので、closest('.tile-info-bar')の
// ような要素探索は不要で、常にwindow全体を対象にする。

const barEl = document.getElementById('bar');
const nameEl = document.getElementById('bar-name');
const titleEl = document.getElementById('bar-title');
const categoryEl = document.getElementById('bar-category');
const statsEl = document.getElementById('bar-stats');

let currentChannel = null;

window.activeInfoBarApi.onSetChannel((channel) => {
  currentChannel = channel;
  nameEl.textContent = channel || '';
  titleEl.textContent = '';
  categoryEl.textContent = '';
  statsEl.textContent = '';
});

window.activeInfoBarApi.onContent((payload) => {
  if (!payload || payload.name !== currentChannel) return; // 切り替え直後の古いデータの取りこぼし対策
  titleEl.textContent = payload.title || '';
  categoryEl.textContent = payload.category || '';
  statsEl.textContent = payload.stats || '';
});

// ---- 下端・左下・右下を掴んでのリサイズ（src/renderer/renderer.jsの#tile-info-bars相当） ----
const CORNER_EDGE_PX = 14; // renderer.jsのTILE_INFO_BAR_CORNER_EDGE_PXと同じ値
let dragging = false;
let rafPending = false;
let latestPoint = null;

function resizeZone(clientX) {
  const w = window.innerWidth;
  if (clientX <= CORNER_EDGE_PX) return 'sw';
  if (clientX >= w - CORNER_EDGE_PX) return 'se';
  return 's';
}

function cursorForZone(dir) {
  if (dir === 'sw') return 'nesw-resize';
  if (dir === 'se') return 'nwse-resize';
  return 'ns-resize';
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !currentChannel) return;
  const dir = resizeZone(e.clientX);
  dragging = true;
  barEl.style.cursor = cursorForZone(dir);
  window.activeInfoBarApi.startTileInteraction({
    channel: currentChannel,
    origin: 'stream',
    type: 'resize',
    dir,
    screenX: e.screenX,
    screenY: e.screenY,
  });
});

window.addEventListener('mousemove', (e) => {
  if (dragging) {
    latestPoint = { x: e.screenX, y: e.screenY };
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (dragging && latestPoint) {
          window.activeInfoBarApi.moveTileInteraction(latestPoint);
        }
      });
    }
    return;
  }
  barEl.style.cursor = cursorForZone(resizeZone(e.clientX));
});

function endDrag() {
  if (!dragging) return;
  dragging = false;
  latestPoint = null;
  barEl.style.cursor = 'ns-resize';
  window.activeInfoBarApi.endTileInteraction();
}
window.addEventListener('mouseup', endDrag);
window.addEventListener('blur', endDrag);
