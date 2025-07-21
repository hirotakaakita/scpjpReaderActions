# SCP Data Directory

このディレクトリには、GitHub ActionsでクロールしたSCPデータが保存されます。

## ファイル構成

- `scp-data.json`: SCPデータの本体
- `meta.json`: メタデータ（最終更新時刻、件数など）

## データフロー

1. **GitHub Actions**: 毎日実行され、SCP-JPサイトをクロール
2. **データ保存**: 結果をこのディレクトリに保存してGitにコミット
3. **Firebase Functions**: GitHub上のデータを取得してFirestoreに同期

## 手動実行

```bash
# ローカルでクローラーを実行
node github-crawler.js

# Firebase Functions同期をトリガー
curl -X POST https://asia-northeast1-scpjp-reader.cloudfunctions.net/syncFromGitHub
```