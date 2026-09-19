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

帽子云是静态网站平台，可使用构建命令 `npm run build:web`、输出目录 `web-dist` 部署官网前端。完整登录、任务、积分和 `/api/v1/studio/*` 接口需要同时运行 `npm start` 的 Node 服务，并将 `/api` 反向代理到该服务。

## 管理员账号

首次启动时自动创建用户名 `admin`。密码取自环境变量 `ZH_ADMIN_KEY`。生产环境若未设置该变量，服务会拒绝启动。

## 模型中转站（new-api）

中转层使用自建 new-api（镜像 `calciumion/new-api:latest`），与业务层 Node 服务分开部署。站点保留原有创作台、插件接口、ComfyUI 与视频模型，只把模型转发、账号镜像与额度记账交给 new-api。

### 自有服务器部署（推荐，支持支付宝付款）

Railway 需要绑定外币信用卡，长期方案改用一台香港/新加坡轻量云服务器，
业务 Node 服务与 new-api 跑在同一台机器，Nginx 统一做 HTTPS 入口。
完整说明见 [`deploy/README.md`](deploy/README.md)，服务器上执行：

```bash
curl -fsSL https://raw.githubusercontent.com/WJT0824/zhihuiapi.cc/main/deploy/install.sh -o install.sh
bash install.sh
```

脚本会装好 Docker、生成密钥、启动 `docker compose`、配 Nginx 并申请 Let's Encrypt 证书。
DNS 把 `api` 与 `relay` 两条记录改成指向服务器 IP 的 A 记录即可，`@`/`www` 仍留帽子云。

### Railway 部署步骤（旧方案，需要外币卡）

1. 在项目里新建服务 → Deploy from Docker Image → 填入 `calciumion/new-api:latest`。
2. 给该服务添加持久卷，挂载路径 `/data`（SQLite 数据文件存放处，必须挂载否则重启丢数据）。
3. 配置环境变量：

   ```
   TZ=Asia/Shanghai
   SESSION_SECRET=<32 位随机字符串>
   CRYPTO_SECRET=<32 位随机字符串>
   ERROR_LOG_ENABLED=true
   BATCH_UPDATE_ENABLED=true
   NODE_NAME=zhihui-1
   ```

4. 在服务设置里生成公开域名，端口填 `3000`，确认 `https://<域名>/api/status` 返回 JSON。
5. 打开该域名完成 `/setup` 初始化，创建中转站管理员账号。
6. 绑定自定义域 `api.zhihuiapi.cc`，并在域名服务商处添加 Railway 提示的 CNAME 记录。

### 与站点打通

在 new-api 里用管理员账号生成系统访问令牌（用户设置 → 访问令牌），然后到郅绘运营后台「中转站（new-api）」面板：

1. 填写中转站地址与管理员令牌，点「测试连接」；
2. 点「迁移存量用户」，把现有用户积分同步成 new-api 额度（已存在的账号会覆盖额度）；
3. 之后在 new-api 控制台的「渠道」里配置上游 Key，「模型」里同步模型并设置价格。

### 计费映射

new-api 设置 `QuotaPerUnit=700000`、美元汇率 `7`，则 **1 积分 = 10000 quota = 0.1 元**，与站点「10 元 = 100 积分」一致。站点创作台生成一次 3 积分，即 30000 quota。
