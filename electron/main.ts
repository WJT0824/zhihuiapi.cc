import { app, BrowserWindow, dialog, ipcMain, safeStorage, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import crypto from "node:crypto";
import { nativeImage } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type {
  AppSettings,
  AssetRecord,
  BillingLedgerEntry,
  BillingReservation,
  CanvasGraph,
  GenerateImageParams,
  GenerateImageResult,
  LocalUser,
  ProcessTextParams,
  RechargeRedeemResult,
  TaskStatus,
  TokenFluxModel,
  WalletState,
  ZhihuiProject,
} from "../src/types/domain";
import { generationCost, pointsForAmount, rechargeAmounts } from "../src/services/billingRules";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow: BrowserWindow | undefined;
let storeReady: Promise<void> | undefined;

function log(message: string, details?: unknown) {
  try {
    const logDir = app.getPath("userData");
    fs.mkdirSync(logDir, { recursive: true });
    const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
    fs.appendFileSync(path.join(logDir, "debug.log"), `[${new Date().toISOString()}] ${message}${suffix}\n`, "utf8");
  } catch {
    // Logging must never block app startup.
  }
}

const defaultSettings: AppSettings = {
  tokenFluxBaseUrl: "https://tokenflux.cloud/v1",
  defaultModel: "gpt-image-2",
  defaultRatio: "1:1",
  upscaleFactor: 2,
  taskConcurrency: 2,
};

const IMAGE_MODEL_ID = "gpt-image-2";
const REASONING_MODEL_CANDIDATES = ["GPT-5.5", "gpt-5.5", "GPT-5.4", "gpt-5.4"];
const SESSION_SETTING_KEY = "auth.currentUserId";
const REMEMBERED_CREDENTIALS_SETTING_KEY = "auth.rememberedCredentials";
const BILLING_ENABLED = __ZH_BILLING_ENABLED__;
const RECHARGE_CODE_PREFIX = "ZHRC1";
const RECHARGE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAziIuFwOLkYPZE7YI2dL7fwlDzsRRFANWlvOosrPfCnY=
-----END PUBLIC KEY-----`;

function normalizeBaseUrl(input?: string) {
  let raw = (input || defaultSettings.tokenFluxBaseUrl || "https://tokenflux.cloud/v1").trim().replace(/\/+$/, "");
  raw = raw.replace(/^http:\/\/tokenflux\.cloud/i, "https://tokenflux.cloud");
  raw = raw.replace(/\/(chat\/completions|images\/generations|images\/edits|images\/models|models)$/i, "");
  if (/\/v\d+$/i.test(raw)) return raw;
  return `${raw}/v1`;
}

function apiUrl(baseUrl: string, endpoint: string) {
  return `${normalizeBaseUrl(baseUrl)}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

function authHeaders(apiKey?: string): Record<string, string> {
  const key = normalizeApiKey(apiKey);
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function normalizeApiKey(apiKey?: string) {
  return (apiKey ?? "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/\s+/g, "");
}

function normalizeModelId(model?: string) {
  const value = String(model || "").trim();
  if (!value) return IMAGE_MODEL_ID;
  if (["images-2", "GPT-images-2", "GPT Image 2", "gpt image 2", "图像-2", "图片-2"].includes(value)) return IMAGE_MODEL_ID;
  if (value.toLowerCase() === IMAGE_MODEL_ID) return IMAGE_MODEL_ID;
  if (value.toLowerCase() === "gpt-5.5") return value === "GPT-5.5" ? "GPT-5.5" : "gpt-5.5";
  if (value.toLowerCase() === "gpt-5.4") return value === "GPT-5.4" ? "GPT-5.4" : "gpt-5.4";
  return value;
}

function reasoningModelCandidates(model?: string) {
  const preferred = String(model || "").trim();
  return [...new Set([preferred, ...REASONING_MODEL_CANDIDATES].filter(Boolean))];
}

const emptyGraph = (): CanvasGraph => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  background: "gradient",
});

class SqliteStore {
  private SQL?: SqlJsStatic;
  private db?: Database;
  private dbPath = "";

  async init() {
    this.dbPath = path.join(app.getPath("userData"), "zhihui.sqlite");
    const wasmPath = app.isPackaged
      ? path.join(process.resourcesPath, "sql-wasm.wasm")
      : path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
    const wasmBinary = await fsp.readFile(wasmPath);
    this.SQL = await initSqlJs({ locateFile: () => wasmPath, wasmBinary });
    this.db = fs.existsSync(this.dbPath)
      ? new this.SQL.Database(await fsp.readFile(this.dbPath))
      : new this.SQL.Database();
    this.migrate();
    await this.persist();
  }

  private get database() {
    if (!this.db) throw new Error("Database is not initialized.");
    return this.db;
  }

  private migrate() {
    this.database.run(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, project_id TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, nickname TEXT NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wallets (user_id TEXT PRIMARY KEY, balance INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS billing_ledger (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, points INTEGER NOT NULL, amount_cny INTEGER, task_id TEXT, reservation_id TEXT, nonce TEXT, note TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS redeemed_recharge_codes (nonce TEXT PRIMARY KEY, user_id TEXT NOT NULL, points INTEGER NOT NULL, amount_cny INTEGER NOT NULL, redeemed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS billing_reservations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL, points INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
  }

  async persist() {
    const bytes = this.database.export();
    await fsp.mkdir(path.dirname(this.dbPath), { recursive: true });
    await fsp.writeFile(this.dbPath, Buffer.from(bytes));
  }

  getSetting<T>(key: string): T | undefined {
    const result = this.database.exec("SELECT value FROM settings WHERE key = $key", { $key: key });
    const value = result[0]?.values[0]?.[0];
    return typeof value === "string" ? (JSON.parse(value) as T) : undefined;
  }

  async setSetting(key: string, value: unknown) {
    this.database.run("INSERT OR REPLACE INTO settings (key, value) VALUES ($key, $value)", {
      $key: key,
      $value: JSON.stringify(value),
    });
    await this.persist();
  }

  listProjects(): ZhihuiProject[] {
    const rows = this.database.exec("SELECT data FROM projects ORDER BY updated_at DESC")[0]?.values ?? [];
    return rows.map(([data]) => JSON.parse(String(data)) as ZhihuiProject);
  }

  getProject(id: string): ZhihuiProject | undefined {
    const row = this.database.exec("SELECT data FROM projects WHERE id = $id", { $id: id })[0]?.values[0]?.[0];
    return typeof row === "string" ? (JSON.parse(row) as ZhihuiProject) : undefined;
  }

  getUserById(id: string): LocalUser | undefined {
    const row = this.database.exec("SELECT id, phone, nickname, created_at FROM users WHERE id = $id", { $id: id })[0]?.values[0];
    return row ? { id: String(row[0]), phone: String(row[1]), nickname: String(row[2]), createdAt: String(row[3]) } : undefined;
  }

  getUserAuthByAccount(account: string):
    | { id: string; phone: string; nickname: string; passwordHash: string; salt: string; createdAt: string }
    | undefined {
    const normalized = normalizeAccount(account);
    const rows = this.database.exec("SELECT id, phone, nickname, password_hash, salt, created_at FROM users")[0]?.values ?? [];
    const row = rows.find((item) => normalizeAccount(String(item[1])) === normalized || normalizeAccount(String(item[2])) === normalized);
    return row
      ? {
          id: String(row[0]),
          phone: String(row[1]),
          nickname: String(row[2]),
          passwordHash: String(row[3]),
          salt: String(row[4]),
          createdAt: String(row[5]),
        }
      : undefined;
  }

  async createUser(input: { nickname: string; phone: string; passwordHash: string; salt: string }): Promise<LocalUser> {
    const now = new Date().toISOString();
    const user: LocalUser = { id: nanoid(), nickname: input.nickname, phone: input.phone, createdAt: now };
    this.database.run(
      "INSERT INTO users (id, phone, nickname, password_hash, salt, created_at) VALUES ($id, $phone, $nickname, $passwordHash, $salt, $createdAt)",
      {
        $id: user.id,
        $phone: user.phone,
        $nickname: user.nickname,
        $passwordHash: input.passwordHash,
        $salt: input.salt,
        $createdAt: user.createdAt,
      },
    );
    await this.persist();
    return user;
  }

  async saveProject(project: ZhihuiProject) {
    this.database.run(
      "INSERT OR REPLACE INTO projects (id, title, data, updated_at) VALUES ($id, $title, $data, $updatedAt)",
      { $id: project.id, $title: project.title, $data: JSON.stringify(project), $updatedAt: project.updatedAt },
    );
    await this.persist();
  }

  async deleteProject(projectId: string) {
    const assets = this.listAssets(projectId);
    this.database.run("DELETE FROM projects WHERE id = $id", { $id: projectId });
    this.database.run("DELETE FROM assets WHERE project_id = $projectId", { $projectId: projectId });
    for (const asset of assets) {
      if (asset.path && fs.existsSync(asset.path)) await fsp.rm(asset.path, { force: true });
    }
    await this.persist();
  }

  listAssets(projectId?: string): AssetRecord[] {
    const query = projectId
      ? ["SELECT data FROM assets WHERE project_id = $projectId ORDER BY created_at DESC", { $projectId: projectId }]
      : ["SELECT data FROM assets ORDER BY created_at DESC", {}];
    const rows = this.database.exec(query[0] as string, query[1] as Record<string, unknown>)[0]?.values ?? [];
    return rows.map(([data]) => JSON.parse(String(data)) as AssetRecord);
  }

  async saveAsset(asset: AssetRecord) {
    this.database.run(
      "INSERT OR REPLACE INTO assets (id, project_id, data, created_at) VALUES ($id, $projectId, $data, $createdAt)",
      {
        $id: asset.id,
        $projectId: asset.projectId ?? null,
        $data: JSON.stringify(asset),
        $createdAt: asset.createdAt,
      },
    );
    await this.persist();
  }

  async deleteAsset(assetId: string) {
    const asset = this.listAssets().find((item) => item.id === assetId);
    this.database.run("DELETE FROM assets WHERE id = $id", { $id: assetId });
    if (asset?.path && fs.existsSync(asset.path)) await fsp.rm(asset.path, { force: true });
    await this.persist();
  }

  async saveTask(task: GenerateImageResult) {
    this.database.run("INSERT OR REPLACE INTO tasks (id, status, data, updated_at) VALUES ($id, $status, $data, $updatedAt)", {
      $id: task.taskId,
      $status: task.status,
      $data: JSON.stringify(task),
      $updatedAt: new Date().toISOString(),
    });
    await this.persist();
  }

  getTask(taskId: string): GenerateImageResult | undefined {
    const row = this.database.exec("SELECT data FROM tasks WHERE id = $id", { $id: taskId })[0]?.values[0]?.[0];
    return typeof row === "string" ? (JSON.parse(row) as GenerateImageResult) : undefined;
  }

  getWallet(userId: string): WalletState {
    const row = this.database.exec("SELECT user_id, balance, updated_at FROM wallets WHERE user_id = $userId", { $userId: userId })[0]?.values[0];
    if (row) return { userId: String(row[0]), balance: Number(row[1]), updatedAt: String(row[2]) };
    const now = new Date().toISOString();
    this.database.run("INSERT INTO wallets (user_id, balance, updated_at) VALUES ($userId, 0, $updatedAt)", {
      $userId: userId,
      $updatedAt: now,
    });
    return { userId, balance: 0, updatedAt: now };
  }

  private setWalletBalance(userId: string, balance: number) {
    const now = new Date().toISOString();
    this.database.run("INSERT OR REPLACE INTO wallets (user_id, balance, updated_at) VALUES ($userId, $balance, $updatedAt)", {
      $userId: userId,
      $balance: Math.max(0, Math.trunc(balance)),
      $updatedAt: now,
    });
    return { userId, balance: Math.max(0, Math.trunc(balance)), updatedAt: now };
  }

  private saveLedgerEntry(entry: BillingLedgerEntry) {
    this.database.run(
      "INSERT OR REPLACE INTO billing_ledger (id, user_id, type, status, points, amount_cny, task_id, reservation_id, nonce, note, created_at) VALUES ($id, $userId, $type, $status, $points, $amountCny, $taskId, $reservationId, $nonce, $note, $createdAt)",
      {
        $id: entry.id,
        $userId: entry.userId,
        $type: entry.type,
        $status: entry.status,
        $points: entry.points,
        $amountCny: entry.amountCny ?? null,
        $taskId: entry.taskId ?? null,
        $reservationId: entry.reservationId ?? null,
        $nonce: entry.nonce ?? null,
        $note: entry.note ?? null,
        $createdAt: entry.createdAt,
      },
    );
  }

  listLedger(userId: string): BillingLedgerEntry[] {
    const rows = this.database.exec("SELECT id, user_id, type, status, points, amount_cny, task_id, reservation_id, nonce, note, created_at FROM billing_ledger WHERE user_id = $userId ORDER BY created_at DESC LIMIT 120", { $userId: userId })[0]?.values ?? [];
    return rows.map((row) => ({
      id: String(row[0]),
      userId: String(row[1]),
      type: row[2] as BillingLedgerEntry["type"],
      status: row[3] as BillingLedgerEntry["status"],
      points: Number(row[4]),
      amountCny: row[5] == null ? undefined : Number(row[5]),
      taskId: row[6] == null ? undefined : String(row[6]),
      reservationId: row[7] == null ? undefined : String(row[7]),
      nonce: row[8] == null ? undefined : String(row[8]),
      note: row[9] == null ? undefined : String(row[9]),
      createdAt: String(row[10]),
    }));
  }

  hasRedeemedNonce(nonce: string) {
    return Boolean(this.database.exec("SELECT nonce FROM redeemed_recharge_codes WHERE nonce = $nonce", { $nonce: nonce })[0]?.values[0]);
  }

  async redeemRechargeCode(input: { userId: string; code: string; payload: RechargeCodePayload }): Promise<RechargeRedeemResult> {
    if (this.hasRedeemedNonce(input.payload.nonce)) throw new Error("该积分访问码已兑换，请不要重复使用。");
    const wallet = this.getWallet(input.userId);
    const now = new Date().toISOString();
    const nextWallet = this.setWalletBalance(input.userId, wallet.balance + input.payload.points);
    this.database.run("INSERT INTO redeemed_recharge_codes (nonce, user_id, points, amount_cny, redeemed_at) VALUES ($nonce, $userId, $points, $amountCny, $redeemedAt)", {
      $nonce: input.payload.nonce,
      $userId: input.userId,
      $points: input.payload.points,
      $amountCny: input.payload.amountCny,
      $redeemedAt: now,
    });
    const entry: BillingLedgerEntry = {
      id: nanoid(),
      userId: input.userId,
      type: "recharge",
      status: "completed",
      points: input.payload.points,
      amountCny: input.payload.amountCny,
      nonce: input.payload.nonce,
      note: "扫码充值兑换",
      createdAt: now,
    };
    this.saveLedgerEntry(entry);
    await this.persist();
    return { wallet: nextWallet, entry, points: input.payload.points, amountCny: input.payload.amountCny };
  }

  async reservePoints(input: { userId: string; taskId: string; points: number; note?: string }): Promise<BillingReservation> {
    const wallet = this.getWallet(input.userId);
    if (input.points <= 0) throw new Error("本次运行积分计算异常。");
    if (wallet.balance < input.points) throw new Error(`积分余额不足：本次需要 ${input.points} 积分，当前余额 ${wallet.balance} 积分。请先充值。`);
    const now = new Date().toISOString();
    const reservation: BillingReservation = {
      id: nanoid(),
      userId: input.userId,
      taskId: input.taskId,
      points: input.points,
      status: "reserved",
      createdAt: now,
      updatedAt: now,
    };
    this.setWalletBalance(input.userId, wallet.balance - input.points);
    this.database.run("INSERT INTO billing_reservations (id, user_id, task_id, points, status, created_at, updated_at) VALUES ($id, $userId, $taskId, $points, $status, $createdAt, $updatedAt)", {
      $id: reservation.id,
      $userId: reservation.userId,
      $taskId: reservation.taskId,
      $points: reservation.points,
      $status: reservation.status,
      $createdAt: reservation.createdAt,
      $updatedAt: reservation.updatedAt,
    });
    this.saveLedgerEntry({
      id: nanoid(),
      userId: input.userId,
      type: "reserve",
      status: "pending",
      points: -input.points,
      taskId: input.taskId,
      reservationId: reservation.id,
      note: input.note,
      createdAt: now,
    });
    await this.persist();
    return reservation;
  }

  private getReservation(id: string): BillingReservation | undefined {
    const row = this.database.exec("SELECT id, user_id, task_id, points, status, created_at, updated_at FROM billing_reservations WHERE id = $id", { $id: id })[0]?.values[0];
    return row
      ? {
          id: String(row[0]),
          userId: String(row[1]),
          taskId: String(row[2]),
          points: Number(row[3]),
          status: row[4] as BillingReservation["status"],
          createdAt: String(row[5]),
          updatedAt: String(row[6]),
        }
      : undefined;
  }

  async commitReservation(reservationId: string) {
    const reservation = this.getReservation(reservationId);
    if (!reservation || reservation.status !== "reserved") return;
    const now = new Date().toISOString();
    this.database.run("UPDATE billing_reservations SET status = 'committed', updated_at = $updatedAt WHERE id = $id", { $id: reservationId, $updatedAt: now });
    this.saveLedgerEntry({
      id: nanoid(),
      userId: reservation.userId,
      type: "commit",
      status: "completed",
      points: 0,
      taskId: reservation.taskId,
      reservationId,
      note: `运行完成，确认扣除 ${reservation.points} 积分`,
      createdAt: now,
    });
    await this.persist();
  }

  async renameAsset(assetId: string, name: string): Promise<AssetRecord> {
    const asset = this.listAssets().find((item) => item.id === assetId);
    const nextName = name.trim();
    if (!asset) throw new Error("素材不存在。");
    if (!nextName) throw new Error("素材名称不能为空。");
    const updated = { ...asset, name: nextName };
    this.database.run("UPDATE assets SET data = $data WHERE id = $id", {
      $id: assetId,
      $data: JSON.stringify(updated),
    });
    await this.persist();
    return updated;
  }

  async composeImageSheet(assetIds: string[], projectId?: string, sourceNodeId?: string): Promise<AssetRecord> {
    const sourceAssets = assetIds
      .map((assetId) => this.listAssets().find((asset) => asset.id === assetId))
      .filter((asset): asset is AssetRecord => Boolean(asset?.path && fs.existsSync(asset.path) && asset.type === "image"));
    if (!sourceAssets.length) throw new Error("没有可合成总览图的图片结果。");

    const cellWidth = 640;
    const cellHeight = 480;
    const padding = 24;
    const columns = Math.min(3, Math.max(1, sourceAssets.length));
    const rows = Math.ceil(sourceAssets.length / columns);
    const canvasWidth = padding + columns * (cellWidth + padding);
    const canvasHeight = padding + rows * (cellHeight + padding);
    const bitmap = Buffer.alloc(canvasWidth * canvasHeight * 4);
    // Neutral dark background in Electron's BGRA bitmap format.
    for (let offset = 0; offset < bitmap.length; offset += 4) {
      bitmap[offset] = 11;
      bitmap[offset + 1] = 15;
      bitmap[offset + 2] = 21;
      bitmap[offset + 3] = 255;
    }

    sourceAssets.forEach((asset, index) => {
      const image = nativeImage.createFromPath(asset.path);
      const size = image.getSize();
      const source = image.toBitmap();
      if (!size.width || !size.height) return;
      const scale = Math.min(cellWidth / size.width, cellHeight / size.height);
      const width = Math.max(1, Math.round(size.width * scale));
      const height = Math.max(1, Math.round(size.height * scale));
      const left = padding + (index % columns) * (cellWidth + padding) + Math.floor((cellWidth - width) / 2);
      const top = padding + Math.floor(index / columns) * (cellHeight + padding) + Math.floor((cellHeight - height) / 2);
      for (let y = 0; y < height; y += 1) {
        const sourceY = Math.min(size.height - 1, Math.floor((y / height) * size.height));
        for (let x = 0; x < width; x += 1) {
          const sourceX = Math.min(size.width - 1, Math.floor((x / width) * size.width));
          const sourceOffset = (sourceY * size.width + sourceX) * 4;
          const targetOffset = ((top + y) * canvasWidth + left + x) * 4;
          bitmap[targetOffset] = source[sourceOffset];
          bitmap[targetOffset + 1] = source[sourceOffset + 1];
          bitmap[targetOffset + 2] = source[sourceOffset + 2];
          bitmap[targetOffset + 3] = source[sourceOffset + 3];
        }
      }
    });

    const sheet = nativeImage.createFromBitmap(bitmap, { width: canvasWidth, height: canvasHeight, scaleFactor: 1 });
    const assetsDir = path.join(app.getPath("userData"), "assets");
    await fsp.mkdir(assetsDir, { recursive: true });
    const id = nanoid();
    const fileName = `zhihui-material-overview-${Date.now()}.png`;
    const filePath = path.join(assetsDir, `${id}-${fileName}`);
    await fsp.writeFile(filePath, sheet.toPNG());
    const asset: AssetRecord = {
      id,
      projectId,
      type: "image",
      name: fileName,
      path: filePath,
      tags: ["AI生成", "整套总览"],
      favorite: false,
      sourceNodeId,
      metadata: { width: canvasWidth, height: canvasHeight, role: "overview", sourceAssetIds: sourceAssets.map((item) => item.id) },
      createdAt: new Date().toISOString(),
    };
    await this.saveAsset(asset);
    return asset;
  }

  async refundReservation(reservationId: string, reason?: string) {
    const reservation = this.getReservation(reservationId);
    if (!reservation || reservation.status !== "reserved") return;
    const wallet = this.getWallet(reservation.userId);
    const now = new Date().toISOString();
    this.setWalletBalance(reservation.userId, wallet.balance + reservation.points);
    this.database.run("UPDATE billing_reservations SET status = 'refunded', updated_at = $updatedAt WHERE id = $id", { $id: reservationId, $updatedAt: now });
    this.saveLedgerEntry({
      id: nanoid(),
      userId: reservation.userId,
      type: "refund",
      status: "refunded",
      points: reservation.points,
      taskId: reservation.taskId,
      reservationId,
      note: reason || "运行失败，积分已退回",
      createdAt: now,
    });
    await this.persist();
  }
}

const store = new SqliteStore();

async function ensureStoreReady() {
  if (!storeReady) {
    storeReady = store.init().then(
      () => log("store:init:done"),
      (error) => {
        log("store:init:error", error instanceof Error ? error.message : String(error));
        throw error;
      },
    );
  }
  await storeReady;
}

function encrypt(value?: string) {
  if (!value) return undefined;
  if (!safeStorage.isEncryptionAvailable()) return value;
  return safeStorage.encryptString(value).toString("base64");
}

function decrypt(value?: string) {
  if (!value) return undefined;
  if (!safeStorage.isEncryptionAvailable()) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    return value;
  }
}

async function getSettings(): Promise<AppSettings> {
  await ensureStoreReady();
  const saved = store.getSetting<AppSettings>("settings") ?? defaultSettings;
  return {
    ...defaultSettings,
    ...saved,
    defaultModel: normalizeModelId(saved.defaultModel),
    tokenFluxBaseUrl: normalizeBaseUrl(saved.tokenFluxBaseUrl),
    tokenFluxApiKey: normalizeApiKey(decrypt(saved.tokenFluxApiKey)),
  };
}

async function saveSettings(settings: AppSettings) {
  await ensureStoreReady();
  const normalizedApiKey = normalizeApiKey(settings.tokenFluxApiKey);
  const toSave = {
    ...defaultSettings,
    ...settings,
    defaultModel: normalizeModelId(settings.defaultModel),
    tokenFluxBaseUrl: normalizeBaseUrl(settings.tokenFluxBaseUrl),
    tokenFluxApiKey: encrypt(normalizedApiKey),
  };
  await store.setSetting("settings", toSave);
  return { ...toSave, tokenFluxApiKey: normalizedApiKey };
}

function normalizeAccount(nickname?: string) {
  return String(nickname || "").trim().replace(/\s+/g, "").toLowerCase();
}

function hashPassword(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function publicUser(user: { id: string; phone: string; nickname: string; createdAt: string }): LocalUser {
  return { id: user.id, phone: user.phone, nickname: user.nickname, createdAt: user.createdAt };
}

type RechargeCodePayload = {
  v: 1;
  app: "zhihui-ai-canvas";
  user: string;
  amountCny: number;
  points: number;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
};

type RememberedCredentials = { nickname: string; password: string };

async function getRememberedCredentials(): Promise<RememberedCredentials | undefined> {
  await ensureStoreReady();
  const encrypted = store.getSetting<string>(REMEMBERED_CREDENTIALS_SETTING_KEY);
  const value = decrypt(encrypted);
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<RememberedCredentials> & { email?: string; phone?: string };
    const nickname = String(parsed.nickname || parsed.email || parsed.phone || "").trim();
    const password = String(parsed.password || "");
    return nickname && password ? { nickname, password } : undefined;
  } catch {
    return undefined;
  }
}

async function setRememberedCredentials(input?: RememberedCredentials) {
  if (!input?.nickname || !input.password) {
    await store.setSetting(REMEMBERED_CREDENTIALS_SETTING_KEY, "");
    return;
  }
  const value = JSON.stringify({ nickname: input.nickname.trim(), password: input.password });
  await store.setSetting(REMEMBERED_CREDENTIALS_SETTING_KEY, encrypt(value));
}

async function getCurrentUser() {
  await ensureStoreReady();
  const userId = store.getSetting<string>(SESSION_SETTING_KEY);
  const currentUser = userId ? store.getUserById(userId) : undefined;
  if (currentUser) return currentUser;

  const remembered = await getRememberedCredentials();
  if (!remembered) return undefined;
  try {
    return await loginLocalUser(remembered);
  } catch {
    await setCurrentUser(undefined);
    await setRememberedCredentials(undefined);
    return undefined;
  }
}

async function setCurrentUser(userId?: string) {
  await store.setSetting(SESSION_SETTING_KEY, userId ?? "");
}

async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("请先登录后再使用积分功能。");
  return user;
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function verifyRechargeCode(code: string, user: LocalUser): RechargeCodePayload {
  const normalizedCode = code.trim();
  const parts = normalizedCode.split(".");
  if (parts.length !== 3 || parts[0] !== RECHARGE_CODE_PREFIX) throw new Error("积分访问码格式不正确。");
  const payloadBuffer = decodeBase64Url(parts[1]);
  const signature = decodeBase64Url(parts[2]);
  const verified = crypto.verify(null, payloadBuffer, RECHARGE_PUBLIC_KEY, signature);
  if (!verified) throw new Error("积分访问码签名无效，请确认复制完整。");
  let payload: RechargeCodePayload;
  try {
    payload = JSON.parse(payloadBuffer.toString("utf8")) as RechargeCodePayload;
  } catch {
    throw new Error("积分访问码内容无法解析。");
  }
  const allowedAmounts = new Set<number>(rechargeAmounts as readonly number[]);
  const userKey = normalizeAccount(user.nickname);
  const payloadUser = normalizeAccount(payload.user);
  if (payload.v !== 1 || payload.app !== "zhihui-ai-canvas") throw new Error("积分访问码版本不匹配。");
  if (!payload.nonce || payload.nonce.length < 8) throw new Error("积分访问码缺少唯一编号。");
  if (!allowedAmounts.has(payload.amountCny)) throw new Error("积分访问码金额不在允许的充值档位内。");
  if (payload.points !== pointsForAmount(payload.amountCny)) throw new Error("积分访问码积分数量不正确。");
  if (payloadUser !== "*" && payloadUser !== userKey && payloadUser !== normalizeAccount(user.id)) {
    throw new Error(`该积分访问码属于 ${payload.user}，不能兑换到当前账号 ${user.nickname}。`);
  }
  if (Number.isNaN(Date.parse(payload.expiresAt)) || new Date(payload.expiresAt).getTime() < Date.now()) {
    throw new Error("积分访问码已过期，请联系管理员重新发放。");
  }
  return payload;
}

async function registerLocalUser(input: { nickname?: string; password?: string }) {
  await ensureStoreReady();
  const nickname = String(input.nickname || "").trim();
  const account = normalizeAccount(nickname);
  const password = String(input.password || "");
  if (nickname.length < 2) throw new Error("昵称至少需要 2 个字符。");
  if (account.length < 2) throw new Error("昵称至少需要 2 个字符。");
  if (password.length < 6) throw new Error("密码至少需要 6 位。");
  if (store.getUserAuthByAccount(account)) throw new Error("该昵称已注册，请直接登录。");
  const salt = crypto.randomBytes(16).toString("hex");
  const user = await store.createUser({ nickname, phone: account, salt, passwordHash: hashPassword(password, salt) });
  await setCurrentUser(user.id);
  await setRememberedCredentials({ nickname, password });
  return user;
}

async function loginLocalUser(input: { nickname?: string; phone?: string; password?: string }) {
  await ensureStoreReady();
  const nickname = String(input.nickname || input.phone || "").trim();
  const password = String(input.password || "");
  const user = store.getUserAuthByAccount(nickname);
  if (!user || hashPassword(password, user.salt) !== user.passwordHash) throw new Error("昵称或密码不正确。");
  await setCurrentUser(user.id);
  await setRememberedCredentials({ nickname: user.nickname, password });
  return publicUser(user);
}

function contentTypeToExtension(contentType?: string | null) {
  if (contentType?.includes("jpeg")) return "jpg";
  if (contentType?.includes("webp")) return "webp";
  return "png";
}

function extensionToContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

async function assetToDataUri(assetId: string) {
  const asset = store.listAssets().find((item) => item.id === assetId);
  if (!asset?.path || !fs.existsSync(asset.path)) return undefined;
  const buffer = await fsp.readFile(asset.path);
  return `data:${extensionToContentType(asset.path)};base64,${buffer.toString("base64")}`;
}

async function assetToEditFile(assetId: string) {
  const asset = store.listAssets().find((item) => item.id === assetId);
  if (!asset?.path || !fs.existsSync(asset.path)) return undefined;
  const buffer = await fsp.readFile(asset.path);
  const contentType = extensionToContentType(asset.path);
  return {
    buffer,
    contentType,
    name: asset.name || path.basename(asset.path),
    dataUri: `data:${contentType};base64,${buffer.toString("base64")}`,
  };
}

function sizeToRatio(size?: string) {
  const match = size?.match(/^(\d+)x(\d+)$/);
  if (!match) return "1:1";
  const width = Number(match[1]);
  const height = Number(match[2]);
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.02) return "16:9";
  if (Math.abs(ratio - 9 / 16) < 0.02) return "9:16";
  if (Math.abs(ratio - 4 / 5) < 0.02) return "4:5";
  if (Math.abs(ratio - 3 / 4) < 0.02) return "3:4";
  if (Math.abs(ratio - 2 / 3) < 0.02) return "2:3";
  if (Math.abs(ratio - 3 / 2) < 0.02) return "3:2";
  if (Math.abs(ratio - 4 / 3) < 0.02) return "4:3";
  return "1:1";
}

function parseImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  return match ? { contentType: match[1], b64: match[2] } : undefined;
}

function parsePixelSize(size?: unknown) {
  const match = String(size || "").match(/^(\d+)x(\d+)$/);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function targetSizeFromMetadata(metadata: Record<string, unknown>) {
  const direct = parsePixelSize(metadata.size);
  if (direct) return direct;
  const input = metadata.input;
  if (input && typeof input === "object") return parsePixelSize((input as Record<string, unknown>).size);
  return undefined;
}

function prepareGeneratedBuffer(buffer: Buffer, metadata: Record<string, unknown>) {
  const image = nativeImage.createFromBuffer(buffer);
  const originalSize = image.getSize();
  const target = targetSizeFromMetadata(metadata);
  if (target && originalSize.width > 0 && originalSize.height > 0 && (originalSize.width < target.width || originalSize.height < target.height)) {
    // Never force both dimensions independently. That stretches people,
    // products, and typography when the provider returns another aspect ratio.
    const scale = Math.max(target.width / originalSize.width, target.height / originalSize.height);
    const resizedWidth = Math.max(originalSize.width, Math.round(originalSize.width * scale));
    const resizedHeight = Math.max(originalSize.height, Math.round(originalSize.height * scale));
    const resized = image.resize({ width: resizedWidth, height: resizedHeight, quality: "best" });
    return {
      buffer: resized.toPNG(),
      contentType: "image/png",
      width: resizedWidth,
      height: resizedHeight,
      originalWidth: originalSize.width,
      originalHeight: originalSize.height,
      upscaledLocally: true,
    };
  }
  return {
    buffer,
    contentType: undefined,
    width: originalSize.width || target?.width,
    height: originalSize.height || target?.height,
    originalWidth: originalSize.width || undefined,
    originalHeight: originalSize.height || undefined,
    upscaledLocally: false,
  };
}

async function saveGeneratedImage(input: { projectId?: string; sourceNodeId?: string; buffer: Buffer; name: string; metadata: Record<string, unknown> }) {
  const assetsDir = path.join(app.getPath("userData"), "assets");
  await fsp.mkdir(assetsDir, { recursive: true });
  const id = nanoid();
  const prepared = prepareGeneratedBuffer(input.buffer, input.metadata);
  const parsedName = path.parse(input.name);
  const fileName = prepared.contentType === "image/png" ? `${parsedName.name}.png` : input.name;
  const filePath = path.join(assetsDir, `${id}-${fileName}`);
  await fsp.writeFile(filePath, prepared.buffer);
  const asset: AssetRecord = {
    id,
    projectId: input.projectId,
    type: "image",
    name: fileName,
    path: filePath,
    tags: ["AI生成"],
    favorite: false,
    sourceNodeId: input.sourceNodeId,
    metadata: {
      ...input.metadata,
      width: prepared.width,
      height: prepared.height,
      originalWidth: prepared.originalWidth,
      originalHeight: prepared.originalHeight,
      upscaledLocally: prepared.upscaledLocally,
    },
    createdAt: new Date().toISOString(),
  };
  await store.saveAsset(asset);
  return asset;
}

async function fetchTokenFluxModels(): Promise<TokenFluxModel[]> {
  const settings = await getSettings();
  const baseUrl = normalizeBaseUrl(settings.tokenFluxBaseUrl);
  const key = settings.tokenFluxApiKey;
  const errors: string[] = [];
  for (const endpoint of ["/models", "/images/models"]) {
    const res = await fetch(apiUrl(baseUrl, endpoint), { headers: authHeaders(key) });
    const json = await readTokenFluxResponse(res);
    if (!res.ok) {
      errors.push(`${endpoint}: ${tokenFluxError(json, `HTTP ${res.status}`)}`);
      continue;
    }
    const data = Array.isArray(json.data) ? json.data : [];
    return data.map((item) => {
      const model = item as TokenFluxModel;
      return {
        id: model.id,
        name: model.name ?? model.id,
        tags: model.tags?.length ? model.tags : ["text-to-image", "image-editing"],
        input_schema: model.input_schema,
        pricing: model.pricing,
      };
    });
  }
  throw new Error(`模型列表读取失败：${errors.join("；")}`);
}

function collectImageOutputs(value: unknown, found: Array<{ b64?: string; url?: string; dataUrl?: string }> = []) {
  if (!value) return found;
  if (typeof value === "string") {
    if (value.startsWith("data:image")) found.push({ dataUrl: value });
    if (/^https?:\/\//.test(value)) found.push({ url: value });
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageOutputs(item, found);
    return found;
  }
  if (typeof value !== "object") return found;
  const record = value as Record<string, unknown>;
  const b64 = typeof record.b64_json === "string" ? record.b64_json : undefined;
  const url =
    typeof record.url === "string"
      ? record.url
      : typeof record.image_url === "string"
        ? record.image_url
        : undefined;
  if (b64 || url) found.push({ b64, url });
  for (const key of ["data", "output", "outputs", "images", "result", "results"]) {
    collectImageOutputs(record[key], found);
  }
  return found;
}

async function readTokenFluxResponse(res: Response) {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return { raw: text };
  }
}

async function enhancePromptWithReasoning(input: { prompt: string; apiKey: string; baseUrl: string; model?: string }) {
  if (!input.prompt.trim()) return input.prompt;
  for (const model of reasoningModelCandidates(input.model)) {
    try {
      const res = await fetch(apiUrl(input.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(input.apiKey),
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "你是顶级商业广告视觉提示词导演。把用户中文需求改写为高标准、高质量、可执行的图像生成提示词，突出主体、材质、光线、构图、广告电商质感。只输出提示词，不要解释。",
            },
            { role: "user", content: input.prompt },
          ],
          temperature: 0.6,
        }),
      });
      const json = await readTokenFluxResponse(res);
      if (!res.ok) {
        log("tokenflux:reasoning:skip", { status: res.status, error: tokenFluxError(json, `HTTP ${res.status}`), model });
        continue;
      }
      const choices = Array.isArray(json.choices) ? json.choices : [];
      const message = choices[0] as { message?: { content?: unknown }; text?: unknown } | undefined;
      const content = typeof message?.message?.content === "string" ? message.message.content : typeof message?.text === "string" ? message.text : "";
      if (content.trim()) return content.trim();
    } catch (error) {
      log("tokenflux:reasoning:error", { model, error: error instanceof Error ? error.message : String(error) });
    }
  }
  log("tokenflux:reasoning:fallback", "all reasoning models failed, using original prompt");
  return input.prompt;
}

