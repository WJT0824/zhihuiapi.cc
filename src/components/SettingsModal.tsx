import { useEffect, useState } from "react";
import type { AppSettings, TokenFluxModel } from "@/types/domain";
import { isImageModelName, normalizeModelTags } from "@/services/modelTags";

export function SettingsModal({
  open,
  settings,
  models,
  onClose,
  onSave,
  onModelsRead,
}: {
  open: boolean;
  settings: AppSettings;
  models: TokenFluxModel[];
  onClose: () => void;
  onSave: (settings: AppSettings) => Promise<void>;
  onModelsRead?: (models: TokenFluxModel[]) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [testMessage, setTestMessage] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setTestMessage("");
    }
  }, [open, settings]);

  if (!open) return null;

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const mergedModels = (() => {
    const seen = new Set<string>();
    const all: TokenFluxModel[] = [];
    for (const model of normalizeModelTags(models)) {
      if (!seen.has(model.id)) {
        seen.add(model.id);
        all.push(model);
      }
    }
    if (!seen.has(draft.defaultModel)) {
      const currentIsImage = /(image|img|dall|flux)/i.test(String(draft.defaultModel));
      seen.add(draft.defaultModel);
      all.push({
        id: draft.defaultModel,
        name: currentIsImage ? "GPT Image 2" : draft.defaultModel,
        tags: currentIsImage ? ["text-to-image", "image-editing"] : ["reasoning"],
      });
    }
    if (!seen.has("gpt-image-2")) {
      seen.add("gpt-image-2");
      all.unshift({ id: "gpt-image-2", name: "GPT Image 2", tags: ["text-to-image", "image-editing"] });
    }
    return all;
  })();
  const modelKind = (model: TokenFluxModel) => {
    const isImage = isImageModelName(`${model.id} ${model.name || ""}`) || model.tags.includes("text-to-image") || model.tags.includes("image-editing");
    const isReasoning = !isImage && model.tags.includes("reasoning");
    if (isImage && isReasoning) return " · 图像/推理";
    if (isImage) return " · 图像";
    if (isReasoning) return " · 推理";
    return "";
  };

  return (
    <div className="modal-backdrop">
      <section className="settings-modal">
        <header>
          <h2>设置中心</h2>
          <button onClick={onClose}>关闭</button>
        </header>
        <div className="settings-form">
          <label>
            上游 API Key
            <input
              type="password"
              value={draft.tokenFluxApiKey ?? ""}
              onChange={(event) => set("tokenFluxApiKey", event.target.value)}
              placeholder="留空时默认使用平台已配置服务"
            />
            <small className="settings-hint">填写后只对当前账号生效；留空则使用运营后台配置的平台服务。更换中转地址时请同时更换对应 Key。</small>
          </label>
          <label>
            API 中转地址
            <input
              value={draft.tokenFluxBaseUrl ?? ""}
              onChange={(event) => set("tokenFluxBaseUrl", event.target.value)}
              placeholder="https://example.com、https://example.com/v1 或带路径的兼容地址"
            />
          </label>
          <div className="inline-actions">
            <button
              onClick={async () => {
                const result = await window.zhihui.settings.testApiKey(draft.tokenFluxApiKey, draft.tokenFluxBaseUrl, "models");
                setTestMessage(result.message);
                if (result.models?.length) onModelsRead?.(result.models);
              }}
            >
              测试连接
            </button>
            <button
              onClick={async () => {
                const result = await window.zhihui.settings.testApiKey(draft.tokenFluxApiKey, draft.tokenFluxBaseUrl, "image");
                setTestMessage(result.message);
              }}
            >
              测试生图模型
            </button>
            <button
              onClick={async () => {
                const result = await window.zhihui.settings.testApiKey(draft.tokenFluxApiKey, draft.tokenFluxBaseUrl, "reasoning");
                setTestMessage(result.message);
              }}
            >
              测试推理模型
            </button>
            <span>{testMessage}</span>
          </div>
          <label>
            默认模型
            <select value={draft.defaultModel} onChange={(event) => set("defaultModel", event.target.value)}>
              {mergedModels.slice(0, 30).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name || model.id}
                    {modelKind(model)}
                  </option>
                ))}
            </select>
            <small className="settings-hint">默认模型会同步给节点下拉框与实际生成任务；API 读取列表中的推理模型用于推理类节点。</small>
          </label>
          <div className="two-cols">
            <label>
              默认比例
              <select value={draft.defaultRatio} onChange={(event) => set("defaultRatio", event.target.value)}>
                <option value="1:1">1:1</option>
                <option value="4:5">4:5</option>
                <option value="3:4">3:4</option>
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
              </select>
            </label>
            <label>
              放大倍率
              <input type="number" min={1} max={4} value={draft.upscaleFactor} onChange={(event) => set("upscaleFactor", Number(event.target.value))} />
            </label>
          </div>
          <label>
            输出目录
            <input value={draft.outputDirectory ?? ""} onChange={(event) => set("outputDirectory", event.target.value)} placeholder="默认使用系统图片目录" />
          </label>
          <label>
            任务并发数
            <input type="number" min={1} max={6} value={draft.taskConcurrency} onChange={(event) => set("taskConcurrency", Number(event.target.value))} />
          </label>
        </div>
        <footer>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => void onSave(draft)}>
            保存设置
          </button>
        </footer>
      </section>
    </div>
  );
}
