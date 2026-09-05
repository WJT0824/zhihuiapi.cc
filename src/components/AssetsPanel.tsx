import { ImagePlus, Plus, Star, Trash2 } from "lucide-react";
import type { AssetRecord } from "@/types/domain";
import { toFileUrl } from "@/services/fileUrl";

export function AssetsPanel({
  assets,
  onImport,
  onAddToCanvas,
  onDelete,
}: {
  assets: AssetRecord[];
  onImport: () => void;
  onAddToCanvas: (asset: AssetRecord) => void;
  onDelete: (asset: AssetRecord) => void;
}) {
  return (
    <div className="panel-scroll assets-panel">
      <button className="wide-action" onClick={onImport}>
        <ImagePlus size={16} />
        从本地上传
      </button>
      <div className="asset-grid">
        {assets.map((asset) => (
          <div key={asset.id} className="asset-card">
            {asset.type === "image" ? <img src={toFileUrl(asset.path)} alt={asset.name} /> : <div className="asset-file">{asset.type}</div>}
            <div className="asset-meta">
              <strong title={asset.name}>{asset.name}</strong>
              <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
            </div>
            {asset.favorite && <Star size={14} />}
            <div className="asset-actions">
              <button title="加入画布" onClick={() => onAddToCanvas(asset)}>
                <Plus size={14} />
              </button>
              <button title="删除素材" onClick={() => onDelete(asset)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
