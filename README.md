# 郅绘ai画布

郅绘是一套面向广告、电商与品牌团队的 AI 设计工作台。本仓库同时包含可部署的网站/API，以及 Electron + React + TypeScript 桌面无限画布。

## 网站功能

- 品牌官网与响应式产品介绍
- 账号登录、注册和会话鉴权
- AI 节点画布与生成任务
- `/api/v1/studio/*` CDR 插件兼容接口
- 积分兑换、任务历史与积分账单
- 用户、任务、兑换数据运营后台
- Docker、健康检查与云端持久化配置

网站本地启动：

```bash
npm start
```

访问 `http://localhost:8787`。生产部署说明见 [DEPLOY.md](./DEPLOY.md)。

## 桌面端功能

- 无限画布：平移、缩放、节点拖拽、节点删除、节点运行。
- 节点编排：提示词、图片、AI 生成、高清放大、修改尺寸、背景/场景替换、电商模板、平面广告模板。
- 模板库：电商广告和平面广告常用模板，包括产品海报、文化墙、门头、展会物料、主视觉 KV、灯箱发光字等。
- 素材资产：导入本地素材，AI 结果自动保存到本地资产库。
- 项目保存：本地 SQLite 保存项目、素材、设置和任务状态。
- AI 后端：TokenFlux OpenAI 兼容接口，支持从 `https://tokenflux.ai/v1/images/models` 拉取图片模型。

## 开发

```bash
npm install
npm run dev
```

PowerShell 如果阻止 `npm.ps1`，可使用：

```bash
npm.cmd install
npm.cmd run dev
```

首次使用离线积分码生成器前，运行 `npm run recharge:keygen` 生成本地签名私钥。私钥保存在被 Git 忽略的 `data/recharge-private.pem`，不要上传或共享。

## 打包

```bash
npm.cmd run build
```

Windows 安装包输出到 `release/`。

## TokenFlux 设置

打开软件右上角设置，填写 TokenFlux API Key。默认模型为 `openai/gpt-image-1.5`，也可以从模型列表选择其他 `text-to-image` 或 `image-editing` 模型。
