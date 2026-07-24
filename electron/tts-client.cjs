const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_STREAM_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_SPEECH_CHARACTERS = 600;
const { createSseJsonParser } = require("./sse-parser.cjs");

class TtsClientError extends Error {
  constructor(message, code = "TTS_REQUEST_FAILED") {
    super(message);
    this.name = "TtsClientError";
    this.code = code;
  }
}

function sanitizeSpeechText(text) {
  if (typeof text !== "string") {
    throw new TtsClientError("朗读文本格式不正确。", "INVALID_TEXT");
  }

  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#>`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SPEECH_CHARACTERS);

  if (!cleaned) {
    throw new TtsClientError("没有可朗读的文本。", "EMPTY_TEXT");
  }
  return cleaned;
}

function sanitizeInstruction(instruction) {
  if (typeof instruction !== "string") return "";
  return instruction.replace(/\s+/g, " ").trim().slice(0, 50);
}

function userFacingHttpError(status) {
  if (status === 401 || status === 403) {
    return new TtsClientError(
      "DashScope API Key 无效，或没有 CosyVoice 调用权限。",
      "AUTH_FAILED",
    );
  }
  if (status === 429) {
    return new TtsClientError(
      "CosyVoice 请求太频繁了，请稍后再试。",
      "RATE_LIMITED",
    );
  }
  if (status >= 500) {
    return new TtsClientError(
      "CosyVoice 服务暂时不可用，请稍后重试。",
      "PROVIDER_UNAVAILABLE",
    );
  }
  return new TtsClientError(
    `CosyVoice 请求失败（HTTP ${status}）。`,
    "TTS_REQUEST_FAILED",
  );
}

function validateAudioUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TtsClientError("CosyVoice 返回了无效的音频地址。", "INVALID_AUDIO_URL");
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !/(^|\.)aliyuncs\.com$/i.test(parsed.hostname)
  ) {
    throw new TtsClientError(
      "CosyVoice 返回了不受信任的音频地址。",
      "UNTRUSTED_AUDIO_URL",
    );
  }
  parsed.protocol = "https:";
  return parsed.toString();
}

function validateSynthesisInput({ apiKey, config, fetchImpl }) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new TtsClientError(
      "请先配置 DashScope API Key。",
      "API_KEY_MISSING",
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new TtsClientError("当前环境不支持网络请求。", "FETCH_UNAVAILABLE");
  }
  if (
    !config ||
    typeof config.baseUrl !== "string" ||
    typeof config.model !== "string" ||
    typeof config.voiceId !== "string"
  ) {
    throw new TtsClientError("CosyVoice 配置不完整。", "CONFIG_MISSING");
  }
}

function buildSynthesisInput({
  cleanText,
  config,
  rate,
  instruction,
  format,
}) {
  const cleanRate = Math.min(1.3, Math.max(0.7, Number(rate) || 1));
  const cleanInstruction = sanitizeInstruction(
    instruction || config.defaultInstruction,
  );

  return {
    text: cleanText,
    voice: config.voiceId,
    format,
    sample_rate: config.sampleRate || 24_000,
    volume: 50,
    rate: cleanRate,
    pitch: 1,
    language_hints: [config.language || "zh"],
    ...(cleanInstruction ? { instruction: cleanInstruction } : {}),
  };
}

