import { describe, expect, it } from "vitest";
import { createRevealPlan } from "./reveal";

describe("createRevealPlan", () => {
  it("builds progressive frames that end with the full reply", () => {
    const plan = createRevealPlan("你好，开拓者！");

    expect(plan.frames[0]).toBe("你");
    expect(plan.frames.at(-1)).toBe("你好，开拓者！");
    expect(plan.leadInMs).toBeGreaterThan(0);
  });

  it("keeps emoji as a single displayed glyph", () => {
    const plan = createRevealPlan("嗨📷！");

    expect(plan.frames).toEqual(["嗨", "嗨📷", "嗨📷！"]);
  });

  it("uses a short reveal window to cover common TTS first-audio latency", () => {
    const plan = createRevealPlan(
      "当然可以！咱已经准备好相机啦，快来一起记录今天的珍贵回忆吧！",
    );
    const durationMs =
      plan.leadInMs + plan.frames.length * plan.intervalMs;

    expect(durationMs).toBeGreaterThan(900);
    expect(durationMs).toBeLessThan(2_500);
  });
});
