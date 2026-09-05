import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import {
  X,
  ArrowLeftRight,
  Columns2,
  FilePenLine,
  FileText,
  Eye,
  Image,
  ImagePlus,
  Maximize2,
  MessageSquare,
  Palette,
  Play,
  RefreshCw,
  ScanSearch,
  Scissors,
  Sparkles,
  Text,
  Trash2,
  Video,
  Wand2,
  WandSparkles,
  Layers3,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { nanoid } from "nanoid";
import type { AssetRecord, CanvasEdge, CanvasNode, TokenFluxModel, ZhihuiProject } from "@/types/domain";
import { generationCost } from "@/services/billingRules";
import { toFileUrl } from "@/services/fileUrl";

type ContextNodePreset = { title: string; params?: Record<string, unknown> };
type ContextNodeItem = { key: string; type: CanvasNode["type"]; label: string; Icon: LucideIcon; preset: ContextNodePreset };
type ContextNodeGroup = { key: string; label: string; items: ContextNodeItem[] };

const contextNodeGroups: ContextNodeGroup[] = [
  {
    key: "basic",
    label: "基础控件",
    items: [
      { key: "smart-chat", type: "prompt", label: "智能对话", Icon: MessageSquare, preset: { title: "智能对话", params: { tool: "chat" } } },
      { key: "polish-prompt", type: "prompt", label: "美化提示", Icon: WandSparkles, preset: { title: "美化提示", params: { tool: "polish-prompt" } } },
      { key: "reverse-prompt", type: "prompt", label: "反推提示", Icon: ArrowLeftRight, preset: { title: "反推提示", params: { tool: "reverse-prompt" } } },
    ],
  },
  {
    key: "generation",
    label: "AI 图像生成",
    items: [
      { key: "image-generation", type: "ai-generate", label: "图片生成", Icon: Sparkles, preset: { title: "图片生成", params: { tool: "image-generation" } } },
      { key: "image-video", type: "ai-generate", label: "图生视频", Icon: Video, preset: { title: "图生视频", params: { tool: "image-video", unsupportedFeature: "video" } } },
    ],
  },
  {
    key: "processing",
    label: "图像处理",
    items: [
      { key: "restore-4k", type: "upscale", label: "4K修复", Icon: ImagePlus, preset: { title: "4K修复", params: { tool: "restore-4k", factor: 2, resolution: "4K", prompt: "高质量修复图片，恢复细节、纹理和清晰度，保持主体与构图不变" } } },
      { key: "upscale-8k", type: "upscale", label: "8K超分", Icon: Maximize2, preset: { title: "8K超分", params: { tool: "upscale-8k", factor: 4, resolution: "4K", prompt: "进行8K级超分辨率处理，保留真实细节，不改变主体和构图" } } },
      { key: "remove-background", type: "background", label: "AI抠图", Icon: Scissors, preset: { title: "AI抠图", params: { tool: "remove-background", prompt: "精准抠出主体，去除背景，保留边缘细节并输出透明感干净的主体图" } } },
      { key: "color-adjust", type: "background", label: "色彩调整", Icon: Palette, preset: { title: "色彩调整", params: { tool: "color-adjust", prompt: "在保留主体、构图和细节的前提下，按照用户补充要求进行专业色彩调整，优化曝光、白平衡、对比度、饱和度和色彩层次" } } },
      { key: "image-transform", type: "resize", label: "图像变换", Icon: RefreshCw, preset: { title: "图像变换", params: { tool: "image-transform", prompt: "根据用户补充要求对参考图进行图像变换，保持主体身份和重要细节不变" } } },
      { key: "long-image", type: "resize", label: "长图合成", Icon: Layers3, preset: { title: "长图合成", params: { tool: "long-image", ratio: "9:21", prompt: "将接入的多张参考图按照统一视觉风格、清晰层级和连续阅读顺序合成为一张完整长图" } } },
      { key: "text-note", type: "prompt", label: "文本备注", Icon: FilePenLine, preset: { title: "文本备注", params: { tool: "text-note" } } },
    ],
  },
];

const contextInputItems: ContextNodeItem[] = [
  { key: "text-input", type: "prompt", label: "文本输入", Icon: Text, preset: { title: "文本输入" } },
  { key: "image-input", type: "image", label: "图片输入", Icon: Image, preset: { title: "图片输入" } },
];

const ratioOptions = ["16:9", "9:16", "4:3", "3:4", "2:3", "3:2", "1:1", "21:9", "9:21", "9:20", "20:9", "auto", "custom"];
const resolutionOptions = ["1K", "2K", "4K"] as const;

function ratioToSize(ratio: string, resolution = "1K") {
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
  if (!widthRatio || !heightRatio) return `${longEdge}x${longEdge}`;
  if (widthRatio >= heightRatio) return `${longEdge}x${Math.round((longEdge * heightRatio) / widthRatio)}`;
  return `${Math.round((longEdge * widthRatio) / heightRatio)}x${longEdge}`;
}

const imageModelOptions = [{ value: "gpt-image-2", label: "GPT Image 2" }];
const inferenceModelOptions = ["GPT-5.5", "GPT-5.4"];
type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type ImageViewerState = { asset: AssetRecord; scale: number; x: number; y: number };
type ConnectionDraft = { sourceNode: string; sourcePort: string };
type ImageDimension = { width: number; height: number };

function displayNodeTitle(title: string) {
  return title.endsWith("节点") ? title : `${title}节点`;
}

interface InfiniteCanvasProps {
  project: ZhihuiProject;
  assets: AssetRecord[];
  models: TokenFluxModel[];
  billingEnabled: boolean;
  walletBalance: number;
  selectedNodeId?: string;
  onChange: (project: ZhihuiProject) => void;
  onSelect: (nodeId?: string) => void;
  onRunNode: (node: CanvasNode) => void;
  onAddNodeAt: (type: CanvasNode["type"], position: { x: number; y: number }, connection?: ConnectionDraft, preset?: ContextNodePreset) => void;
  onImportImageAt: (position: { x: number; y: number }, connection?: ConnectionDraft) => void;
  onImportImageIntoNode: (nodeId: string) => void;
  onAddAssetToCanvas: (asset: AssetRecord, position?: { x: number; y: number }) => void;
  onDeleteAsset: (asset: AssetRecord) => void;
  onSaveAssetAs: (asset: AssetRecord) => void;
  onRenameAsset: (asset: AssetRecord, name: string) => void;
}

export function InfiniteCanvas({
  project,
  assets,
  models,
  billingEnabled,
  walletBalance,
  selectedNodeId,
  onChange,
  onSelect,
  onRunNode,
  onAddNodeAt,
  onImportImageAt,
  onImportImageIntoNode,
  onAddAssetToCanvas,
  onDeleteAsset,
  onSaveAssetAs,
  onRenameAsset,
}: InfiniteCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ screenX: number; screenY: number; worldX: number; worldY: number; connection?: ConnectionDraft }>();
  const [contextSubmenu, setContextSubmenu] = useState<string>();
  const [imageMenu, setImageMenu] = useState<{ screenX: number; screenY: number; worldX: number; worldY: number; asset: AssetRecord }>();
  const [connecting, setConnecting] = useState<{ sourceNode: string; sourcePort: string; x: number; y: number }>();
  const [viewer, setViewer] = useState<ImageViewerState>();
  const [imageDimensions, setImageDimensions] = useState<Record<string, ImageDimension>>({});
  const [viewerDrag, setViewerDrag] = useState<{ startX: number; startY: number; originX: number; originY: number }>();
  const [drag, setDrag] = useState<
    | { mode: "pan"; startX: number; startY: number; originX: number; originY: number }
    | { mode: "node"; nodeId: string; startX: number; startY: number; originX: number; originY: number }
    | {
        mode: "resize";
        nodeId: string;
        direction: ResizeDirection;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
        originWidth: number;
        originHeight: number;
      }
  >();

  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  function assetDimension(asset?: AssetRecord): ImageDimension | undefined {
    if (!asset) return undefined;
    const cached = imageDimensions[asset.id];
    if (cached) return cached;
    const width = Number(asset.metadata?.width ?? asset.metadata?.imageWidth);
    const height = Number(asset.metadata?.height ?? asset.metadata?.imageHeight);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }

  function fitNodeToImage(node: CanvasNode, asset: AssetRecord, dimension: ImageDimension) {
    if (!dimension.width || !dimension.height || !["image", "ai-generate", "background", "upscale", "resize", "preview"].includes(node.type)) return;
    setImageDimensions((current) => {
      const previous = current[asset.id];
      if (previous?.width === dimension.width && previous.height === dimension.height) return current;
      return { ...current, [asset.id]: dimension };
    });
    const currentWidth = getVisualNodeSize(node).width;
    const imageHeight = currentWidth * (dimension.height / dimension.width);
    const nextHeight = Math.round(Math.min(760, Math.max(130, imageHeight + 44)));
    const knownWidth = Number(node.params.imageWidth);
    const knownHeight = Number(node.params.imageHeight);
    if (knownWidth === dimension.width && knownHeight === dimension.height && Math.abs(node.size.height - nextHeight) < 3) return;
    updateNode({
      ...node,
      size: { width: currentWidth, height: nextHeight },
      params: { ...node.params, imageWidth: dimension.width, imageHeight: dimension.height },
    });
  }

  function toWorld(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return {
      screenX: clientX - left,
      screenY: clientY - top,
      worldX: (clientX - left - project.graph.viewport.x) / project.graph.viewport.zoom,
      worldY: (clientY - top - project.graph.viewport.y) / project.graph.viewport.zoom,
    };
  }

  function updateViewport(viewport: ZhihuiProject["graph"]["viewport"]) {
    onChange({ ...project, graph: { ...project.graph, viewport } });
  }

  function setViewportZoom(zoom: number) {
    updateViewport({ ...project.graph.viewport, zoom: Number(Math.min(2.4, Math.max(0.18, zoom)).toFixed(2)) });
  }

  function updateNode(node: CanvasNode) {
    onChange({
      ...project,
      graph: {
        ...project.graph,
        nodes: project.graph.nodes.map((item) => (item.id === node.id ? node : item)),
      },
    });
  }

  function deleteNode(nodeId: string) {
    onChange({
      ...project,
      graph: {
        ...project.graph,
        nodes: project.graph.nodes.filter((node) => node.id !== nodeId),
        edges: project.graph.edges.filter((edge) => edge.sourceNode !== nodeId && edge.targetNode !== nodeId),
      },
    });
    onSelect(undefined);
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedNodeId || !["Delete", "Backspace"].includes(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      deleteNode(selectedNodeId);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodeId, project]);

  function createEdge(targetNode: string, targetPort: string) {
    if (!connecting || connecting.sourceNode === targetNode) {
      setConnecting(undefined);
      return;
    }
    const nextEdge: CanvasEdge = {
      id: nanoid(),
      sourceNode: connecting.sourceNode,
      sourcePort: connecting.sourcePort,
      targetNode,
      targetPort,
    };
    const existing = project.graph.edges.some(
      (edge) =>
        edge.sourceNode === nextEdge.sourceNode &&
        edge.sourcePort === nextEdge.sourcePort &&
        edge.targetNode === nextEdge.targetNode &&
        edge.targetPort === nextEdge.targetPort,
    );
    onChange({
      ...project,
      graph: {
        ...project.graph,
        edges: existing ? project.graph.edges : [...project.graph.edges, nextEdge],
      },
    });
    setConnecting(undefined);
  }

  function pickTargetPort(node: CanvasNode, sourcePort?: string) {
    if (sourcePort && node.inputs.includes(sourcePort)) return sourcePort;
    if (sourcePort === "prompt" && node.inputs.includes("prompt")) return "prompt";
    if (sourcePort === "image" && node.inputs.includes("image")) return "image";
    if (node.inputs.includes("input")) return "input";
    return node.inputs[0] ?? "input";
  }

  function completeEdgeAtPoint(clientX: number, clientY: number) {
    if (!connecting) return;
    const point = toWorld(clientX, clientY);
    const draft: ConnectionDraft = { sourceNode: connecting.sourceNode, sourcePort: connecting.sourcePort };
    const target = project.graph.nodes
      .slice()
      .reverse()
      .find((node) => {
        if (node.id === connecting.sourceNode) return false;
        const size = getVisualNodeSize(node);
        return point.worldX >= node.position.x && point.worldX <= node.position.x + size.width && point.worldY >= node.position.y && point.worldY <= node.position.y + size.height;
      });
    if (target) createEdge(target.id, pickTargetPort(target, connecting.sourcePort));
    else {
      setContextMenu({ ...point, connection: draft });
      setConnecting(undefined);
    }
  }

  function portPoint(node: CanvasNode, side: "input" | "output", portName?: string) {
    const size = getVisualNodeSize(node);
    const ports = side === "output" ? node.outputs : node.inputs;
    const index = Math.max(0, portName ? ports.indexOf(portName) : 0);
    const count = Math.max(1, ports.length);
    const y = count === 1 ? size.height / 2 : ((index + 1) / (count + 1)) * size.height;
    return {
      x: node.position.x + (side === "output" ? size.width : 0),
      y: node.position.y + y,
    };
  }

  function firstIncomingImageAsset(nodeId: string) {
    const incoming = project.graph.edges.filter((edge) => edge.targetNode === nodeId);
    for (const edge of incoming) {
      const source = project.graph.nodes.find((node) => node.id === edge.sourceNode);
      if (!source) continue;
      const assetId = source.resultAssetIds.at(-1) ?? String(source.params.assetId ?? "");
      const asset = assetsById.get(assetId);
      if (asset?.type === "image") return asset;
    }
    return undefined;
  }

  function uniqueAssetIds(values: string[]) {
    return [...new Set(values.filter(Boolean))];
  }

  function nodeAssetIds(node: CanvasNode) {
    const directAsset = typeof node.params.assetId === "string" ? [node.params.assetId] : [];
    return uniqueAssetIds([...directAsset, ...node.resultAssetIds]);
  }

  function incomingImageAssets(nodeId: string) {
    return imageAssetsFromIds(collectUpstreamAssetIds(nodeId));
  }

  function collectUpstreamAssetIds(nodeId: string, visited = new Set<string>()): string[] {
    if (visited.has(nodeId)) return [];
    visited.add(nodeId);
    const assetIds: string[] = [];
    for (const edge of project.graph.edges.filter((item) => item.targetNode === nodeId)) {
      const source = project.graph.nodes.find((node) => node.id === edge.sourceNode);
      if (!source) continue;
      assetIds.push(...collectUpstreamAssetIds(source.id, visited));
      assetIds.push(...nodeAssetIds(source));
    }
    return uniqueAssetIds(assetIds);
  }

  function imageAssetsFromIds(assetIds: string[]) {
    return assetIds
      .map((assetId) => assetsById.get(assetId))
      .filter((asset): asset is AssetRecord => asset?.type === "image");
  }

  function collectUpstreamImageFlow(nodeId: string, visited = new Set<string>()): { sourceAssetIds: string[]; generatedAssetIds: string[]; running: boolean } {
    if (visited.has(nodeId)) return { sourceAssetIds: [], generatedAssetIds: [], running: false };
    visited.add(nodeId);
    const sourceAssetIds: string[] = [];
    const generatedAssetIds: string[] = [];
    let running = false;
    for (const edge of project.graph.edges.filter((item) => item.targetNode === nodeId)) {
      const source = project.graph.nodes.find((node) => node.id === edge.sourceNode);
      if (!source) continue;
      running ||= source.status === "running";
      const upstream = collectUpstreamImageFlow(source.id, visited);
      running ||= upstream.running;
      sourceAssetIds.push(...upstream.sourceAssetIds);
      generatedAssetIds.push(...upstream.generatedAssetIds);
      for (const assetId of nodeAssetIds(source)) {
        const asset = assetsById.get(assetId);
        if (!asset || asset.type !== "image") continue;
        if (source.type === "image" && !asset.sourceNodeId) sourceAssetIds.push(assetId);
        else generatedAssetIds.push(assetId);
      }
    }
    return {
      sourceAssetIds: uniqueAssetIds(sourceAssetIds),
      generatedAssetIds: uniqueAssetIds(generatedAssetIds),
      running,
    };
  }

  function handleCanvasPointerMove(event: PointerEvent<HTMLElement>) {
    if (connecting) {
      const point = toWorld(event.clientX, event.clientY);
      setConnecting((current) => (current ? { ...current, x: point.worldX, y: point.worldY } : current));
    }
  }

  useEffect(() => {
    if (!drag) return;
    const handlePointerMove = (event: globalThis.PointerEvent) => {
    if (drag.mode === "pan") {
      updateViewport({
        ...project.graph.viewport,
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY,
      });
    } else if (drag.mode === "node") {
      const node = project.graph.nodes.find((item) => item.id === drag.nodeId);
      if (!node || node.locked) return;
      updateNode({
        ...node,
        position: {
          x: drag.originX + (event.clientX - drag.startX) / project.graph.viewport.zoom,
          y: drag.originY + (event.clientY - drag.startY) / project.graph.viewport.zoom,
        },
      });
    } else {
      const node = project.graph.nodes.find((item) => item.id === drag.nodeId);
      if (!node || node.locked) return;
      const minSize = getMinimumNodeSize(node);
      const deltaX = (event.clientX - drag.startX) / project.graph.viewport.zoom;
      const deltaY = (event.clientY - drag.startY) / project.graph.viewport.zoom;
      const growsEast = drag.direction.includes("e");
      const growsWest = drag.direction.includes("w");
      const growsSouth = drag.direction.includes("s");
      const growsNorth = drag.direction.includes("n");
      const nextWidth = Math.max(minSize.width, drag.originWidth + (growsEast ? deltaX : 0) - (growsWest ? deltaX : 0));
      const nextHeight = Math.max(minSize.height, drag.originHeight + (growsSouth ? deltaY : 0) - (growsNorth ? deltaY : 0));
      updateNode({
        ...node,
        position: {
          x: growsWest ? drag.originX + drag.originWidth - nextWidth : drag.originX,
          y: growsNorth ? drag.originY + drag.originHeight - nextHeight : drag.originY,
        },
        size: { width: Math.round(nextWidth), height: Math.round(nextHeight) },
      });
    }
    };
    const handlePointerUp = () => setDrag(undefined);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [drag, project]);

  useEffect(() => {
    if (!viewer) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewer(undefined);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewer]);

  useEffect(() => {
    if (!viewerDrag) return;
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      setViewer((current) =>
        current
          ? { ...current, x: viewerDrag.originX + event.clientX - viewerDrag.startX, y: viewerDrag.originY + event.clientY - viewerDrag.startY }
          : current,
      );
    };
    const handlePointerUp = () => setViewerDrag(undefined);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [viewerDrag]);

  const openViewer = (asset: AssetRecord) => {
    setViewerDrag(undefined);
    setViewer({ asset, scale: 1, x: 0, y: 0 });
  };

  return (
    <main
      ref={canvasRef}
      className={`canvas-viewport canvas-bg-${project.graph.background ?? "gradient"}`}
      onContextMenu={(event) => {
        event.preventDefault();
        setImageMenu(undefined);
        setContextSubmenu(undefined);
        setContextMenu(toWorld(event.clientX, event.clientY));
      }}
      onWheel={(event) => {
        event.preventDefault();
        setContextMenu(undefined);
        setContextSubmenu(undefined);
        setImageMenu(undefined);
        const nextZoom = Math.min(2.4, Math.max(0.18, project.graph.viewport.zoom - event.deltaY * 0.001));
        updateViewport({ ...project.graph.viewport, zoom: Number(nextZoom.toFixed(2)) });
      }}
      onPointerDown={(event) => {
        setContextMenu(undefined);
        setImageMenu(undefined);
        if (event.button === 1) {
          event.preventDefault();
          setDrag({
            mode: "pan",
            startX: event.clientX,
            startY: event.clientY,
            originX: project.graph.viewport.x,
            originY: project.graph.viewport.y,
          });
          return;
        }
        if (event.target !== event.currentTarget) return;
        onSelect(undefined);
        setDrag({
          mode: "pan",
          startX: event.clientX,
          startY: event.clientY,
          originX: project.graph.viewport.x,
          originY: project.graph.viewport.y,
        });
      }}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={(event) => {
        setDrag(undefined);
        completeEdgeAtPoint(event.clientX, event.clientY);
      }}
      onPointerLeave={() => {
        setDrag(undefined);
        setConnecting(undefined);
      }}
    >
      <div className="canvas-grid" />
      <div
        className="canvas-world"
        style={{
          transform: `translate(${project.graph.viewport.x}px, ${project.graph.viewport.y}px) scale(${project.graph.viewport.zoom})`,
        }}
      >
        <svg className="edge-layer">
          {project.graph.edges.map((edge) => {
            const source = project.graph.nodes.find((node) => node.id === edge.sourceNode);
            const target = project.graph.nodes.find((node) => node.id === edge.targetNode);
            if (!source || !target) return null;
            const start = portPoint(source, "output", edge.sourcePort);
            const end = portPoint(target, "input", edge.targetPort);
            const running = source.status === "running" || target.status === "running";
            return (
              <path
                key={edge.id}
                className={running ? "edge-running" : undefined}
                d={`M ${start.x} ${start.y} C ${start.x + 110} ${start.y}, ${end.x - 110} ${end.y}, ${end.x} ${end.y}`}
              />
            );
          })}
          {connecting && (
            <path
              className="edge-preview"
              d={`M ${portPoint(project.graph.nodes.find((node) => node.id === connecting.sourceNode)!, "output", connecting.sourcePort).x} ${
                portPoint(project.graph.nodes.find((node) => node.id === connecting.sourceNode)!, "output", connecting.sourcePort).y
              } C ${connecting.x - 120} ${connecting.y}, ${connecting.x - 80} ${connecting.y}, ${connecting.x} ${connecting.y}`}
            />
          )}
        </svg>
        {project.graph.nodes
          .slice()
          .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
          .map((node) => {
            const imageFlow = node.type === "preview" || node.type === "compare" ? collectUpstreamImageFlow(node.id) : undefined;
            const visibleAssetIds = imageFlow
              ? uniqueAssetIds([...imageFlow.generatedAssetIds, ...node.resultAssetIds.filter((assetId) => !imageFlow.sourceAssetIds.includes(assetId))])
              : nodeAssetIds(node);
            const visibleImages = imageAssetsFromIds(visibleAssetIds);
            const sourceImages = imageFlow ? imageAssetsFromIds(imageFlow.sourceAssetIds) : [];
            const overviewAsset = visibleImages.find((asset) => asset.metadata?.role === "overview");
            const individualImages = visibleImages.filter((asset) => asset.metadata?.role !== "overview");
            const resultAsset = individualImages.at(-1) ?? (node.type === "preview" || node.type === "compare" ? undefined : assetsById.get(node.resultAssetIds.at(-1) ?? String(node.params.assetId ?? "")));
            const sourceAsset = node.type === "compare"
              ? sourceImages[0] ?? firstIncomingImageAsset(node.id)
              : firstIncomingImageAsset(node.id);
            const referenceAssets = ["prompt", "image", "preview", "compare"].includes(node.type)
              ? []
              : incomingImageAssets(node.id);
            const headerDimension = assetDimension(resultAsset ?? sourceAsset);
            return (
              <NodeCard
                key={node.id}
                node={node}
                models={models}
                billingEnabled={billingEnabled}
                walletBalance={walletBalance}
                resultAsset={resultAsset}
                resultAssets={individualImages}
                overviewAsset={overviewAsset}
                sourceAsset={sourceAsset}
                referenceAssets={referenceAssets}
                imageDimension={headerDimension}
                progress={Number(node.params.progress ?? 0)}
                progressStartedAt={Number(node.params.progressStartedAt ?? 0)}
                waitingForResult={Boolean(imageFlow?.running || ((node.type === "preview" || node.type === "compare") && sourceImages.length && !resultAsset))}
                selected={node.id === selectedNodeId}
                onSelect={() => onSelect(node.id)}
                onRun={() => onRunNode(node)}
                onUpdate={updateNode}
                onImportImage={() => onImportImageIntoNode(node.id)}
                onOpenImage={openViewer}
                onImageLoad={(asset, dimension) => fitNodeToImage(node, asset, dimension)}
                onImageContextMenu={(asset, event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const point = toWorld(event.clientX, event.clientY);
                  setContextMenu(undefined);
                  setImageMenu({ ...point, asset });
                }}
                onRenameAsset={onRenameAsset}
                onStartConnect={(sourcePort, event) => {
                  event.stopPropagation();
                  const point = toWorld(event.clientX, event.clientY);
                  setContextMenu(undefined);
                  setConnecting({ sourceNode: node.id, sourcePort, x: point.worldX, y: point.worldY });
                }}
                onCompleteConnect={(targetPort, event) => {
                  event.stopPropagation();
                  createEdge(node.id, targetPort);
                }}
                onPointerDown={(event) => {
                  const target = event.target as HTMLElement;
                if (event.button === 1) {
                  event.preventDefault();
                  event.stopPropagation();
                  setContextMenu(undefined);
                  setDrag({
                    mode: "pan",
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: project.graph.viewport.x,
                    originY: project.graph.viewport.y,
                  });
                  return;
                }
                if (target.closest(".node-control, .node-actions, .node-port, .node-resize-handle")) return;
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                onSelect(node.id);
                  setDrag({
                    mode: "node",
                    nodeId: node.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: node.position.x,
                    originY: node.position.y,
                  });
                }}
                onStartResize={(direction, event) => {
                  event.stopPropagation();
                  const visualSize = getVisualNodeSize(node);
                  onSelect(node.id);
                  setDrag({
                    mode: "resize",
                    nodeId: node.id,
                    direction,
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: node.position.x,
                    originY: node.position.y,
                    originWidth: visualSize.width,
                    originHeight: visualSize.height,
                  });
                }}
              />
            );
          })}
      </div>
      <div className="canvas-hud">
        <Palette size={15} />
        <select
          className="canvas-background-select"
          value={project.graph.background ?? "gradient"}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => {
            const background = event.target.value as NonNullable<ZhihuiProject["graph"]["background"]>;
            onChange({ ...project, graph: { ...project.graph, background } });
          }}
          title="画布背景"
          aria-label="画布背景"
        >
          <option value="gradient">渐变色</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
        <Maximize2 size={15} />
        <input
          type="range"
          min={18}
          max={240}
          value={Math.round(project.graph.viewport.zoom * 100)}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => setViewportZoom(Number(event.target.value) / 100)}
          title="缩放画布"
        />
        <span>{Math.round(project.graph.viewport.zoom * 100)}%</span>
      </div>
      {contextMenu && (
        <>
          <div
            className="canvas-context-menu node-context-menu"
            style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="context-menu-title">添加连接节点</div>
            <div className="context-menu-section">输入节点</div>
            {contextInputItems.map((item) => (
              <ContextMenuAction
                key={item.key}
                item={item}
                onClick={() => {
                  onAddNodeAt(item.type, { x: contextMenu.worldX, y: contextMenu.worldY }, contextMenu.connection, item.preset);
                  setContextMenu(undefined);
                  setContextSubmenu(undefined);
                }}
              />
            ))}
            <div className="context-menu-divider" />
            {contextNodeGroups.map((group) => (
              <button
                key={group.key}
                className={`context-menu-group ${contextSubmenu === group.key ? "active" : ""}`}
                onMouseEnter={() => setContextSubmenu(group.key)}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setContextSubmenu((current) => (current === group.key ? undefined : group.key));
                }}
              >
                <span>{group.label}</span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
          {contextSubmenu && (() => {
            const groupIndex = contextNodeGroups.findIndex((group) => group.key === contextSubmenu);
            const group = contextNodeGroups[groupIndex];
            if (!group) return null;
            return (
              <div
                className="canvas-context-menu context-submenu"
                style={{ left: contextMenu.screenX + 178, top: contextMenu.screenY + 145 + groupIndex * 38 }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {group.items.map((item) => (
                  <ContextMenuAction
                    key={item.key}
                    item={item}
                    onClick={() => {
                      onAddNodeAt(item.type, { x: contextMenu.worldX, y: contextMenu.worldY }, contextMenu.connection, item.preset);
                      setContextMenu(undefined);
                      setContextSubmenu(undefined);
                    }}
                  />
                ))}
              </div>
            );
          })()}
        </>
      )}
      {imageMenu && (
        <div
          className="canvas-context-menu image-context-menu"
          style={{ left: imageMenu.screenX, top: imageMenu.screenY }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSaveAssetAs(imageMenu.asset);
              setImageMenu(undefined);
            }}
          >
            <ImagePlus size={15} />
            下载图片
          </button>
          <button
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAddAssetToCanvas(imageMenu.asset, { x: imageMenu.worldX, y: imageMenu.worldY });
              setImageMenu(undefined);
            }}
          >
            <Image size={15} />
            加入画布
          </button>
          <button
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDeleteAsset(imageMenu.asset);
              setImageMenu(undefined);
            }}
          >
            <Trash2 size={15} />
            删除素材
          </button>
        </div>
      )}
      {viewer && (
        <ImageViewer
          viewer={viewer}
          onClose={() => setViewer(undefined)}
          onChange={setViewer}
          onStartDrag={(event) => {
            event.stopPropagation();
            setViewerDrag({ startX: event.clientX, startY: event.clientY, originX: viewer.x, originY: viewer.y });
          }}
        />
      )}
    </main>
  );
}

