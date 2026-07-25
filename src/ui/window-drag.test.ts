import { describe, expect, it } from "vitest";
import { calculateWindowDragPosition } from "./window-drag";

const origin = {
  screenX: 300,
  screenY: 240,
  windowX: 80,
  windowY: 60,
};

describe("calculateWindowDragPosition", () => {
  it("keeps a short press available for character interaction", () => {
    expect(calculateWindowDragPosition(origin, 302, 241)).toBeNull();
  });

  it("moves the window by the global pointer delta", () => {
    expect(calculateWindowDragPosition(origin, 335, 222)).toEqual({
      x: 115,
      y: 42,
    });
  });
});
