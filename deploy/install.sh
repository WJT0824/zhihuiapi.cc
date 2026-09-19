#!/usr/bin/env bash
# 郅绘单机一键部署：Docker + 业务服务 + new-api + Nginx + Let's Encrypt
#
# 用法（在刚装好的 Ubuntu 22.04/24.04 上，以 root 执行）：
#   bash install.sh
#
# 可选环境变量：
#   APP_DIR     项目目录，默认 /opt/zhihui
#   LE_EMAIL    Let's Encrypt 通知邮箱，默认 admin@zhihuiapi.cc
#   SKIP_TLS=1  只装 HTTP，不申请证书
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/zhihui}"
LE_EMAIL="${LE_EMAIL:-admin@zhihuiapi.cc}"
API_DOMAIN="api.zhihuiapi.cc"
RELAY_DOMAIN="relay.zhihuiapi.cc"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }
rand() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

[ "$(id -u)" = "0" ] || die "请用 root 运行：sudo bash install.sh"

log "1/7 安装 Docker 与 Nginx"
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

log "2/7 准备项目目录 ${APP_DIR}"
mkdir -p "${APP_DIR}"
if [ ! -f "${APP_DIR}/package.json" ]; then
  if [ -d /root/zhihui-src ]; then
    cp -a /root/zhihui-src/. "${APP_DIR}/"
  else
    git clone --depth 1 https://github.com/WJT0824/zhihuiapi.cc.git "${APP_DIR}"
  fi
fi
cd "${APP_DIR}"
[ -d deploy ] || die "项目里缺少 deploy 目录，请确认代码已完整上传"

log "3/7 生成密钥文件 deploy/.env"
ENV_FILE="${APP_DIR}/deploy/.env"
if [ ! -f "${ENV_FILE}" ]; then
  cp deploy/.env.example "${ENV_FILE}"
  ADMIN_KEY="$(rand)"
  sed -i "s|^ZH_ADMIN_KEY=.*|ZH_ADMIN_KEY=${ADMIN_KEY}|" "${ENV_FILE}"
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(rand)|" "${ENV_FILE}"
  sed -i "s|^CRYPTO_SECRET=.*|CRYPTO_SECRET=$(rand)|" "${ENV_FILE}"
  sed -i "s|^ZH_RECHARGE_SHORT_SECRET=.*|ZH_RECHARGE_SHORT_SECRET=$(rand)|" "${ENV_FILE}"
  printf '%s\n' "${ADMIN_KEY}" > "${APP_DIR}/deploy/.admin-key.txt"
  chmod 600 "${APP_DIR}/deploy/.admin-key.txt"
  warn "已生成随机管理员密码，保存在 ${APP_DIR}/deploy/.admin-key.txt"
else
  warn "已存在 deploy/.env，保持原样不覆盖"
fi
chmod 600 "${ENV_FILE}"

log "4/7 启动容器（首次构建需要 1-3 分钟）"
cd "${APP_DIR}/deploy"
docker compose up -d --build

log "5/7 等待服务就绪"
for i in $(seq 1 40); do
  if curl -fsS -m 3 http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    printf '业务服务已就绪\n'
    break
  fi
  [ "$i" = "40" ] && warn "业务服务 120 秒内未响应，可用 docker compose logs zhihui 排查"
  sleep 3
done
for i in $(seq 1 40); do
  if curl -fsS -m 3 http://127.0.0.1:3000/api/status >/dev/null 2>&1; then
    printf 'new-api 已就绪\n'
    break
  fi
  [ "$i" = "40" ] && warn "new-api 120 秒内未响应，可用 docker compose logs new-api 排查"
  sleep 3
done

log "6/7 配置 Nginx 反向代理"
cp nginx/zhihuiapi.cc.conf /etc/nginx/sites-available/zhihuiapi.cc.conf
ln -sf /etc/nginx/sites-available/zhihuiapi.cc.conf /etc/nginx/sites-enabled/zhihuiapi.cc.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

if [ "${SKIP_TLS:-0}" = "1" ]; then
  warn "已跳过证书申请（SKIP_TLS=1）"
else
  log "7/7 申请 HTTPS 证书"
  apt-get install -y -qq certbot python3-certbot-nginx
  if certbot --nginx -n --agree-tos -m "${LE_EMAIL}" \
      -d "${API_DOMAIN}" -d "${RELAY_DOMAIN}" --redirect; then
    systemctl enable --now certbot.timer >/dev/null 2>&1 || true
    printf 'HTTPS 已启用，证书会自动续期\n'
  else
    warn "证书申请失败，通常是 DNS 未指向本机或 80 端口不通。修好后执行："
    warn "certbot --nginx -d ${API_DOMAIN} -d ${RELAY_DOMAIN} --redirect"
  fi
fi

IP="$(curl -fsS -m 10 https://api.ipify.org 2>/dev/null || printf '本机IP')"
printf '%s\n' '' '------------------------------------------------------------------'
printf '部署完成\n\n'
printf '  业务接口   https://%s/api/health   （内网 127.0.0.1:8787）\n' "${API_DOMAIN}"
printf '  中转站     https://%s/api/status （内网 127.0.0.1:3000）\n' "${RELAY_DOMAIN}"
printf '  管理员密码 %s/deploy/.admin-key.txt\n\n' "${APP_DIR}"
printf '  DNS 需要指向本机 IP：%s\n' "${IP}"
printf '    api.zhihuiapi.cc    A %s\n' "${IP}"
printf '    relay.zhihuiapi.cc  A %s\n\n' "${IP}"
printf '  常用命令（在 %s/deploy 下）：\n' "${APP_DIR}"
printf '    docker compose ps              查看状态\n'
printf '    docker compose logs -f zhihui  业务日志\n'
printf '    docker compose restart         重启\n'
printf '    docker compose up -d --build   更新代码后重建\n'
printf '------------------------------------------------------------------\n'
