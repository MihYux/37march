const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TTS_SETTINGS = Object.freeze({
  enabled: false,
  autoPlay: false,
  volume: 0.86,
  rate: 1,
  voiceRightsConfirmed: false,
});

class TtsSettingsStore {
  constructor({
    filePath,
    safeStorage,
    config,
    environment = process.env,
    externalApiKey = "",
  }) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.config = config;
    this.environment = environment;
    this.externalApiKey =
      typeof externalApiKey === "string" ? externalApiKey.trim() : "";
    this.sessionApiKey = "";
    this.settings = this.#read();
  }

  #read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      const voiceRightsConfirmed =
        parsed.voiceRightsConfirmed === true;
      return {
        ...DEFAULT_TTS_SETTINGS,
        enabled:
          voiceRightsConfirmed && parsed.enabled === true,
        autoPlay:
          voiceRightsConfirmed && parsed.autoPlay === true,
        voiceRightsConfirmed,
        volume:
          Number.isFinite(parsed.volume) && parsed.volume >= 0 && parsed.volume <= 1
            ? parsed.volume
            : DEFAULT_TTS_SETTINGS.volume,
        rate:
          Number.isFinite(parsed.rate) && parsed.rate >= 0.7 && parsed.rate <= 1.3
            ? parsed.rate
            : DEFAULT_TTS_SETTINGS.rate,
        encryptedApiKey:
          typeof parsed.encryptedApiKey === "string"
            ? parsed.encryptedApiKey
            : "",
      };
    } catch {
      return { ...DEFAULT_TTS_SETTINGS, encryptedApiKey: "" };
    }
  }

  #secureStorageAvailable() {
    try {
      return this.safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  #write() {
    const directory = path.dirname(this.filePath);
    const temporaryFile = `${this.filePath}.tmp`;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      temporaryFile,
      `${JSON.stringify(this.settings, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    fs.renameSync(temporaryFile, this.filePath);
  }

  #secureStoredKey() {
    if (!this.settings.encryptedApiKey || !this.#secureStorageAvailable()) {
      return "";
    }
    try {
      return this.safeStorage.decryptString(
        Buffer.from(this.settings.encryptedApiKey, "base64"),
      );
    } catch {
      return "";
    }
  }

  getApiKey() {
    const environmentKey = this.environment.DASHSCOPE_API_KEY?.trim();
    return (
      environmentKey ||
      this.sessionApiKey ||
      this.#secureStoredKey() ||
      this.externalApiKey ||
      ""
    );
  }

  getPublicSettings() {
    const environmentKey = this.environment.DASHSCOPE_API_KEY?.trim();
    const secureStoredKey = this.#secureStoredKey();
    const keySource = environmentKey
      ? "environment"
      : this.sessionApiKey
        ? "session"
        : secureStoredKey
          ? "secure-storage"
          : this.externalApiKey
            ? "macos-keychain"
            : "none";

    return {
      provider: this.config.provider,
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      voiceId: this.config.voiceId,
      enabled: this.settings.enabled,
      autoPlay: this.settings.autoPlay,
      volume: this.settings.volume,
      rate: this.settings.rate,
      voiceRightsConfirmed: this.settings.voiceRightsConfirmed,
      hasApiKey: Boolean(this.getApiKey()),
      keySource,
      secureStorageAvailable: this.#secureStorageAvailable(),
    };
  }

  save(input = {}) {
    if (input.voiceRightsConfirmed !== undefined) {
      this.settings.voiceRightsConfirmed =
        input.voiceRightsConfirmed === true;
    }
    if (
      input.enabled === true &&
      !this.settings.voiceRightsConfirmed
    ) {
      throw new Error("请先确认复刻声音的使用授权。");
    }
    if (input.enabled !== undefined) {
      this.settings.enabled = input.enabled === true;
    }
    if (input.autoPlay !== undefined) {
      this.settings.autoPlay = input.autoPlay === true;
    }
    if (!this.settings.voiceRightsConfirmed) {
      this.settings.enabled = false;
      this.settings.autoPlay = false;
    }
    if (input.volume !== undefined) {
      const volume = Number(input.volume);
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
        throw new Error("语音音量设置不正确。");
      }
      this.settings.volume = volume;
    }
    if (input.rate !== undefined) {
      const rate = Number(input.rate);
      if (!Number.isFinite(rate) || rate < 0.7 || rate > 1.3) {
        throw new Error("语音速度设置不正确。");
      }
      this.settings.rate = rate;
    }

    const nextApiKey =
      typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    if (nextApiKey) {
      if (nextApiKey.length > 500) {
        throw new Error("DashScope API Key 长度不正确。");
      }
      if (this.#secureStorageAvailable()) {
        this.settings.encryptedApiKey = this.safeStorage
          .encryptString(nextApiKey)
          .toString("base64");
        this.sessionApiKey = "";
      } else {
        this.sessionApiKey = nextApiKey;
        this.settings.encryptedApiKey = "";
      }
    }

    this.#write();
    return this.getPublicSettings();
  }

  clearApiKey() {
    this.sessionApiKey = "";
    this.settings.encryptedApiKey = "";
    this.#write();
    return this.getPublicSettings();
  }
}

module.exports = {
  DEFAULT_TTS_SETTINGS,
  TtsSettingsStore,
};
