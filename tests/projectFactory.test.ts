import { describe, expect, it } from "vitest";
import { ecommerceTemplates } from "../src/data/templates";
import { createNode, createTemplateNode, getPromptFromNode, upsertNode } from "../src/services/projectFactory";
import type { ZhihuiProject } from "../src/types/domain";

function makeProject(): ZhihuiProject {
  return {
    version: 1,
    id: "project-1",
    title: "test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    assetIds: [],
    exportSettings: { format: "png", width: 1920, height: 1080, scale: 1, transparent: false },
  };
}

describe("projectFactory", () => {
  it("creates an AI generation node with executable defaults", () => {
    const node = createNode("ai-generate");
    expect(node.type).toBe("ai-generate");
    expect(node.params.model).toBe("gpt-image-2");
    expect(node.params.size).toBe("1024x1024");
  });

  it("creates template nodes with prompt and dimensions", () => {
    const node = createTemplateNode(ecommerceTemplates[0]);
    expect(node.type).toBe("ecommerce-template");
    expect(node.params.prompt).toContain("电商");
    expect(node.params.width).toBeGreaterThan(0);
  });

  it("upserts nodes without duplicating ids", () => {
    const project = makeProject();
    const node = createNode("prompt");
    const withNode = upsertNode(project, node);
    const updated = upsertNode(withNode, { ...node, title: "updated" });
    expect(updated.graph.nodes).toHaveLength(1);
    expect(updated.graph.nodes[0].title).toBe("updated");
  });

  it("extracts prompt text safely", () => {
    expect(getPromptFromNode(createNode("prompt"))).toBe("");
    expect(getPromptFromNode(undefined)).toBe("");
  });
});
