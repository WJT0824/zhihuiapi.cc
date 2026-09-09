import { nanoid } from "nanoid";
import type { ZhihuiApi } from "@/types/preload";
import type { AppSettings, BillingLedgerEntry, GenerateImageResult, LocalUser, WalletState, ZhihuiProject } from "@/types/domain";

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

const projects = new Map<string, ZhihuiProject>();
const tasks = new Map<string, GenerateImageResult>();
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
    async import() {
      return [];
    },
    async list() {
      return [];
    },
    async rename(_assetId: string, _name: string) {
      throw new Error("模拟接口不支持重命名素材。");
    },
    async composeSheet() {
      throw new Error("模拟接口不支持生成总览图。");
    },
    async delete() {},
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
              const hasImage = direct.some((model) => model.tags.includes("text-to-image") || model.tags.includes("image-editing"));
              if (hasImage || !direct.some((model) => model.tags.includes("reasoning"))) return direct;
              return [{ id: "gpt-image-2", name: "GPT Image 2", tags: ["text-to-image", "image-editing"] }, ...direct];
            }
          }
        } catch {}
      }
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
          if (hasImage || !live.some((model) => model.tags.includes("reasoning"))) return live;
          return [
            { id: "gpt-image-2", name: "GPT Image 2", tags: ["text-to-image", "image-editing"] },
            ...live,
          ];
        }
      } catch {}
      try {
        const imageModels = await readModels("/v1/image/models");
        if (imageModels.length) return imageModels;
      } catch {}
      return [
        { id: "gpt-image-2", name: "GPT Image 2", tags: ["text-to-image", "image-editing"] },
        { id: "GPT-5.5", name: "GPT-5.5", tags: ["reasoning"] },
        { id: "GPT-5.4", name: "GPT-5.4", tags: ["reasoning"] },
      ];
    },
    async processText(params) {
      return { text: params.prompt.trim() };
    },
    async createTask() {
      const task: GenerateImageResult = { taskId: nanoid(), status: "failed", assetIds: [], error: "浏览器预览模式未连接 TokenFlux。" };
      tasks.set(task.taskId, task);
      return task;
    },
    async status(taskId: string) {
      return tasks.get(taskId) ?? { taskId, status: "failed", assetIds: [], error: "任务不存在。" };
    },
    async cancel(taskId: string) {
      const task: GenerateImageResult = { taskId, status: "canceled", assetIds: [] };
      tasks.set(taskId, task);
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
        return { ok: response.ok, message: payload.message || payload.error || payload.detail || "连接失败", models };
      } catch {
        return { ok: false, message: "连接失败：无法访问测试接口，请检查网络后重试" };
      }
    },
  },
};
