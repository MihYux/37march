const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ReleaseSkillLoader,
  parseFrontmatter,
} = require("./release-skill-loader.cjs");

function validSkill(version = "1.0.0") {
  return `---
name: march7th-symbiotic-release-execution
version: ${version}
description: test
applies_to: release_chat
---

# test

${"只在自然、有价值且符合频控时执行发行；玩家安全和长期信任始终优先。".repeat(12)}
`;
}

test("validates the bundled release skill contract", () => {
  const parsed = parseFrontmatter(validSkill());
  assert.equal(parsed.metadata.version, "1.0.0");
  assert.match(parsed.body, /玩家安全/);
  assert.throws(
    () => parseFrontmatter(validSkill().replace("release_chat", "all_chat")),
    /release_chat/,
  );
});

test("hot reload keeps the last known good skill after an invalid edit", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "march-skill-"));
  const filePath = path.join(directory, "SKILL.md");
  fs.writeFileSync(filePath, validSkill("1.0.0"), "utf8");
  const loader = new ReleaseSkillLoader({ filePath, watch: false });
  assert.equal(loader.getSnapshot().version, "1.0.0");
  fs.writeFileSync(filePath, validSkill("1.1.0"), "utf8");
  loader.reload();
  assert.equal(loader.getSnapshot().version, "1.1.0");
  fs.writeFileSync(filePath, "invalid", "utf8");
  loader.reload();
  assert.equal(loader.getSnapshot().version, "1.1.0");
  assert.equal(loader.getSnapshot().valid, true);
  assert.match(loader.getSnapshot().error, /frontmatter/);
  loader.close();
});
