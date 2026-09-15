#!/usr/bin/env node
// Publishes a plugin installer to a new GitHub Release and repoints the
// download page at it. GitHub releases in this repository are immutable, so an
// installer update always creates a fresh release instead of replacing assets.
//
// Usage: node scripts/publish-plugin-installer.mjs <path-to-exe> [--tag <tag>] [--name <asset-name>]

import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const OWNER = "WJT0824";
const REPO = "zhihuiapi.cc";
const DOWNLOAD_PAGE = path.resolve("web/downloads/index.html");
const DEFAULT_ASSET_NAME = "ZhiHui-CDR-Plugin-AI-v1.4.0.exe";

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const filePath = args.find((arg) => !arg.startsWith("--"));
if (!filePath) fail("请传入安装包路径，例如 node scripts/publish-plugin-installer.mjs \"C:/path/插件.exe\"");
const readOption = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const absolute = path.resolve(filePath);
let stats;
try {
  stats = statSync(absolute);
} catch {
  fail(`找不到文件：${absolute}`);
}
if (!stats.isFile()) fail(`不是文件：${absolute}`);
const assetName = readOption("name", DEFAULT_ASSET_NAME);
// Local date, not UTC: a 01:00 Beijing publish is still the previous day in UTC.
const local = new Date();
const displayDate = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
const stamp = displayDate.replace(/-/g, "");
const tag = readOption("tag", `plugin-v1.4.0-ai-${stamp}`);

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  try {
    const output = execFileSync("git", ["credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
    });
    const line = output.split(/\r?\n/).find((item) => item.startsWith("password="));
    if (line) return line.slice("password=".length).trim();
  } catch {
    /* fall through to the error below */
  }
  fail("没有找到 GitHub 凭据，请先设置 GITHUB_TOKEN 环境变量，或确认 git 已保存 github.com 的登录信息。");
}

const token = githubToken();
const api = (url, options = {}) =>
  fetch(url, {
    ...options,
    headers: {
      authorization: `token ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "zhihui-plugin-publisher",
      ...(options.headers || {}),
    },
  });

async function json(response, label) {
  const text = await response.text();
  if (!response.ok) fail(`${label}失败（HTTP ${response.status}）：${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function uploadAsset(releaseId, uploadUrl) {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      authorization: `token ${token}`,
      "content-type": "application/octet-stream",
      "content-length": String(stats.size),
      "user-agent": "zhihui-plugin-publisher",
    },
    body: createReadStream(absolute),
    duplex: "half",
  });
  return json(response, "上传安装包");
}

console.log(`安装包：${absolute}`);
console.log(`大小：${stats.size} 字节`);
console.log(`发布标签：${tag}`);

const release = await json(
  await api(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      name: `郅绘 CDR 插件 AI 版 v1.4.0 (${stamp})`,
      target_commitish: "main",
      draft: true,
      prerelease: false,
      body: "郅绘 CDR 插件 AI 版 v1.4.0 更新安装包。安装后使用 https://zhihuiapi.cc 账号登录，积分、模型与工作流自动同步。",
    }),
  }),
  "创建草稿发布",
);
console.log(`已创建草稿发布：${release.id}`);

const asset = await uploadAsset(
  release.id,
  `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`,
);
if (asset.size !== stats.size) fail(`上传大小不一致：本地 ${stats.size}，线上 ${asset.size}`);
console.log(`已上传：${asset.name}（${asset.size} 字节，id ${asset.id}）`);

await json(
  await api(`https://api.github.com/repos/${OWNER}/${REPO}/releases/${release.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draft: false }),
  }),
  "发布 Release",
);

const downloadUrl = `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${encodeURIComponent(assetName)}`;
const page = readFileSync(DOWNLOAD_PAGE, "utf8");
// The page links to releases/latest so every future release is picked up
// without another deploy; only the "last updated" label changes here.
const linkPattern = /https:\/\/github\.com\/[^"]+\/releases\/(?:latest\/download|download\/[^/]+)\/[^"]+/g;
if (!linkPattern.test(page)) fail(`没有在 ${DOWNLOAD_PAGE} 找到下载链接，请手动更新。`);
linkPattern.lastIndex = 0;
const latestUrl = `https://github.com/${OWNER}/${REPO}/releases/latest/download/${encodeURIComponent(assetName)}`;
const nextPage = page
  .replace(linkPattern, latestUrl)
  .replace(/完整安装包（[^）]*）/g, `完整安装包（${displayDate} 更新）`);
writeFileSync(DOWNLOAD_PAGE, nextPage, "utf8");

console.log("");
console.log(`下载页已更新：${path.relative(process.cwd(), DOWNLOAD_PAGE)}`);
console.log(`本次发布地址：${downloadUrl}`);
console.log(`下载页使用的固定地址：${latestUrl}`);
console.log("接下来执行：");
console.log("  npm run build:web");
console.log('  git add web/downloads/index.html && git commit -m "chore: update plugin installer" && git push origin main');
