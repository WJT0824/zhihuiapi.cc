#!/usr/bin/env bash
# 郅绘中转站 一键部署（Ubuntu 22.04/24.04，root 运行）
#
# 装 Docker（走阿里云镜像源）→ 起 new-api → 配 nginx 反代 → 申请 Let's Encrypt 证书
#
# 用法：
#   bash install.sh
#
# 可选环境变量：
#   APP_DIR      部署目录，默认 /opt/zhihui/deploy
#   LE_EMAIL     Let's Encrypt 通知邮箱，默认 admin@zhihuiapi.cc
#   SKIP_TLS=1   只装 HTTP，不申请证书
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/zhihui/deploy}"
LE_EMAIL="${LE_EMAIL:-admin@zhihuiapi.cc}"
MAIN_DOMAIN="zhihuiapi.cc"
ALT_DOMAINS="www.zhihuiapi.cc relay.zhihuiapi.cc api.zhihuiapi.cc"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }
rand() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

[ "$(id -u)" = "0" ] || die "请用 root 运行：sudo bash install.sh"

log "1/5 安装 Docker 与 Nginx"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git nginx openssl
if ! command -v docker >/dev/null 2>&1; then
  # 中国大陆机器访问 get.docker.com 经常被重置，改用阿里云镜像源
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL --retry 3 --connect-timeout 15 \
    https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.aliyun.com/docker-ce/linux/ubuntu %s stable\n' \
    "$(dpkg --print-architecture)" "$(. /etc/os-release && echo "$VERSION_CODENAME")" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker >/dev/null 2>&1 || true
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y -qq docker-compose-plugin
fi
# 国内拉取 Docker Hub 镜像需要加速器
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.1ms.run",
    "https://docker.1panel.live",
    "https://hub.rat.dev"
  ]
}
JSON
  systemctl restart docker
fi

log "2/5 准备目录与密钥"
mkdir -p "${APP_DIR}"/{newapi-data,branding}
cd "${APP_DIR}"
[ -f docker-compose.yml ] || die "缺少 docker-compose.yml，请先同步 deploy 目录"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(rand)|" .env
  sed -i "s|^CRYPTO_SECRET=.*|CRYPTO_SECRET=$(rand)|" .env
  chmod 600 .env
  warn "已生成新的 SESSION_SECRET / CRYPTO_SECRET；恢复旧库时必须沿用备份里的这两个值"
fi

log "3/5 启动 new-api"
docker compose up -d
for i in $(seq 1 40); do
  if curl -fsS -m 3 http://127.0.0.1:3000/api/status >/dev/null 2>&1; then
    printf 'new-api 已就绪\n'; break
  fi
  [ "$i" = "40" ] && warn "new-api 120 秒内未响应，用 docker compose logs new-api 排查"
  sleep 3
done

log "4/5 配置 Nginx"
cp nginx/zhihuiapi.cc.conf /etc/nginx/sites-available/zhihuiapi.cc.conf
ln -sf /etc/nginx/sites-available/zhihuiapi.cc.conf /etc/nginx/sites-enabled/zhihuiapi.cc.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

if [ "${SKIP_TLS:-0}" = "1" ]; then
  warn "已跳过证书申请（SKIP_TLS=1）"
else
  log "5/5 申请 HTTPS 证书"
  apt-get install -y -qq certbot python3-certbot-nginx
  # DNS 必须先指向本机，否则 HTTP-01 校验会失败
  if certbot certonly --nginx --cert-name "${MAIN_DOMAIN}" -n --agree-tos -m "${LE_EMAIL}" --no-eff-email \
      -d "${MAIN_DOMAIN}" $(for d in ${ALT_DOMAINS}; do printf -- '-d %s ' "$d"; done); then
    systemctl enable --now certbot.timer >/dev/null 2>&1 || true
    printf 'HTTPS 已启用，证书会自动续期\n'
  else
    warn "证书申请失败，通常是 DNS 未指向本机或 80 端口不通。修好后重跑："
    warn "certbot certonly --nginx --cert-name ${MAIN_DOMAIN} -d ${MAIN_DOMAIN} $(for d in ${ALT_DOMAINS}; do printf -- '-d %s ' "$d"; done)"
  fi
fi

cat <<EOF

------------------------------------------------------------------
部署完成

  站点      https://${MAIN_DOMAIN}
  接口      https://${MAIN_DOMAIN}/v1/*
  管理入口  https://${MAIN_DOMAIN}/console

  首次使用：打开站点完成初始化并创建管理员，然后在
  「渠道」里添加上游（base_url 必须可达），
  「系统设置」里维护站名、注册开关与分组。
------------------------------------------------------------------
EOF
