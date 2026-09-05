import { nanoid } from "nanoid";
import type { ZhihuiApi } from "@/types/preload";
import type { AppSettings, BillingLedgerEntry, GenerateImageResult, LocalUser, WalletState, ZhihuiProject } from "@/types/domain";

const now = () => new Date().toISOString();

const mockSettings: AppSettings = {
  defaultModel: "gpt-image-2",
  defaultRatio: "1:1",
  upscaleFactor: 2,
  taskConcurrency: 2,
};

const projects = new Map<string, ZhihuiProject>();
const tasks = new Map<string, GenerateImageResult>();
let mockUser: LocalUser | undefined = {
  id: "mock-user",
  nickname: "本地用户",
  phone: "本地用户",
  createdAt: now(),
};
let rememberedCredentials: { nickname: string; password: string } | undefined = {
  nickname: "本地用户",
  password: "123456",
};
let wallet: WalletState = { userId: "mock-user", balance: 100, updatedAt: now() };
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
      return [
        { id: "gpt-image-2", name: "GPT Image 2", tags: ["text-to-image", "image-editing"] },
        { id: "GPT-5.5", name: "GPT-5.5", tags: ["reasoning"] },
        { id: "GPT-5.4", name: "GPT-5.4", tags: ["reasoning"] },
        { id: "flux-kontext-apps/restore-image", name: "restore-image", tags: ["image-editing"] },
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
      return mockSettings;
    },
    async testApiKey() {
      return { ok: false, message: "浏览器预览模式未连接 Electron IPC。" };
    },
  },
};
