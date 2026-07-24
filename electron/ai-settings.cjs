const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_DEEPSEEK_BASE_URL,
  SUPPORTED_DEEPSEEK_MODELS,
} = require("./ai-client.cjs");

const DEFAULT_SETTINGS = Object.freeze({
  provider: "deepseek",
  baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
  model: "deepseek-v4-flash",
  thinking: false,
});

class AiSettingsStore {
  constructor({ filePath, safeStorage, environment = process.env }) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.environment = environment;
    this.sessionApiKey = "";
    this.settings = this.#read();
  }

  #read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return {
        ...DEFAULT_SETTINGS,
        model: SUPPORTED_DEEPSEEK_MODELS.has(parsed.model)
          ? parsed.model
          : DEFAULT_SETTINGS.model,
        thinking: parsed.thinking === true,
        encryptedApiKey:
          typeof parsed.encryptedApiKey === "string"
            ? parsed.encryptedApiKey
            : "",
      };
    } catch {
      return { ...DEFAULT_SETTINGS, encryptedApiKey: "" };
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

  getApiKey() {
    const environmentKey = this.environment.DEEPSEEK_API_KEY?.trim();
    if (environmentKey) return environmentKey;
    if (this.sessionApiKey) return this.sessionApiKey;
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

  getPublicSettings() {
    const environmentKey = this.environment.DEEPSEEK_API_KEY?.trim();
    const storedKey = this.getApiKey();
    const keySource = environmentKey
      ? "environment"
      : this.sessionApiKey
        ? "session"
        : storedKey
          ? "secure-storage"
          : "none";

    return {
      provider: DEFAULT_SETTINGS.provider,
      baseUrl: DEFAULT_SETTINGS.baseUrl,
      model: this.settings.model,
      thinking: this.settings.thinking,
      hasApiKey: Boolean(storedKey),
      keySource,
      secureStorageAvailable: this.#secureStorageAvailable(),
    };
  }

  save(input = {}) {
    if (
      input.model !== undefined &&
      !SUPPORTED_DEEPSEEK_MODELS.has(input.model)
    ) {
      throw new Error("不支持这个 DeepSeek 模型。");
    }

    this.settings.model = input.model ?? this.settings.model;
    this.settings.thinking =
      input.thinking === undefined
        ? this.settings.thinking
        : input.thinking === true;

    const nextApiKey =
      typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    if (nextApiKey) {
      if (nextApiKey.length > 500) {
        throw new Error("API Key 长度不正确。");
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
  AiSettingsStore,
  DEFAULT_SETTINGS,
};
