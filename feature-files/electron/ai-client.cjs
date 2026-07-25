const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const MAX_CONVERSATION_MESSAGES = 20;
const SUPPORTED_DEEPSEEK_MODELS = new Set([
  "deepseek-v4-flash",
  "deepseek-v4-pro",
]);

class AiClientError extends Error {
  constructor(message, code = "AI_REQUEST_FAILED") {
    super(message);
    this.name = "AiClientError";
    this.code = code;
  }
}

function validateModel(model) {
  if (!SUPPORTED_DEEPSEEK_MODELS.has(model)) {
    throw new AiClientError("暂不支持这个 DeepSeek 模型。", "INVALID_MODEL");
  }
  return model;
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new AiClientError("对话记录格式不正确。", "INVALID_MESSAGES");
  }

  return messages
    .slice(-MAX_CONVERSATION_MESSAGES)
    .map((message) => {
      const role = message?.role;
      const content =
        typeof message?.content === "string" ? message.content.trim() : "";

      if (!["user", "assistant"].includes(role) || !content) {
        return null;
      }

      return {
        role,
        content: content.slice(0, 2_000),
      };
    })
    .filter(Boolean);
}

function userFacingHttpError(status) {
  if (status === 401 || status === 403) {
    return new AiClientError(
      "DeepSeek API Key 无效或没有访问权限。",
      "AUTH_FAILED",
    );
  }
  if (status === 402) {
    return new AiClientError(
      "DeepSeek 账户余额不足，请充值后再试。",
      "INSUFFICIENT_BALANCE",
    );
  }
  if (status === 429) {
    return new AiClientError(
      "DeepSeek 请求太频繁了，稍后再试一下吧。",
      "RATE_LIMITED",
    );
  }
  if (status >= 500) {
    return new AiClientError(
      "DeepSeek 服务暂时不可用，请稍后重试。",
      "PROVIDER_UNAVAILABLE",
    );
  }
  return new AiClientError(
    `DeepSeek 请求失败（HTTP ${status}）。`,
    "AI_REQUEST_FAILED",
  );
}

async function requestDeepSeekChat({
  apiKey,
  model = "deepseek-v4-flash",
  thinking = false,
  messages,
  systemPrompt,
  fetchImpl = globalThis.fetch,
  timeoutMs = 45_000,
}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new AiClientError(
      "请先在设置中填写 DeepSeek API Key。",
      "API_KEY_MISSING",
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new AiClientError("当前环境不支持网络请求。", "FETCH_UNAVAILABLE");
  }
  if (typeof systemPrompt !== "string" || !systemPrompt.trim()) {
    throw new AiClientError("角色提示词未配置。", "PROMPT_MISSING");
  }

  const cleanModel = validateModel(model);
  const cleanMessages = sanitizeMessages(messages);
  if (!cleanMessages.some((message) => message.role === "user")) {
    throw new AiClientError("没有可发送的用户消息。", "USER_MESSAGE_MISSING");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(
      `${DEFAULT_DEEPSEEK_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: cleanModel,
          messages: [
            { role: "system", content: systemPrompt.trim() },
            ...cleanMessages,
          ],
          stream: false,
          max_tokens: 320,
          thinking: {
            type: thinking ? "enabled" : "disabled",
          },
          ...(thinking ? { reasoning_effort: "high" } : {}),
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw userFacingHttpError(response.status);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new AiClientError(
        "DeepSeek 没有返回可显示的内容。",
        "EMPTY_RESPONSE",
      );
    }

    return {
      content: content.trim().slice(0, 1_500),
      model:
        typeof payload.model === "string" && payload.model
          ? payload.model
          : cleanModel,
      usage: payload.usage
        ? {
            promptTokens: Number(payload.usage.prompt_tokens) || 0,
            completionTokens: Number(payload.usage.completion_tokens) || 0,
          }
        : undefined,
    };
  } catch (error) {
    if (error instanceof AiClientError) {
      throw error;
    }
    if (error?.name === "AbortError") {
      throw new AiClientError(
        "DeepSeek 响应超时，请检查网络后重试。",
        "REQUEST_TIMEOUT",
      );
    }
    throw new AiClientError(
      "无法连接 DeepSeek，请检查网络设置。",
      "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  AiClientError,
  DEFAULT_DEEPSEEK_BASE_URL,
  SUPPORTED_DEEPSEEK_MODELS,
  requestDeepSeekChat,
  sanitizeMessages,
};
