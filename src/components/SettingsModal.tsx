import { useEffect, useState } from "react";
import type { AppSettings, TokenFluxModel } from "@/types/domain";

export function SettingsModal({
  open,
  settings,
  models,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: AppSettings;
  models: TokenFluxModel[];
  onClose: () => void;
  onSave: (settings: AppSettings) => Promise<void>;
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

  return (
    <div className="modal-backdrop">
      <section className="settings-modal">
        <header>
          <h2>设置中心</h2>
          <button onClick={onClose}>关闭</button>
        </header>
        <div className="settings-form">
          <label>
            TokenFlux API Key
            <input
              type="password"
              value={draft.tokenFluxApiKey ?? ""}
              onChange={(event) => set("tokenFluxApiKey", event.target.value)}
              placeholder="sk-..."
            />
          </label>
          <label>
            API 中转地址
            <input
              value={draft.tokenFluxBaseUrl ?? ""}
              onChange={(event) => set("tokenFluxBaseUrl", event.target.value)}
              placeholder="https://tokenflux.cloud/v1"
            />
          </label>
          <div className="inline-actions">
            <button
              onClick={async () => {
                const result = await window.zhihui.settings.testApiKey(draft.tokenFluxApiKey, draft.tokenFluxBaseUrl, "models");
                setTestMessage(result.message);
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
              <option value="gpt-image-2">GPT Image 2</option>
              {models
                .filter((model) => model.id !== "gpt-image-2")
                .slice(0, 8)
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name || model.id}
                  </option>
                ))}
            </select>
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
