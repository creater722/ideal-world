#!/usr/bin/env bash
# 一键部署「理想的世界」到 121.199.0.224
# 用法：bash deploy.sh
# 目标：http://121.199.0.224/ideal-world/          原野（主界面，含场景切换）
#       http://121.199.0.224/ideal-world/grassland.html  草原
set -euo pipefail

HOST="admin@121.199.0.224"
REMOTE_DIR="/www/server/nginx/html/ideal-world"
REMOTE_INDEX="/tmp/world-index.html"
REMOTE_GRASS="/tmp/world-grassland.html"

cd "$(dirname "$0")"

echo "==> 构建原野"
node build.mjs

echo "==> 构建草原"
node build-grassland.mjs

INDEX_KB=$(du -k dist/index.html | cut -f1)
GRASS_KB=$(du -k dist/grassland.html | cut -f1)
echo "==> 产物 index ${INDEX_KB} KB / grassland ${GRASS_KB} KB，开始上传"

scp -o BatchMode=yes -o ConnectTimeout=15 dist/index.html "$HOST:$REMOTE_INDEX"
scp -o BatchMode=yes -o ConnectTimeout=15 dist/grassland.html "$HOST:$REMOTE_GRASS"

echo "==> 安装"
ssh -o BatchMode=yes "$HOST" "
  set -e
  sudo mkdir -p $REMOTE_DIR
  sudo mv $REMOTE_INDEX $REMOTE_DIR/index.html
  sudo mv $REMOTE_GRASS $REMOTE_DIR/grassland.html
  sudo chown root:root $REMOTE_DIR/index.html $REMOTE_DIR/grassland.html
  sudo chmod 644 $REMOTE_DIR/index.html $REMOTE_DIR/grassland.html
  echo 'index    ' \$(md5sum $REMOTE_DIR/index.html | cut -d' ' -f1)
  echo 'grassland' \$(md5sum $REMOTE_DIR/grassland.html | cut -d' ' -f1)
"

echo "==> 公网校验"
curl -sS -o /dev/null -w "  原野  HTTP %{http_code}  %{size_download} 字节  %{time_total}s\n" \
  -H "Accept-Encoding: gzip" "http://121.199.0.224/ideal-world/"
curl -sS -o /dev/null -w "  草原  HTTP %{http_code}  %{size_download} 字节  %{time_total}s\n" \
  -H "Accept-Encoding: gzip" "http://121.199.0.224/ideal-world/grassland.html"

echo "==> 线上地址: http://121.199.0.224/ideal-world/"
