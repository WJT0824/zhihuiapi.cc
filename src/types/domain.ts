export type NodeKind =
  | "prompt"
  | "image"
  | "ai-generate"
  | "upscale"
  | "resize"
  | "background"
  | "preview"
  | "compare"
  | "ecommerce-template"
  | "print-template";

export type AssetType = "image" | "video" | "audio" | "document" | "other";

export type TaskStatus = "idle" | "queued" | "running" | "completed" | "failed" | "canceled";

export interface CanvasNode {
  id: string;
  type: NodeKind;
  position: { x: number; y: number };
  size: { width: number; height: number };
  title: string;
  inputs: string[];
  outputs: string[];
  params: Record<string, unknown>;
  status: TaskStatus;
  resultAssetIds: string[];
  selected?: boolean;
  locked?: boolean;
  groupId?: string;
  zIndex?: number;
}

export interface CanvasEdge {
  id: string;
  sourceNode: string;
  sourcePort: string;
  targetNode: string;
  targetPort: string;
}

export type CanvasBackground = "light" | "dark" | "gradient";

export interface CanvasGraph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
  background?: CanvasBackground;
}

export interface ZhihuiProject {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  graph: CanvasGraph;
  assetIds: string[];
  exportSettings: {
    format: "png" | "jpeg" | "pdf";
    width: number;
    height: number;
    scale: number;
    transparent: boolean;
  };
}

export interface AssetRecord {
  id: string;
  projectId?: string;
  type: AssetType;
  name: string;
  path: string;
  tags: string[];
  favorite: boolean;
  sourceNodeId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface AppSettings {
  tokenFluxApiKey?: string;
  tokenFluxBaseUrl?: string;
  defaultModel: string;
  defaultRatio: string;
  outputDirectory?: string;
  upscaleFactor: number;
  proxyUrl?: string;
  taskConcurrency: number;
}

export type BillingLedgerType = "recharge" | "reserve" | "commit" | "refund";
export type BillingLedgerStatus = "completed" | "pending" | "refunded" | "failed";

export interface WalletState {
  userId: string;
  balance: number;
  updatedAt: string;
}

export interface BillingLedgerEntry {
  id: string;
  userId: string;
  type: BillingLedgerType;
  status: BillingLedgerStatus;
  points: number;
  amountCny?: number;
  taskId?: string;
  reservationId?: string;
  nonce?: string;
  note?: string;
  createdAt: string;
}

export interface RechargeRedeemResult {
  wallet: WalletState;
  entry: BillingLedgerEntry;
  points: number;
  amountCny: number;
}

export interface BillingReservation {
  id: string;
  userId: string;
  taskId: string;
  points: number;
  status: "reserved" | "committed" | "refunded";
  createdAt: string;
  updatedAt: string;
}

export interface LocalUser {
  id: string;
  nickname: string;
  phone?: string;
  createdAt: string;
}

export interface TokenFluxModel {
  id: string;
  name: string;
  tags: string[];
  input_schema?: {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  pricing?: {
    price: number;
    currency: string;
    unit: number;
  };
}

export interface GenerateImageParams {
  prompt: string;
  model: string;
  size?: string;
  n?: number;
  referenceAssetIds?: string[];
  mode?: "generate" | "edit" | "upscale";
  extra?: Record<string, unknown>;
}

export interface GenerateImageResult {
  taskId: string;
  status: TaskStatus;
  assetIds: string[];
  error?: string;
  overviewAssetId?: string;
  billing?: {
    reservationId?: string;
    cost: number;
    refunded?: boolean;
  };
}

export type TextTool = "chat" | "polish-prompt" | "reverse-prompt";

export interface ProcessTextParams {
  tool: TextTool;
  prompt: string;
  referenceAssetIds?: string[];
}

export interface TemplateDefinition {
  id: string;
  category: string;
  title: string;
  description: string;
  type: "ecommerce" | "print";
  defaultPrompt: string;
  aspectRatio: string;
  outputSize: { width: number; height: number };
}
