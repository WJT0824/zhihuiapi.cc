# 郅绘中转站（new-api）单机部署

一台阿里云杭州 Ubuntu 24.04 服务器承载整套中转站：new-api 容器 + 宿主机 nginx + Let's Encrypt。
完整说明见仓库根目录的 [DEPLOY.md](../DEPLOY.md)。

## 目录

```
deploy/
├── docker-compose.yml        # new-api 单服务（仅监听 127.0.0.1:3000）
├── .env                      # 运行时密钥（不进仓库）
├── .env.example              # 密钥模板
├── branding/                 # logo.png / favicon.ico，由 nginx 直接托管
├── newapi-data/one-api.db    # SQLite 数据（随卷持久化）
├── nginx/zhihuiapi.cc.conf   # 复制到 /etc/nginx/sites-available/
└── install.sh                # 从零装机的参考脚本
```

## 日常运维

```bash
cd /opt/zhihui/deploy
docker compose ps                 # 状态
docker compose logs -f new-api    # 日志
docker compose restart new-api    # 重启
docker compose pull && docker compose up -d   # 升级镜像
```

## 域名与证书

- `zhihuiapi.cc` / `www.zhihuiapi.cc` → new-api
- `relay.zhihuiapi.cc` / `api.zhihuiapi.cc` → 301 到 `https://zhihuiapi.cc`
- 证书：`certbot certonly --nginx --cert-name zhihuiapi.cc -d zhihuiapi.cc -d www.zhihuiapi.cc -d relay.zhihuiapi.cc -d api.zhihuiapi.cc`
- 续期由 `certbot.timer` 自动完成，可随时 `certbot renew --dry-run` 验证

## 备份

```bash
tar czf /root/backups/zhihuiapi-$(date +%F).tar.gz -C / \
  opt/zhihui etc/nginx/sites-available etc/letsencrypt/renewal
```
