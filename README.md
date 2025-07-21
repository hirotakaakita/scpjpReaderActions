# SCP Crawler - GitHub Actions

このディレクトリには、GitHub ActionsでSCP-JPサイトをクロールするためのコードが含まれています。

## 構成

```
github-actions-crawler/
├── .github/
│   └── workflows/
│       └── scp-crawler.yml     # GitHub Actionsワークフロー
├── data/                       # クロール結果保存ディレクトリ
│   ├── scp-data.json          # SCPデータ本体
│   ├── meta.json              # メタデータ
│   └── README.md              # データディレクトリの説明
├── github-crawler.js          # メインクローラースクリプト
├── package.json               # Node.js依存関係
└── README.md                  # このファイル
```

## 実行方法

### ローカル実行
```bash
npm install
npm start
```

### GitHub Actions
- 毎日午前0時（UTC）に自動実行
- 手動実行も可能（Actions タブから）

## データフロー

1. GitHub ActionsがSCP-JPサイトをクロール
2. 結果を`data/`ディレクトリに保存
3. 自動的にGitHubにコミット・プッシュ
4. Firebase Functionsが変更を検知して同期

## 設定

GitHub Secretsに以下を設定：
- `FIREBASE_FUNCTION_URL`: Firebase Functions同期エンドポイント