# 郅绘中转站部署说明

> 2026-09-20 起，`zhihuiapi.cc` 已从「郅绘创作台门户」整体切换为 **new-api 中转站**。
> 创作台、画布、积分体系与 CDR 插件接口同时下线，相关代码保留在本仓库作为历史与备份。

## 现网形态

| 项目 | 值 |
| --- | --- |
| 站点 | `https://zhihuiapi.cc`（`www` 归一，`relay.` / `api.` 301 到主域名） |
| 服务器 | 阿里云杭州 `47.114.52.219`，Ubuntu 24.04，2C2G |
| 应用 | new-api 单容器（`calciumion/new-api:latest`），仅监听 `127.0.0.1:3000` |
| 入口 | 宿主机 nginx 反向代理，Let's Encrypt 证书由 certbot 自动续期 |
| 数据 | `/opt/zhihui/deploy/newapi-data/one-api.db`（SQLite，随容器卷持久化） |
| 部署目录 | `/opt/zhihui/deploy`（compose、`.env`、`branding/`、证书无关的 nginx 源文件副本） |

## 常用操作

```bash
cd /opt/zhihui/deploy
docker compose ps                      # 状态
docker compose logs -f new-api         # 日志
docker compose restart new-api         # 重启
docker compose pull && docker compose up -d   # 升级镜像

nginx -t && systemctl reload nginx     # 改完 nginx 配置后
certbot renew --dry-run                # 检查证书续期
```

## 站点配置

站点品牌、导航、注册开关等都在 new-api 后台「系统设置」里维护；也可以用系统访问令牌直接调接口：

```bash
TOKEN=$(cat /root/.newapi-access-token)   # 管理员系统访问令牌（服务器本地文件）
curl -X PUT http://127.0.0.1:3000/api/option/ \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"key":"SystemName","value":"郅绘中转站"}'
```

当前关键配置：

- 站名 `郅绘中转站`，Logo `https://zhihuiapi.cc/logo.png`（由 nginx 从 `deploy/branding/` 提供）
- 主题：前端预设为浏览器本地设置，已通过「页脚 HTML」注入青绿主色（`--primary:#00d294`），全站默认白底青绿
- 导航：主页 / 控制台 / 模型广场 / 文档；注册开放，邮箱验证与人机验证关闭
- 分组：仅 `default`；充值只走兑换码，不接在线支付

## 充值（收款码 + 人工发码）

没有支付宝商户号，个人/经营收款码不提供服务端回调，因此**无法自动到账**。当前做法：

- 收款码放在服务器 `deploy/branding/alipay.jpg`，由 nginx 通过 `/branding/` 直接提供（图片不进仓库）
- 充值说明页 `deploy/branding/pay.html`，对外地址 `https://zhihuiapi.cc/pay`（nginx `location = /pay`）
- new-api 的 `TopUpLink` 指向该页，控制台「钱包 → 充值」会跳过去；`PayMethods` 已清空，避免出现没有网关的支付按钮
- 流程：用户扫码付款 → 备注站点用户名 → 把「用户名 + 金额 + 订单尾号」发给管理员 → 管理员在后台「兑换」页生成兑换码发回 → 用户在钱包兑换到账

要改成**全自动到账**，需要开通支付宝「当面付」（小微商户可申请），拿到 APPID/PID/应用私钥后接入异步通知；否则这套人工发码流程是唯一可行方案。

## 上游渠道

渠道在 new-api 后台「渠道」页维护。当前一条 `TokenFlux` 渠道指向 `https://tokenflux.cloud`，提供 12 个文本模型。

注意两点：

1. 渠道的 `base_url` 必须指向真实可达的 OpenAI 兼容地址；留空会默认走 `api.openai.com`，在国内服务器上不可达。
2. 令牌的「分组」必须与渠道所在分组一致，否则会出现「连接成功但模型列表为 0」。

## 备份与恢复

```bash
# 备份（数据 + 配置 + nginx + 证书续期配置）
tar czf /root/backups/zhihuiapi-$(date +%F).tar.gz -C / \
  opt/zhihui etc/nginx/sites-available etc/letsencrypt/renewal

# 恢复数据库（先停容器）
cd /opt/zhihui/deploy && docker compose stop new-api
cp /root/backups/xxx/opt/zhihui/deploy/newapi-data/one-api.db ./newapi-data/one-api.db
docker compose start new-api
```

2026-09-20 改造前的完整备份（含郅绘 `store.json`、new-api 原始库）保存在服务器 `/root/backups/`，并同步了一份到部署者本机桌面。
