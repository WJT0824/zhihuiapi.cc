# 郅绘网站部署

## 直接启动

需要 Node.js 22 或更高版本。

```bash
ZH_ADMIN_KEY="请替换为强密码" NODE_ENV=production npm start
```

服务默认监听 `0.0.0.0:8787`，健康检查地址为 `/api/health`。

## Docker

```bash
docker build -t zhihui-web .
docker run -d --name zhihui-web -p 8787:8787 \
  -e NODE_ENV=production \
  -e ZH_ADMIN_KEY="请替换为强密码" \
  -v zhihui-data:/app/data \
  --restart unless-stopped zhihui-web
```

在云平台中将域名反向代理到容器的 `8787` 端口，并启用平台提供的 Let's Encrypt HTTPS。数据目录 `/app/data` 必须挂载持久卷。

## 管理员账号

首次启动时自动创建用户名 `admin`。密码取自环境变量 `ZH_ADMIN_KEY`。生产环境若未设置该变量，服务会拒绝启动。
