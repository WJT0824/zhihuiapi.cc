import type {
  AppSettings,
  AssetRecord,
  GenerateImageParams,
  GenerateImageResult,
  ProcessTextParams,
  BillingLedgerEntry,
  LocalUser,
  RechargeRedeemResult,
  TokenFluxModel,
  WalletState,
  ZhihuiProject,
} from "./domain";

export interface ZhihuiApi {
  auth: {
    current(): Promise<LocalUser | undefined>;
    remembered(): Promise<{ nickname: string; password: string } | undefined>;
    register(input: { nickname: string; password: string }): Promise<LocalUser>;
    login(input: { nickname: string; password: string }): Promise<LocalUser>;
    logout(): Promise<void>;
  };
  projects: {
    create(title?: string): Promise<ZhihuiProject>;
    list(): Promise<ZhihuiProject[]>;
    open(projectId: string): Promise<ZhihuiProject | undefined>;
    save(project: ZhihuiProject): Promise<ZhihuiProject>;
    delete(projectId: string): Promise<void>;
    export(project: ZhihuiProject, format: "png" | "jpeg" | "pdf"): Promise<{ path: string }>;
  };
  assets: {
    import(projectId?: string): Promise<AssetRecord[]>;
    list(projectId?: string): Promise<AssetRecord[]>;
    rename(assetId: string, name: string): Promise<AssetRecord>;
    composeSheet(assetIds: string[], projectId?: string, sourceNodeId?: string): Promise<AssetRecord>;
    delete(assetId: string): Promise<void>;
    saveAs(assetId: string): Promise<{ path: string }>;
  };
  ai: {
    listModels(): Promise<TokenFluxModel[]>;
    processText(params: ProcessTextParams): Promise<{ text: string }>;
    createTask(params: GenerateImageParams & { projectId?: string; sourceNodeId?: string }): Promise<GenerateImageResult>;
    status(taskId: string): Promise<GenerateImageResult>;
    cancel(taskId: string): Promise<GenerateImageResult>;
  };
  billing: {
    getWallet(): Promise<WalletState>;
    redeem(code: string): Promise<RechargeRedeemResult>;
    listLedger(): Promise<BillingLedgerEntry[]>;
  };
  settings: {
    get(): Promise<AppSettings>;
    set(settings: AppSettings): Promise<AppSettings>;
    testApiKey(apiKey?: string, baseUrl?: string, mode?: "models" | "image" | "reasoning"): Promise<{ ok: boolean; message: string }>;
  };
}

declare global {
  interface Window {
    zhihui: ZhihuiApi;
  }
}
