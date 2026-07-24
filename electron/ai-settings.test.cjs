const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AiSettingsStore } = require("./ai-settings.cjs");

test("encrypts API keys before writing settings to disk", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "march7-ai-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "ai-settings.json");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) =>
      value.toString("utf8").replace(/^encrypted:/, ""),
  };

  const store = new AiSettingsStore({
    filePath,
    safeStorage,
    environment: {},
  });
  const publicSettings = store.save({
    apiKey: "sk-private-value",
    model: "deepseek-v4-flash",
    thinking: false,
  });

  const diskContents = fs.readFileSync(filePath, "utf8");
  assert.equal(store.getApiKey(), "sk-private-value");
  assert.equal(publicSettings.hasApiKey, true);
  assert.equal(publicSettings.keySource, "secure-storage");
  assert.ok(!diskContents.includes("sk-private-value"));
});

test("keeps keys in memory when secure storage is unavailable", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "march7-ai-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "ai-settings.json");
  const safeStorage = {
    isEncryptionAvailable: () => false,
  };

  const store = new AiSettingsStore({
    filePath,
    safeStorage,
    environment: {},
  });
  const publicSettings = store.save({ apiKey: "sk-session-only" });

  assert.equal(store.getApiKey(), "sk-session-only");
  assert.equal(publicSettings.keySource, "session");
  assert.ok(!fs.readFileSync(filePath, "utf8").includes("sk-session-only"));
});
