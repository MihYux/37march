const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { TtsSettingsStore } = require("./tts-settings.cjs");

const config = {
  provider: "dashscope",
  baseUrl: "https://dashscope.aliyuncs.com/api/v1",
  model: "cosyvoice-v3.5-flash",
  voiceId: "cosyvoice-v3.5-flash-marchpet-test",
};

test("encrypts DashScope keys and persists playback settings", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "march7-tts-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "tts-settings.json");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) =>
      value.toString("utf8").replace(/^encrypted:/, ""),
  };
  const store = new TtsSettingsStore({
    filePath,
    safeStorage,
    config,
    environment: {},
  });

  const settings = store.save({
    apiKey: "sk-dashscope-private",
    voiceRightsConfirmed: true,
    enabled: true,
    autoPlay: false,
    volume: 0.7,
    rate: 1.1,
  });

  assert.equal(store.getApiKey(), "sk-dashscope-private");
  assert.equal(settings.autoPlay, false);
  assert.equal(settings.voiceRightsConfirmed, true);
  assert.equal(settings.volume, 0.7);
  assert.equal(settings.rate, 1.1);
  assert.equal(settings.keySource, "secure-storage");
  assert.ok(!fs.readFileSync(filePath, "utf8").includes("sk-dashscope-private"));
});

test("uses a macOS Keychain value without writing it to disk", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "march7-tts-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "tts-settings.json");
  const store = new TtsSettingsStore({
    filePath,
    safeStorage: { isEncryptionAvailable: () => false },
    config,
    environment: {},
    externalApiKey: "sk-from-keychain",
  });

  store.save({ voiceRightsConfirmed: true, enabled: true });

  assert.equal(store.getApiKey(), "sk-from-keychain");
  assert.equal(store.getPublicSettings().keySource, "macos-keychain");
  assert.ok(!fs.readFileSync(filePath, "utf8").includes("sk-from-keychain"));
});

test("keeps cloned voice output disabled until rights are confirmed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "march7-tts-"));
  const store = new TtsSettingsStore({
    filePath: path.join(directory, "tts-settings.json"),
    safeStorage: { isEncryptionAvailable: () => false },
    config,
    environment: {},
  });
  assert.equal(store.getPublicSettings().enabled, false);
  assert.equal(
    store.getPublicSettings().voiceRightsConfirmed,
    false,
  );
  assert.throws(
    () => store.save({ enabled: true }),
    /确认复刻声音的使用授权/,
  );
  store.save({
    voiceRightsConfirmed: true,
    enabled: true,
    autoPlay: true,
  });
  const revoked = store.save({
    voiceRightsConfirmed: false,
  });
  assert.equal(revoked.enabled, false);
  assert.equal(revoked.autoPlay, false);
  assert.equal(revoked.voiceRightsConfirmed, false);
});
