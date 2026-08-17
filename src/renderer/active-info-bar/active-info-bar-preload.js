'use strict';

// アクティブタイルのメタ情報帯（2026-08-09新設）専用のpreload。
// このBrowserViewは、直前にクリック/ドラッグ操作した「アクティブな」タイルのメタ情報帯
// （チャンネル名・タイトル・カテゴリ・視聴者数/経過時間）だけを表示する、常に他のタイルより
// 前面に来る小さな透明ウィンドウ。ホストウィンドウのHTML(#tile-info-bars)にある通常の
// タイル情報帯はElectronの仕様上どのBrowserViewよりも常に背面になってしまうため、
// 「アクティブなタイルの映像が前面に来る時は、そのメタ情報も一緒に前面に来てほしい」という
// 要望に対して、このタイルだけ専用のBrowserView化して対応する（詳細はmain.jsの
// updateActiveInfoBar/bringTileToFront参照）。
//
// ネットワーク取得は一切行わない。表示内容はメインウィンドウのrenderer.js側が既に毎秒
// 計算している値（streamMetaCacheベース）をそのまま転送してもらう方式にし、二重に
// fetchAllStreamMeta()を叩いてYouTube等へのリクエスト頻度を増やさないようにしている。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('activeInfoBarApi', {
  // アクティブなチャンネルが切り替わった直後、まずチャンネル名だけ即座に表示するために送られる
  // （タイトル/カテゴリ/統計はこの時点ではまだ空。次のonContentで埋まる、最大1秒程度の遅延）。
  onSetChannel: (cb) => ipcRenderer.on('active-info-bar:set-channel', (_e, channel) => cb(channel)),
  // メインウィンドウ側で毎秒計算済みの表示内容（タイトル・カテゴリ・統計の文字列）を受け取る。
  onContent: (cb) => ipcRenderer.on('active-info-bar:content', (_e, payload) => cb(payload)),

  // 下端・左下・右下を掴んでのリサイズ。既存のrenderer.js（#tile-info-bars）・
  // tileInteractionPreload.js（BrowserView内）と全く同じ'tile-interaction:*'プロトコルを
  // そのまま中継する（main.js側の処理はどの発生元でも共通、preload.jsのstartTileInteraction/
  // moveTileInteraction/endTileInteractionと同じチャンネル名）。
  startTileInteraction: (payload) => ipcRenderer.send('tile-interaction:start', payload),
  moveTileInteraction: (point) => ipcRenderer.send('tile-interaction:move', point),
  endTileInteraction: () => ipcRenderer.invoke('layout:interaction-end'),
});
