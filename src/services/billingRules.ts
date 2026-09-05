export const rechargeAmounts = [10, 20, 30, 50, 100, 200] as const;
export const resolutionOptions = ["1K", "2K", "4K"] as const;

export function pointsForAmount(amountCny: number) {
  return amountCny * 10;
}

export function costForResolution(resolution: unknown) {
  return String(resolution || "1K") === "4K" ? 8 : 4;
}

export function generationCost(input: { resolution?: unknown; n?: unknown }) {
  const n = Math.max(1, Number(input.n || 1) || 1);
  return costForResolution(input.resolution) * n;
}