function ContextMenuAction({ item, onClick }: { item: ContextNodeItem; onClick: () => void }) {
  const Icon = item.Icon;
  return (
    <button
      className="context-menu-action"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      <Icon size={15} />
      <span>{item.label}</span>
    </button>
  );
}

function NodeCard({
  node,
  models,
  billingEnabled,
  walletBalance,
  resultAsset,
  resultAssets,
  overviewAsset,
  sourceAsset,
  referenceAssets,
  imageDimension,
  progress,
  progressStartedAt,
  waitingForResult,
  selected,
  onSelect,
  onRun,
  onUpdate,
  onImportImage,
  onStartConnect,
  onCompleteConnect,
  onPointerDown,
  onStartResize,
  onOpenImage,
  onImageLoad,
  onImageContextMenu,
  onRenameAsset,
}: {
  node: CanvasNode;
  models: TokenFluxModel[];
  billingEnabled: boolean;
  walletBalance: number;
  resultAsset?: AssetRecord;
  resultAssets?: AssetRecord[];
  overviewAsset?: AssetRecord;
  sourceAsset?: AssetRecord;
  referenceAssets?: AssetRecord[];
  imageDimension?: ImageDimension;
  progress?: number;
  progressStartedAt?: number;
  waitingForResult?: boolean;
  selected: boolean;
  onSelect: () => void;
  onRun: () => void;
  onUpdate: (node: CanvasNode) => void;
  onImportImage: () => void;
  onStartConnect: (sourcePort: string, event: PointerEvent<HTMLButtonElement>) => void;
  onCompleteConnect: (targetPort: string, event: PointerEvent<HTMLButtonElement>) => void;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onStartResize: (direction: ResizeDirection, event: PointerEvent<HTMLButtonElement>) => void;
  onOpenImage: (asset: AssetRecord) => void;
  onImageLoad: (asset: AssetRecord, dimension: ImageDimension) => void;
  onImageContextMenu: (asset: AssetRecord, event: MouseEvent<HTMLElement>) => void;
  onRenameAsset: (asset: AssetRecord, name: string) => void;
}) {
  const prompt = typeof node.params.prompt === "string" ? node.params.prompt : "";
  const ratio = String(node.params.ratio ?? sizeToRatio(String(node.params.size ?? "1024x1024")));
  const resolution = String(node.params.resolution ?? "1K");
  const visualSize = getVisualNodeSize(node);
  const inputPorts = node.inputs.length ? node.inputs : ["input"];
  const outputPorts = node.outputs.length ? node.outputs : ["output"];
  const isPromptNode = node.type === "prompt";
  const isViewOnlyNode = node.type === "preview" || node.type === "compare";
  const isUploadNode = node.type === "image";
  const showFloatingControls = selected && !isViewOnlyNode;
  const connectedReferenceAssets = (referenceAssets ?? []).filter((asset) => asset.type === "image");

  const setParam = (key: string, value: unknown) => onUpdate({ ...node, params: { ...node.params, [key]: value } });
  const sizeParts = String(node.params.size ?? "1024x1024").match(/^(\d+)x(\d+)$/);
  const customWidth = Math.max(64, Number(node.params.width) || Number(sizeParts?.[1]) || 1024);
  const customHeight = Math.max(64, Number(node.params.height) || Number(sizeParts?.[2]) || 1024);
  const setCustomSize = (width: number, height: number) => {
    const nextWidth = Math.min(8192, Math.max(64, Math.round(width) || customWidth));
    const nextHeight = Math.min(8192, Math.max(64, Math.round(height) || customHeight));
    onUpdate({
      ...node,
      params: {
        ...node.params,
        ratio: "custom",
        width: nextWidth,
        height: nextHeight,
        size: `${nextWidth}x${nextHeight}`,
      },
    });
  };
  const setRatio = (nextRatio: string) =>
    nextRatio === "custom"
      ? setCustomSize(customWidth, customHeight)
      : onUpdate({
          ...node,
          params: {
            ...node.params,
            ratio: nextRatio,
            size: ratioToSize(nextRatio, resolution),
          },
        });
  const setResolution = (nextResolution: string) =>
    onUpdate({
      ...node,
      params: {
        ...node.params,
        resolution: nextResolution,
        size: ratio === "custom" ? `${customWidth}x${customHeight}` : ratioToSize(ratio, nextResolution),
      },
    });
  const stopControlPointer = (event: PointerEvent<HTMLElement>) => event.stopPropagation();
  const portTop = (index: number, count: number) => (count === 1 ? "50%" : `${Math.round(((index + 1) / (count + 1)) * 100)}%`);

  return (
    <article
      className={`canvas-node ${selected ? "selected" : ""} ${node.status}`}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: visualSize.width,
        height: visualSize.height,
      }}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {inputPorts.map((port, index) => (
        <button
          key={port}
          className="node-port node-port-in"
          style={{ top: `calc(${portTop(index, inputPorts.length)} - 8px)` }}
          title={`输入：${port}`}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => onCompleteConnect(port, event)}
        />
      ))}
      {outputPorts.map((port, index) => (
        <button
          key={port}
          className="node-port node-port-out"
          style={{ top: `calc(${portTop(index, outputPorts.length)} - 8px)` }}
          title={`输出：${port}`}
          onPointerDown={(event) => onStartConnect(port, event)}
        />
      ))}

      <header className="node-dragbar">
        <strong>
          {isPromptNode ? <FileText size={15} /> : <Image size={15} />}
          {displayNodeTitle(node.title)}
        </strong>
        {isUploadNode && (
          <button
            className="node-header-action node-control"
            onPointerDown={stopControlPointer}
            onClick={(event) => {
              event.stopPropagation();
              onImportImage();
            }}
            title={resultAsset ? "替换图片" : "上传图片"}
          >
            <ImagePlus size={13} />
            {resultAsset ? "替换图片" : "上传图片"}
          </button>
        )}
        <span>{imageDimension ? `${imageDimension.width} x ${imageDimension.height}` : ""}</span>
      </header>

      {isPromptNode ? (
        <textarea
          className="node-control workbench-prompt prompt-only"
          value={prompt}
          onPointerDown={stopControlPointer}
          onChange={(event) => setParam("prompt", event.target.value)}
          placeholder="输入提示词，点击运行后会直接开始生图"
        />
      ) : isUploadNode ? (
        <ImageUploadPanel resultAsset={resultAsset} resultAssets={resultAssets} onImportImage={onImportImage} onPointerDown={stopControlPointer} onOpenImage={onOpenImage} onImageLoad={onImageLoad} onImageContextMenu={onImageContextMenu} />
      ) : isViewOnlyNode ? (
        <PreviewPanel nodeType={node.type} resultAsset={resultAsset} resultAssets={resultAssets} overviewAsset={overviewAsset} sourceAsset={sourceAsset} progress={progress} progressStartedAt={progressStartedAt} running={node.status === "running"} waitingForResult={waitingForResult} onOpenImage={onOpenImage} onImageLoad={onImageLoad} onImageContextMenu={onImageContextMenu} />
      ) : (
        <PreviewPanel nodeType={node.type} resultAsset={resultAsset} resultAssets={resultAssets} overviewAsset={overviewAsset} sourceAsset={sourceAsset} progress={progress} progressStartedAt={progressStartedAt} running={node.status === "running"} waitingForResult={waitingForResult} onOpenImage={onOpenImage} onImageLoad={onImageLoad} onImageContextMenu={onImageContextMenu} />
      )}

      {showFloatingControls && (
        <div className="node-floating-editor node-control" onPointerDown={stopControlPointer}>
          {connectedReferenceAssets.length > 0 && (
            <ReferenceImageStrip
              assets={connectedReferenceAssets}
              onOpenImage={onOpenImage}
              onImageContextMenu={onImageContextMenu}
              onRenameAsset={onRenameAsset}
              onPointerDown={stopControlPointer}
            />
          )}
          {!isPromptNode && (
            <textarea
              className="floating-prompt"
              value={prompt}
              onChange={(event) => setParam("prompt", event.target.value)}
              placeholder={isUploadNode ? "描述想如何编辑这张图，例如：换成白底、增强质感、改成电商海报风格" : "描述处理需求，连接文本或图片节点后会自动合并输入"}
            />
          )}
          <MiniRunControls
            node={node}
            models={models}
            billingEnabled={billingEnabled}
            walletBalance={walletBalance}
            ratio={ratio}
            resolution={resolution}
            onPointerDown={stopControlPointer}
            onSetParam={setParam}
            onSetRatio={setRatio}
            onSetResolution={setResolution}
            onSetCustomSize={setCustomSize}
            onRun={onRun}
          />
          {typeof node.params.error === "string" && <p className="node-error">{node.params.error}</p>}
        </div>
      )}
      {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as ResizeDirection[]).map((direction) => (
        <button
          key={direction}
          className={`node-resize-handle resize-${direction}`}
          title="调整节点尺寸"
          onPointerDown={(event) => onStartResize(direction, event)}
        />
      ))}
    </article>
  );
}

