import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, GenerateImageParams, ProcessTextParams, ZhihuiProject } from "../src/types/domain";
import type { ZhihuiApi } from "../src/types/preload";

const api: ZhihuiApi = {
  auth: {
    current: () => ipcRenderer.invoke("auth.current"),
    remembered: () => ipcRenderer.invoke("auth.remembered"),
    register: (input: { nickname: string; password: string }) => ipcRenderer.invoke("auth.register", input),
    login: (input: { nickname: string; password: string }) => ipcRenderer.invoke("auth.login", input),
    logout: () => ipcRenderer.invoke("auth.logout"),
  },
  projects: {
    create: (title?: string) => ipcRenderer.invoke("projects.create", title),
    list: () => ipcRenderer.invoke("projects.list"),
    open: (projectId: string) => ipcRenderer.invoke("projects.open", projectId),
    save: (project: ZhihuiProject) => ipcRenderer.invoke("projects.save", project),
    delete: (projectId: string) => ipcRenderer.invoke("projects.delete", projectId),
    export: (project: ZhihuiProject, format: "png" | "jpeg" | "pdf") =>
      ipcRenderer.invoke("projects.export", project, format),
  },
  assets: {
    import: (projectId?: string) => ipcRenderer.invoke("assets.import", projectId),
    list: (projectId?: string) => ipcRenderer.invoke("assets.list", projectId),
    rename: (assetId: string, name: string) => ipcRenderer.invoke("assets.rename", assetId, name),
    composeSheet: (assetIds: string[], projectId?: string, sourceNodeId?: string) => ipcRenderer.invoke("assets.composeSheet", assetIds, projectId, sourceNodeId),
    delete: (assetId: string) => ipcRenderer.invoke("assets.delete", assetId),
    saveAs: (assetId: string) => ipcRenderer.invoke("assets.saveAs", assetId),
  },
  ai: {
    listModels: () => ipcRenderer.invoke("ai.models.list"),
    processText: (params: ProcessTextParams) => ipcRenderer.invoke("ai.text.process", params),
    createTask: (params: GenerateImageParams & { projectId?: string; sourceNodeId?: string }) =>
      ipcRenderer.invoke("ai.generate.createTask", params),
    status: (taskId: string) => ipcRenderer.invoke("ai.task.status", taskId),
    cancel: (taskId: string) => ipcRenderer.invoke("ai.task.cancel", taskId),
  },
  billing: {
    getWallet: () => ipcRenderer.invoke("billing.wallet.get"),
    redeem: (code: string) => ipcRenderer.invoke("billing.recharge.redeem", code),
    listLedger: () => ipcRenderer.invoke("billing.ledger.list"),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings.get"),
    set: (settings: AppSettings) => ipcRenderer.invoke("settings.set", settings),
    testApiKey: (apiKey?: string, baseUrl?: string, mode?: "models" | "image" | "reasoning") =>
      ipcRenderer.invoke("settings.testApiKey", apiKey, baseUrl, mode),
  },
};

contextBridge.exposeInMainWorld("zhihui", api);