async function processTextWithTokenFlux(input: ProcessTextParams): Promise<{ text: string }> {
  const settings = await getSettings();
  const apiKey = settings.tokenFluxApiKey?.trim();
  const baseUrl = normalizeBaseUrl(settings.tokenFluxBaseUrl);
  if (!apiKey) throw new Error("请先在设置中填写 TokenFlux API Key。");
  const prompt = input.prompt.trim();
  if (!prompt && input.tool !== "reverse-prompt") throw new Error("请先输入需要处理的文本。");
  const referenceUris = (
    await Promise.all((input.referenceAssetIds ?? []).map((assetId) => assetToDataUri(assetId)))
  ).filter((value): value is string => Boolean(value));
  const systemPrompt = input.tool === "chat"
    ? "你是郅绘ai画布里的智能对话助手。理解用户的广告、电商、视觉设计需求，给出清晰、可执行、适合继续生图的中文结果。只输出结果，不解释接口。"
    : input.tool === "polish-prompt"
      ? "你是顶级商业广告视觉提示词导演。把用户输入改写成高标准、高质量、可执行的中文图像生成提示词，补全主体、材质、光线、构图、镜头和排版要求。只输出提示词，不解释。"
      : "你是专业视觉分析师。结合用户要求和参考图片，反推出准确的中文图像编辑提示词，重点保留主体身份、构图、材质和画面关系。只输出提示词，不解释。";
  const textContent: unknown = referenceUris.length
    ? [{ type: "text", text: prompt || "请分析这张参考图并反推出可执行的图像提示词。" }, ...referenceUris.map((url) => ({ type: "image_url", image_url: { url } }))]
    : prompt;
  for (const model of reasoningModelCandidates("GPT-5.5")) {
    try {
      const res = await fetch(apiUrl(baseUrl, "/chat/completions"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: textContent }],
          temperature: input.tool === "chat" ? 0.7 : 0.45,
        }),
      });
      const json = await readTokenFluxResponse(res);
      if (!res.ok) {
        log("tokenflux:text:skip", { status: res.status, model, error: tokenFluxError(json, `HTTP ${res.status}`) });
        continue;
      }
      const choices = Array.isArray(json.choices) ? json.choices : [];
      const message = choices[0] as { message?: { content?: unknown }; text?: unknown } | undefined;
      const content = typeof message?.message?.content === "string"
        ? message.message.content
        : typeof message?.text === "string"
          ? message.text
          : "";
      if (content.trim()) return { text: content.trim() };
    } catch (error) {
      log("tokenflux:text:error", { model, error: error instanceof Error ? error.message : String(error) });
    }
  }
  throw new Error("文本处理失败：当前中转站没有可用的推理模型或该模型不支持文本处理。");
}