async function synthesizeCosyVoice({
  apiKey,
  text,
  config,
  rate = 1,
  instruction,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  validateSynthesisInput({ apiKey, config, fetchImpl });

  const cleanText = sanitizeSpeechText(text);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(
      `${config.baseUrl.replace(/\/$/, "")}/services/audio/tts/SpeechSynthesizer`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          input: buildSynthesisInput({
            cleanText,
            config,
            rate,
            instruction,
            format: config.format || "wav",
          }),
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) throw userFacingHttpError(response.status);
    const payload = await response.json();
    const remoteAudioUrl = payload?.output?.audio?.url;
    if (typeof remoteAudioUrl !== "string" || !remoteAudioUrl) {
      throw new TtsClientError(
        "CosyVoice 没有返回音频地址。",
        "EMPTY_AUDIO_RESPONSE",
      );
    }

    const audioResponse = await fetchImpl(validateAudioUrl(remoteAudioUrl), {
      signal: controller.signal,
    });
    if (!audioResponse.ok) {
      throw new TtsClientError(
        "无法下载 CosyVoice 生成的音频。",
        "AUDIO_DOWNLOAD_FAILED",
      );
    }

    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    if (!audioBuffer.length || audioBuffer.length > MAX_AUDIO_BYTES) {
      throw new TtsClientError(
        "CosyVoice 返回的音频大小不正确。",
        "INVALID_AUDIO_SIZE",
      );
    }

    return {
      audioBase64: audioBuffer.toString("base64"),
      mimeType:
        config.format === "mp3"
          ? "audio/mpeg"
          : config.format === "opus"
            ? "audio/opus"
            : "audio/wav",
      characters: Number(payload?.usage?.characters) || cleanText.length,
      model: config.model,
      voiceId: config.voiceId,
    };
  } catch (error) {
    if (error instanceof TtsClientError) throw error;
    if (error?.name === "AbortError") {
      throw new TtsClientError(
        "CosyVoice 响应超时，请稍后重试。",
        "REQUEST_TIMEOUT",
      );
    }
    throw new TtsClientError(
      "无法连接 CosyVoice，请检查网络设置。",
      "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function streamCosyVoice({
  apiKey,
  text,
  config,
  rate = 1,
  instruction,
  fetchImpl = globalThis.fetch,
  timeoutMs = 60_000,
  signal,
  onAudioChunk = () => {},
  onSentence = () => {},
}) {
  validateSynthesisInput({ apiKey, config, fetchImpl });
  const cleanText = sanitizeSpeechText(text);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  signal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let firstChunkMs;
  let audioChunks = 0;
  let audioBytes = 0;
  let characters = cleanText.length;

  try {
    const response = await fetchImpl(
      `${config.baseUrl.replace(/\/$/, "")}/services/audio/tts/SpeechSynthesizer`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
          "X-DashScope-SSE": "enable",
        },
        body: JSON.stringify({
          model: config.model,
          input: buildSynthesisInput({
            cleanText,
            config,
            rate,
            instruction,
            format: config.streamingFormat || "pcm",
          }),
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) throw userFacingHttpError(response.status);
    if (!response.body || typeof response.body.getReader !== "function") {
      throw new TtsClientError(
        "当前环境无法读取 CosyVoice 音频流。",
        "STREAM_UNAVAILABLE",
      );
    }

    const parser = createSseJsonParser((payload) => {
      if (payload?.code || payload?.message) {
        throw new TtsClientError(
          "CosyVoice 流式合成失败，请稍后重试。",
          payload?.code || "STREAM_FAILED",
        );
      }

      const output = payload?.output;
      const audioBase64 = output?.audio?.data;
      characters =
        Number(payload?.usage?.characters) || characters;

      if (output?.type === "sentence-begin") {
        onSentence({
          index: Number(output?.sentence?.index) || 0,
          text: output?.original_text || "",
        });
      }

      if (typeof audioBase64 !== "string" || !audioBase64) return;
      const padding = audioBase64.endsWith("==")
        ? 2
        : audioBase64.endsWith("=")
          ? 1
          : 0;
      const chunkBytes =
        Math.floor((audioBase64.length * 3) / 4) - padding;
      audioBytes += chunkBytes;
      if (audioBytes > MAX_STREAM_AUDIO_BYTES) {
        throw new TtsClientError(
          "CosyVoice 返回的音频流过大。",
          "STREAM_TOO_LARGE",
        );
      }

      audioChunks += 1;
      if (firstChunkMs === undefined) {
        firstChunkMs = Date.now() - startedAt;
      }
      onAudioChunk({
        audioBase64,
        index: audioChunks - 1,
        sampleRate: config.sampleRate || 24_000,
      });
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.finish();

    if (!audioChunks) {
      throw new TtsClientError(
        "CosyVoice 没有返回流式音频数据。",
        "EMPTY_AUDIO_STREAM",
      );
    }

    return {
      characters,
      audioChunks,
      audioBytes,
      firstChunkMs: firstChunkMs ?? Date.now() - startedAt,
      sampleRate: config.sampleRate || 24_000,
      model: config.model,
      voiceId: config.voiceId,
    };
  } catch (error) {
    if (error instanceof TtsClientError) throw error;
    if (error?.name === "AbortError") {
      if (signal?.aborted) {
        throw new TtsClientError("语音播放已停止。", "CANCELLED");
      }
      throw new TtsClientError(
        "CosyVoice 流式响应超时，请稍后重试。",
        "REQUEST_TIMEOUT",
      );
    }
    if (error instanceof SyntaxError) {
      throw new TtsClientError(
        "CosyVoice 返回了无法解析的音频流。",
        "INVALID_STREAM_RESPONSE",
      );
    }
    throw new TtsClientError(
      "无法连接 CosyVoice 流式服务，请检查网络设置。",
      "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

module.exports = {
  MAX_SPEECH_CHARACTERS,
  TtsClientError,
  sanitizeSpeechText,
  streamCosyVoice,
  synthesizeCosyVoice,
  validateAudioUrl,
};
