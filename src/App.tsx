import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  CircleHelp,
  Clock3,
  CreditCard,
  Download,
  FileImage,
  FileText,
  FolderOpen,
  Hand,
  ImagePlus,
  Layers3,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightClose,
  Play,
  Plus,
  Save,
  Settings,
  Sparkles,
  StickyNote,
  Trash2,
  UserCircle,
} from "lucide-react";
import { nanoid } from "nanoid";
import { allTemplates, ecommerceTemplates, printTemplates } from "@/data/templates";
import type { AppSettings, AssetRecord, BillingLedgerEntry, CanvasEdge, CanvasNode, LocalUser, TokenFluxModel, WalletState, ZhihuiProject } from "@/types/domain";
import { AssetsPanel } from "@/components/AssetsPanel";
import { InfiniteCanvas } from "@/components/InfiniteCanvas";
import { Inspector } from "@/components/Inspector";
import { SettingsModal } from "@/components/SettingsModal";
import { WalletModal } from "@/components/WalletModal";
import { createNode, createTemplateNode, getPromptFromNode, upsertNode } from "@/services/projectFactory";

type Tab = "templates" | "assets" | "projects";
type ConnectionDraft = { sourceNode: string; sourcePort: string };
type WorkflowDefinition = {
  id: string;
  title: string;
  description: string;
  nodes: Array<{
    key: string;
    type: CanvasNode["type"];
    title?: string;
    x: number;
    y: number;
    params?: Record<string, unknown>;
  }>;
  edges: Array<{ from: string; sourcePort: string; to: string; targetPort: string }>;
};

const workflowDefinitions: WorkflowDefinition[] = [
  {
    id: "product-retouch",
    title: "商品图精修流程",
    description: "上传原图，按提示词精准编辑，自动输出预览和原图对比。",
    nodes: [
      { key: "image", type: "image", title: "图像节点", x: 0, y: 20 },
      {
        key: "prompt",
        type: "prompt",
        title: "文本节点",
        x: 0,
        y: 360,
        params: {
          prompt: "严格参考上传商品图，只优化光影、质感、背景和广告氛围，保持商品外形、颜色、结构和品牌识别不变。",
          ratio: "1:1",
          size: "1024x1024",
        },
      },
      { key: "edit", type: "background", title: "图像编辑节点", x: 520, y: 130, params: { ratio: "1:1", size: "1024x1024" } },
      { key: "preview", type: "preview", title: "图像预览节点", x: 1040, y: 50 },
      { key: "compare", type: "compare", title: "图像对比节点", x: 1040, y: 390 },
    ],
    edges: [
      { from: "image", sourcePort: "image", to: "edit", targetPort: "image" },
      { from: "prompt", sourcePort: "prompt", to: "edit", targetPort: "prompt" },
      { from: "edit", sourcePort: "image", to: "preview", targetPort: "image" },
      { from: "image", sourcePort: "image", to: "compare", targetPort: "image" },
      { from: "edit", sourcePort: "image", to: "compare", targetPort: "image" },
    ],
  },
  {
    id: "ecommerce-poster",
    title: "电商海报流程",
    description: "商品参考图加卖点提示词，生成主图海报并进入预览。",
    nodes: [
      { key: "image", type: "image", title: "图像节点", x: 0, y: 60 },
      {
        key: "prompt",
        type: "prompt",
        title: "文本节点",
        x: 0,
        y: 400,
        params: { prompt: "基于上传商品图生成高转化电商主图海报，主体突出，卖点清晰，高级商业摄影质感。", ratio: "1:1", size: "1024x1024" },
      },
      { key: "generate", type: "ai-generate", title: "图像生成节点", x: 520, y: 170, params: { ratio: "1:1", size: "1024x1024" } },
      { key: "preview", type: "preview", title: "图像预览节点", x: 1040, y: 170 },
    ],
    edges: [
      { from: "image", sourcePort: "image", to: "generate", targetPort: "image" },
      { from: "prompt", sourcePort: "prompt", to: "generate", targetPort: "prompt" },
      { from: "generate", sourcePort: "image", to: "preview", targetPort: "image" },
    ],
  },
  {
    id: "white-background",
    title: "商品白底图流程",
    description: "按平台规范提取主体，保留真实细节，输出前后对比。",
    nodes: [
      { key: "image", type: "image", title: "图像节点", x: 0, y: 40 },
      {
        key: "prompt",
        type: "prompt",
        title: "文本节点",
        x: 0,
        y: 370,
        params: { prompt: "严格保留上传商品主体，去除复杂背景，生成干净白底图，边缘自然，材质真实，不改变商品结构。", ratio: "1:1", size: "1024x1024" },
      },
      { key: "edit", type: "background", title: "白底处理节点", x: 520, y: 140, params: { ratio: "1:1", size: "1024x1024" } },
      { key: "compare", type: "compare", title: "图像对比节点", x: 1040, y: 140 },
    ],
    edges: [
      { from: "image", sourcePort: "image", to: "edit", targetPort: "image" },
      { from: "prompt", sourcePort: "prompt", to: "edit", targetPort: "prompt" },
      { from: "image", sourcePort: "image", to: "compare", targetPort: "image" },
      { from: "edit", sourcePort: "image", to: "compare", targetPort: "image" },
    ],
  },
  {
    id: "print-kv",
    title: "广告主视觉流程",
    description: "直接用文案生成平面广告主视觉，适合海报、展架、门头方案。",
    nodes: [
      {
        key: "prompt",
        type: "prompt",
        title: "文本节点",
        x: 0,
        y: 80,
        params: { prompt: "生成一张高级商业广告主视觉 KV，主体明确，标题区域清晰，适合线下海报和展会物料延展。", ratio: "16:9", size: "1920x1080" },
      },
      { key: "generate", type: "ai-generate", title: "图像生成节点", x: 520, y: 80, params: { ratio: "16:9", size: "1920x1080" } },
      { key: "preview", type: "preview", title: "图像预览节点", x: 1040, y: 80 },
    ],
    edges: [
      { from: "prompt", sourcePort: "prompt", to: "generate", targetPort: "prompt" },
      { from: "generate", sourcePort: "image", to: "preview", targetPort: "image" },
    ],
  },
];

function normalizeRunModel(model: unknown) {
  const value = String(model || "").trim();
  if (!value || ["images-2", "GPT-images-2", "GPT Image 2", "gpt image 2", "图像-2", "图片-2"].includes(value)) return "gpt-image-2";
  if (value.toLowerCase() === "gpt-image-2") return "gpt-image-2";
  return value;
}

