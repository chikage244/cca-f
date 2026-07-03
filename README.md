# CCA-F 学習アプリ

Claude Certified Architect – Foundations (CCA-F) 認定試験の対策用に作られた、ビルド不要のバニラ HTML/CSS/JS (ES Modules) 製オフライン学習 PWA です。クイズ・SRS ベースの弱点復習・フラッシュカード・タイマー付き模擬試験の4モードを備え、5つの出題ドメイン (エージェント型アーキテクチャ / Claude Code / プロンプトエンジニアリング / ツール設計 & MCP / コンテキスト管理) を横断して学習できます。外部依存やビルドステップは一切なく、静的ファイルをそのまま配信するだけで動作し、Service Worker によりオフラインでも全機能が使えます。

**公開URL**: https://chikage244.github.io/cca-f/ （ホーム画面に追加するとアプリのように起動します）

## 機能

- **ホーム** (`#/`) — 復習due件数、ドメイン別正答率、直近の模試スコア、「今日の復習」への導線
- **学習** (`#/quiz`) — ドメインを絞り込んで1問ずつ即時採点+日本語解説
- **復習** (`#/review`) — 6段階 Leitner SRS による弱点優先の復習キュー (10問セッション区切り)
- **カード** (`#/cards`) — 英語用語⇄日本語定義のフラッシュカード (タップでめくる、知ってる/知らない)
- **模試** (`#/exam`) — 60問・120分のタイマー付き模擬試験 (フラグ・問題ジャンプ・途中リロード再開対応)、結果画面でドメイン別内訳と全問レビュー
- **履歴** (`#/history`) — 過去の模試結果一覧・詳細
- **設定** (`#/settings`) — テーマ切替、選択肢シャッフル、復習セッション件数、進捗のリセット/エクスポート/インポート
- **PWA** — ホーム画面インストール、オフライン動作、アップデート通知トースト

試験仕様: 60問 / 120分 / 合格720点 (1000点満点) / シナリオベース4択。ドメイン配分は Agentic Architecture 27% (16問) / Claude Code 20% (12問) / Prompt Engineering 20% (12問) / Tool Design & MCP 18% (11問) / Context Management 15% (9問)。

## ディレクトリ構成

```
cca-f/
├── index.html            # アプリシェル、タブバー、SW登録、iOS用meta
├── manifest.webmanifest  # PWAマニフェスト
├── sw.js                 # Service Worker (cache-first, CACHE_VERSIONで管理)
├── 404.html              # GitHub Pages用SPAフォールバック
├── css/style.css         # 全スタイル (CSS変数、ダークモード、safe-area対応)
├── js/                   # ES Modules (app/router/store/data/util/srs/各画面)
├── data/                 # 問題JSON (ドメイン別) + flashcards.json
├── icons/                # icon.svg 原本 + 各サイズのラスタライズ済みPNG/ICO
├── scripts/validate.mjs  # コンテンツ・SWプリキャッシュの検証スクリプト
└── README.md
```

## 問題・フラッシュカードの追加/編集方法

### 問題スキーマ (`data/questions-<domain>.json`)

```json
{
  "id": "agentic-001",
  "domain": "agentic",
  "difficulty": 2,
  "question": "英語のシナリオ問題文",
  "choices": ["選択肢A", "選択肢B", "選択肢C", "選択肢D"],
  "answer": 1,
  "explanation": "日本語解説。正解の理由 + 各誤答がなぜ間違いかも書く",
  "tags": ["orchestration"],
  "ref": "出典 (任意)"
}
```

- `id` は `{domain}-{連番3桁}` (例: `agentic-001`) で **一度割り当てたら変更しない** こと。SRS の学習状態はこの id をキーに保存されているため、変更すると学習履歴が失われます。
- `domain` は次のいずれか: `agentic` / `claude-code` / `prompting` / `mcp` / `context`。ファイル名のドメインと一致させること。
- `choices` は必ず4つ、`answer` はその中の正解インデックス (0-3の整数)。表示時にシャッフルされ、採点は元インデックスで行われます。
- `difficulty` は 1-3 の整数。
- 選択肢は英語 (本番同様)、`explanation` は日本語で正解根拠+誤答理由まで書く。

最終的な問題数の目標: agentic 81 / claude-code 60 / prompting 60 / mcp 54 / context 45 (計300問)。

### フラッシュカードスキーマ (`data/flashcards.json`)

```json
{
  "id": "fc-mcp-004",
  "domain": "mcp",
  "term": "英語の用語",
  "definition": "日本語の定義 (2-3文)",
  "tags": ["tag1"]
}
```

- `id` は `fc-{domain}-{連番3桁}`、こちらも一意である必要があります。
- 目標枚数: 約100枚。

### 追加/編集後の検証

問題やカードを追加・編集したら、コミット前に必ず検証スクリプトを実行してください。

```bash
node scripts/validate.mjs          # スキーマ・ID一意性・SWプリキャッシュ整合を検証
node scripts/validate.mjs --full   # 上記に加え、最終目標の問題数/カード数も検証
```

`--full` は全300問+100カードが揃った状態でのみパスします (開発途中のシードデータでは意図的に失敗します)。

新しい JS/CSS/データファイルを追加した場合は `sw.js` の `PRECACHE_URLS` にも忘れずに追加してください。`validate.mjs` がファイルシステムとの整合性 (双方向) をチェックします。

## ローカルでの動作確認

```bash
python3 -m http.server 8123
# または .claude/launch.json の "preview" 設定を使って起動
```

`http://localhost:8123/` を開いて確認してください。Service Worker はオフラインキャッシュを行うため、コンテンツを更新した際はブラウザのハードリロード、またはアプリ内の更新通知トーストから反映してください。

## リリース手順

1. 問題/カード/コードを編集する
2. `node scripts/validate.mjs` (コンテンツが完成している場合は `--full` も) を実行してパスすることを確認する
3. **`sw.js` の `CACHE_VERSION` を1行バンプする** (例: `"ccaf-v1"` → `"ccaf-v2"`) — これを忘れるとユーザーは古いキャッシュのまま更新に気づけません
4. 変更をコミットする
5. `main` ブランチに push する — GitHub Pages が自動的に再デプロイします
6. 既にアプリを開いているユーザーには次回起動時に「新しいバージョンがあります」トーストが表示されます (模試中は自動更新を抑制し、模試終了後に表示されます)

## 技術的な制約・方針

- 依存ゼロ、ビルドステップなし。全ての `<script>`/`fetch`/アイコン参照は相対パス (`./...`)。
- 外部 CDN・フォント・API 呼び出しは一切なし (完全オフライン動作が要件)。
- ハッシュルーティング (`#/quiz` 等) を採用し、GitHub Pages のサブパスでのリロード404を回避。存在しないパスへの直接アクセスは `404.html` が `index.html` にハッシュを保持したままリダイレクトします。
- `localStorage` は `ccaf.v1.` プレフィックス配下に `js/store.js` が一元管理します。
