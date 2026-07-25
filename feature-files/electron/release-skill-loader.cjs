const fs = require("node:fs");
const path = require("node:path");

const MAX_SKILL_BYTES = 64 * 1024;

function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(source);
  if (!match) throw new Error("发行 Skill 缺少 YAML frontmatter。");
  const metadata = {};
  for (const line of match[1].split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    metadata[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim();
  }
  if (metadata.name !== "march7th-symbiotic-release-execution") {
    throw new Error("发行 Skill 名称不匹配。");
  }
  if (!/^\d+\.\d+\.\d+$/u.test(metadata.version ?? "")) {
    throw new Error("发行 Skill 版本必须使用语义化版本。");
  }
  if (metadata.applies_to !== "release_chat") {
    throw new Error("发行 Skill 适用范围必须是 release_chat。");
  }
  if (match[2].trim().length < 300) {
    throw new Error("发行 Skill 内容不完整。");
  }
  return { metadata, body: match[2].trim() };
}

class ReleaseSkillLoader {
  constructor({ filePath, watch = true, debounceMs = 300 }) {
    this.filePath = path.resolve(filePath);
    this.debounceMs = debounceMs;
    this.lastGood = undefined;
    this.lastError = undefined;
    this.reload();
    if (watch) {
      fs.watchFile(this.filePath, { interval: 500 }, () => {
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => this.reload(), this.debounceMs);
      });
    }
  }

  reload() {
    try {
      const stats = fs.statSync(this.filePath);
      if (!stats.isFile() || stats.size > MAX_SKILL_BYTES) {
        throw new Error("发行 Skill 文件不存在或超过 64KB。");
      }
      const source = fs.readFileSync(this.filePath, "utf8");
      if (source.includes("\u0000")) throw new Error("发行 Skill 不是有效文本。");
      const parsed = parseFrontmatter(source);
      this.lastGood = Object.freeze({
        name: parsed.metadata.name,
        version: parsed.metadata.version,
        body: parsed.body,
        loadedAt: new Date().toISOString(),
        filePath: this.filePath,
      });
      this.lastError = undefined;
      return this.getSnapshot();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      if (!this.lastGood) throw error;
      return this.getSnapshot();
    }
  }

  getPrompt() {
    return this.lastGood?.body ?? "";
  }

  getSnapshot() {
    return {
      ...(this.lastGood ?? {}),
      valid: Boolean(this.lastGood),
      error: this.lastError,
    };
  }

  close() {
    clearTimeout(this.reloadTimer);
    fs.unwatchFile(this.filePath);
  }
}

module.exports = {
  MAX_SKILL_BYTES,
  ReleaseSkillLoader,
  parseFrontmatter,
};
