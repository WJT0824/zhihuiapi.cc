import { nanoid } from "nanoid";
import type { ZhihuiApi } from "@/types/preload";
import type { AppSettings, AssetRecord, BillingLedgerEntry, GenerateImageResult, LocalUser, WalletState, ZhihuiProject } from "@/types/domain";

const now = () => new Date().toISOString();
const webIdentity = (() => {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("zh_user") : null;
    if (raw) { const user = JSON.parse(raw); return { nickname: user.nickname || user.username || "", points: Number(user.points ?? user.credits ?? 100) || 100 }; }
  } catch {}
  return { nickname: "本地用户", points: 100 };
})();

const DEFAULT_AI_BASE_URL = "https://tokenflux.cloud/v1";
const SETTINGS_STORAGE_KEY = "zh_canvas_settings";
const defaultBrowserSettings = (): AppSettings => ({
  tokenFluxBaseUrl: DEFAULT_AI_BASE_URL,
  defaultModel: "gpt-image-2",
  defaultRatio: "1:1",
  upscaleFactor: 2,
  taskConcurrency: 2,
});
const loadBrowserSettings = (): AppSettings => {
  const base = defaultBrowserSettings();
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) return { ...base, ...(JSON.parse(raw) as Partial<AppSettings>) };
    }
  } catch {}
  return base;
};

let mockSettings: AppSettings = loadBrowserSettings();
const persistSettings = (settings: AppSettings) => {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {}
};
function createBrowserImageAsset(file: File, projectId?: string): AssetRecord | undefined {
  if (!file.type.startsWith("image/")) return undefined;
  const id = nanoid();
  const path = typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
  const asset: AssetRecord = {
    id,
    projectId,
    type: "image",
    name: file.name || `图片-${id.slice(0, 6)}.png`,
    path,
    tags: ["image"],
    favorite: false,
    sourceNodeId: undefined,
    metadata: { size: file.size, mimeType: file.type, uploadedAt: now() },
    createdAt: now(),
  };
  const list = assetStore.get(projectId ?? "") ?? [];
  list.push(asset);
  assetStore.set(projectId ?? "", list);
  return asset;
}

const projects = new Map<string, ZhihuiProject>();
const tasks = new Map<string, GenerateImageResult>();
const assetStore = new Map<string, AssetRecord[]>();
let mockUser: LocalUser | undefined = {
  id: "mock-user",
  nickname: webIdentity.nickname,
  phone: webIdentity.nickname,
  createdAt: now(),
};
let rememberedCredentials: { nickname: string; password: string } | undefined = {
  nickname: webIdentity.nickname,
  password: "123456",
};
let wallet: WalletState = { userId: "mock-user", balance: webIdentity.points, updatedAt: now() };
let ledger: BillingLedgerEntry[] = [];

function createMockProject(title = "浏览器预览项目"): ZhihuiProject {
  const createdAt = now();
  const project: ZhihuiProject = {
    version: 1,
    id: nanoid(),
    title,
    createdAt,
    updatedAt: createdAt,
    graph: {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      background: "light",
    },
    assetIds: [],
    exportSettings: { format: "png", width: 1920, height: 1080, scale: 1, transparent: false },
  };
  projects.set(project.id, project);
  return project;
}

