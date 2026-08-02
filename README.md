# LyconSalonRecord

手書きのサロンカルテをAI OCRで読み取り、店舗単位で顧客・施術履歴・注意事項を管理するWebアプリです。ローカルではJSON、本番ではPostgreSQLへ自動的に切り替わります。

## 起動

1. Node.js 18以上を用意します。
2. `start-salonrecord.bat` をダブルクリック、または `npm start` を実行します。
3. ブラウザで `http://127.0.0.1:8798` を開きます。
4. デモアカウント `owner@lumiere.jp` / `demo123` でログインします。

AI OCRを使う場合は、起動前にPowerShellで環境変数を設定します。

```powershell
$env:OPENAI_API_KEY="sk-..."
npm start
```

APIキーがなくても「サンプルで試す」で読取後の確認・保存フローを検証できます。`DATABASE_URL`が未設定なら、データは`data/store.json`へ保存されます。既存の平文パスワードは起動時にbcryptハッシュへ自動移行されます。

## 実装済み

- 店舗（テナント）単位のユーザー認証とデータ分離
- オーナー／スタッフ権限（フォーム設定はオーナーのみ）
- 店舗ごとのカルテ項目・読取範囲設定
- PNG/JPEG/WEBP画像のAI OCR（OpenAI Responses API）
- OCR結果の確度表示、確認・手修正、顧客への紐付け
- 顧客検索、施術タイムライン、注意事項・好みのリマインド
- ローカルJSON／本番PostgreSQLへの永続保存
- bcryptパスワードハッシュ、期限付きセッション、ログイン試行制限
- セキュリティヘッダーと`/healthz`ヘルスチェック

## Renderへ公開

### 1. GitHubへプッシュ

```powershell
cd "C:\Users\Shuji Watanabe\salonrecord"
git add .
git commit -m "Prepare LyconSalonRecord for Render"
git push
```

`.env`、`data/store.json`、`node_modules`はGitへ登録されません。

### 2. Render Blueprintを作成

1. Renderへログインします。
2. `New` → `Blueprint`を選択します。
3. このリポジトリを接続します。
4. ルートの`render.yaml`を読み込ませます。
5. PostgreSQLとWeb Serviceが作成されます。

`render.yaml`は初回公開を試せるようWeb ServiceとPostgreSQLを`free`に設定しています。無料プランの停止、性能、データ保持期限などの制約はRender画面で必ず確認し、本番販売前に有料プランへ変更してください。

### 3. 秘密の環境変数を入力

Blueprint作成時に、次を入力します。

| 変数 | 内容 |
|---|---|
| `OPENAI_API_KEY` | OpenAI APIキー。Gitへ保存しない |
| `SALON_NAME` | 最初の店舗名 |
| `ADMIN_NAME` | 最初のオーナー名 |
| `ADMIN_EMAIL` | 最初のログインメール |
| `ADMIN_PASSWORD` | 12文字以上の初期パスワード |

`NODE_ENV=production`かつ`SEED_DEMO_DATA=false`の場合、デモ顧客は作成されません。PostgreSQLが空の最初の起動時だけ、上記の店舗とオーナーが作成されます。

### 4. 公開確認

デプロイ後に以下を確認します。

```text
https://発行されたURL/healthz
```

正常時：

```json
{"status":"ok","storage":"postgres"}
```

続いてトップページへアクセスし、`ADMIN_EMAIL`と`ADMIN_PASSWORD`でログインします。

### 5. 独自ドメイン

RenderのWeb Serviceで`Settings` → `Custom Domains`からドメインを追加し、表示されたDNSレコードをドメイン管理会社側に設定します。HTTPS証明書はRender側で有効化します。

## 環境変数

設定例は[.env.example](./.env.example)を参照してください。ローカルでPostgreSQLを試す場合は`DATABASE_URL`を設定してから起動します。

## 商用化前に必要なもの

パスワードハッシュとPostgreSQL保存までは対応済みです。商用販売前には、監査ログ、バックアップ復元テスト、スタッフ招待、パスワード再設定、画像の暗号化保存、顧客同意、保存期限、退会時削除、利用規約、プライバシーポリシーを追加してください。個人情報を扱うため、アクセス権限と運用規程も店舗ごとに整備が必要です。
