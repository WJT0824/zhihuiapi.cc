# 郅绘部署说明

## 现网形态（一台服务器跑两套，互不影响）

服务器：**香港** `103.185.248.227`（CentOS 7.6，2 核 2G，椰子云），Docker 承载全部服务：
业务容器 `zhihui`、中转站容器 `zhihui-new-api`、入口容器 `zhihui-nginx`（宿主 nginx 用容器代替）。

> 为什么搬离内地：原服务器在阿里云杭州，`zhihuiapi.cc` 未做 ICP 备案，被阿里云按域名阻断
> （HTTP 返回 `Non-compliance ICP Filing` 拦截页、HTTPS 直接重置连接），
> 表现为 Chrome `ERR_CONNECTION_RESET`、夸克打不开、CDR 插件「基础连接已经关闭」。
> 迁到香港节点后无需备案，阻断解除。
>
> 旧服务器 `47.114.52.219` 仍保留全部旧数据，作为冷备。

| 域名 | 指向 | 内容 |
| --- | --- | --- |
| `zhihuiapi.cc` / `www.zhihuiapi.cc` | `zhihui` 容器（8787） | 官网首页、登录注册、创作台、**无限画布**、模型广场、积分中心、下载插件 |
| `api.zhihuiapi.cc` | 同一个 `zhihui` 容器 | 站点接口：`/v1/auth/*`、`/v1/studio/*`、`/v1/image/*`、`/api/v1/studio/*`、`/plugin-config.json` |
| `relay.zhihuiapi.cc` | `new-api` 容器（3000） | AI 模型中转站：模型广场、控制台、`/v1/*` OpenAI 兼容接口 |

CDR 插件读取 `https://zhihuiapi.cc/plugin-config.json`，服务端接口在 `api.zhihuiapi.cc`，与站点账号、积分实时同步。

## 目录与数据

```
/opt/zhihui/                     应用代码（Dockerfile / server / web）
/opt/zhihui/deploy/
├── docker-compose.yml           两个服务
├── .env                         全部密钥（勿改 SESSION_SECRET / CRYPTO_SECRET）
├── data/                        站点数据：store.json（用户/积分/任务/兑换）+ references 参考图
├── newapi-data/one-api.db       中转站数据
├── branding/                    logo.png / favicon.ico / alipay.jpg / pay.html
└── nginx/zhihuiapi.cc.conf      nginx 源文件副本
```

## 常用操作

```bash
cd /opt/zhihui/deploy
docker compose ps                       # 状态
docker compose logs -f zhihui           # 站点日志
docker compose logs -f new-api          # 中转站日志
docker compose up -d --build            # 改完代码后重建
nginx -t && systemctl reload nginx      # 改完 nginx 后
certbot renew --dry-run                 # 证书续期自检
```

## 站点配置

- 管理员密钥：`deploy/.env` 的 `ZH_ADMIN_KEY`（首次启动创建 admin 用，也可作为 `x-admin-key` 请求头）
- 上游 AI：运营后台「AI 图像服务」里可随时改中转地址与 API Key，改完即生效，无需重新部署
- 充值：`https://zhihuiapi.cc/pay` 是收款码 + 人工发码页；短码兑换依赖 `ZH_RECHARGE_SHORT_SECRET`，**不要更换**，否则插件生成的旧兑换码会失效

## 中转站配置

- 后台：`https://relay.zhihuiapi.cc`，系统访问令牌在服务器 `/root/.newapi-access-token`
- 渠道：TokenFlux（主，文本+图像）、Krapi 国模 / Krapi GPT（备用）、Pollinations（免费分组）
- 价格：沿用 new-api 开源内置价目表，并与参考站市价对齐；文本按倍率、图像按次

## 备份与恢复

```bash
# 备份
tar czf /root/backups/zhihui-$(date +%F).tar.gz -C / \
  opt/zhihui etc/nginx/sites-available etc/letsencrypt/renewal

# 恢复站点数据（停容器→覆盖→起容器）
cd /opt/zhihui/deploy && docker compose stop zhihui
tar xzf /root/backups/xxx.tar.gz -C /tmp/restore opt/zhihui/deploy/data
cp -a /tmp/restore/opt/zhihui/deploy/data/. ./data/
docker compose start zhihui
```

## 历史

2026-09-20 曾把整站切换为纯 new-api 中转站，当天按用户要求**已还原**为「创作台/画布 + 中转站并存」的形态。
改造前的完整备份（含应用代码、站点数据、new-api 库、nginx 与证书配置）保存在服务器 `/root/backups/zhihui-backup-20260920-013836.tar.gz`，并保留了一份在部署者本机。