function sizeForRatioAndResolution(ratioValue: unknown, resolutionValue: unknown, fallbackSize: unknown, widthValue?: unknown, heightValue?: unknown) {
  const ratio = String(ratioValue || "1:1");
  const resolution = String(resolutionValue || "1K");
  if (ratio === "custom") {
    const width = Math.min(8192, Math.max(64, Math.round(Number(widthValue) || 0)));
    const height = Math.min(8192, Math.max(64, Math.round(Number(heightValue) || 0)));
    if (width && height) return `${width}x${height}`;
  }
  const normalizedRatio = ratio === "auto" ? "1:1" : ratio;
  if (normalizedRatio === "16:9") {
    if (resolution === "4K") return "3840x2160";
    if (resolution === "2K") return "2560x1440";
    return "1280x720";
  }
  if (normalizedRatio === "9:16") {
    if (resolution === "4K") return "2160x3840";
    if (resolution === "2K") return "1440x2560";
    return "720x1280";
  }
  const [widthRatio, heightRatio] = normalizedRatio.split(":").map(Number);
  const longEdge = resolution === "4K" ? 4096 : resolution === "2K" ? 2048 : 1024;
  if (widthRatio && heightRatio) {
    if (widthRatio >= heightRatio) return `${longEdge}x${Math.round((longEdge * heightRatio) / widthRatio)}`;
    return `${Math.round((longEdge * widthRatio) / heightRatio)}x${longEdge}`;
  }
  return String(fallbackSize || `${longEdge}x${longEdge}`);
}

