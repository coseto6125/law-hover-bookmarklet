#!/usr/bin/env bash
# 部署安裝頁到 Cloudflare Pages
# 憑證沿用 e-trending 專案的 .env（CF_API_TOKEN / CF_ACCOUNT_ID）
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE="${CF_ENV_FILE:-$HOME/enor_agi/e-trending/.env}"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$ENV_FILE" ]; then
  # 只取部署要用的兩個值；整份 export 會把該檔其他密鑰一併交給 build 與 wrangler
  eval "$(. "$ENV_FILE"; printf 'export CLOUDFLARE_API_TOKEN=%q CLOUDFLARE_ACCOUNT_ID=%q\n' "${CF_API_TOKEN:-}" "${CF_ACCOUNT_ID:-}")"
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "缺少 CLOUDFLARE_API_TOKEN，請設定環境變數或 CF_ENV_FILE" >&2
  exit 1
fi

# npm test 會先 build，測試沒過就不部署
npm test
npx --yes wrangler@4.156.0 pages deploy docs \
  --project-name law-hover-bookmarklet \
  --branch main \
  --commit-dirty=true

echo
echo "線上網址：https://law-hover-bookmarklet.pages.dev/"
