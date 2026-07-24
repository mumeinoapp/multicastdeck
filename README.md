# MultiCastDeck（Twitch/YouTube/Kick マルチストリーム & Drops 統合ツール）

企画資料「機能①」の実装（プロトタイプ→完成版）です。

## セットアップ

```bash
cd multistream-drops-tool
npm install
npm start
```

初回起動後、右上の「⚙ 設定」から `parent` ドメインやレイアウト列数、スタンプ機能用のTwitch Helix Client ID/Secret を設定してください。

## 実装済み機能

- 複数チャンネルの同時視聴（Twitch公式埋め込みプレイヤー `player.twitch.tv`）
- チャット埋め込み（`twitch.tv/embed/.../chat`。決済はTwitch公式UIに委譲、独自決済は未実装）
- レイアウト自由化：自動グリッドに加え、列数の手動指定（設定画面）、チャンネルチップのドラッグ&ドロップによる並び替え
- Dropsインベントリのアプリ内表示（`twitch.tv/drops/inventory` を実ページのままBrowserViewで表示）
- Drops進捗のDOM読み取り（**「確認操作をした時だけ」実行するオンデマンド設計**。常時ポーリングはしない）
- 広告再生中の自動ミュート／解除（ヒューリスティック検知。ON/OFF切替可）
- スタンプ（エモート）一覧・お気に入り機能：Twitch Helix API（無料のClient Credentials方式）でチャンネル+グローバルエモートを取得し、クリックでコード名をクリップボードにコピー、Shift+クリックでお気に入り登録（**ローカル保存のみ**。企画資料の方針どおり独自決済・投稿機能は持たない）
- 設定画面：`parent`ドメイン変更（変更時は自動で埋め込みを再読み込み）、レイアウト列数、Helix認証情報
- 非公式機能に関する注記モーダル（「⚠ 注記」ボタン）
- 配信/チャット読み込み失敗時のエラー通知（ステータス表示欄）
- アプリメニュー（再読み込み・開発者ツール・Twitch Developer Console導線）
- チャンネル追加/削除・並び順・設定を `electron-store` でローカル永続化

## アップデート確認機能

設定画面に「アップデートを確認」ボタンがあり、押すと GitHub Releases（`mumeinoapp/multicastdeck`）を参照して新しいバージョンの有無を確認する。新しいバージョンがあればダウンロードし、完了すると「今すぐ更新して再起動」ボタンが表示される（自動チェック・自動インストールはせず、必ずユーザーの操作を経てから適用される）。

## リリース手順（アップデート配布）

新しいバージョンを配布する際は、以下の手順で行う。

1. `package.json` の `version` を更新する（例: `0.1.1`）
2. `CHANGELOG.md` の `[Unreleased]` に書いていた変更点を、新しいバージョン番号の見出しの下に移動する（日付も記載）
3. GitHubのPersonal Access Token（`repo`権限）を発行し、環境変数 `GH_TOKEN` に設定する
4. `npm run release` を実行する（`electron-builder --win --publish always`）。ビルドしたインストーラーが GitHub Releases（`https://github.com/mumeinoapp/multicastdeck/releases`）に自動でアップロードされ、`latest.yml` も生成される（これをアプリ内の「アップデートを確認」が参照する）
5. GitHub Releases画面で、そのリリースの説明欄に `CHANGELOG.md` の該当バージョンの内容を貼り付けて公開する（Draftのまま作られるので、内容を確認してから「Publish release」を押す）
6. 配布が確認できたら、はてなブログ（`https://mumeinoapp.hatenablog.com/`）に更新内容の記事を投稿する

## 既知の制約（要フォロー）

- `parent` パラメータの初期値は `localhost`。実配布時は配布ドメインに応じて設定画面で変更が必要
- Drops進捗・広告検知のDOM/CSSセレクタはTwitchの現行構造を前提にした実装。**Twitch側のDOM変更で動作しなくなる可能性があるため、実機での定期的な動作確認が必要**（非公式機能である旨はUI上にも明記済み）
- スタンプ機能はTwitch Developer Consoleでの無料アプリ登録（Client ID/Secret取得）がユーザー側で必要
- お気に入りエモートのコピーはコード名（`:name:`）のクリップボードコピーまでで、実際の投稿は引き続きTwitch公式チャット欄で行う設計（決済・投稿処理を自前実装しない企画方針を踏襲）

## 既知のリスク（企画資料より）

- Drops進捗表示・広告自動ミュートは非公式機能。Twitch側の仕様変更で機能停止する可能性がある
- 個人アカウントBANの明確な事例は確認されていないが、可能性はゼロではない