function tokenFluxError(json: Record<string, unknown>, fallback: string) {
  const error = json.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  if (typeof json.message === "string") return json.message;
  if (typeof json.detail === "string") return json.detail;
  if (typeof json.raw === "string" && json.raw.trim()) return `${fallback}：${json.raw.slice(0, 300)}`;
  return fallback;
}

function humanizeApiError(input: { status: number; endpoint?: string; model?: string; json: Record<string, unknown>; baseUrl: string }) {
  const raw = tokenFluxError(input.json, `HTTP ${input.status}`);
  const modelHint = input.model ? `模型：${input.model}。` : "";
  const endpointHint = input.endpoint ? `接口：${input.endpoint}。` : "";
  if (/Codex auth candidates|auto-banned|CPA candidate|429\/401\/402\/403/i.test(raw)) {
    return `${modelHint}中转站已收到请求，但该模型的上游绘图通道当前不可用、被限流或被自动禁用。请在中转站后台为 ${input.model ?? "当前模型"} 更换可用通道，确认余额、模型权限和通道状态后重试。原始错误：${raw.slice(0, 260)}`;
  }
  if (/No available channel|无可用通道|没有可用通道/i.test(raw)) {
    return `${modelHint}${endpointHint}当前 API Key 所在分组不能调用该模型，请换绘图模型分组 Key，或在中转站后台放开模型限制/配置通道。原始错误：${raw}`;
  }
  if (/has not been priced|未配置价格|尚未.*价格/i.test(raw)) {
    return `${modelHint}该推理模型未配置价格，软件会跳过推理增强继续生图；如需推理增强，请在中转站后台配置价格。原始错误：${raw}`;
  }
  if (/model.*not.*found|模型.*不存在|not found/i.test(raw)) {
    return `${modelHint}当前中转站没有开放该模型 ID，请检查后台模型限制。原始错误：${raw}`;
  }
  if (input.status === 401 || input.status === 403) {
    return `${modelHint}${endpointHint}Key 无效、模型权限不足或分组限制。当前中转地址：${input.baseUrl}。原始错误：${raw}`;
  }
  return `${modelHint}${raw}`;
}