function ReferenceImageStrip({
  assets,
  onOpenImage,
  onImageContextMenu,
  onRenameAsset,
  onPointerDown,
}: {
  assets: AssetRecord[];
  onOpenImage: (asset: AssetRecord) => void;
  onImageContextMenu: (asset: AssetRecord, event: MouseEvent<HTMLElement>) => void;
  onRenameAsset: (asset: AssetRecord, name: string) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}) {
  return (
    <section className="node-reference-strip node-control" onPointerDown={onPointerDown}>
      <div className="node-reference-heading">
        <span>参考图</span>
        <em>{assets.length} 张已接入</em>
      </div>
      <div className="node-reference-list">
        {assets.map((asset, index) => (
          <div className="node-reference-item" key={asset.id}>
            <button
              className="node-reference-chip"
              onClick={(event) => {
                event.stopPropagation();
                onOpenImage(asset);
              }}
              onContextMenu={(event) => onImageContextMenu(asset, event)}
              title={`点击查看参考图 ${index + 1}`}
            >
              <span className="node-reference-chip-index">图{index + 1}</span>
              <strong>参考图</strong>
              <img src={toFileUrl(asset.path)} alt="" draggable={false} />
            </button>
            <input
              className="node-reference-name"
              defaultValue={asset.name}
              title="点击编辑参考图名称"
              aria-label={`参考图 ${index + 1} 名称`}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              onBlur={(event) => {
                const nextName = event.currentTarget.value.trim();
                if (nextName && nextName !== asset.name) onRenameAsset(asset, nextName);
                else if (!nextName) event.currentTarget.value = asset.name;
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function ImageUploadPanel({
  resultAsset,
  resultAssets,
  onImportImage,
  onPointerDown,
  onOpenImage,
  onImageLoad,
  onImageContextMenu,
}: {
  resultAsset?: AssetRecord;
  resultAssets?: AssetRecord[];
  onImportImage: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onOpenImage: (asset: AssetRecord) => void;
  onImageLoad: (asset: AssetRecord, dimension: ImageDimension) => void;
  onImageContextMenu: (asset: AssetRecord, event: MouseEvent<HTMLElement>) => void;
}) {
  if (resultAsset?.type === "image") {
    const galleryAssets = (resultAssets ?? [resultAsset]).filter((asset) => asset.type === "image");
    return (
      <div className="image-node-panel node-control" onPointerDown={onPointerDown}>
        {galleryAssets.length > 1 ? (
          <ImageResultGallery assets={galleryAssets} onOpenImage={onOpenImage} onImageLoad={onImageLoad} onImageContextMenu={onImageContextMenu} />
        ) : (
          <button className="node-image-button" onClick={() => onOpenImage(resultAsset)} onContextMenu={(event) => onImageContextMenu(resultAsset, event)} title="点击放大查看">
            <img
              className="node-preview"
              src={toFileUrl(resultAsset.path)}
              alt={resultAsset.name}
              draggable={false}
              onLoad={(event) => onImageLoad(resultAsset, { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="workbench-preview upload-preview node-control" onPointerDown={onPointerDown}>
      <button
        className="upload-preview-button"
        onClick={(event) => {
          event.stopPropagation();
          onImportImage();
        }}
      >
        <ImagePlus size={30} />
        <strong>上传图片</strong>
        <span>上传后会显示在这里，可作为参考图连接到其他节点</span>
      </button>
    </div>
  );
}

function PreviewPanel({
  nodeType,
  resultAsset,
  resultAssets,
  overviewAsset,
  sourceAsset,
  progress,
  progressStartedAt,
  running,
  waitingForResult,
  onOpenImage,
  onImageLoad,
  onImageContextMenu,
}: {
  nodeType: CanvasNode["type"];
  resultAsset?: AssetRecord;
  resultAssets?: AssetRecord[];
  overviewAsset?: AssetRecord;
  sourceAsset?: AssetRecord;
  progress?: number;
  progressStartedAt?: number;
  running: boolean;
  waitingForResult?: boolean;
  onOpenImage: (asset: AssetRecord) => void;
  onImageLoad: (asset: AssetRecord, dimension: ImageDimension) => void;
  onImageContextMenu: (asset: AssetRecord, event: MouseEvent<HTMLElement>) => void;
}) {
  // Only the dedicated compare node renders both images. Generation and edit
  // nodes must show the latest result on its own so the output stays readable.
  if (nodeType === "compare" && sourceAsset?.type === "image" && resultAsset?.type === "image" && sourceAsset.id !== resultAsset.id) {
    return (
      <div className="node-preview-compare">
        <div>
          <span>原图</span>
          <button onClick={() => onOpenImage(sourceAsset)} onContextMenu={(event) => onImageContextMenu(sourceAsset, event)} title="点击放大查看">
            <img
              src={toFileUrl(sourceAsset.path)}
              alt={sourceAsset.name}
              draggable={false}
              onLoad={(event) => onImageLoad(sourceAsset, { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            />
          </button>
        </div>
        <div>
          <span>结果</span>
          <button onClick={() => onOpenImage(resultAsset)} onContextMenu={(event) => onImageContextMenu(resultAsset, event)} title="点击放大查看">
            <img
              src={toFileUrl(resultAsset.path)}
              alt={resultAsset.name}
              draggable={false}
              onLoad={(event) => onImageLoad(resultAsset, { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            />
          </button>
        </div>
      </div>
    );
  }

  if (resultAsset?.type === "image") {
    const galleryAssets = (resultAssets ?? [resultAsset]).filter((asset) => asset.type === "image");
    return (
      <div className="image-node-panel node-control">
        {galleryAssets.length > 1 ? (
          <ImageResultGallery assets={galleryAssets} overviewAsset={overviewAsset} onOpenImage={onOpenImage} onImageLoad={onImageLoad} onImageContextMenu={onImageContextMenu} />
        ) : (
          <button className="node-image-button" onClick={() => onOpenImage(resultAsset)} onContextMenu={(event) => onImageContextMenu(resultAsset, event)} title="点击放大查看">
            <img
              className="node-preview"
              src={toFileUrl(resultAsset.path)}
              alt={resultAsset.name}
              draggable={false}
              onLoad={(event) => onImageLoad(resultAsset, { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="workbench-preview">
      {running || waitingForResult ? (
        <GenerationProgress progress={progress} startedAt={progressStartedAt} />
      ) : (
        <div className="preview-empty">
          {nodeType === "compare" ? <Columns2 size={28} /> : <Sparkles size={28} />}
          <span>{nodeType === "compare" ? "连接原图和结果图后显示对比" : "生成结果会显示在这里"}</span>
        </div>
      )}
    </div>
  );
}

function GenerationProgress({ progress = 2, startedAt = 0 }: { progress?: number; startedAt?: number }) {
  const [displayProgress, setDisplayProgress] = useState(Math.max(2, Math.min(95, progress)));

  useEffect(() => {
    const started = startedAt > 0 ? startedAt : Date.now();
    const update = () => {
      const elapsedProgress = Math.floor(((Date.now() - started) / 60000) * 90);
      setDisplayProgress(Math.max(2, Math.min(95, Math.max(progress, progress + elapsedProgress))));
    };
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [progress, startedAt]);

  return (
    <div className="generation-progress" aria-live="polite">
      <div className="generation-progress-icon">
        <Sparkles size={25} />
      </div>
      <strong>正在生成 {displayProgress}%</strong>
      <div className="generation-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayProgress}>
        <span style={{ width: `${displayProgress}%` }} />
      </div>
      <small>任务处理中，完成后自动显示结果</small>
    </div>
  );
}

function ImageViewer({
  viewer,
  onClose,
  onChange,
  onStartDrag,
}: {
  viewer: ImageViewerState;
  onClose: () => void;
  onChange: (viewer: ImageViewerState) => void;
  onStartDrag: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className="image-viewer" onClick={onClose}>
      <div className="image-viewer-toolbar" onClick={(event) => event.stopPropagation()}>
        <strong title={viewer.asset.name}>{viewer.asset.name}</strong>
        <span>{Math.round(viewer.scale * 100)}%</span>
        <button onClick={onClose} title="关闭">
          <X size={18} />
        </button>
      </div>
      <div
        className="image-viewer-stage"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          event.preventDefault();
          onStartDrag(event);
        }}
        onDoubleClick={() => onChange({ ...viewer, scale: 1, x: 0, y: 0 })}
        onWheel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          const pointerX = event.clientX - rect.left - rect.width / 2;
          const pointerY = event.clientY - rect.top - rect.height / 2;
          const nextScale = Math.min(8, Math.max(0.2, viewer.scale - event.deltaY * 0.0015));
          const scaleRatio = nextScale / viewer.scale;
          onChange({
            ...viewer,
            scale: Number(nextScale.toFixed(2)),
            x: Number((pointerX - (pointerX - viewer.x) * scaleRatio).toFixed(1)),
            y: Number((pointerY - (pointerY - viewer.y) * scaleRatio).toFixed(1)),
          });
        }}
      >
        <img
          src={toFileUrl(viewer.asset.path)}
          alt={viewer.asset.name}
          draggable={false}
          style={{ transform: `translate3d(${viewer.x}px, ${viewer.y}px, 0) scale(${viewer.scale})` }}
        />
      </div>
    </div>
  );
}

function MiniRunControls({
  node,
  models,
  billingEnabled,
  walletBalance,
  ratio,
  resolution,
  onPointerDown,
  onSetParam,
  onSetRatio,
  onSetResolution,
  onSetCustomSize,
  onRun,
}: {
  node: CanvasNode;
  models: TokenFluxModel[];
  billingEnabled: boolean;
  walletBalance: number;
  ratio: string;
  resolution: string;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onSetParam: (key: string, value: unknown) => void;
  onSetRatio: (ratio: string) => void;
  onSetResolution: (resolution: string) => void;
  onSetCustomSize: (width: number, height: number) => void;
  onRun: () => void;
}) {
  void models;
  const runMode = String(node.params.runMode ?? "image");
  const selectedModel = runMode === "inference" ? normalizeUiModel(String(node.params.inferenceModel ?? "GPT-5.5")) : normalizeUiModel(String(node.params.model ?? "gpt-image-2"));
  const selectableModels = runMode === "inference" ? inferenceModelOptions : imageModelOptions;
  const cost = generationCost({ resolution, n: node.params.n });
  const insufficient = billingEnabled && walletBalance < cost;
  return (
    <div className="node-mini-controls node-control" onPointerDown={onPointerDown}>
      <select
        value={runMode}
        onChange={(event) => {
          onSetParam("runMode", event.target.value);
        }}
        title="图像/推理"
      >
        <option value="image">图像</option>
        <option value="inference">推理</option>
      </select>
      <select
        value={selectedModel}
        onChange={(event) => onSetParam(runMode === "inference" ? "inferenceModel" : "model", event.target.value)}
        title={runMode === "inference" ? "推理模型" : "生图模型"}
      >
        {selectableModels.map((model) => (
          <option key={typeof model === "string" ? model : model.value} value={typeof model === "string" ? model : model.value}>
            {typeof model === "string" ? model : model.label}
          </option>
        ))}
      </select>
      <select value={ratio} onChange={(event) => onSetRatio(event.target.value)} title="比例">
        {ratioOptions.map((item) => (
          <option key={item} value={item}>
            {item === "custom" ? "自定义" : item}
          </option>
        ))}
      </select>
      {ratio === "custom" && (
        <div className="node-custom-size" title="自定义输出尺寸">
          <input
            type="number"
            min={64}
            max={8192}
            step={1}
            value={Number(node.params.width ?? 1024)}
            onChange={(event) => onSetCustomSize(Number(event.target.value), Number(node.params.height ?? 1024))}
            aria-label="自定义宽度"
          />
          <span>×</span>
          <input
            type="number"
            min={64}
            max={8192}
            step={1}
            value={Number(node.params.height ?? 1024)}
            onChange={(event) => onSetCustomSize(Number(node.params.width ?? 1024), Number(event.target.value))}
            aria-label="自定义高度"
          />
        </div>
      )}
      <select value={resolution} onChange={(event) => onSetResolution(event.target.value)} title="分辨率">
        {resolutionOptions.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      {billingEnabled && (
        <span className={`run-cost ${insufficient ? "insufficient" : ""}`} title={`当前余额 ${walletBalance} 积分`}>
          本次 {cost} 积分
        </span>
      )}
      <button className="primary run-button" onClick={(event) => { event.stopPropagation(); onRun(); }} disabled={node.status === "running" || insufficient}>
        <Play size={16} />
        {insufficient ? "余额不足" : "运行"}
      </button>
    </div>
  );
}

function ImageResultGallery({
  assets,
  overviewAsset,
  onOpenImage,
  onImageLoad,
  onImageContextMenu,
}: {
  assets: AssetRecord[];
  overviewAsset?: AssetRecord;
  onOpenImage: (asset: AssetRecord) => void;
  onImageLoad: (asset: AssetRecord, dimension: ImageDimension) => void;
  onImageContextMenu: (asset: AssetRecord, event: MouseEvent<HTMLElement>) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedAsset = assets[selectedIndex] ?? assets[0];

  if (overviewAsset?.type === "image" && selectedAsset) {
    return (
      <div className="node-result-overview">
        <button
          className="node-result-overview-main"
          onClick={() => onOpenImage(overviewAsset)}
          onContextMenu={(event) => onImageContextMenu(overviewAsset, event)}
          title="点击放大查看整套总览图"
        >
          <img
            src={toFileUrl(overviewAsset.path)}
            alt={overviewAsset.name}
            draggable={false}
            onLoad={(event) => onImageLoad(overviewAsset, { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          />
        </button>
        <div className="node-result-overview-controls">
          <span>整套总览 · {assets.length} 张结果</span>
          <select value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))} aria-label="选择单张结果">
            {assets.map((asset, index) => (
              <option key={asset.id} value={index}>
                第{index + 1}张 · {asset.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onOpenImage(selectedAsset)}
            onContextMenu={(event) => onImageContextMenu(selectedAsset, event)}
            title="打开当前单张结果"
          >
            <Maximize2 size={13} />
            查看单张
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="node-result-gallery-wrap">
      <div className="node-result-overview-label">全部预览 · {assets.length} 张结果</div>
      <div className="node-result-gallery">
        {assets.slice(-12).map((asset, index) => (
          <button
            key={asset.id}
            className="node-result-gallery-item"
            onClick={() => onOpenImage(asset)}
            onContextMenu={(event) => onImageContextMenu(asset, event)}
            title={`${index + 1}. 点击放大查看`}
          >
            <img
              src={toFileUrl(asset.path)}
              alt={asset.name}
              draggable={false}
              onLoad={(event) => onImageLoad(asset, { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            />
            <span>{index + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function normalizeUiModel(model: string) {
  if (!model || ["images-2", "GPT-images-2", "GPT Image 2", "gpt image 2", "图像-2", "图片-2"].includes(model)) return "gpt-image-2";
  if (model.toLowerCase() === "gpt-image-2") return "gpt-image-2";
  if (model === "gpt-5.5") return "GPT-5.5";
  if (model === "gpt-5.4") return "GPT-5.4";
  return model;
}

function sizeToRatio(size: string) {
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return "1:1";
  const width = Number(match[1]);
  const height = Number(match[2]);
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.02) return "16:9";
  if (Math.abs(ratio - 9 / 16) < 0.02) return "9:16";
  if (Math.abs(ratio - 21 / 9) < 0.03) return "21:9";
  if (Math.abs(ratio - 9 / 21) < 0.03) return "9:21";
  if (Math.abs(ratio - 9 / 20) < 0.03) return "9:20";
  if (Math.abs(ratio - 20 / 9) < 0.03) return "20:9";
  if (Math.abs(ratio - 4 / 3) < 0.02) return "4:3";
  if (Math.abs(ratio - 3 / 4) < 0.02) return "3:4";
  if (Math.abs(ratio - 2 / 3) < 0.02) return "2:3";
  if (Math.abs(ratio - 3 / 2) < 0.02) return "3:2";
  return "1:1";
}

function getVisualNodeSize(node: CanvasNode) {
  const minSize = getMinimumNodeSize(node);
  return { width: Math.max(node.size.width, minSize.width), height: Math.max(node.size.height, minSize.height) };
}

function getMinimumNodeSize(node: CanvasNode) {
  if (node.type === "ai-generate") return { width: 660, height: 360 };
  if (node.type === "background") return { width: 660, height: 340 };
  if (node.type === "upscale" || node.type === "resize") return { width: 660, height: 320 };
  if (node.type === "prompt") return { width: 660, height: 210 };
  if (node.type === "image") return { width: 520, height: 220 };
  if (node.type === "ecommerce-template" || node.type === "print-template") return { width: 660, height: 320 };
  return { width: 420, height: 320 };
}

