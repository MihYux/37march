const fs = require("node:fs");
const path = require("node:path");

const SERVICE_LIMITS = Object.freeze({
  deepseek: Object.freeze({
    requestLimit: 60,
    characterLimit: 120_000,
  }),
  dashscope: Object.freeze({
    requestLimit: 120,
    characterLimit: 50_000,
  }),
});

const FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 5 * 60 * 1_000;
const NON_PROVIDER_FAILURE_CODES = new Set([
  "CANCELLED",
  "DAILY_USAGE_LIMIT",
  "SERVICE_CIRCUIT_OPEN",
  "API_KEY_MISSING",
  "AUTH_FAILED",
  "INVALID_MESSAGES",
  "INVALID_TEXT",
  "TTS_DISABLED",
  "VOICE_RIGHTS_UNCONFIRMED",
]);

class ServiceBudgetError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ServiceBudgetError";
    this.code = code;
  }
}

function dayKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function emptyProviderState() {
  return {
    requests: 0,
    characters: 0,
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    circuitOpenUntil: "",
    lastErrorCode: "",
  };
}

function createState(now) {
  return {
    schemaVersion: 1,
    day: dayKey(now),
    providers: {
      deepseek: emptyProviderState(),
      dashscope: emptyProviderState(),
    },
  };
}

function normalizeProviderState(input) {
  const fallback = emptyProviderState();
  return {
    requests: Math.max(0, Math.floor(Number(input?.requests) || 0)),
    characters: Math.max(
      0,
      Math.floor(Number(input?.characters) || 0),
    ),
    successes: Math.max(0, Math.floor(Number(input?.successes) || 0)),
    failures: Math.max(0, Math.floor(Number(input?.failures) || 0)),
    consecutiveFailures: Math.max(
      0,
      Math.floor(Number(input?.consecutiveFailures) || 0),
    ),
    circuitOpenUntil:
      typeof input?.circuitOpenUntil === "string" &&
      Number.isFinite(Date.parse(input.circuitOpenUntil))
        ? input.circuitOpenUntil
        : fallback.circuitOpenUntil,
    lastErrorCode:
      typeof input?.lastErrorCode === "string"
        ? input.lastErrorCode.slice(0, 80)
        : fallback.lastErrorCode,
  };
}

function normalizeState(input, now) {
  if (input?.day !== dayKey(now)) return createState(now);
  return {
    schemaVersion: 1,
    day: input.day,
    providers: Object.fromEntries(
      Object.keys(SERVICE_LIMITS).map((provider) => [
        provider,
        normalizeProviderState(input?.providers?.[provider]),
      ]),
    ),
  };
}

class ServiceBudgetStore {
  constructor({ filePath, clock = () => new Date().toISOString() }) {
    this.filePath = filePath;
    this.clock = clock;
    this.state = this.#read();
  }

  #read() {
    const now = this.clock();
    try {
      const state = normalizeState(
        JSON.parse(fs.readFileSync(this.filePath, "utf8")),
        now,
      );
      this.#write(state);
      return state;
    } catch {
      const state = createState(now);
      this.#write(state);
      return state;
    }
  }

  #write(state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryFile = `${this.filePath}.tmp`;
    fs.writeFileSync(
      temporaryFile,
      `${JSON.stringify(state, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    fs.renameSync(temporaryFile, this.filePath);
  }

  #refresh(now) {
    const normalized = normalizeState(this.state, now);
    if (normalized.day !== this.state.day) {
      this.state = normalized;
      this.#write(this.state);
    }
  }

  #provider(provider) {
    if (!Object.hasOwn(SERVICE_LIMITS, provider)) {
      throw new ServiceBudgetError(
        "不支持的第三方服务。",
        "INVALID_SERVICE",
      );
    }
    return this.state.providers[provider];
  }

  authorize(provider, { characters = 0 } = {}) {
    const now = this.clock();
    this.#refresh(now);
    const usage = this.#provider(provider);
    const limits = SERVICE_LIMITS[provider];
    const cleanCharacters = Math.max(
      0,
      Math.floor(Number(characters) || 0),
    );
    if (
      usage.circuitOpenUntil &&
      Date.parse(usage.circuitOpenUntil) > Date.parse(now)
    ) {
      throw new ServiceBudgetError(
        "第三方服务连续失败，已短暂暂停调用，请稍后再试。",
        "SERVICE_CIRCUIT_OPEN",
      );
    }
    if (
      usage.requests + 1 > limits.requestLimit ||
      usage.characters + cleanCharacters > limits.characterLimit
    ) {
      throw new ServiceBudgetError(
        "今天的演示调用额度已用完，本地功能仍可继续使用。",
        "DAILY_USAGE_LIMIT",
      );
    }
    usage.requests += 1;
    usage.characters += cleanCharacters;
    this.#write(this.state);
    return this.getPublicStatus();
  }

  recordSuccess(provider) {
    const now = this.clock();
    this.#refresh(now);
    const usage = this.#provider(provider);
    usage.successes += 1;
    usage.consecutiveFailures = 0;
    usage.circuitOpenUntil = "";
    usage.lastErrorCode = "";
    this.#write(this.state);
    return this.getPublicStatus();
  }

  recordFailure(provider, code = "REQUEST_FAILED") {
    if (NON_PROVIDER_FAILURE_CODES.has(code)) {
      return this.getPublicStatus();
    }
    const now = this.clock();
    this.#refresh(now);
    const usage = this.#provider(provider);
    usage.failures += 1;
    usage.consecutiveFailures += 1;
    usage.lastErrorCode = String(code).slice(0, 80);
    if (usage.consecutiveFailures >= FAILURE_THRESHOLD) {
      usage.circuitOpenUntil = new Date(
        Date.parse(now) + CIRCUIT_OPEN_MS,
      ).toISOString();
    }
    this.#write(this.state);
    return this.getPublicStatus();
  }

  getPublicStatus() {
    const now = this.clock();
    this.#refresh(now);
    return {
      day: this.state.day,
      providers: Object.fromEntries(
        Object.entries(SERVICE_LIMITS).map(([provider, limits]) => {
          const usage = this.state.providers[provider];
          return [
            provider,
            {
              requests: usage.requests,
              requestLimit: limits.requestLimit,
              characters: usage.characters,
              characterLimit: limits.characterLimit,
              failures: usage.failures,
              circuitOpen:
                Boolean(usage.circuitOpenUntil) &&
                Date.parse(usage.circuitOpenUntil) > Date.parse(now),
              circuitOpenUntil: usage.circuitOpenUntil,
            },
          ];
        }),
      ),
    };
  }
}

module.exports = {
  CIRCUIT_OPEN_MS,
  FAILURE_THRESHOLD,
  SERVICE_LIMITS,
  ServiceBudgetError,
  ServiceBudgetStore,
  createState,
  normalizeState,
};