async function pollTokenFluxTask(taskId: string, apiKey: string, baseUrl: string) {
  const endpoints = [
    apiUrl(baseUrl, `/images/generations/${taskId}`),
    apiUrl(baseUrl, `/images/tasks/${taskId}`),
    apiUrl(baseUrl, `/tasks/${taskId}`),
  ];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    for (const endpoint of endpoints) {
      const res = await fetch(endpoint, {
        headers: authHeaders(apiKey),
      }).catch(() => undefined);
      if (!res || res.status === 404) continue;
      const json = await readTokenFluxResponse(res);
      if (!res.ok) throw new Error(tokenFluxError(json, `任务查询失败 ${res.status}`));
      const status = String(json.status ?? "");
      const outputs = collectImageOutputs(json);
      if (outputs.length) return json;
      if (["failed", "canceled", "cancelled", "error"].includes(status.toLowerCase())) {
        throw new Error(tokenFluxError(json, "TokenFlux 任务失败"));
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("TokenFlux 任务超时，未返回可保存的图片结果。");
}

type TokenFluxAttempt = {
  name: string;
  endpoint: string;
  body: Record<string, unknown> | FormData;
  bodyForMetadata?: Record<string, unknown>;
};

async function buildTokenFluxAttempts(params: GenerateImageParams, apiKey: string, baseUrl: string) {
  const model = normalizeModelId(params.model || IMAGE_MODEL_ID);
  const models = await fetchTokenFluxModels().catch(() => []);
  const selectedModel = models.find((item) => item.id === model);
  const properties = selectedModel?.input_schema?.properties ?? {};
  const hasSchema = Object.keys(properties).length > 0;
  const hasProp = (key: string) => !hasSchema || Object.prototype.hasOwnProperty.call(properties, key);
  const ratio = String(params.extra?.ratio ?? sizeToRatio(params.size));
  const quality = String(params.extra?.quality ?? "high");
  const referenceFiles = (
    await Promise.all((params.referenceAssetIds ?? []).map((assetId) => assetToEditFile(assetId)))
  ).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const referenceImages = referenceFiles.map((item) => item.dataUri);
  const enhancedPrompt = referenceImages.length
    ? params.prompt
    : await enhancePromptWithReasoning({
        prompt: params.prompt,
        apiKey,
        baseUrl,
        model: typeof params.extra?.inferenceModel === "string" ? params.extra.inferenceModel : "GPT-5.5",
      });

  const nativeInput: Record<string, unknown> = { prompt: enhancedPrompt };
  if (hasProp("aspect_ratio")) nativeInput.aspect_ratio = ratio;
  if (hasProp("size") && params.size) nativeInput.size = params.size;
  if (hasProp("quality")) nativeInput.quality = quality;
  if (hasProp("output_quality")) nativeInput.output_quality = quality === "ultra" ? 100 : quality === "high" ? 90 : 75;
  if (hasProp("num_outputs")) nativeInput.num_outputs = params.n ?? 1;
  if (hasProp("number_of_images")) nativeInput.number_of_images = params.n ?? 1;
  if (hasProp("n")) nativeInput.n = params.n ?? 1;
  if (hasProp("output_format")) nativeInput.output_format = "png";
  if (hasProp("width") && typeof params.extra?.width === "number") nativeInput.width = params.extra.width;
  if (hasProp("height") && typeof params.extra?.height === "number") nativeInput.height = params.extra.height;
  if (hasProp("scale") && typeof params.extra?.factor === "number") nativeInput.scale = params.extra.factor;
  if (hasProp("factor") && typeof params.extra?.factor === "number") nativeInput.factor = params.extra.factor;
  if (referenceImages.length) {
    if (hasProp("image")) nativeInput.image = referenceImages[0];
    if (hasProp("input_image")) nativeInput.input_image = referenceImages[0];
    if (hasProp("image_url")) nativeInput.image_url = referenceImages[0];
    if (hasProp("image_prompt")) nativeInput.image_prompt = referenceImages[0];
    if (hasProp("images")) nativeInput.images = referenceImages;
    if (hasProp("input_images")) nativeInput.input_images = referenceImages;
  }

  const openAiBody: Record<string, unknown> = {
    model,
    prompt: enhancedPrompt,
    size: params.size ?? "1024x1024",
    n: params.n ?? 1,
    quality,
  };
  const openAiB64Body: Record<string, unknown> = { ...openAiBody, response_format: "b64_json" };
  if (referenceImages.length) {
    const imageObjects = referenceImages.map((url) => ({ url }));
    openAiBody.image = imageObjects[0];
    openAiBody.images = imageObjects;
    openAiB64Body.image = imageObjects[0];
    openAiB64Body.images = imageObjects;
  }

  const buildEditForm = (responseFormat?: string) => {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", "");
    form.append("size", params.size ?? "1024x1024");
    form.append("n", String(params.n ?? 1));
    form.append("quality", quality);
    if (responseFormat) form.append("response_format", responseFormat);
    for (const [index, file] of referenceFiles.entries()) {
      const blob = new Blob([file.buffer], { type: file.contentType });
      form.append(index === 0 ? "image" : "images", blob, file.name);
    }
    return form;
  };

  const attempts: TokenFluxAttempt[] = [];
  const shouldEditImage = params.mode === "edit" || params.mode === "upscale" || referenceImages.length > 0;
  const requiresReferenceEdit = referenceImages.length > 0;
  const editPrompt = referenceImages.length
    ? [
        "严格基于用户上传的参考图进行图片编辑，不要重新生成一张无关图片。",
        "必须保留原图主体、构图、主要物体、人物/产品身份、空间关系和画面风格，只按照用户要求做必要修改。",
        "如果用户要求添加文字、调整背景、优化清晰度、替换局部内容，也必须以原图为基础完成。",
        enhancedPrompt,
      ].join("\n")
    : enhancedPrompt;
  openAiBody.prompt = editPrompt;
  openAiB64Body.prompt = editPrompt;
  nativeInput.prompt = editPrompt;
  if (shouldEditImage) {
    if (referenceFiles.length) {
      const formBody = buildEditForm();
      formBody.set("prompt", editPrompt);
      attempts.push({ name: "openai-edit-form", endpoint: apiUrl(baseUrl, "/images/edits"), body: formBody, bodyForMetadata: openAiBody });
      const formB64Body = buildEditForm("b64_json");
      formB64Body.set("prompt", editPrompt);
      attempts.push({ name: "openai-edit-form-b64", endpoint: apiUrl(baseUrl, "/images/edits"), body: formB64Body, bodyForMetadata: openAiB64Body });
    }
    attempts.push({ name: "openai-edit", endpoint: apiUrl(baseUrl, "/images/edits"), body: openAiBody });
    attempts.push({ name: "openai-edit-b64", endpoint: apiUrl(baseUrl, "/images/edits"), body: openAiB64Body });
    if (baseUrl.includes("tokenflux.ai") && hasSchema) {
      attempts.push({ name: "tokenflux-native-edit", endpoint: apiUrl(baseUrl, "/images/generations"), body: { model, input: nativeInput } });
    }
    if (requiresReferenceEdit) {
      log("tokenflux:attempts:built", { model, attemptCount: attempts.length, hasSchema, imageInputs: referenceImages.length, apiKeyPresent: Boolean(apiKey), editOnly: true });
      return attempts;
    }
  }
  attempts.push({ name: "openai-compatible", endpoint: apiUrl(baseUrl, "/images/generations"), body: openAiBody });
  attempts.push({ name: "openai-compatible-b64", endpoint: apiUrl(baseUrl, "/images/generations"), body: openAiB64Body });
  if (baseUrl.includes("tokenflux.ai") && hasSchema) {
    attempts.push({ name: "tokenflux-native", endpoint: apiUrl(baseUrl, "/images/generations"), body: { model, input: nativeInput } });
  }

  log("tokenflux:attempts:built", { model, attemptCount: attempts.length, hasSchema, imageInputs: referenceImages.length, apiKeyPresent: Boolean(apiKey) });
  return attempts;
}

async function generateWithTokenFlux(
  params: GenerateImageParams & { projectId?: string; sourceNodeId?: string },
): Promise<GenerateImageResult> {
  const taskId = nanoid();
  const settings = await getSettings();
  const cost = generationCost({ resolution: params.extra?.resolution, n: params.n });
  let reservation: BillingReservation | undefined;
  if (BILLING_ENABLED) try {
    const user = await requireCurrentUser();
    reservation = await store.reservePoints({
      userId: user.id,
      taskId,
      points: cost,
      note: `${params.mode === "edit" ? "图像编辑" : params.mode === "upscale" ? "高清放大" : "图像生成"} ${String(params.extra?.resolution || "1K")}`,
    });
  } catch (error) {
    const failed = {
      taskId,
      status: "failed" as TaskStatus,
      assetIds: [],
      error: error instanceof Error ? error.message : String(error),
      billing: { cost },
    };
    await store.saveTask(failed);
    return failed;
  }
  const apiKey = settings.tokenFluxApiKey?.trim();
  const baseUrl = normalizeBaseUrl(settings.tokenFluxBaseUrl);
  if (!apiKey) {
    if (reservation) await store.refundReservation(reservation.id, "未配置 TokenFlux API Key，积分已退回");
    const failed = {
      taskId,
      status: "failed" as TaskStatus,
      assetIds: [],
      error: "请先在设置中填写 TokenFlux API Key。",
      billing: BILLING_ENABLED ? { reservationId: reservation?.id, cost, refunded: true } : undefined,
    };
    await store.saveTask(failed);
    return failed;
  }

  const queued: GenerateImageResult = { taskId, status: "running", assetIds: [], billing: BILLING_ENABLED ? { reservationId: reservation?.id, cost } : undefined };
  await store.saveTask(queued);

  try {
    const model = normalizeModelId(params.model || settings.defaultModel || IMAGE_MODEL_ID);
    const attempts = await buildTokenFluxAttempts({ ...params, model }, apiKey, baseUrl);
    log("tokenflux:generate:start", {
      taskId,
      model,
      size: params.size,
      n: params.n,
      mode: params.mode,
      referenceAssetIds: params.referenceAssetIds?.length ?? 0,
    });

    let json: Record<string, unknown> | undefined;
    let bodyForMetadata: Record<string, unknown> = {};
    const errors: string[] = [];
    const errorSet = new Set<string>();
    for (const attempt of attempts) {
      const isFormData = attempt.body instanceof FormData;
      let jsonBody: Record<string, unknown> | undefined;
      let requestBody: BodyInit;
      if (isFormData) {
        requestBody = attempt.body as FormData;
      } else {
        jsonBody = attempt.body as Record<string, unknown>;
        requestBody = JSON.stringify(jsonBody);
      }
      const res = await fetch(attempt.endpoint, {
        method: "POST",
        headers: isFormData
          ? authHeaders(apiKey)
          : {
              "Content-Type": "application/json",
              ...authHeaders(apiKey),
            },
        body: requestBody,
      });
      const nextJson = await readTokenFluxResponse(res);
      log("tokenflux:generate:response", { taskId, attempt: attempt.name, status: res.status, endpoint: attempt.endpoint });
      if (res.ok && nextJson.success !== false) {
        json = nextJson;
        bodyForMetadata = attempt.bodyForMetadata ?? jsonBody ?? { model, prompt: params.prompt, mode: params.mode, multipart: true };
        break;
      }
      const attemptModel = jsonBody ? String(jsonBody.model || model) : model;
      let readableError: string;
      if (res.status === 401 || res.status === 403) {
        const baseHint = baseUrl.includes("tokenflux.ai")
          ? "当前 API 中转地址仍是默认 TokenFlux 官方地址，请在设置里填入你的中转站 /v1 地址后再保存测试。"
          : `当前中转地址：${baseUrl}`;
        readableError = `${humanizeApiError({ status: res.status, endpoint: attempt.endpoint, model: attemptModel, json: nextJson, baseUrl })} ${baseHint}`;
      } else {
        readableError = humanizeApiError({ status: res.status, endpoint: attempt.endpoint, model: attemptModel, json: nextJson, baseUrl });
      }
      if (!errorSet.has(readableError)) {
        errorSet.add(readableError);
        errors.push(readableError);
      }
    }

    if (!json) throw new Error(`生成失败：${errors.join("；")}`);

    const remoteTaskId = typeof json.id === "string" ? json.id : typeof json.task_id === "string" ? json.task_id : undefined;
    if (remoteTaskId && !collectImageOutputs(json).length) {
      json = await pollTokenFluxTask(remoteTaskId, apiKey, baseUrl);
    }

    const assets: AssetRecord[] = [];
    const imageItems = collectImageOutputs(json);
    for (const [index, item] of imageItems.entries()) {
      const data = item.dataUrl ? parseImageDataUrl(item.dataUrl) : undefined;
      const b64 = item.b64 ?? data?.b64;
      if (b64) {
        assets.push(
          await saveGeneratedImage({
            projectId: params.projectId,
            sourceNodeId: params.sourceNodeId,
            buffer: Buffer.from(b64, "base64"),
            name: `zhihui-${Date.now()}-${index + 1}.${contentTypeToExtension(data?.contentType)}`,
            metadata: { provider: "tokenflux", responseTaskId: remoteTaskId, ...bodyForMetadata },
          }),
        );
      } else if (item.url) {
        const imageRes = await fetch(item.url);
        if (!imageRes.ok) continue;
        const ext = contentTypeToExtension(imageRes.headers.get("content-type"));
        assets.push(
          await saveGeneratedImage({
            projectId: params.projectId,
            sourceNodeId: params.sourceNodeId,
            buffer: Buffer.from(await imageRes.arrayBuffer()),
            name: `zhihui-${Date.now()}-${index + 1}.${ext}`,
            metadata: { provider: "tokenflux", responseTaskId: remoteTaskId, remoteUrl: item.url, ...bodyForMetadata },
          }),
        );
      }
    }
    if (!assets.length) {
      log("tokenflux:generate:no-assets", json);
      throw new Error("TokenFlux 已返回结果，但没有可保存的图片数据。请换用 text-to-image 模型或降低参数后重试。");
    }
    if (reservation) await store.commitReservation(reservation.id);
    const completed = {
      taskId,
      status: "completed" as TaskStatus,
      assetIds: assets.map((asset) => asset.id),
      billing: BILLING_ENABLED ? { reservationId: reservation?.id, cost } : undefined,
    };
    await store.saveTask(completed);
    log("tokenflux:generate:done", { taskId, assetCount: assets.length });
    return completed;
  } catch (error) {
    if (reservation) await store.refundReservation(reservation.id, error instanceof Error ? error.message : String(error));
    const failed = {
      taskId,
      status: "failed" as TaskStatus,
      assetIds: [],
      error: error instanceof Error ? error.message : String(error),
      billing: BILLING_ENABLED ? { reservationId: reservation?.id, cost, refunded: true } : undefined,
    };
    await store.saveTask(failed);
    log("tokenflux:generate:error", { taskId, error: failed.error });
    return failed;
  }
}

async function createProject(title = "未命名项目") {
  await ensureStoreReady();
  const now = new Date().toISOString();
  const project: ZhihuiProject = {
    version: 1,
    id: nanoid(),
    title,
    createdAt: now,
    updatedAt: now,
    graph: emptyGraph(),
    assetIds: [],
    exportSettings: { format: "png", width: 1920, height: 1080, scale: 1, transparent: false },
  };
  await store.saveProject(project);
  return project;
}

async function createWindow() {
  const appIcon = app.isPackaged ? path.join(process.resourcesPath, "icon.ico") : path.join(process.cwd(), "build", "icon.ico");
  log("window:create:start", { isPackaged: app.isPackaged, appIcon });
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 760,
    title: "郅绘ai画布",
    icon: appIcon,
    show: false,
    center: true,
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    log("window:ready-to-show");
    mainWindow?.show();
    mainWindow?.focus();
    mainWindow?.moveTop();
  });
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      log("window:force-show");
      mainWindow.show();
      mainWindow.focus();
      mainWindow.moveTop();
    }
  }, 2500);
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    log("window:did-fail-load", { errorCode, errorDescription, validatedURL });
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    log("renderer:console", { level, message, line, sourceId });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log("window:render-process-gone", details);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    log("window:load-url", process.env.VITE_DEV_SERVER_URL);
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const target = path.join(__dirname, "../dist/index.html");
    log("window:load-file", target);
    await mainWindow.loadFile(target);
  }
}

