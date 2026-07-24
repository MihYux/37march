import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "./contrast";

describe("desktop companion color contrast", () => {
  it("meets WCAG AA for primary text and interactive labels", () => {
    const pairs = [
      ["#3f3450", "#ffffff"],
      ["#5e4c77", "#ffffff"],
      ["#a53d70", "#ffffff"],
      ["#ffffff", "#a9345f"],
    ];

    for (const [foreground, background] of pairs) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("rejects invalid colors and preserves black/white extremes", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBe(1);
    expect(() => contrastRatio("#fff", "#000000")).toThrow();
  });
});
