import type { CanvasNode, TokenFluxModel } from "@/types/domain";

const ratioToDefaultSize: Record<string, string> = {
  "16:9": "1280x720",
  "9:16": "720x1280",
  "4:3": "1024x768",
  "3:4": "768x1024",
  "2:3": "683x1024",
  "3:2": "1024x683",
  "1:1": "1024x1024",
  "21:9": "1024x439",
  "9:21": "439x1024",
  "9:20": "460x1024",
  "20:9": "1024x461",
  auto: "1024x1024",
  custom: "1024x1024",
};

export function Inspector({
  node,
  models,
  onChange,
}: {
  node?: CanvasNode;
  models: TokenFluxModel[];
  onChange: (node: CanvasNode) => void;
}) {
  if (!node) {
    return <div className="empty-state">选择一个节点后编辑参数。</div>;
  }

  const setParam = (key: string, value: unknown) => onChange({ ...node, params: { ...node.params, [key]: value } });
  const setRatio = (ratio: string) =>
    onChange({
      ...node,
      params: {
        ...node.params,
        ratio,
        size: ratioToDefaultSize[ratio] ?? "1024x1024",
      },
    });

  return (
    <div className="inspector-form">
      <label>
        标题
        <input value={node.title} onChange={(event) => onChange({ ...node, title: event.target.value })} />
      </label>
      <label>
        节点类型
        <input value={node.type} disabled />
      </label>
      {(node.type === "prompt" ||
        node.type === "ai-generate" ||
        node.type === "background" ||
        node.type === "ecommerce-template" ||
        node.type === "print-template") && (
        <label>
          文本提示
          <textarea value={String(node.params.prompt ?? "")} onChange={(event) => setParam("prompt", event.target.value)} rows={7} />
        </label>
      )}
      {(node.type === "ai-generate" || node.type === "upscale" || node.type === "background") && (
        <>
          <label>
            模型
            <select value={String(node.params.model ?? "gpt-image-2")} onChange={(event) => setParam("model", event.target.value)}>
              <option value="gpt-image-2">GPT Image 2</option>
              {models
                .filter((model) => model.id !== "gpt-image-2")
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                  </option>
                ))}
            </select>
          </label>
          <label>
            比例
            <select value={String(node.params.ratio ?? "1:1")} onChange={(event) => setRatio(event.target.value)}>
              {Object.keys(ratioToDefaultSize).map((ratio) => (
                <option key={ratio} value={ratio}>
                  {ratio}
                </option>
              ))}
            </select>
          </label>
          <label>
            分辨率
            <select value={String(node.params.resolution ?? "1K")} onChange={(event) => setParam("resolution", event.target.value)}>
              <option value="1K">1K</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
          </label>
          <label>
            数量
            <input
              type="number"
              min={1}
              max={4}
              value={Number(node.params.n ?? 1)}
              onChange={(event) => setParam("n", Number(event.target.value))}
            />
          </label>
        </>
      )}
      {node.type === "resize" && (
        <div className="two-cols">
          <label>
            宽度
            <input type="number" value={Number(node.params.width ?? 1600)} onChange={(event) => setParam("width", Number(event.target.value))} />
          </label>
          <label>
            高度
            <input type="number" value={Number(node.params.height ?? 1600)} onChange={(event) => setParam("height", Number(event.target.value))} />
          </label>
        </div>
      )}
      <label className="check-row">
        <input type="checkbox" checked={Boolean(node.locked)} onChange={(event) => onChange({ ...node, locked: event.target.checked })} />
        锁定节点
      </label>
      <div className="metadata">
        <span>结果素材：{node.resultAssetIds.length}</span>
        <span>状态：{node.status}</span>
      </div>
    </div>
  );
}