function registerIpc() {
  ipcMain.handle("auth.current", () => getCurrentUser());
  ipcMain.handle("auth.remembered", () => getRememberedCredentials());
  ipcMain.handle("auth.register", async (_event, input: { nickname?: string; password?: string }) => registerLocalUser(input));
  ipcMain.handle("auth.login", async (_event, input: { nickname?: string; phone?: string; password?: string }) => loginLocalUser(input));
  ipcMain.handle("auth.logout", async () => {
    await ensureStoreReady();
    await setCurrentUser(undefined);
    await setRememberedCredentials(undefined);
  });

  ipcMain.handle("projects.create", (_event, title?: string) => createProject(title));
  ipcMain.handle("projects.list", async () => {
    await ensureStoreReady();
    return store.listProjects();
  });
  ipcMain.handle("projects.open", async (_event, projectId: string) => {
    await ensureStoreReady();
    return store.getProject(projectId);
  });
  ipcMain.handle("projects.save", async (_event, project: ZhihuiProject) => {
    await ensureStoreReady();
    const updated = { ...project, updatedAt: new Date().toISOString() };
    await store.saveProject(updated);
    return updated;
  });
  ipcMain.handle("projects.delete", async (_event, projectId: string) => {
    await ensureStoreReady();
    return store.deleteProject(projectId);
  });
  ipcMain.handle("projects.export", async (event, project: ZhihuiProject, format: "png" | "jpeg" | "pdf") => {
    await ensureStoreReady();
    await store.saveProject({ ...project, updatedAt: new Date().toISOString() });
    const defaultPath = path.join(app.getPath("pictures"), `${project.title || "zhihui-export"}.${format}`);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: SaveDialogOptions = {
      title: "导出画布",
      defaultPath,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    };
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { path: "" };
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("找不到当前窗口。");
    if (format === "pdf") {
      const pdf = await window.webContents.printToPDF({ printBackground: true, landscape: true });
      await fsp.writeFile(result.filePath, pdf);
    } else {
      const image = await window.webContents.capturePage();
      await fsp.writeFile(result.filePath, image.toPNG());
    }
    return { path: result.filePath };
  });

  ipcMain.handle("assets.import", async (event, projectId?: string) => {
    await ensureStoreReady();
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "导入素材",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Media", extensions: ["png", "jpg", "jpeg", "webp", "gif", "mp4", "mov", "mp3", "wav", "pdf"] },
        { name: "All Files", extensions: ["*"] },
      ],
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return [];
    const assetsDir = path.join(app.getPath("userData"), "assets");
    await fsp.mkdir(assetsDir, { recursive: true });
    const assets: AssetRecord[] = [];
    for (const filePath of result.filePaths) {
      const ext = path.extname(filePath).toLowerCase();
      const id = nanoid();
      const dest = path.join(assetsDir, `${id}${ext}`);
      await fsp.copyFile(filePath, dest);
      const type: AssetRecord["type"] = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)
        ? "image"
        : [".mp4", ".mov"].includes(ext)
          ? "video"
          : [".mp3", ".wav"].includes(ext)
            ? "audio"
            : ext === ".pdf"
              ? "document"
              : "other";
      const asset: AssetRecord = {
        id,
        projectId,
        type,
        name: path.basename(filePath),
        path: dest,
        tags: [],
        favorite: false,
        createdAt: new Date().toISOString(),
      };
      await store.saveAsset(asset);
      assets.push(asset);
    }
    return assets;
  });
  ipcMain.handle("assets.list", async (_event, projectId?: string) => {
    await ensureStoreReady();
    return store.listAssets(projectId);
  });
  ipcMain.handle("assets.rename", async (_event, assetId: string, name: string) => {
    await ensureStoreReady();
    return store.renameAsset(assetId, name);
  });
  ipcMain.handle("assets.composeSheet", async (_event, assetIds: string[], projectId?: string, sourceNodeId?: string) => {
    await ensureStoreReady();
    return store.composeImageSheet(assetIds, projectId, sourceNodeId);
  });
  ipcMain.handle("assets.delete", async (_event, assetId: string) => {
    await ensureStoreReady();
    return store.deleteAsset(assetId);
  });
  ipcMain.handle("assets.saveAs", async (event, assetId: string) => {
    await ensureStoreReady();
    const asset = store.listAssets().find((item) => item.id === assetId);
    const sourcePath = asset?.path;
    if (!asset || !sourcePath || !fs.existsSync(sourcePath)) throw new Error("图片文件不存在。");
    const owner = BrowserWindow.fromWebContents(event.sender);
    const saveOptions = {
      title: "保存图片",
      defaultPath: asset.name,
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] },
        { name: "All Files", extensions: ["*"] },
      ],
    };
    const result = owner ? await dialog.showSaveDialog(owner, saveOptions) : await dialog.showSaveDialog(saveOptions);
    if (result.canceled || !result.filePath) return { path: "" };
    await fsp.copyFile(sourcePath, result.filePath);
    return { path: result.filePath };
  });

  ipcMain.handle("ai.models.list", () => fetchTokenFluxModels());
  ipcMain.handle("ai.text.process", async (_event, params: ProcessTextParams) => processTextWithTokenFlux(params));
  ipcMain.handle("ai.generate.createTask", (_event, params: GenerateImageParams & { projectId?: string; sourceNodeId?: string }) =>
    generateWithTokenFlux(params),
  );
  ipcMain.handle("ai.task.status", (_event, taskId: string) => store.getTask(taskId) ?? { taskId, status: "failed", assetIds: [], error: "任务不存在。" });
  ipcMain.handle("ai.task.cancel", async (_event, taskId: string) => {
    const canceled = { taskId, status: "canceled" as TaskStatus, assetIds: [] };
    await store.saveTask(canceled);
    return canceled;
  });

  ipcMain.handle("billing.wallet.get", async () => {
    await ensureStoreReady();
    const user = await requireCurrentUser();
    return store.getWallet(user.id);
  });
  ipcMain.handle("billing.recharge.redeem", async (_event, code: string) => {
    await ensureStoreReady();
    const user = await requireCurrentUser();
    const payload = verifyRechargeCode(code, user);
    return store.redeemRechargeCode({ userId: user.id, code, payload });
  });
  ipcMain.handle("billing.ledger.list", async () => {
    await ensureStoreReady();
    const user = await requireCurrentUser();
    return store.listLedger(user.id);
  });
  ipcMain.handle("billing.reserve", async (_event, input: { points?: number; taskId?: string; note?: string }) => {
    await ensureStoreReady();
    const user = await requireCurrentUser();
    return store.reservePoints({ userId: user.id, taskId: input.taskId || nanoid(), points: Number(input.points || 0), note: input.note });
  });
  ipcMain.handle("billing.commit", async (_event, reservationId: string) => {
    await ensureStoreReady();
    await store.commitReservation(reservationId);
  });
  ipcMain.handle("billing.refund", async (_event, reservationId: string, reason?: string) => {
    await ensureStoreReady();
    await store.refundReservation(reservationId, reason);
  });

  ipcMain.handle("settings.get", () => getSettings());
  ipcMain.handle("settings.set", (_event, settings: AppSettings) => saveSettings(settings));
  ipcMain.handle("settings.testApiKey", async (_event, apiKey?: string, baseUrl?: string, mode: "models" | "image" | "reasoning" = "models") => {
    try {
      const settings = await getSettings();
      const key = normalizeApiKey(apiKey || settings.tokenFluxApiKey);
      if (!key?.trim()) return { ok: false, message: "未填写 API Key。" };
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl || settings.tokenFluxBaseUrl);
      if (mode === "reasoning") {
        const errors: string[] = [];
        for (const model of REASONING_MODEL_CANDIDATES) {
          const res = await fetch(apiUrl(normalizedBaseUrl, "/chat/completions"), {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders(key) },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: "只回复 OK" }],
              temperature: 0,
            }),
          });
          const json = await readTokenFluxResponse(res);
          if (res.ok) return { ok: true, message: `推理模型连接成功：${model}。地址：${normalizedBaseUrl}` };
          errors.push(humanizeApiError({ status: res.status, endpoint: apiUrl(normalizedBaseUrl, "/chat/completions"), model, json, baseUrl: normalizedBaseUrl }));
        }
        return { ok: false, message: `推理模型测试失败：${errors.join("；")}` };
      }
      const errors: string[] = [];
      for (const endpoint of ["/models", "/images/models"]) {
        const res = await fetch(apiUrl(normalizedBaseUrl, endpoint), { headers: authHeaders(key) });
        const json = await readTokenFluxResponse(res);
        const count = Array.isArray(json.data) ? json.data.length : 0;
        if (res.ok) {
          if (mode === "image") {
            const data = Array.isArray(json.data) ? json.data : [];
            const hasImageModel = data.some((item) => typeof item === "object" && item && "id" in item && String((item as { id?: unknown }).id) === IMAGE_MODEL_ID);
            if (!hasImageModel) {
              return {
                ok: false,
                message: `连接成功，但没有看到生图模型 ${IMAGE_MODEL_ID}。请在中转站后台确认这个 Key 的模型限制/分组权限。`,
              };
            }
            return { ok: true, message: `生图模型可用：${IMAGE_MODEL_ID}。地址：${normalizedBaseUrl}` };
          }
          return {
            ok: true,
            message: `连接成功，地址 ${normalizedBaseUrl}，已读取 ${count} 个模型。`,
          };
        }
        if (res.status === 401 || res.status === 403) {
          const baseHint = normalizedBaseUrl.includes("tokenflux.ai")
            ? "当前地址仍是默认 TokenFlux 官方地址；如果你使用的是中转站 API Key，请先填写中转站 /v1 地址。"
            : `当前中转地址：${normalizedBaseUrl}`;
          errors.push(`${endpoint}: ${humanizeApiError({ status: res.status, endpoint: apiUrl(normalizedBaseUrl, endpoint), model: mode === "image" ? IMAGE_MODEL_ID : undefined, json, baseUrl: normalizedBaseUrl })} ${baseHint}`);
        } else {
          errors.push(`${endpoint}: ${humanizeApiError({ status: res.status, endpoint: apiUrl(normalizedBaseUrl, endpoint), model: mode === "image" ? IMAGE_MODEL_ID : undefined, json, baseUrl: normalizedBaseUrl })}`);
        }
      }
      return { ok: false, message: `连接失败：${errors.join("；")}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
}

process.on("uncaughtException", (error) => log("process:uncaughtException", error instanceof Error ? error.stack : String(error)));
process.on("unhandledRejection", (reason) => log("process:unhandledRejection", reason instanceof Error ? reason.stack : String(reason)));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.moveTop();
    }
  });

  app.whenReady().then(async () => {
    log("app:ready");
    registerIpc();
    void ensureStoreReady();
    await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
