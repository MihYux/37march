import skillProfile from "../../shared/march7th-skill-profile.json";
import type { CharacterSkillProfile } from "./types";

export const MARCH_7TH_SKILL_PROFILE =
  skillProfile as CharacterSkillProfile;

export function validateSkillProfile(
  profile: CharacterSkillProfile,
): string[] {
  const missing: string[] = [];

  if (!profile.characterId.trim()) missing.push("characterId");
  if (!profile.displayName.trim()) missing.push("displayName");
  if (!profile.skillVersion.trim()) missing.push("skillVersion");
  if (!profile.personaSummary.trim()) missing.push("personaSummary");
  if (!profile.firstPerson.trim()) missing.push("firstPerson");
  if (!profile.speechStyle.length) missing.push("speechStyle");
  if (!profile.values.length) missing.push("values");
  if (!profile.behaviorRules.length) missing.push("behaviorRules");
  if (!profile.knowledgeBoundaries.length) {
    missing.push("knowledgeBoundaries");
  }
  if (!profile.forbiddenBehaviors.length) {
    missing.push("forbiddenBehaviors");
  }
  if (!profile.relationshipRules.length) {
    missing.push("relationshipRules");
  }
  if (!profile.safetyRules.length) missing.push("safetyRules");

  const requiredTemplateTypes = new Set([
    "daily",
    "photo",
    "postcard",
    "version_launch",
  ]);
  for (const template of profile.eventTemplates) {
    requiredTemplateTypes.delete(template.type);
  }
  for (const type of requiredTemplateTypes) {
    missing.push(`eventTemplates.${type}`);
  }

  if (!profile.assetManifest.assets.length) {
    missing.push("assetManifest.assets");
  }
  if (!profile.assetManifest.fallbackVisualId.trim()) {
    missing.push("assetManifest.fallbackVisualId");
  }

  return missing;
}
