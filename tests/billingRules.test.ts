import { describe, expect, it } from "vitest";
import { costForResolution, generationCost, pointsForAmount, rechargeAmounts } from "../src/services/billingRules";

describe("billing rules", () => {
  it("converts recharge amounts to points", () => {
    expect(rechargeAmounts).toEqual([10, 20, 30, 50, 100, 200]);
    expect(pointsForAmount(10)).toBe(100);
    expect(pointsForAmount(200)).toBe(2000);
  });

  it("charges 4 points for 1K and 2K images", () => {
    expect(costForResolution("1K")).toBe(4);
    expect(costForResolution("2K")).toBe(4);
  });

  it("charges 8 points for 4K and multiplies by image count", () => {
    expect(costForResolution("4K")).toBe(8);
    expect(generationCost({ resolution: "4K", n: 3 })).toBe(24);
  });
});
