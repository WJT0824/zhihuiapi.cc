# 郅绘部署（自有服务器版）

Railway 需要绑定外币信用卡，本目录用一台**支持支付宝付款的云服务器**替换它：
业务 Node 服务与 new-api 中转站跑在同一台机器上，由 Nginx 统一做 HTTPS 入口。

`zhihuiapi.cc` 与 `www` 继续留在帽子云静态托管，不受影响。

## 一、买机器

都支持支付宝/微信，不需要外币卡：

| 方案 | 价格 | 说明 |
| --- | --- | --- |
| 阿里云 轻量应用服务器 · 香港 | 约 ¥24/月起 | 免备案，选 2 核 2G 更稳，控制台续费方便 |
| 腾讯云 轻量应用服务器 · 香港 | 约 ¥24/月起 | 同上，活动多 |
| 雨云 / 亿速云 等 | ¥10-20/月起 | 更便宜，线路一般，适合过渡 |
| ClawCloud Run | ¥0 | 需 GitHub 账号且注册满 180 天，每月赠 $5，支持 Docker + 持久卷 |

必须选**中国内地以外地域**（香港/新加坡/日本）。内地机房未备案域名无法通过 80/443 访问，
而 .cc 备案周期长，不适合现在这条链路。

配置要求：Ubuntu 22.04 / 24.04，至少 1 核 2G、20G 硬盘；安全组放行 22、80、443。

## 二、部署

拿到公网 IP 与 root 密码后，登录服务器执行：

```bash
curl -fsSL https://raw.githubusercontent.com/WJT0824/zhihuiapi.cc/main/deploy/install.sh -o install.sh
bash install.sh
```

脚本自动完成：装 Docker → 生成随机密钥 → 构建并启动两个容器 →
装 Nginx 反代 → 申请 Let's Encrypt 证书 → 开启自动续期。

## 三、DNS

在爱名网把两条记录从 CNAME 改成 A 记录，指向服务器 IP：

| 主机记录 | 类型 | 记录值 |
| --- | --- | --- |
| api | A | 服务器公网 IP |
| relay | A | 服务器公网 IP |

`@`、`www` 保持帽子云不动。若保存没反应，先在爱名网关闭「解析保护」。

## 四、初始化

1. 打开 `https://relay.zhihuiapi.cc/setup` 创建中转站管理员账号。
2. 在 new-api 后台「用户设置 → 访问令牌」生成系统令牌。
3. 登录郅绘运营后台「中转站（new-api）」面板：地址填 `https://relay.zhihuiapi.cc`，
   贴上令牌 → 测试连接 → 迁移存量用户。
4. 在 new-api 控制台添加上游渠道，同步模型并设置价格。

## 五、计费映射

`QuotaPerUnit=700000`、美元汇率 `7`，则 **1 积分 = 10000 quota = 0.1 元**，
与站点「10 元 = 100 积分」一致。图像生成 3 积分、4K 修复 3 积分、8K 放大 4 积分、图转矢量 3 积分。

## 六、日常维护

```bash
cd /opt/zhihui/deploy
docker compose ps                 # 状态
docker compose logs -f zhihui     # 业务日志
docker compose logs -f new-api    # 中转站日志
docker compose up -d --build      # 拉取最新代码后重建
certbot renew --dry-run           # 检查证书续期
```

数据落盘位置：`deploy/data`（站点账号/积分/任务）与 `deploy/newapi-data`（中转站额度/渠道）。
备份这两个目录即可，建议每周打包一次。