export function App() {
  const billingEnabled = __ZH_BILLING_ENABLED__;
  const [user, setUser] = useState<LocalUser>();
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authForm, setAuthForm] = useState({ nickname: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [project, setProject] = useState<ZhihuiProject>();
  const [projects, setProjects] = useState<ZhihuiProject[]>([]);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [models, setModels] = useState<TokenFluxModel[]>([]);
  const [settings, setSettings] = useState<AppSettings>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [tab, setTab] = useState<Tab>("templates");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [wallet, setWallet] = useState<WalletState>();
  const [ledger, setLedger] = useState<BillingLedgerEntry[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [status, setStatus] = useState("准备就绪");
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const projectRef = useRef<ZhihuiProject>();
  const assetsRef = useRef<AssetRecord[]>([]);
  const settingsRef = useRef<AppSettings>();

  const selectedNode = useMemo(
    () => project?.graph.nodes.find((node) => node.id === selectedNodeId),
    [project?.graph.nodes, selectedNodeId],
  );

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  function setActiveProject(next: ZhihuiProject | undefined) {
    projectRef.current = next;
    setProject(next);
  }

  async function refreshAssets(projectId = project?.id) {
    setAssets(await window.zhihui.assets.list(projectId));
  }

  async function refreshProjects() {
    setProjects(await window.zhihui.projects.list());
  }

  async function refreshWallet() {
    try {
      const [nextWallet, nextLedger] = await Promise.all([window.zhihui.billing.getWallet(), window.zhihui.billing.listLedger()]);
      setWallet(nextWallet);
      setLedger(nextLedger);
      return nextWallet;
    } catch {
      setWallet(undefined);
      setLedger([]);
      return undefined;
    }
  }

  useEffect(() => {
    void (async () => {
      const currentUser = await window.zhihui.auth.current();
      setUser(currentUser);
      if (currentUser) await refreshWallet();
      if (!currentUser) {
        const remembered = await window.zhihui.auth.remembered();
        if (remembered) setAuthForm((current) => ({ ...current, ...remembered }));
      }
      const [savedSettings, savedProjects] = await Promise.all([window.zhihui.settings.get(), window.zhihui.projects.list()]);
      setSettings(savedSettings);
      setProjects(savedProjects);
      const initialProject = await window.zhihui.projects.create("新广告画布");
      setProject(initialProject);
      setProjects([initialProject, ...savedProjects.filter((item) => item.id !== initialProject.id)]);
      setSidebarOpen(false);
      setInspectorOpen(false);
      setAssets(await window.zhihui.assets.list(initialProject.id));
      window.zhihui.ai
        .listModels()
        .then(setModels)
        .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
    })();
  }, []);

  async function submitAuth() {
    setAuthError("");
    try {
      const nextUser =
        authMode === "register"
          ? await window.zhihui.auth.register(authForm)
          : await window.zhihui.auth.login({ nickname: authForm.nickname, password: authForm.password });
      setUser(nextUser);
      await refreshWallet();
      setAuthForm({ nickname: "", password: "" });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    }
  }

  async function logout() {
    await window.zhihui.auth.logout();
    setUser(undefined);
    setWallet(undefined);
    setLedger([]);
    setAuthMode("login");
  }

  async function saveProject(next = project) {
    if (!next) return;
    const saved = await window.zhihui.projects.save(next);
    setProject(saved);
    await refreshProjects();
    setStatus(`已保存：${saved.title}`);
  }

  async function createProject() {
    const next = await window.zhihui.projects.create("新广告画布");
    setProject(next);
    setSelectedNodeId(undefined);
    setSidebarOpen(false);
    setInspectorOpen(false);
    await refreshProjects();
    await refreshAssets(next.id);
    setStatus("已创建新项目");
  }

  async function openProject(projectId: string) {
    const next = await window.zhihui.projects.open(projectId);
    if (!next) return;
    setProject(next);
    setSelectedNodeId(undefined);
    setSidebarOpen(false);
    setInspectorOpen(false);
    await refreshAssets(next.id);
    setStatus(`已打开：${next.title}`);
  }

  async function deleteProject(projectId: string) {
    const target = projects.find((item) => item.id === projectId);
    if (!target) return;
    const confirmed = window.confirm(`确定删除项目“${target.title}”？该项目下的素材文件也会一起删除。`);
    if (!confirmed) return;
    await window.zhihui.projects.delete(projectId);
    const remaining = (await window.zhihui.projects.list()).filter((item) => item.id !== projectId);
    if (project?.id === projectId) {
      const next = remaining[0] ?? (await window.zhihui.projects.create("新广告画布"));
      setProject(next);
      setSelectedNodeId(undefined);
      setProjects(remaining[0] ? remaining : [next]);
      await refreshAssets(next.id);
    } else {
      setProjects(remaining);
      await refreshAssets(project?.id);
    }
    setSelectedProjectIds((current) => current.filter((id) => id !== projectId));
    setStatus(`已删除项目：${target.title}`);
  }

  async function deleteSelectedProjects() {
    const ids = selectedProjectIds.filter((id) => projects.some((item) => item.id === id));
    if (!ids.length) return;
    const confirmed = window.confirm(`确定删除选中的 ${ids.length} 个项目？项目下的素材文件也会一起删除。`);
    if (!confirmed) return;
    for (const id of ids) await window.zhihui.projects.delete(id);
    const remaining = await window.zhihui.projects.list();
    if (project && ids.includes(project.id)) {
      const next = remaining[0] ?? (await window.zhihui.projects.create("新广告画布"));
      setProject(next);
      setSelectedNodeId(undefined);
      setProjects(remaining[0] ? remaining : [next]);
      await refreshAssets(next.id);
    } else {
      setProjects(remaining);
      await refreshAssets(project?.id);
    }
    setSelectedProjectIds([]);
    setStatus(`已删除 ${ids.length} 个项目`);
  }

  function addNode(type: CanvasNode["type"]) {
    if (!project) return;
    const node = createNode(
      type,
      (220 - project.graph.viewport.x) / project.graph.viewport.zoom,
      (180 - project.graph.viewport.y) / project.graph.viewport.zoom,
    );
    const next = upsertNode(project, node);
    setProject(next);
    setSelectedNodeId(node.id);
  }

  function pickTargetPort(node: CanvasNode, sourcePort?: string) {
    if (sourcePort && node.inputs.includes(sourcePort)) return sourcePort;
    if (sourcePort === "prompt" && node.inputs.includes("prompt")) return "prompt";
    if (sourcePort === "image" && node.inputs.includes("image")) return "image";
    if (node.inputs.includes("input")) return "input";
    return node.inputs[0] ?? "input";
  }

  function createEdgeToNode(connection: ConnectionDraft | undefined, node: CanvasNode): CanvasEdge | undefined {
    if (!connection || connection.sourceNode === node.id) return undefined;
    return {
      id: nanoid(),
      sourceNode: connection.sourceNode,
      sourcePort: connection.sourcePort,
      targetNode: node.id,
      targetPort: pickTargetPort(node, connection.sourcePort),
    };
  }

  function addNodeAt(
    type: CanvasNode["type"],
    position: { x: number; y: number },
    connection?: ConnectionDraft,
    preset?: { title: string; params?: Record<string, unknown> },
  ) {
    if (!project) return;
    const baseNode = createNode(type, position.x, position.y);
    const node: CanvasNode = preset
      ? { ...baseNode, title: preset.title, params: { ...baseNode.params, ...preset.params } }
      : baseNode;
    const edge = createEdgeToNode(connection, node);
    const next = {
      ...project,
      graph: {
        ...project.graph,
        nodes: [...project.graph.nodes, node],
        edges: edge ? [...project.graph.edges, edge] : project.graph.edges,
      },
    };
    setProject(next);
    setSelectedNodeId(node.id);
    setStatus(edge ? `已创建并连接：${node.title}` : `已创建节点：${node.title}`);
  }


  function addTemplate(templateId: string) {
    if (!project) return;
    const template = allTemplates.find((item) => item.id === templateId);
    if (!template) return;
    const node = createTemplateNode(
      template,
      (220 - project.graph.viewport.x) / project.graph.viewport.zoom,
      (180 - project.graph.viewport.y) / project.graph.viewport.zoom,
    );
    const next = upsertNode(project, node);
    setProject(next);
    setSelectedNodeId(node.id);
  }

  function updateNode(node: CanvasNode) {
    const current = projectRef.current;
    if (!current) return;
    setActiveProject(upsertNode(current, node));
  }

  async function importAssets() {
    if (!project) return;
    const imported = await window.zhihui.assets.import(project.id);
    await refreshAssets(project.id);
    setStatus(imported.length ? `已导入 ${imported.length} 个素材` : "未选择素材");
  }

  async function importImageAt(position: { x: number; y: number }, connection?: ConnectionDraft) {
    if (!project) return;
    const imported = await window.zhihui.assets.import(project.id);
    if (!imported.length) {
      setStatus("未选择素材");
    }
    const imageAssets = imported.filter((asset) => asset.type === "image");
    const newNodes = imageAssets.map((asset, index) => ({
      ...createNode("image", position.x + index * 36, position.y + index * 36),
      title: "图像节点",
      params: { assetId: asset.id },
      status: "completed" as const,
      resultAssetIds: [asset.id],
    }));
    const edge = newNodes[0] ? createEdgeToNode(connection, newNodes[0]) : undefined;
    const next = {
      ...project,
      graph: {
        ...project.graph,
        nodes: [...project.graph.nodes, ...newNodes],
        edges: edge ? [...project.graph.edges, edge] : project.graph.edges,
      },
    };
    setProject(next);
    setSelectedNodeId(newNodes[0]?.id);
    await window.zhihui.projects.save(next);
    await refreshAssets(project.id);
    setStatus(imageAssets.length ? `已导入 ${imageAssets.length} 张图片` : "已导入素材，但没有图片文件");
  }

  function addWorkflow(workflowId: string) {
    if (!project) return;
    const workflow = workflowDefinitions.find((item) => item.id === workflowId);
    if (!workflow) return;
    const baseX = (180 - project.graph.viewport.x) / project.graph.viewport.zoom;
    const baseY = (130 - project.graph.viewport.y) / project.graph.viewport.zoom;
    const nodeByKey = new Map<string, CanvasNode>();
    const nodes = workflow.nodes.map((definition, index) => {
      const node = createNode(definition.type, baseX + definition.x, baseY + definition.y);
      const nextNode: CanvasNode = {
        ...node,
        title: definition.title ?? node.title,
        params: { ...node.params, ...definition.params },
        zIndex: 20 + index,
      };
      nodeByKey.set(definition.key, nextNode);
      return nextNode;
    });
    const edges = workflow.edges.flatMap((edgeDefinition) => {
      const source = nodeByKey.get(edgeDefinition.from);
      const target = nodeByKey.get(edgeDefinition.to);
      if (!source || !target) return [];
      return [
        {
          id: nanoid(),
          sourceNode: source.id,
          sourcePort: edgeDefinition.sourcePort,
          targetNode: target.id,
          targetPort: target.inputs.includes(edgeDefinition.targetPort)
            ? edgeDefinition.targetPort
            : pickTargetPort(target, edgeDefinition.sourcePort),
        },
      ];
    });
    setProject({
      ...project,
      graph: {
        ...project.graph,
        nodes: [...project.graph.nodes, ...nodes],
        edges: [...project.graph.edges, ...edges],
      },
    });
    setSelectedNodeId(nodes[0]?.id);
    setStatus(`已创建流程：${workflow.title}`);
  }

  async function importImageIntoNode(nodeId: string) {
    if (!project) return;
    const imported = await window.zhihui.assets.import(project.id);
    if (!imported.length) {
      setStatus("未选择素材");
      return;
    }
    const imageAsset = imported.find((asset) => asset.type === "image");
    if (!imageAsset) {
      await refreshAssets(project.id);
      setStatus("已导入素材，但没有图片文件");
      return;
    }
    const target = project.graph.nodes.find((node) => node.id === nodeId);
    if (!target) return;
    const updatedNode: CanvasNode = {
      ...target,
      title: "图像节点",
      params: { ...target.params, assetId: imageAsset.id, error: undefined },
      status: "completed",
      resultAssetIds: [imageAsset.id],
    };
    const next = upsertNode(project, updatedNode);
    setProject(next);
    setSelectedNodeId(nodeId);
    await window.zhihui.projects.save(next);
    await refreshAssets(project.id);
    setStatus(`已上传图像：${imageAsset.name}`);
  }

  async function addAssetToCanvas(asset: AssetRecord, position?: { x: number; y: number }) {
    if (!project || asset.type !== "image") return;
    const node = {
      ...createNode(
        "image",
        position?.x ?? (260 - project.graph.viewport.x) / project.graph.viewport.zoom,
        position?.y ?? (220 - project.graph.viewport.y) / project.graph.viewport.zoom,
      ),
      title: "图像节点",
      params: { assetId: asset.id },
      status: "completed" as const,
      resultAssetIds: [asset.id],
    };
    const next = upsertNode(project, node);
    setProject(next);
    setSelectedNodeId(node.id);
    await window.zhihui.projects.save(next);
    setStatus(`已加入画布：${asset.name}`);
  }

  async function deleteAsset(asset: AssetRecord) {
    if (!window.confirm(`确定删除素材“${asset.name}”？`)) return;
    await window.zhihui.assets.delete(asset.id);
    if (project) {
      const next = {
        ...project,
        graph: {
          ...project.graph,
          nodes: project.graph.nodes.map((node) => ({
            ...node,
            params: node.params.assetId === asset.id ? { ...node.params, assetId: undefined } : node.params,
            resultAssetIds: node.resultAssetIds.filter((assetId) => assetId !== asset.id),
          })),
        },
      };
      setProject(next);
      await window.zhihui.projects.save(next);
      await refreshAssets(project.id);
    } else {
      await refreshAssets();
    }
    setStatus(`已删除素材：${asset.name}`);
  }

  async function renameAsset(asset: AssetRecord, name: string) {
    const nextName = name.trim();
    if (!nextName || nextName === asset.name) return;
    try {
      await window.zhihui.assets.rename(asset.id, nextName);
      await refreshAssets(project?.id);
      setStatus(`已修改素材名称：${nextName}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveAssetAs(asset: AssetRecord) {
    const result = await window.zhihui.assets.saveAs(asset.id);
    setStatus(result.path ? `已保存图片：${result.path}` : "已取消保存图片");
  }

  function getIncomingNodes(nodeId: string) {
    if (!project) return [];
    const incomingEdges = project.graph.edges.filter((edge) => edge.targetNode === nodeId);
    return incomingEdges
      .map((edge) => project.graph.nodes.find((node) => node.id === edge.sourceNode))
      .filter((node): node is CanvasNode => Boolean(node));
  }

  function getNodeAssetIds(node: CanvasNode) {
    const directAsset = typeof node.params.assetId === "string" ? [node.params.assetId] : [];
    return uniqueStrings([...directAsset, ...node.resultAssetIds]);
  }

  function uniqueStrings(values: string[]) {
    return [...new Set(values.filter(Boolean))];
  }

  function getUpstreamContext(nodeId: string, visited = new Set<string>()): { prompts: string[]; assetIds: string[] } {
    if (!project || visited.has(nodeId)) return { prompts: [], assetIds: [] };
    visited.add(nodeId);
    const incomingEdges = project.graph.edges.filter((edge) => edge.targetNode === nodeId);
    const prompts: string[] = [];
    const assetIds: string[] = [];
    for (const edge of incomingEdges) {
      const source = project.graph.nodes.find((item) => item.id === edge.sourceNode);
      if (!source) continue;
      const upstream = getUpstreamContext(source.id, visited);
      prompts.push(...upstream.prompts);
      assetIds.push(...upstream.assetIds);
      const sourcePrompt = getPromptFromNode(source);
      if (sourcePrompt) prompts.push(sourcePrompt);
      assetIds.push(...getNodeAssetIds(source));
    }
    return { prompts: uniqueStrings(prompts), assetIds: uniqueStrings(assetIds) };
  }

  function getViewNodeAssetIds(viewNodeId: string) {
    const directIncomingAssets = getIncomingNodes(viewNodeId).flatMap(getNodeAssetIds);
    const upstreamAssets = getUpstreamContext(viewNodeId).assetIds;
    return uniqueStrings([...directIncomingAssets, ...upstreamAssets]);
  }

  function getDownstreamViewNodeIds(sourceNodeId: string, graph = project?.graph, visited = new Set<string>()) {
    if (!graph || visited.has(sourceNodeId)) return new Set<string>();
    visited.add(sourceNodeId);
    const ids = new Set<string>();
    for (const edge of graph.edges.filter((item) => item.sourceNode === sourceNodeId)) {
      const target = graph.nodes.find((item) => item.id === edge.targetNode);
      if (!target) continue;
      if (target.type === "preview" || target.type === "compare") ids.add(target.id);
      for (const id of getDownstreamViewNodeIds(target.id, graph, visited)) ids.add(id);
    }
    return ids;
  }

  function getUpstreamContextFromGraph(graph: ZhihuiProject["graph"], nodeId: string, visited = new Set<string>()): { prompts: string[]; assetIds: string[] } {
    if (visited.has(nodeId)) return { prompts: [], assetIds: [] };
    visited.add(nodeId);
    const incomingEdges = graph.edges.filter((edge) => edge.targetNode === nodeId);
    const prompts: string[] = [];
    const assetIds: string[] = [];
    for (const edge of incomingEdges) {
      const source = graph.nodes.find((item) => item.id === edge.sourceNode);
      if (!source) continue;
      const upstream = getUpstreamContextFromGraph(graph, source.id, visited);
      prompts.push(...upstream.prompts);
      assetIds.push(...upstream.assetIds);
      const sourcePrompt = getPromptFromNode(source);
      if (sourcePrompt) prompts.push(sourcePrompt);
      assetIds.push(...getNodeAssetIds(source));
    }
    return { prompts: uniqueStrings(prompts), assetIds: uniqueStrings(assetIds) };
  }

  function getUpstreamImageFlow(nodeId: string, visited = new Set<string>()): { sourceAssetIds: string[]; generatedAssetIds: string[] } {
    if (!project || visited.has(nodeId)) return { sourceAssetIds: [], generatedAssetIds: [] };
    visited.add(nodeId);
    const sourceAssetIds: string[] = [];
    const generatedAssetIds: string[] = [];
    for (const edge of project.graph.edges.filter((item) => item.targetNode === nodeId)) {
      const source = project.graph.nodes.find((item) => item.id === edge.sourceNode);
      if (!source) continue;
      const upstream = getUpstreamImageFlow(source.id, visited);
      sourceAssetIds.push(...upstream.sourceAssetIds);
      generatedAssetIds.push(...upstream.generatedAssetIds);
      for (const assetId of getNodeAssetIds(source)) {
        const asset = assets.find((item) => item.id === assetId);
        if (!asset || asset.type !== "image") continue;
        if (source.type === "image" && !asset.sourceNodeId) sourceAssetIds.push(assetId);
        else generatedAssetIds.push(assetId);
      }
    }
    return {
      sourceAssetIds: uniqueStrings(sourceAssetIds),
      generatedAssetIds: uniqueStrings(generatedAssetIds),
    };
  }

  function getUpstreamImageFlowFromGraph(graph: ZhihuiProject["graph"], nodeId: string, assetList = assetsRef.current, visited = new Set<string>()): { sourceAssetIds: string[]; generatedAssetIds: string[] } {
    if (visited.has(nodeId)) return { sourceAssetIds: [], generatedAssetIds: [] };
    visited.add(nodeId);
    const sourceAssetIds: string[] = [];
    const generatedAssetIds: string[] = [];
    for (const edge of graph.edges.filter((item) => item.targetNode === nodeId)) {
      const source = graph.nodes.find((item) => item.id === edge.sourceNode);
      if (!source) continue;
      const upstream = getUpstreamImageFlowFromGraph(graph, source.id, assetList, visited);
      sourceAssetIds.push(...upstream.sourceAssetIds);
      generatedAssetIds.push(...upstream.generatedAssetIds);
      for (const assetId of getNodeAssetIds(source)) {
        const asset = assetList.find((item) => item.id === assetId);
        if (!asset || asset.type !== "image") continue;
        if (source.type === "image" && !asset.sourceNodeId) sourceAssetIds.push(assetId);
        else generatedAssetIds.push(assetId);
      }
    }
    return {
      sourceAssetIds: uniqueStrings(sourceAssetIds),
      generatedAssetIds: uniqueStrings(generatedAssetIds),
    };
  }

  function isPosterLikeNode(node: CanvasNode, prompt: string) {
    const haystack = `${node.title} ${node.type} ${String(node.params.category || "")} ${String(node.params.description || "")} ${prompt}`;
    return /海报|主图|KV|广告|展架|易拉宝|画册|门头|物料|poster|banner/i.test(haystack);
  }

  function buildRunPrompt(node: CanvasNode, prompt: string) {
    const cleaned = prompt.trim();
    if (!isPosterLikeNode(node, cleaned)) return cleaned;
    return [
      cleaned,
      "必须输出完整可用的广告海报版式，而不是单纯场景图或背景图。",
      "画面需要包含清晰的文字排版区域，例如主标题、副标题或卖点区域，但不要默认添加价格、二维码、LOGO、联系方式、促销按钮等具体商业信息。",
      "只有当用户提示词明确要求价格、二维码、LOGO、联系方式或促销按钮时，才允许加入这些元素。",
      "文字要融入设计网格，层级明确，对齐整洁，保留足够留白，适合电商投放和平面广告提案。",
    ].join("\n");
  }

  function isBrandMaterialSetRequest(node: CanvasNode, prompt: string) {
    if (["preview", "compare", "prompt", "image"].includes(node.type)) return false;
    return /品牌物料|物料套装|品牌套装|整套物料|一套.*(?:品牌|物料)|全套.*(?:品牌|物料)/i.test(`${node.title} ${prompt}`);
  }

  function buildBrandMaterialTaskPrompts(prompt: string) {
    const deliverables = [
      "品牌主视觉 KV 海报",
      "门头或店招设计",
      "社交媒体宣传海报",
      "包装或手提袋设计",
      "名片或宣传单设计",
      "展架或易拉宝设计",
    ];
    return deliverables.map(
      (deliverable, index) =>
        [
          prompt,
          `这是品牌物料套装中的第 ${index + 1} 张：${deliverable}。请只输出这一张独立物料成品，不要把多张物料拼成一张总览图。`,
          "所有物料保持统一品牌视觉系统、字体层级、色彩、材质和构图语言，但每张要符合自身用途和尺寸比例。",
          "不要默认添加价格、二维码、LOGO、联系方式、促销按钮或虚构品牌信息；只有用户明确提供或要求时才加入。",
          "画面中的文字必须清晰、完整、可读，避免乱码、错字和无意义占位文字。",
        ].join("\n"),
    );
  }

  function mergeCompletedRun(input: { nodeId: string; running: CanvasNode; result: Awaited<ReturnType<typeof window.zhihui.ai.createTask>>; sourceAssetIds?: string[] }) {
    const latest = projectRef.current;
    if (!latest) return undefined;
    const latestNode = latest.graph.nodes.find((item) => item.id === input.nodeId) ?? input.running;
    const nextResultAssetIds =
      input.result.status === "completed"
        ? uniqueStrings([...latestNode.resultAssetIds, ...input.result.assetIds])
        : latestNode.resultAssetIds;
    const cleanedParams = {
      ...latestNode.params,
      progress: undefined,
      progressStartedAt: undefined,
      error: input.result.error || undefined,
    };
    const updatedNode: CanvasNode = {
      ...latestNode,
      status: input.result.status,
      resultAssetIds: nextResultAssetIds,
      params: cleanedParams,
    };
    const nextWithSource = upsertNode(latest, updatedNode);
    const downstreamIds = getDownstreamViewNodeIds(input.nodeId, nextWithSource.graph);
    const next =
      input.result.status === "completed" && input.result.assetIds.length
        ? {
            ...nextWithSource,
            graph: {
              ...nextWithSource.graph,
              nodes: nextWithSource.graph.nodes.map((item) => {
                if (!downstreamIds.has(item.id) || (item.type !== "preview" && item.type !== "compare")) return item;
                const linkedAssetIds = getUpstreamContextFromGraph(nextWithSource.graph, item.id).assetIds;
                const imageFlow = getUpstreamImageFlowFromGraph(nextWithSource.graph, item.id);
                const viewAssetIds = item.type === "compare"
                  ? uniqueStrings([...imageFlow.sourceAssetIds, ...imageFlow.generatedAssetIds, ...input.result.assetIds])
                  : uniqueStrings([...linkedAssetIds, ...input.result.assetIds]);
                return {
                  ...item,
                  status: viewAssetIds.length ? "completed" as const : item.status,
                  resultAssetIds: viewAssetIds.length ? viewAssetIds : item.resultAssetIds,
                  params: { ...item.params, error: undefined },
                };
              }),
            },
          }
        : nextWithSource;
    setActiveProject(next);
    void window.zhihui.projects.save(next);
    return next;
  }

  async function runAiNode(node = selectedNode) {
    const currentProject = projectRef.current;
    if (!currentProject || !node) return;
    const nodeTool = String(node.params.tool ?? "");
    if (node.params.unsupportedFeature === "video") {
      updateNode({ ...node, status: "failed", params: { ...node.params, error: "当前版本暂未接入视频生成接口，请使用图片生成节点。" } });
      setStatus("图生视频接口暂未接入，未发送错误的图片请求");
      return;
    }
    if (["chat", "polish-prompt", "reverse-prompt"].includes(nodeTool)) {
      const upstream = getUpstreamContextFromGraph(currentProject.graph, node.id);
      const inputText = [...upstream.prompts, getPromptFromNode(node)].filter(Boolean).join("\n");
      const running: CanvasNode = { ...node, status: "running", params: { ...node.params, error: undefined } };
      updateNode(running);
      setStatus(`${node.title}节点正在处理文本...`);
      try {
        const result = await window.zhihui.ai.processText({
          tool: nodeTool as "chat" | "polish-prompt" | "reverse-prompt",
          prompt: inputText,
          referenceAssetIds: upstream.assetIds,
        });
        const completed: CanvasNode = {
          ...running,
          status: "completed",
          params: { ...running.params, prompt: result.text, error: undefined },
        };
        updateNode(completed);
        const saved = projectRef.current;
        if (saved) void window.zhihui.projects.save(saved);
        setStatus(`${node.title}节点处理完成，结果已传给下游节点`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateNode({ ...running, status: "failed", params: { ...running.params, error: message } });
        setStatus(message);
      }
      return;
    }
    if (nodeTool === "text-note") {
      updateNode({ ...node, status: "completed", params: { ...node.params, error: undefined } });
      setStatus("文本备注已保存，可连接到图片生成节点作为说明");
      return;
    }
    const latestSettings = settingsRef.current;
    const { error: _oldError, ...paramsWithoutError } = node.params;
    const upstream = getUpstreamContextFromGraph(currentProject.graph, node.id);
    const promptParts = [...upstream.prompts, getPromptFromNode(node)].filter(Boolean);
    const basePrompt =
      promptParts.join("\n") ||
      getPromptFromNode(currentProject.graph.nodes.find((candidate) => candidate.type === "prompt")) ||
      "电商广告海报，主体突出，高级商业摄影";
    const sourceAssetId = typeof node.params.assetId === "string" ? node.params.assetId : node.resultAssetIds[0];
    const imageFlow = getUpstreamImageFlowFromGraph(currentProject.graph, node.id);
    const nodeOwnPrompt = getPromptFromNode(node).trim();
    const runPrompt = buildRunPrompt(node, node.type === "image" && !nodeOwnPrompt ? basePrompt : nodeOwnPrompt || basePrompt);
    const taskPrompts = isBrandMaterialSetRequest(node, runPrompt) ? buildBrandMaterialTaskPrompts(runPrompt) : [runPrompt];
    const referenceAssetIds =
      node.type === "image"
        ? sourceAssetId ? [sourceAssetId] : []
        : node.type === "preview" || node.type === "compare"
          ? imageFlow.sourceAssetIds.length ? imageFlow.sourceAssetIds : upstream.assetIds
          : upstream.assetIds;

    if ((node.type === "preview" || node.type === "compare") && !promptParts.some((item) => item.trim())) {
      const incomingAssetIds = getUpstreamContextFromGraph(currentProject.graph, node.id).assetIds;
      updateNode({
        ...node,
        params: paramsWithoutError,
        status: incomingAssetIds.length ? "completed" : "idle",
        resultAssetIds: incomingAssetIds.length ? incomingAssetIds : node.resultAssetIds,
      });
      setStatus(incomingAssetIds.length ? "图像查看节点已更新" : "请先连接图片节点或文本节点");
      return;
    }

    if (node.type === "image" && !sourceAssetId && !nodeOwnPrompt) {
      updateNode({ ...node, params: paramsWithoutError, status: "idle" });
      setStatus("请上传图片，或输入提示词后直接运行生图");
      return;
    }

    const running: CanvasNode = { ...node, params: paramsWithoutError, status: "running", resultAssetIds: [] };
    running.params.progress = 2;
    running.params.progressStartedAt = Date.now();
    updateNode(running);
    setStatus(
      taskPrompts.length > 1
        ? `正在同时生成 ${taskPrompts.length} 张品牌物料...`
        : node.type === "image"
        ? sourceAssetId ? "正在根据上传图像和提示词编辑..." : "正在根据图片节点提示词生图..."
        : node.type === "preview" || node.type === "compare"
          ? "正在根据上游节点生成预览..."
          : "AI 多任务运行中...",
    );

    let settledTasks = 0;
    const taskResults = await Promise.all(
      taskPrompts.map(async (prompt) => {
        const taskResult = await window.zhihui.ai.createTask({
          projectId: currentProject.id,
          sourceNodeId: node.id,
          prompt,
          model: normalizeRunModel(node.params.model || latestSettings?.defaultModel || "gpt-image-2"),
          size: sizeForRatioAndResolution(
            node.params.ratio || latestSettings?.defaultRatio,
            node.params.resolution,
            node.params.size,
            node.params.width,
            node.params.height,
          ),
          n: taskPrompts.length > 1 ? 1 : Number(node.params.n || 1),
          referenceAssetIds,
          mode: node.type === "upscale" ? "upscale" : referenceAssetIds.length ? "edit" : "generate",
          extra: {
            ratio: node.params.ratio || latestSettings?.defaultRatio || "1:1",
            resolution: node.params.resolution || "1K",
            quality: node.params.quality || "high",
            width: node.params.width,
            height: node.params.height,
            factor: node.params.factor || latestSettings?.upscaleFactor,
            inferenceModel: node.params.inferenceModel || "GPT-5.5",
            runMode: node.params.runMode || "image",
            tool: node.params.tool,
          },
        });
        settledTasks += 1;
        const latestRunning = projectRef.current?.graph.nodes.find((item) => item.id === node.id);
        if (latestRunning) {
          updateNode({
            ...latestRunning,
            status: settledTasks === taskPrompts.length ? "running" : latestRunning.status,
            params: { ...latestRunning.params, progress: Math.min(95, Math.round((settledTasks / taskPrompts.length) * 100)) },
          });
        }
        return taskResult;
      }),
    );
    const successfulResults = taskResults.filter((item) => item.status === "completed" && item.assetIds.length);
    let result: Awaited<ReturnType<typeof window.zhihui.ai.createTask>> = {
      taskId: taskResults.map((item) => item.taskId).join(","),
      status: successfulResults.length ? "completed" as const : "failed" as const,
      assetIds: uniqueStrings(taskResults.flatMap((item) => item.assetIds)),
      error: successfulResults.length === taskResults.length ? undefined : taskResults.find((item) => item.error)?.error || "部分物料生成失败",
    };
    if (taskPrompts.length > 1 && result.status === "completed" && result.assetIds.length > 1) {
      try {
        const overview = await window.zhihui.assets.composeSheet(result.assetIds, currentProject.id, node.id);
        result = { ...result, assetIds: [...result.assetIds, overview.id], overviewAssetId: overview.id };
      } catch (error) {
        setStatus(error instanceof Error ? `整套总览图生成失败：${error.message}` : "整套总览图生成失败");
      }
    }
    await refreshWallet();
    const next = mergeCompletedRun({ nodeId: node.id, running, result });
    await refreshAssets(currentProject.id);
    setStatus(result.status === "completed" ? `任务完成：${node.title} 已更新` : result.error || "生成失败");
    if (next && selectedNodeId === node.id) setSelectedNodeId(node.id);
  }

  async function exportProject(format: "png" | "jpeg" | "pdf") {
    if (!project) return;
    const result = await window.zhihui.projects.export(project, format);
    setStatus(result.path ? `已导出：${result.path}` : "已取消导出");
  }

  const modelOptions = models.filter((model) => model.tags.includes("text-to-image") || model.tags.includes("image-editing"));

  if (!user) {
    return (
      <AuthScreen
        mode={authMode}
        form={authForm}
        error={authError}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setAuthError("");
        }}
        onFormChange={setAuthForm}
        onSubmit={() => void submitAuth()}
      />
    );
  }

  return (
    <div className={`app-shell ${sidebarOpen ? "" : "sidebar-collapsed"} ${inspectorOpen ? "" : "inspector-collapsed"}`}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">郅</div>
          <div>
            <h1>郅绘ai画布</h1>
            <p>{project?.title ?? "加载项目中..."}</p>
          </div>
        </div>
        <div className="toolbar">
          <button onClick={createProject} title="新建项目">
            <Plus size={18} />
            新建
          </button>
          <button onClick={() => setSidebarOpen((open) => !open)} title={sidebarOpen ? "收起左侧功能" : "展开左侧功能"}>
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            功能
          </button>
          <button onClick={() => void saveProject()} title="保存项目">
            <Save size={18} />
            保存
          </button>
          <button onClick={importAssets} title="导入素材">
            <ImagePlus size={18} />
            导入
          </button>
          <button onClick={() => selectedNode && void runAiNode(selectedNode)} disabled={!selectedNode} title="运行选中节点">
            <Play size={18} />
            运行
          </button>
          <button onClick={() => void exportProject("png")} title="导出 PNG">
            <Download size={18} />
            PNG
          </button>
          <button onClick={() => void exportProject("pdf")} title="导出 PDF">
            <Download size={18} />
            PDF
          </button>
          {billingEnabled && (
            <button onClick={() => { setWalletOpen(true); void refreshWallet(); }} title="积分充值">
              <CreditCard size={18} />
              {wallet?.balance ?? 0} 积分
            </button>
          )}
          <button onClick={() => setSettingsOpen(true)} title="设置">
            <Settings size={18} />
          </button>
          <button onClick={() => setInspectorOpen((open) => !open)} title={inspectorOpen ? "收起属性面板" : "展开属性面板"}>
            {inspectorOpen ? <PanelRightClose size={18} /> : <PanelRight size={18} />}
          </button>
          <button onClick={() => void logout()} title="退出登录">
            <UserCircle size={18} />
            {user.nickname}
          </button>
        </div>
      </header>

      <aside className={`sidebar ${sidebarOpen ? "" : "collapsed"}`}>
        <nav className="side-rail">
          <button className={sidebarOpen && tab === "templates" ? "active" : ""} onClick={() => { setTab("templates"); setSidebarOpen(true); }} title="添加">
            <Plus size={20} />
            <span>添加</span>
          </button>
          <button className={!sidebarOpen ? "active" : ""} onClick={() => setSidebarOpen(false)} title="选择">
            <MousePointer2 size={18} />
            <span>选择</span>
          </button>
          <button title="移动">
            <Hand size={18} />
            <span>移动</span>
          </button>
          <button title="便签">
            <StickyNote size={18} />
            <span>便签</span>
          </button>
          <div className="rail-divider" />
          <button className={sidebarOpen && tab === "assets" ? "active" : ""} onClick={() => { setTab("assets"); setSidebarOpen(true); }} title="素材">
            <Layers3 size={18} />
            <span>素材</span>
          </button>
          <button className={sidebarOpen && tab === "projects" ? "active" : ""} onClick={() => { setTab("projects"); setSidebarOpen(true); }} title="项目">
            <FolderOpen size={18} />
            <span>项目</span>
          </button>
          <button title="历史">
            <Clock3 size={18} />
            <span>历史</span>
          </button>
          <button title="帮助">
            <CircleHelp size={18} />
            <span>帮助</span>
          </button>
        </nav>

        {sidebarOpen && (
          <div className="sidebar-panel">
            {tab === "templates" && (
              <div className="panel-scroll">
                <section className="tool-section">
                  <h2>常用广告流程</h2>
                  <div className="workflow-list">
                    {workflowDefinitions.map((workflow) => (
                      <button key={workflow.id} onClick={() => addWorkflow(workflow.id)}>
                        <strong>{workflow.title}</strong>
                        <span>{workflow.description}</span>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="tool-section">
                  <h2>添加节点</h2>
                  <div className="resource-list">
                    {[
                      ["prompt", "文本", FileText],
                      ["image", "图片", FileImage],
                      ["ai-generate", "生成", Sparkles],
                      ["upscale", "放大", ImagePlus],
                      ["resize", "尺寸", Layers3],
                      ["background", "应用", Box],
                    ].map(([type, label, Icon]) => {
                      const NodeIcon = Icon as typeof FileText;
                      return (
                        <button key={String(type)} onClick={() => addNode(type as CanvasNode["type"])}>
                          <NodeIcon size={17} />
                          {String(label)}
                        </button>
                      );
                    })}
                  </div>
                </section>
                <section className="tool-section">
                  <h2>添加资源</h2>
                  <div className="resource-list">
                    <button onClick={importAssets}>
                      <ImagePlus size={17} />
                      从本地上传
                    </button>
                    <button onClick={() => setTab("assets")}>
                      <Layers3 size={17} />
                      从资产库选择
                    </button>
                  </div>
                </section>
                <TemplateGroup title="电商广告" templates={ecommerceTemplates} onAdd={addTemplate} />
                <TemplateGroup title="平面广告" templates={printTemplates} onAdd={addTemplate} />
              </div>
            )}

            {tab === "assets" && <AssetsPanel assets={assets} onImport={importAssets} onAddToCanvas={(asset) => void addAssetToCanvas(asset)} onDelete={(asset) => void deleteAsset(asset)} />}

            {tab === "projects" && (
              <div className="panel-scroll project-list">
            <div className="project-bulk-actions">
              <button
                onClick={() => setSelectedProjectIds(selectedProjectIds.length === projects.length ? [] : projects.map((item) => item.id))}
              >
                {selectedProjectIds.length === projects.length ? "取消全选" : "全选"}
              </button>
              <button onClick={() => void deleteSelectedProjects()} disabled={!selectedProjectIds.length}>
                删除选中
              </button>
            </div>
            {projects.map((item) => (
              <div key={item.id} className={item.id === project?.id ? "active project-item" : "project-item"}>
                <input
                  type="checkbox"
                  checked={selectedProjectIds.includes(item.id)}
                  onChange={(event) =>
                    setSelectedProjectIds((current) =>
                      event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id),
                    )
                  }
                  title="选择项目"
                />
                <button className="project-open" onClick={() => void openProject(item.id)} title={item.title}>
                  <strong>{item.title}</strong>
                  <span>{new Date(item.updatedAt).toLocaleString()}</span>
                </button>
                <button
                  className="project-delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteProject(item.id);
                  }}
                  title="删除项目"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
              </div>
            )}
          </div>
        )}
      </aside>

      {project && (
        <InfiniteCanvas
          project={project}
          assets={assets}
          models={modelOptions}
          billingEnabled={billingEnabled}
          walletBalance={billingEnabled ? wallet?.balance ?? 0 : Number.MAX_SAFE_INTEGER}
          selectedNodeId={selectedNodeId}
          onChange={setProject}
          onSelect={(nodeId) => {
            setSelectedNodeId(nodeId);
          }}
          onRunNode={(node) => void runAiNode(node)}
          onAddNodeAt={addNodeAt}
          onImportImageAt={(position, connection) => void importImageAt(position, connection)}
          onImportImageIntoNode={(nodeId) => void importImageIntoNode(nodeId)}
          onAddAssetToCanvas={(asset, position) => void addAssetToCanvas(asset, position)}
          onDeleteAsset={(asset) => void deleteAsset(asset)}
          onSaveAssetAs={(asset) => void saveAssetAs(asset)}
          onRenameAsset={(asset, name) => void renameAsset(asset, name)}
        />
      )}

      <aside className={`inspector ${inspectorOpen ? "" : "collapsed"}`}>
        <div className="inspector-title">
          <PanelRight size={18} />
          属性
        </div>
        <Inspector node={selectedNode} models={modelOptions} onChange={updateNode} />
      </aside>

      <footer className="statusbar">{status}</footer>

      {settings && (
        <SettingsModal
          open={settingsOpen}
          settings={settings}
          models={modelOptions}
          onClose={() => setSettingsOpen(false)}
          onSave={async (next) => {
            const saved = await window.zhihui.settings.set(next);
            setSettings(saved);
            setSettingsOpen(false);
            setStatus("设置已保存");
          }}
        />
      )}

      {billingEnabled && (
        <WalletModal
          open={walletOpen}
          wallet={wallet}
          ledger={ledger}
          onClose={() => setWalletOpen(false)}
          onRedeem={async (code) => {
            const result = await window.zhihui.billing.redeem(code);
            await refreshWallet();
            setStatus(`充值成功：到账 ${result.points} 积分`);
            return result;
          }}
        />
      )}
    </div>
  );
}

function AuthScreen({
  mode,
  form,
  error,
  onModeChange,
  onFormChange,
  onSubmit,
}: {
  mode: "login" | "register";
  form: { nickname: string; password: string };
  error: string;
  onModeChange: (mode: "login" | "register") => void;
  onFormChange: (form: { nickname: string; password: string }) => void;
  onSubmit: () => void;
}) {
  const set = (key: keyof typeof form, value: string) => onFormChange({ ...form, [key]: value });
  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <div className="brand auth-brand">
          <div className="brand-mark">郅</div>
          <div>
            <h1>郅绘ai画布</h1>
            <p>{mode === "register" ? "创建本地账号" : "登录本地账号"}</p>
          </div>
        </div>
        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => onModeChange("login")}>登录</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => onModeChange("register")}>注册</button>
        </div>
        <p className="auth-note">本地账号用于保存项目和登录记忆，TokenFlux API Key 请在进入软件后的设置中配置。</p>
        <div className="auth-form">
          <label>
            昵称
            <input value={form.nickname} onChange={(event) => set("nickname", event.target.value)} placeholder="请输入昵称" />
          </label>
          <label>
            密码
            <input type="password" value={form.password} onChange={(event) => set("password", event.target.value)} placeholder="至少 6 位" />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="primary auth-submit" onClick={onSubmit}>{mode === "register" ? "注册并登录" : "登录"}</button>
        </div>
      </section>
    </main>
  );
}

function TemplateGroup({
  title,
  templates,
  onAdd,
}: {
  title: string;
  templates: typeof allTemplates;
  onAdd: (templateId: string) => void;
}) {
  return (
    <section className="tool-section">
      <h2>{title}</h2>
      <div className="template-list">
        {templates.map((template) => (
          <button key={template.id} onClick={() => onAdd(template.id)}>
            <strong>{template.title}</strong>
            <span>{template.category} / {template.aspectRatio}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

