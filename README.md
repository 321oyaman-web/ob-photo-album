# OB会 思い出アルバム

サークルのOB会の思い出写真を、**無料枠のまま500枚以上**保存・共有できるサイトです。
チャットボット「アルバム係」に話しかけて、写真を探したり（出す）、追加したり（入れる）できます。

---

## 構成

| 役割 | 使うもの | 費用 |
|---|---|---|
| 写真の保管庫 | Cloudflare R2（10GB 無料・**閲覧の転送量は無料**） | 0円 |
| サイト公開・API | Vercel（Hobby プラン） | 0円 |
| チャットボット | ルールベース（ブラウザ内で完結） | 0円 |
| データベース | 不要（R2 上の JSON 1ファイルで管理） | 0円 |

**外部パッケージは一切使っていません**（`npm install` 不要）。AWS の署名処理は Node 標準の `crypto` だけで実装しています。

### 容量の目安

アップロード時にブラウザ側で自動縮小します（長辺2048px・JPEG）。

- 1枚あたり約 **0.4〜0.8MB**（原本が5MBでも縮小されます）
- **500枚 ≒ 約300MB** → 10GB の無料枠に対して **3%程度**
- 計算上は **1万枚以上**保存できます

---

## セットアップ手順

### 1. Cloudflare R2 でバケットを作る

