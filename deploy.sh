#!/usr/bin/env bash
# 部署安裝頁到 Cloudflare Pages
# 憑證沿用 e-trending 專案的 .env（CF_API_TOKEN / CF_ACCOUNT_ID）
set -euo pipefail

# 先讀憑證再 cd，相對路徑的 CF_ENV_FILE 才是相對於呼叫時的目錄。
# 只取部署要用的兩個值，存成不 export 的變數：整份 export 會把該檔其他密鑰交給 build 與測試。
token="${CLOUDFLARE_API_TOKEN:-}" account="${CLOUDFLARE_ACCOUNT_ID:-}"
ENV_FILE="${CF_ENV_FILE:-$HOME/enor_agi/e-trending/.env}"
if [ -z "$token" ] && [ -f "$ENV_FILE" ]; then
  # 分兩步：env 檔讀取失敗時，指令替換的非零結束碼讓 set -e 中止部署
  vars="$(set -e; . "$ENV_FILE" >&2; printf 'token=%q account=%q\n' "${CF_API_TOKEN:-}" "${CF_ACCOUNT_ID:-}")"
  eval "$vars"
fi
if [ -z "$token" ]; then
  echo "缺少 CLOUDFLARE_API_TOKEN，請設定環境變數或 CF_ENV_FILE" >&2
  exit 1
fi

cd "$(dirname "$0")"
# npm test 會先 build，測試沒過就不部署。CI=1 讓 build 在 terser 失敗時中止，不上傳保守壓縮版。
# 測試與 build 不需要 Cloudflare 憑證，不讓它們讀到。
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID CI=1 npm test
CLOUDFLARE_API_TOKEN="$token" CLOUDFLARE_ACCOUNT_ID="$account" \
  npx --yes wrangler@4.156.0 pages deploy docs \
  --project-name law-hover-bookmarklet \
  --branch main \
  --commit-dirty=true

echo
echo "線上網址：https://law-hover-bookmarklet.pages.dev/"
