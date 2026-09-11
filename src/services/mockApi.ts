import { nanoid } from "nanoid";
import type { ZhihuiApi } from "@/types/preload";
import type { AppSettings, AssetRecord, BillingLedgerEntry, GenerateImageResult, LocalUser, WalletState, WorkflowLibrary, WorkflowPreset, ZhihuiProject } from "@/types/domain";

const now = () => new Date().toISOString();
const webIdentity = (() => {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("zh_user") : null;
    if (raw) { const user = JSON.parse(raw); return { nickname: user.nickname || user.username || "", points: Number(user.points ?? user.credits ?? 100) || 100 }; }
  } catch {}
  return { nickname: "本地用户", points: 100 };
})();

const DEFAULT_AI_BASE_URL = "";
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
async function accountRequest(endpoint: string, body?: unknown) {
  const token = localStorage.getItem("zh_token");
  if (!token) throw new Error("请先登录网站账号。");
  const origin = ["localhost", "127.0.0.1"].includes(location.hostname) ? location.origin : "https://zhihuiapicc-production.up.railway.app";
  const response = await fetch(origin + endpoint, {
    method: body === undefined ? "GET" : "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || payload.detail || `请求失败（${response.status}）`);
  return payload;
}
function acceptAccountSettings(user: { profile?: { settings?: Partial<AppSettings> } }) {
  mockSettings = { ...mockSettings, tokenFluxApiKey: "", tokenFluxApiKeyConfigured: false, ...(user.profile?.settings || {}) };
  persistSettings(mockSettings);
  localStorage.setItem("zh_user", JSON.stringify(user));
  return mockSettings;
}
const persistSettings = (settings: AppSettings) => {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {}
};
const serviceOrigin = () =>
  typeof location !== "undefined" && ["localhost", "127.0.0.1"].includes(location.hostname)
    ? location.origin
    : "https://zhihuiapicc-production.up.railway.app";
const authToken = () => (typeof localStorage === "undefined" ? "" : localStorage.getItem("zh_token") || "");
async function uploadCanvasReferences(assetIds: string[] | undefined): Promise<string[]> {
  if (!assetIds?.length) return [];
  const token = authToken();
  if (!token) throw new Error("请先登录网站账号。");
  const form = new FormData();
  let attached = 0;
  for (const assetId of assetIds) {
    const asset = [...assetStore.values()].flat().find((item) => item.id === assetId);
    if (!asset?.path) continue;
    const blob = await (await fetch(asset.path)).blob();
    form.append("files", new File([blob], asset.name || `reference-${attached}.png`, { type: blob.type || "image/png" }));
    attached += 1;
  }
  if (!attached) return [];
  const response = await fetch(`${serviceOrigin()}/v1/image/references`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.detail || `参考图上传失败（${response.status}）`);
  return (payload.references || []).map((item: { id: string }) => item.id);
}
async function storeResultImage(assetId: string, params: { projectId?: string; sourceNodeId?: string; name: string; requestId: string; metadata?: Record<string, unknown> }): Promise<AssetRecord> {
  const token = authToken();
  const response = await fetch(`${serviceOrigin()}/v1/image/assets/${encodeURIComponent(assetId)}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error("结果文件下载失败");
  const blob = await response.blob();
  const asset: AssetRecord = {
    id: nanoid(),
    projectId: params.projectId,
    type: blob.type === "image/svg+xml" ? "document" : "image",
    name: params.name,
    path: URL.createObjectURL(blob),
    tags: ["generated"],
    favorite: false,
    sourceNodeId: params.sourceNodeId,
    metadata: { requestId: params.requestId, mimeType: blob.type, ...(params.metadata || {}) },
    createdAt: now(),
  };
  const list = assetStore.get(params.projectId ?? "") ?? [];
  list.push(asset);
  assetStore.set(params.projectId ?? "", list);
  return asset;
}
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
      const response = await accountRequest("/v1/models?refresh=1");
      const models = (response.models || []).map((item: { id?: string; modelId?: string; displayName?: string; name?: string; tags?: string[] }) => ({
        id: item.id || item.modelId || "",
        name: item.displayName || item.name || item.id || item.modelId || "",
        tags: item.tags || [],
      })).filter((item: { id: string }) => item.id);
      localStorage.setItem("zh_models", JSON.stringify(models));
      return models;
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
        const referenceIds = await uploadCanvasReferences(params.referenceAssetIds);
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
            ...(referenceIds.length ? { reference_ids: referenceIds } : {}),
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
    async listWorkflows(): Promise<WorkflowLibrary> {
      const response = await accountRequest("/v1/studio/workflows");
      return {
        comfy: response.comfy || { configured: false, enabled: false },
        workflows: (response.workflows || []) as WorkflowPreset[],
      };
    },
    async runWorkflow(params): Promise<GenerateImageResult> {
      const token = authToken();
      const requestId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const referenceIds = await uploadCanvasReferences(params.referenceAssetIds);
        const response = await fetch(`${serviceOrigin()}/v1/studio/workflows/${encodeURIComponent(params.code)}/run`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            request_id: requestId,
            prompt: params.prompt || "",
            scale: params.scale,
            width: params.width,
            height: params.height,
            reference_ids: referenceIds,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          return {
            taskId: requestId,
            status: "failed",
            assetIds: [],
            error: payload.error || payload.detail || `工作流启动失败（${response.status}）`,
            code: payload.code,
            fallback: Boolean(payload.fallback),
          };
        }
        const jobId = String(payload.jobId || "");
        for (let attempt = 0; attempt < 600; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2500));
          const jobResponse = await fetch(`${serviceOrigin()}/v1/image/jobs/${encodeURIComponent(jobId)}`, {
            headers: token ? { authorization: `Bearer ${token}` } : {},
          });
          const job = await jobResponse.json().catch(() => ({}));
          if (!jobResponse.ok) {
            return { taskId: jobId, status: "failed", assetIds: [], error: job.error || "工作流状态读取失败" };
          }
          params.onProgress?.(Number(job.progress || 0));
          if (job.status === "succeeded") {
            const asset = await storeResultImage(String(job.assetId), {
              projectId: params.projectId,
              sourceNodeId: params.sourceNodeId,
              name: `${payload.workflow?.name || params.code}-${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`,
              requestId,
              metadata: { workflowCode: params.code, outputKind: job.outputKind },
            });
            const result: GenerateImageResult = { taskId: jobId, status: "completed", assetIds: [asset.id], progress: 100 };
            tasks.set(jobId, result);
            return result;
          }
          if (job.status === "failed") {
            return { taskId: jobId, status: "failed", assetIds: [], error: job.error || "工作流执行失败" };
          }
        }
        return { taskId: jobId, status: "failed", assetIds: [], error: "工作流超时，请稍后在任务历史查看结果。" };
      } catch (error) {
        return { taskId: requestId, status: "failed", assetIds: [], error: error instanceof Error ? error.message : String(error) };
      }
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
      if (!localStorage.getItem("zh_token")) return mockSettings;
      const payload = await accountRequest("/v1/account");
      const saved = payload.user.profile?.settings || {};
      // Migrate a legacy browser key once; an existing account configuration wins.
      if (saved.upstreamMode === undefined && saved.tokenFluxBaseUrl === undefined && mockSettings.tokenFluxApiKey && mockSettings.tokenFluxBaseUrl) {
        return this.set({ ...mockSettings, upstreamMode: "custom" });
      }
      return acceptAccountSettings(payload.user);
    },
    async set(settings: AppSettings) {
      const next = { ...settings };
      const platform = next.upstreamMode === "platform";
      if (platform) {
        next.tokenFluxApiKey = "";
        next.tokenFluxBaseUrl = "";
      } else if (!next.tokenFluxApiKey?.trim()) {
        // An omitted key keeps the server-side secret; an empty string clears it.
        delete next.tokenFluxApiKey;
      }
      const payload = await accountRequest("/v1/account", { settings: next });
      localStorage.removeItem("zh_models");
      return acceptAccountSettings(payload.user);
    },
    async testApiKey(apiKey?: string, baseUrl?: string, mode: "models" | "image" | "reasoning" = "models") {
      try {
        const apiOrigin = ["localhost", "127.0.0.1"].includes(location.hostname) ? location.origin : "https://zhihuiapicc-production.up.railway.app";
        const requestBody: Record<string, string> = { mode };
        if (apiKey?.trim()) { requestBody.apiKey = apiKey.trim(); requestBody.baseUrl = baseUrl || mockSettings.tokenFluxBaseUrl || ""; }
        else if (baseUrl && baseUrl !== mockSettings.tokenFluxBaseUrl) requestBody.baseUrl = baseUrl;
        const response = await fetch(`${apiOrigin}/v1/ai/test-connection`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(localStorage.getItem("zh_token") ? { authorization: `Bearer ${localStorage.getItem("zh_token")}` } : {}) },
          body: JSON.stringify(requestBody),
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
        return { ok: response.ok, message: payload.message || payload.error || payload.detail || "连接失败", models };
      } catch {
        return { ok: false, message: "连接失败：无法访问测试接口，请检查网络后重试" };
      }
    },
  },
};
