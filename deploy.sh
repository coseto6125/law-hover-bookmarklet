#!/usr/bin/env bash
# 部署安裝頁到 Cloudflare Pages
# 憑證沿用 e-trending 專案的 .env（CF_API_TOKEN / CF_ACCOUNT_ID）
set -euo pipefail

ENV_FILE="${CF_ENV_FILE:-$HOME/enor_agi/e-trending/.env}"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
  export CLOUDFLARE_API_TOKEN="${CF_API_TOKEN:-}"
  export CLOUDFLARE_ACCOUNT_ID="${CF_ACCOUNT_ID:-}"
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "缺少 CLOUDFLARE_API_TOKEN，請設定環境變數或 CF_ENV_FILE" >&2
  exit 1
fi

node build/build.js
npx wrangler pages deploy docs \
  --project-name law-hover-bookmarklet \
  --branch main \
  --commit-dirty=true

echo
echo "線上網址：https://law-hover-bookmarklet.pages.dev/"
