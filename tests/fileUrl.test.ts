import { describe, expect, it } from "vitest";
import { toFileUrl } from "../src/services/fileUrl";

describe("toFileUrl", () => {
  it("converts Windows paths into browser-safe file URLs", () => {
    expect(toFileUrl("C:\\Users\\Test\\图片.png")).toBe("file:///C:/Users/Test/图片.png");
  });

  it("handles empty paths", () => {
    expect(toFileUrl()).toBe("");
  });
});