export const mockApi: ZhihuiApi = {
  auth: {
    async current() {
      return mockUser;
    },
    async remembered() {
      return rememberedCredentials;
    },
    async register(input) {
      mockUser = { id: nanoid(), nickname: input.nickname, phone: input.nickname, createdAt: now() };
      rememberedCredentials = { nickname: input.nickname, password: input.password };
      wallet = { userId: mockUser.id, balance: 100, updatedAt: now() };
      return mockUser;
    },
    async login(input) {
      rememberedCredentials = { nickname: input.nickname, password: input.password };
      mockUser = { id: "mock-user", nickname: input.nickname, phone: input.nickname, createdAt: now() };
      wallet = { ...wallet, userId: mockUser.id };
      return mockUser;
    },
    async logout() {
      mockUser = undefined;
      rememberedCredentials = undefined;
    },
  },
  projects: {
    async create(title?: string) {
      return createMockProject(title);
    },
    async list() {
      if (!projects.size) createMockProject();
      return [...projects.values()];
    },
    async open(projectId: string) {
      return projects.get(projectId);
    },
    async save(project: ZhihuiProject) {
      const next = { ...project, updatedAt: now() };
      projects.set(next.id, next);
      return next;
    },
    async delete(projectId: string) {
      projects.delete(projectId);
    },
    async export() {
      return { path: "浏览器预览模式不写入文件" };
    },
  },
  assets: {
    async import(projectId) {
      if (typeof document === "undefined") return [];
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.style.display = "none";
      document.body.appendChild(input);
      const files = await new Promise<File[]>((resolve) => {
        input.onchange = () => resolve(Array.from(input.files ?? []));
        input.click();
      }).finally(() => input.remove());
      if (!files.length) return [];
      return files.map((file) => createBrowserImageAsset(file, projectId)).filter((asset): asset is AssetRecord => Boolean(asset));
    },
    async importFiles(projectId, files) {
      if (!files || !Array.isArray(files)) return [];
      return files.map((file) => createBrowserImageAsset(file, projectId)).filter((asset): asset is AssetRecord => Boolean(asset));
    },
    async list(projectId) {
      return [...(assetStore.get(projectId ?? "") ?? [])];
    },
    async rename(assetId: string, name: string) {
      for (const list of assetStore.values()) {
        const asset = list.find((item) => item.id === assetId);
        if (asset) {
          asset.name = name;
          return asset;
        }
      }
      throw new Error("素材不存在。");
    },
    async composeSheet() {
      throw new Error("模拟接口不支持生成总览图。");
    },
    async delete(assetId: string) {
      for (const [projectId, list] of assetStore) {
        const next = list.filter((asset) => asset.id !== assetId);
        if (next.length !== list.length) {
          for (const asset of list) {
            if (asset.id === assetId && asset.path.startsWith("blob:")) {
              try { URL.revokeObjectURL(asset.path); } catch {}
            }
          }
          assetStore.set(projectId, next);
          return;
        }
      }
    },
    async saveAs() {
      return { path: "" };
    },
  },
  ai: {
    async listModels() {
      const inferTags = (value: string) => {
        const lower = value.toLowerCase();
        if (/image|img|dall|flux|gpt-image/.test(lower)) return ["text-to-image", "image-editing"] as const;
        if (/(^|[^a-z])(gpt|o[0-9]|o1|claude|deepseek|codex|command|gemini|mini|compact|luna|sol|terra)([^a-z]|$)/i.test(lower)) return ["reasoning"] as const;
        return ["reasoning"] as const;
      };
      const normalizeList = (items: Array<{ id?: string; modelId?: string; displayName?: string; name?: string; tags?: string[] }>) =>
        items
          .filter((item) => item.modelId || item.id)
          .map((item) => {
            const id = item.modelId || item.id || "gpt-image-2";
            const displayName = item.displayName || item.name || item.modelId || item.id || "GPT Image 2";
            return {
              id,
              name: displayName,
              tags: Array.isArray(item.tags) && item.tags.length ? item.tags.map(String) : [...inferTags(`${id} ${displayName}`)],
            };
          });
      const cacheModels = (list: Array<{ id: string; name: string; tags: string[] }>) => {
        try { localStorage.setItem("zh_models", JSON.stringify(list)); } catch {}
        return list;
      };
      const mergeModels = (base: Array<{ id: string; name: string; tags: string[] }>, extra: Array<{ id: string; name: string; tags: string[] }>) => {
        const merged = new Map(base.map((model) => [model.id.toLowerCase(), model]));
        for (const model of extra) {
          const key = model.id.toLowerCase();
          const existing = merged.get(key);
          if (!existing) {
            merged.set(key, model);
            continue;
          }
          const tags = [...new Set([...existing.tags, ...model.tags])];
          merged.set(key, { ...existing, name: existing.name || model.name, tags });
        }
        return [...merged.values()];
      };
      const readCachedModels = () => {
        try {
          const cached = JSON.parse(localStorage.getItem("zh_models") || "[]");
          return Array.isArray(cached) ? cached as Array<{ id: string; name: string; tags: string[] }> : [];
        } catch {
          return [];
        }
      };
      const collected: Array<{ id: string; name: string; tags: string[] }> = [];
      try {
        const token = typeof localStorage !== "undefined" ? localStorage.getItem("zh_token") : "";
        const savedKey = String(mockSettings.tokenFluxApiKey ?? "").trim();
        const savedBase = String(mockSettings.tokenFluxBaseUrl ?? "").trim();
        if (token && savedKey && savedBase) {
          const syncOrigin = ["localhost", "127.0.0.1"].includes(location.hostname) ? location.origin : "https://zhihuiapicc-production.up.railway.app";
          await fetch(`${syncOrigin}/v1/account`, {
            method: "PUT",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ settings: { tokenFluxBaseUrl: savedBase, tokenFluxApiKey: savedKey } }),
          });
        }
      } catch {}
      try {
        const platformOrigin = ["localhost", "127.0.0.1"].includes(location.hostname) ? location.origin : "https://zhihuiapicc-production.up.railway.app";
        const platformToken = typeof localStorage !== "undefined" ? localStorage.getItem("zh_token") : "";
        const platformResponse = await fetch(`${platformOrigin}/v1/models`, { headers: platformToken ? { authorization: `Bearer ${platformToken}` } : {} });
        if (platformResponse.ok) {
          const platformPayload = await platformResponse.json();
          const platformModels = normalizeList((platformPayload.models || platformPayload.data || []) as Array<{ id?: string; modelId?: string; displayName?: string; name?: string; tags?: string[] }>);
          collected.push(...platformModels);
        }
      } catch {}
      const apiKey = String(mockSettings.tokenFluxApiKey ?? "").trim();
      const customBase = String(mockSettings.tokenFluxBaseUrl ?? "").trim().replace(/\/+$/, "");
      if (apiKey && customBase) {
        try {
          const versionedBase = /\/v\d+$/i.test(customBase) ? customBase : `${customBase}/v1`;
          const response = await fetch(`${versionedBase}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
          if (response.ok) {
            const payload = await response.json();
            const direct = normalizeList((payload.models || payload.data || []) as Array<{ id?: string; modelId?: string; displayName?: string; name?: string; tags?: string[] }>);
            if (direct.length) {
              const merged = mergeModels(collected, direct);
              if (!merged.some((model) => model.tags.includes("text-to-image") || model.tags.includes("image-editing"))) {
                merged.unshift({ id: "gpt-image-2", name: "GPT Image 2", tags: ["text-to-image", "image-editing"] });
              }
              return cacheModels(mergeModels(mergeModels(merged, collected), readCachedModels()));
            }
          }
        } catch {}
      }
      if (collected.length) return cacheModels(mergeModels(collected, readCachedModels()));
      const apiOrigin = ["localhost", "127.0.0.1"].includes(location.hostname) ? location.origin : "https://zhihuiapicc-production.up.railway.app";
      const token = typeof localStorage !== "undefined" ? localStorage.getItem("zh_token") : "";
      const readModels = async (path: string) => {
        const response = await fetch(`${apiOrigin}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
        if (!response.ok) throw new Error(`模型列表读取失败（${response.status}）`);
        const payload = await response.json();
        return normalizeList((payload.models || payload.data || []) as Array<{ id?: string; modelId?: string; displayName?: string; name?: string; tags?: string[] }>);
      };
      try {
        const live = await readModels("/v1/models");
        if (live.length) {
          const hasImage = live.some((model) => model.tags.includes("text-to-image") || model.tags.includes("image-editing"));
          if (hasImage || !live.some((model) => model.tags.includes("reasoning"))) return cacheModels(live);
          return cacheModels([
            { id: "gpt-image-2", name: "GPT Image 2", tags: ["text-to-image", "image-editing"] },
            ...live,
          ]);
        }
      } catch {}
      try {
        const imageModels = await readModels("/v1/image/models");
        if (imageModels.length) return cacheModels(imageModels);
      } catch {}
      try {
        const cached = JSON.parse(localStorage.getItem("zh_models") || "[]");
        if (Array.isArray(cached) && cached.length) return cached;
      } catch {}
      return cacheModels([
        { id: "gpt-image-2", name: "GPT Image 2", tags: ["text-to-image", "image-editing"] },
        { id: "GPT-5.5", name: "GPT-5.5", tags: ["reasoning"] },
        { id: "GPT-5.4", name: "GPT-5.4", tags: ["reasoning"] },
      ]);
    },
    async processText(params) {
      const apiOrigin = ["localhost", "127.0.0.1"].includes(location.hostname) ? location.origin : "https://zhihuiapicc-production.up.railway.app";
      const token = typeof localStorage !== "undefined" ? localStorage.getItem("zh_token") : "";
      const response = await fetch(`${apiOrigin}/v1/ai/text`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          tool: params.tool,
          prompt: params.prompt,
          model: params.model || "gpt-5.5",
          apiKey: String(mockSettings.tokenFluxApiKey ?? "").trim() || undefined,
          baseUrl: String(mockSettings.tokenFluxBaseUrl ?? "").trim() || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.detail || `文本处理失败（${response.status}）`);
      return { text: String(payload.text || params.prompt).trim() };
    },
    async createTask(params) {
      const apiOrigin = ["localhost", "127.0.0.1"].includes(location.hostname) ? location.origin : "https://zhihuiapicc-production.up.railway.app";
      const token = typeof localStorage !== "undefined" ? localStorage.getItem("zh_token") : "";
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;
      const size = String(params.size || "1024x1024");
      const requestApiKey = String(mockSettings.tokenFluxApiKey ?? "").trim();
      const requestBaseUrl = String(mockSettings.tokenFluxBaseUrl ?? "").trim();
      const [widthText, heightText] = size.toLowerCase().split("x");
      const width = Number(widthText) || 1024;
      const height = Number(heightText) || 1024;
      const longEdge = Math.max(width, height);
      const ratioValue = params.extra?.ratio || (width >= height ? `${Math.round((width / height) * 2) / 2}:1` : `1:${Math.round((height / width) * 2) / 2}`);
      const requestId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const taskId = requestId;
      try {
        const response = await fetch(`${apiOrigin}/v1/image/generations`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            request_id: requestId,
            model: String(params.model || "gpt-image-2"),
            prompt: String(params.prompt || ""),
            aspect_ratio: ratioValue === "auto" ? "1:1" : String(ratioValue),
            resolution: String(params.extra?.resolution || (longEdge >= 2800 ? "4K" : longEdge >= 1500 ? "2K" : "1K")),
            quality: String(params.extra?.quality || "auto"),
            quantity: Math.max(1, Math.min(4, Number(params.n) || 1)),
            ...(requestApiKey && requestBaseUrl ? { apiKey: requestApiKey, baseUrl: requestBaseUrl } : {}),
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message || payload.error || payload.detail || `生成失败（${response.status}）`);
        if (payload.status === "succeeded" && payload.assetId) {
          const assetResponse = await fetch(`${apiOrigin}/v1/image/assets/${encodeURIComponent(String(payload.assetId))}`, {
            headers: token ? { authorization: `Bearer ${token}` } : {},
          });
          if (assetResponse.ok) {
            const blob = await assetResponse.blob();
            const id = nanoid();
            const path = URL.createObjectURL(blob);
            const asset: AssetRecord = {
              id,
              projectId: params.projectId,
              type: "image",
              name: `${String(params.model || "生成图片")}-${new Date().toLocaleTimeString("zh-CN", { hour12: false })}.png`,
              path,
              tags: ["generated"],
              favorite: false,
              sourceNodeId: params.sourceNodeId,
              metadata: { role: "result", requestId, size },
              createdAt: now(),
            };
            const list = assetStore.get(params.projectId ?? "") ?? [];
            list.push(asset);
            assetStore.set(params.projectId ?? "", list);
            const result: GenerateImageResult = { taskId, status: "completed", assetIds: [asset.id] };
            tasks.set(taskId, result);
            return result;
          }
        }
        if (payload.status === "failed") throw new Error(payload.error || "生成失败，请检查模型配置或积分");
        const task: GenerateImageResult = { taskId, status: "failed", assetIds: [], error: "任务未返回结果" };
        tasks.set(task.taskId, task);
        return task;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const task: GenerateImageResult = { taskId, status: "failed", assetIds: [], error: message };
        tasks.set(task.taskId, task);
        return task;
      }
    },
    async inpaint(params) {
      const apiOrigin = ["localhost", "127.0.0.1"].includes(location.hostname) ? location.origin : "https://zhihuiapicc-production.up.railway.app";
      const token = typeof localStorage !== "undefined" ? localStorage.getItem("zh_token") : "";
      const requestId = `paint-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const imageBlob = await (await fetch(params.imagePath)).blob();
        const maskBlob = await (await fetch(params.maskDataUrl)).blob();
        const form = new FormData();
        form.append("files", new File([imageBlob], "source.png", { type: "image/png" }));
        form.append("files", new File([maskBlob], "mask.png", { type: "image/png" }));
        const upload = await fetch(`${apiOrigin}/v1/image/references`, {
          method: "POST",
          headers: token ? { authorization: `Bearer ${token}` } : {},
          body: form,
        });
        const uploaded = await upload.json().catch(() => ({}));
        if (!upload.ok || !Array.isArray(uploaded.references) || uploaded.references.length < 2) {
          throw new Error(uploaded.error || uploaded.detail || "原图或蒙版上传失败");
        }
        const requestApiKey = String(mockSettings.tokenFluxApiKey ?? "").trim();
        const requestBaseUrl = String(mockSettings.tokenFluxBaseUrl ?? "").trim();
        const response = await fetch(`${apiOrigin}/v1/image/generations`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            request_id: requestId,
            model: String(params.model || "gpt-image-2"),
            prompt: String(params.prompt || ""),
            aspect_ratio: String(params.ratio || "1:1"),
            resolution: String(params.resolution || "1K"),
            quality: "high",
            quantity: 1,
            reference_ids: [uploaded.references[0].id],
            mask_id: uploaded.references[1].id,
            ...(requestApiKey && requestBaseUrl ? { apiKey: requestApiKey, baseUrl: requestBaseUrl } : {}),
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || payload.detail || `局部重绘失败（${response.status}）`);
        if (payload.status !== "succeeded" || !payload.assetId) throw new Error(payload.error || "局部重绘没有返回结果");
        const assetResponse = await fetch(`${apiOrigin}/v1/image/assets/${encodeURIComponent(String(payload.assetId))}`, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
        if (!assetResponse.ok) throw new Error("局部重绘结果下载失败");
        const blob = await assetResponse.blob();
        const id = nanoid();
        const asset: AssetRecord = {
          id,
          projectId: params.projectId,
          type: "image",
          name: `局部重绘-${new Date().toLocaleTimeString("zh-CN", { hour12: false })}.png`,
          path: URL.createObjectURL(blob),
          tags: ["generated", "inpaint"],
          favorite: false,
          sourceNodeId: params.sourceNodeId,
          metadata: { role: "result", requestId },
          createdAt: now(),
        };
        const list = assetStore.get(params.projectId ?? "") ?? [];
        list.push(asset);
        assetStore.set(params.projectId ?? "", list);
        return { taskId: requestId, status: "completed", assetIds: [asset.id] } as GenerateImageResult;
      } catch (error) {
        return { taskId: requestId, status: "failed", assetIds: [], error: error instanceof Error ? error.message : String(error) };
      }
    },
    async status(taskId: string) {
      return tasks.get(taskId) ?? { taskId, status: "failed", assetIds: [], error: "任务不存在。" };
    },
    async cancel(taskId: string) {
      const task: GenerateImageResult = { taskId, status: "canceled", assetIds: [] };
      tasks.set(task.taskId, task);
      return task;
    },
  },
  billing: {
    async getWallet() {
      return wallet;
    },
    async redeem(code: string) {
      if (!code.trim()) throw new Error("请输入积分访问码。");
      wallet = { ...wallet, balance: wallet.balance + 100, updatedAt: now() };
      const entry: BillingLedgerEntry = {
        id: nanoid(),
        userId: wallet.userId,
        type: "recharge",
        status: "completed",
        points: 100,
        amountCny: 10,
        note: "浏览器预览兑换",
        createdAt: now(),
      };
      ledger = [entry, ...ledger];
      return { wallet, entry, points: 100, amountCny: 10 };
    },
    async listLedger() {
      return ledger;
    },
  },
  settings: {
    async get() {
      return mockSettings;
    },
    async set(settings: AppSettings) {
      Object.assign(mockSettings, settings);
      persistSettings(mockSettings);
      try {
        const apiOrigin = ["localhost", "127.0.0.1"].includes(location.hostname) ? location.origin : "https://zhihuiapicc-production.up.railway.app";
        const token = localStorage.getItem("zh_token");
        if (token) {
          await fetch(`${apiOrigin}/v1/account`, {
            method: "PUT",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({
              settings: {
                tokenFluxBaseUrl: mockSettings.tokenFluxBaseUrl || "",
                tokenFluxApiKey: mockSettings.tokenFluxApiKey || "",
                defaultModel: mockSettings.defaultModel,
                defaultRatio: mockSettings.defaultRatio,
              },
            }),
          });
        }
      } catch {}
      return mockSettings;
    },
    async testApiKey(apiKey?: string, baseUrl?: string, mode: "models" | "image" | "reasoning" = "models") {
      try {
        const apiOrigin = ["localhost", "127.0.0.1"].includes(location.hostname) ? location.origin : "https://zhihuiapicc-production.up.railway.app";
        const response = await fetch(`${apiOrigin}/v1/ai/test-connection`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey: apiKey || "", baseUrl: baseUrl || mockSettings.tokenFluxBaseUrl, mode }),
        });
        const payload = await response.json();
        const models = Array.isArray(payload.models)
          ? (payload.models as Array<{ id?: string; modelId?: string; displayName?: string; name?: string; tags?: string[] }>)
              .filter((item) => item.modelId || item.id)
              .map((item) => ({
                id: item.modelId || item.id || "gpt-image-2",
                name: item.displayName || item.name || item.modelId || item.id || "GPT Image 2",
                tags: Array.isArray(item.tags) && item.tags.length ? item.tags.map(String) : mode === "models" ? ["reasoning"] : ["image-editing"],
              }))
          : [];
        if (!response.ok && !models.length) {
          try {
            const cached = JSON.parse(localStorage.getItem("zh_models") || "[]");
            if (Array.isArray(cached) && cached.length) {
              return { ok: true, message: `${payload.message || payload.error || "上游暂时不可用，已使用本地缓存模型"}`, models: cached };
            }
          } catch {}
        }
        return { ok: response.ok, message: payload.message || payload.error || payload.detail || "连接失败", models };
      } catch {
        return { ok: false, message: "连接失败：无法访问测试接口，请检查网络后重试" };
      }
    },
  },
};
