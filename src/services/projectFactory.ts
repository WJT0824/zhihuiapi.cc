import { nanoid } from "nanoid";
import type { CanvasNode, TemplateDefinition, ZhihuiProject } from "@/types/domain";

function withNodeSuffix(title: string) {
  return title.endsWith("节点") ? title : `${title}节点`;
}

export function createTemplateNode(template: TemplateDefinition, x = 120, y = 120): CanvasNode {
  return {
    id: nanoid(),
    type: template.type === "ecommerce" ? "ecommerce-template" : "print-template",
    position: { x, y },
    size: { width: 360, height: 260 },
    title: withNodeSuffix(template.title),
    inputs: ["image"],
    outputs: ["prompt"],
    params: {
      category: template.category,
      description: template.description,
      prompt: template.defaultPrompt,
      aspectRatio: template.aspectRatio,
      width: template.outputSize.width,
      height: template.outputSize.height,
      runMode: "image",
      model: "gpt-image-2",
      inferenceModel: "GPT-5.5",
      ratio: template.aspectRatio,
      resolution: "1K",
      quality: "high",
      n: 1,
    },
    status: "idle",
    resultAssetIds: [],
    zIndex: 10,
  };
}

export function createNode(type: CanvasNode["type"], x = 160, y = 160): CanvasNode {
  const titles: Record<CanvasNode["type"], string> = {
    prompt: "文本节点",
    image: "图像节点",
    "ai-generate": "图像生成节点",
    upscale: "高清放大节点",
    resize: "修改尺寸节点",
    background: "背景替换节点",
    preview: "图像预览节点",
    compare: "图像对比节点",
    "ecommerce-template": "电商模板节点",
    "print-template": "平面广告模板节点",
  };
  const io: Record<CanvasNode["type"], { inputs: string[]; outputs: string[] }> = {
    prompt: { inputs: ["input"], outputs: ["prompt"] },
    image: { inputs: ["input"], outputs: ["image"] },
    "ai-generate": { inputs: ["prompt", "image"], outputs: ["image"] },
    upscale: { inputs: ["image"], outputs: ["image"] },
    resize: { inputs: ["image"], outputs: ["image"] },
    background: { inputs: ["prompt", "image"], outputs: ["image"] },
    preview: { inputs: ["image"], outputs: ["image"] },
    compare: { inputs: ["image"], outputs: ["image"] },
    "ecommerce-template": { inputs: ["image"], outputs: ["prompt"] },
    "print-template": { inputs: ["image"], outputs: ["prompt"] },
  };
  const size: Record<CanvasNode["type"], { width: number; height: number }> = {
    prompt: { width: 260, height: 180 },
    image: { width: 390, height: 220 },
    "ai-generate": { width: 430, height: 280 },
    upscale: { width: 360, height: 250 },
    resize: { width: 360, height: 250 },
    background: { width: 390, height: 270 },
    preview: { width: 390, height: 250 },
    compare: { width: 520, height: 260 },
    "ecommerce-template": { width: 360, height: 240 },
    "print-template": { width: 360, height: 240 },
  };
  const commonParams = {
    prompt: "",
    runMode: "image",
    model: "gpt-image-2",
    inferenceModel: "GPT-5.5",
    ratio: "1:1",
    resolution: "1K",
    quality: "high",
    size: "1024x1024",
    n: 1,
  };
  return {
    id: nanoid(),
    type,
    position: { x, y },
    size: size[type],
    title: titles[type],
    inputs: io[type].inputs,
    outputs: io[type].outputs,
    params:
      type === "resize"
        ? { ...commonParams, width: 1600, height: 1600, ratio: "auto", prompt: "保持主体不变，按目标尺寸重新构图" }
        : type === "upscale"
          ? { ...commonParams, factor: 2, ratio: "auto", prompt: "高清放大，保留细节与材质" }
          : type === "background"
            ? { ...commonParams, prompt: "替换为适合电商广告的高级商业场景" }
            : commonParams,
    status: "idle",
    resultAssetIds: [],
    zIndex: 10,
  };
}

export function upsertNode(project: ZhihuiProject, node: CanvasNode): ZhihuiProject {
  return {
    ...project,
    graph: {
      ...project.graph,
      nodes: project.graph.nodes.some((item) => item.id === node.id)
        ? project.graph.nodes.map((item) => (item.id === node.id ? node : item))
        : [...project.graph.nodes, node],
    },
  };
}

export function getPromptFromNode(node: CanvasNode | undefined) {
  const raw = node?.params.prompt;
  return typeof raw === "string" ? raw : "";
}
