import { describe, expect, it } from "vitest";
import { getMarchReply, MARCH_7TH_SYSTEM_PROMPT } from "./march7th";

describe("March 7th persona", () => {
  it("keeps the skill's first-person voice", () => {
    expect(MARCH_7TH_SYSTEM_PROMPT).toContain("第一人称“咱”");
    expect(getMarchReply("你是谁？", () => 0).text).toContain("咱");
  });

  it("responds to photo-related chat with a photo line", () => {
    const reply = getMarchReply("我们来拍张照片吧", () => 0);
    expect(reply.text).toMatch(/咔嚓|照片|笑一个/);
    expect(reply.mood).toBe("bright");
  });

  it("softens its tone for emotional conversations", () => {
    const reply = getMarchReply("我今天有点难过", () => 0);
    expect(reply.mood).toBe("soft");
    expect(reply.text.length).toBeLessThan(70);
  });

  it("does not invent missing input", () => {
    expect(getMarchReply("   ", () => 0).text).toContain("想说什么");
  });
});
