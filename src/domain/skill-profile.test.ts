import { describe, expect, it } from "vitest";
import {
  MARCH_7TH_SKILL_PROFILE,
  validateSkillProfile,
} from "./skill-profile";

describe("March 7th skill profile", () => {
  it("contains every field required for controlled MVP content", () => {
    expect(validateSkillProfile(MARCH_7TH_SKILL_PROFILE)).toEqual([]);
    expect(MARCH_7TH_SKILL_PROFILE.completeness.ready).toBe(true);
  });

  it("keeps restricted original Live2D assets outside the manifest", () => {
    expect(
      MARCH_7TH_SKILL_PROFILE.assetManifest.originalLive2DIncluded,
    ).toBe(false);
    expect(
      MARCH_7TH_SKILL_PROFILE.assetManifest.assets.every(
        (asset) => !asset.path?.endsWith(".moc3"),
      ),
    ).toBe(true);
  });

  it("requires a version launch template", () => {
    const incomplete = structuredClone(MARCH_7TH_SKILL_PROFILE);
    incomplete.eventTemplates = incomplete.eventTemplates.filter(
      (template) => template.type !== "version_launch",
    );

    expect(validateSkillProfile(incomplete)).toContain(
      "eventTemplates.version_launch",
    );
  });
});
