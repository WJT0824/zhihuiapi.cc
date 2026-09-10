import type { TokenFluxModel } from "@/types/domain";

export function isImageModelName(value: string) {
  return /(image|img|dall|flux)/i.test(String(value || ""));
}

export function normalizeModelTags(models: TokenFluxModel[]): TokenFluxModel[] {
  return models.map((model) => {
    const tags = new Set((model.tags || []).map(String));
    if (isImageModelName(`${model.id} ${model.name || ""}`)) {
      tags.delete("reasoning");
      tags.add("text-to-image");
      tags.add("image-editing");
    }
    return { ...model, tags: [...tags] };
  });
}