1. [Cloudflare](https://dash.cloudflare.com/) にサインアップ（無料）
2. 左メニューの **R2** を開く
3. R2 の有効化にはクレジットカード登録が必要です（**無料枠の範囲内なら請求は発生しません**）
4. **Create bucket** をクリックし、名前を `ob-photo-album` にする
5. 作成後、画面右側に表示される **アカウントID** を控える

### 2. R2 の API トークンを発行する

1. R2 の画面で **API** → **Manage API Tokens** → **Create API Token**
2. 権限は **Object Read & Write** を選ぶ
3. 対象バケットを `ob-photo-album` に限定する（推奨）
4. 表示される **Access Key ID** と **Secret Access Key** を控える
   （Secret は一度しか表示されません）

> ⚠️ 控えたキーは **OneDrive の中に保存しないでください**。
> ローカルに置く場合は `C:\Users\qqdx4\secrets\ob-photo-album\.env` など OneDrive の外へ。

### 3. Vercel にデプロイする

1. このフォルダーを GitHub のリポジトリにプッシュする（**Private** 推奨）
   - Vercel の Hobby プランは **Git organization 所有のリポジトリに接続できません**。
     必ず**個人アカウント配下**にリポジトリを作ってください
2. [Vercel](https://vercel.com/) で **Add New → Project** からそのリポジトリを選ぶ
3. Framework Preset は **Other**、Build Command は空のままで **Deploy**
4. 発行された URL（`https://〇〇.vercel.app`）を控える

### 4. 環境変数を設定する

Vercel のプロジェクト画面 → **Settings** → **Environment Variables** に以下を登録します。
（`.env.example` と同じ項目です。**コードには絶対に書かないでください**）

| 変数名 | 内容 |
|---|---|
| `R2_ACCOUNT_ID` | 手順1で控えたアカウントID |
| `R2_ACCESS_KEY_ID` | 手順2の Access Key ID |
| `R2_SECRET_ACCESS_KEY` | 手順2の Secret Access Key |
| `R2_BUCKET` | `ob-photo-album` |
| `ALBUM_PASSWORD` | **閲覧用の合言葉**（OB会メンバーに配布） |
| `ADMIN_PASSWORD` | **管理用の合言葉**（幹事のみ。追加・削除ができる） |
| `SESSION_SECRET` | 32文字以上のランダム文字列 |

`SESSION_SECRET` は PowerShell で生成できます。

```bash
powershell -Command "[Convert]::ToBase64String((1..32|%{Get-Random -Max 256}))"
```

登録後、**Deployments → 最新のデプロイ → Redeploy** で環境変数を反映させてください。

### 5. R2 のCORS設定（これを忘れるとアップロードだけが失敗します）

手順3で控えた URL を使います。バケットの **Settings** → **CORS Policy** → **Edit** に貼り付けてください。

```json
[
  {
    "AllowedOrigins": ["https://あなたのサイト.vercel.app"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

> 写真の**表示**は `<img>` タグ経由なので CORS 不要ですが、**アップロード**はブラウザから
> R2 へ直接 PUT するため CORS が必須です。「見られるのに追加できない」場合はここを疑ってください。

### 6. 動作確認

1. サイトを開き、**管理用の合言葉**でログイン
2. 「写真を追加」から1枚アップロードして、ギャラリーに出るか確認
3. 写真をタップ →「ダウンロード」で保存できるか確認
4. チャットボットに「何枚ある？」と聞いて応答するか確認

---

## 使い方

### 見る（写真を出す）

1. サイトを開き、**閲覧用の合言葉**を入力
2. 年・イベントのボタンや検索ボックスで絞り込む
3. 写真をタップすると拡大表示 → **ダウンロード**ボタンで元画質を保存

### 追加する（写真を入れる）

1. **管理用の合言葉**でログイン
2. ヘッダーの「写真を追加」、またはチャットボットに「写真を追加したい」と入力
3. 写真を選び、**撮影年・イベント名・タグ**を入れて「アップロード」
   - 一度に複数枚まとめて選べます
   - 同じイベントの写真はまとめてアップロードすると効率的です

### チャットボットへの話しかけ方の例

| 入力例 | 動作 |
|---|---|
| `2019年の写真を見せて` | 2019年の写真に絞り込み |
| `令和元年の合宿` | 和暦も認識して絞り込み |
| `花見の写真ある？` | イベント名・タグ・説明文から検索 |
| `最近の写真` | 新しい順に表示 |
| `ランダムで見せて` | ランダムに6枚提案 |
| `何枚ある？` | 登録枚数を年別に集計 |
| `イベント一覧` | 登録されているイベントを一覧表示 |
| `写真を追加したい` | アップロード画面を開く（管理者のみ） |
| `使い方` | ヘルプを表示 |

---

## セキュリティ上の設計

- R2 バケットは**非公開**のまま運用し、画像は**都度発行する2時間有効の署名付きURL**でのみ配信
- R2 のシークレットは**サーバー側（Vercel Functions）にのみ存在**し、ブラウザには渡らない
- ログイン状態は HMAC 署名付きトークンで管理（有効期間7日・`sessionStorage` 保存）
- 検索エンジンにインデックスされないよう `noindex` を指定

---

## 制限事項

- **HEIC 形式**（iPhone の標準設定）は Safari 以外のブラウザで変換に失敗することがあります。
  iPhone 側で「設定 → カメラ → フォーマット → 互換性優先」にしておくと JPEG で撮影されます。
- 複数人が**同時に**アップロードすると、写真一覧（`index/manifest.json`）の更新が競合して
  一部の登録が失われる可能性があります。アップロードは幹事の方が順番に行ってください。
- アップロード時に長辺2048pxへ縮小されるため、**原本そのままの画質では保存されません**。
  原本を残したい場合は別途バックアップを取ってください。

---

## ファイル構成

```
ob-photo-album/
├── index.html          … 画面全体
├── css/style.css       … スタイル（レスポンシブ・ダークモード対応）
├── js/
│   ├── app.js          … ログイン・一覧・拡大表示・アップロード
│   └── chatbot.js      … チャットボット「アルバム係」
├── api/
│   ├── _r2.js          … R2 アクセス（AWS SigV4 署名を自前実装）
│   ├── _auth.js        … 合言葉による認証
│   ├── login.js        … POST /api/login
│   ├── photos.js       … GET  /api/photos
│   ├── upload-url.js   … POST /api/upload-url
│   ├── register.js     … POST /api/register
│   └── delete.js       … POST /api/delete
├── .env.example        … 環境変数テンプレート（ダミー値のみ）
├── _drafts/
│   └── sigv4-test.html … 署名処理の検証ページ（Git・デプロイ対象外）
├── vercel.json
└── package.json
```

---

## 動作確認済みの内容

`api/_r2.js` の AWS SigV4 署名は外部ライブラリを使わない自前実装のため、
**AWS 公式ドキュメントのテストベクトルと照合して検証済み**です。

`_drafts/sigv4-test.html` をブラウザで開くと、以下が再確認できます（全10件 PASS）。

- AWS 公式の presigned URL 例と署名が完全一致すること
- ファイル名の `( )` `'` や日本語が正しくエンコードされること
- R2（`region=auto`・パススタイル）で正しい形式になること
- ダウンロード時の `Content-Disposition` が正しく署名されること

`api/` のハンドラーも、R2 をメモリ上に模した状態で**全44件の統合テストが通っています**
（`_drafts/api-test.html`）。ログイン・トークン改ざん検知・権限チェック・登録・削除・
日本語ファイル名のダウンロードまで、実ファイルをそのまま読み込んで検証しています。

api/ を修正したあとにテストし直す場合は、先に読み込み用データを作り直してください。

```bash
powershell -Command "$d='ob-photo-album'; $m=[ordered]@{}; @('_r2.js','_auth.js','login.js','photos.js','upload-url.js','register.js','delete.js') | %{ $m[$_] = Get-Content \"$d\api\$_\" -Raw -Encoding UTF8 }; Set-Content \"$d\_drafts\api-sources.js\" -Value ('window.API_SOURCES = ' + ($m | ConvertTo-Json -Depth 3 -Compress) + ';') -Encoding UTF8 -NoNewline"
```

画面側も、API をモックした状態で以下を確認済みです。

- ログイン → 一覧表示 → 年・イベントの絞り込み → 拡大表示 → キーボード操作
- 閲覧モードでは「写真を追加」「削除」が現れないこと
- チャットボットの検索（西暦・和暦・イベント名・タグ・1文字の語）
- スマホ（375px：2列）／タブレット（582px：3列）／PC（1280px：5列）で横スクロールが出ないこと
