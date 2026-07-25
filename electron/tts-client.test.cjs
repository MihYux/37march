const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TtsClientError,
  sanitizeSpeechText,
  streamCosyVoice,
  synthesizeCosyVoice,
  validateAudioUrl,
} = require("./tts-client.cjs");

const config = {
  provider: "dashscope",
  baseUrl: "https://dashscope.aliyuncs.com/api/v1",
  model: "cosyvoice-v3.5-flash",
  voiceId: "cosyvoice-v3.5-flash-marchpet-test",
  format: "wav",
  streamingFormat: "pcm",
  sampleRate: 24000,
  language: "zh",
  defaultInstruction: "请自然表达。",
};

test("synthesizes with the configured cloned voice and downloads audio", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (requests.length === 1) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            output: {
              audio: {
                url: "http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav",
              },
            },
            usage: { characters: 5 },
          };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async arrayBuffer() {
        return Uint8Array.from([82, 73, 70, 70]).buffer;
      },
    };
  };

  const result = await synthesizeCosyVoice({
    apiKey: "sk-test",
    text: "你好，开拓者！",
    config,
    fetchImpl,
  });

  const body = JSON.parse(requests[0].options.body);
  assert.equal(
    requests[0].url,
    "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer",
  );
  assert.equal(body.model, "cosyvoice-v3.5-flash");
  assert.equal(body.input.voice, config.voiceId);
  assert.equal(body.input.sample_rate, 24000);
  assert.equal(
    requests[1].url,
    "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav",
  );
  assert.equal(result.audioBase64, "UklGRg==");
  assert.equal(result.mimeType, "audio/wav");
});

test("rejects untrusted provider audio URLs", () => {
  assert.throws(
    () => validateAudioUrl("https://example.com/audio.wav"),
    (error) => {
      assert.ok(error instanceof TtsClientError);
      assert.equal(error.code, "UNTRUSTED_AUDIO_URL");
      return true;
    },
  );
});

test("cleans markdown before speech synthesis", () => {
  assert.equal(
    sanitizeSpeechText("**你好**，[来看看](https://example.com)吧。"),
    "你好，来看看吧。",
  );
});

test("streams PCM chunks from DashScope SSE as soon as they arrive", async () => {
  const encoder = new TextEncoder();
  const sseChunks = [
    'data: {"output":{"type":"sentence-begin","original_text":"你好，开拓者！","sentence":{"index":0},"audio":{"data":""}},"usage":{"characters":7}}\n\n',
    'data: {"output":{"type":"sentence-synthesis","audio":{"data":"AAABAA=="}},"usage":{"characters":7}}\n\n',
    'data: {"output":{"type":"sentence-synthesis","audio":{"data":"//8AAP//"}},"usage":{"characters":7}}\n\n',
    'data: {"output":{"finish_reason":"stop","audio":{"data":""}},"usage":{"characters":7}}\n\n',
  ].map((value) => encoder.encode(value));
  const receivedAudio = [];
  const receivedSentences = [];
  let requestOptions;
  const fetchImpl = async (_url, options) => {
    requestOptions = options;
    let index = 0;
    return {
      ok: true,
      status: 200,
      body: {
        getReader() {
          return {
            async read() {
              if (index >= sseChunks.length) {
                return { done: true, value: undefined };
              }
              return { done: false, value: sseChunks[index++] };
            },
          };
        },
      },
    };
  };

  const result = await streamCosyVoice({
    apiKey: "sk-test",
    text: "你好，开拓者！",
    config,
    fetchImpl,
    onAudioChunk: (chunk) => receivedAudio.push(chunk),
    onSentence: (sentence) => receivedSentences.push(sentence),
  });

  const body = JSON.parse(requestOptions.body);
  assert.equal(requestOptions.headers["X-DashScope-SSE"], "enable");
  assert.equal(body.input.format, "pcm");
  assert.equal(receivedAudio.length, 2);
  assert.equal(receivedAudio[0].audioBase64, "AAABAA==");
  assert.equal(receivedAudio[0].sampleRate, 24000);
  assert.deepEqual(receivedSentences, [
    { index: 0, text: "你好，开拓者！" },
  ]);
  assert.equal(result.audioChunks, 2);
  assert.equal(result.audioBytes, 10);
  assert.equal(result.characters, 7);
});

test("rejects an SSE response that has no audio chunks", async () => {
  const encoder = new TextEncoder();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    body: {
      getReader() {
        let read = false;
        return {
          async read() {
            if (read) return { done: true, value: undefined };
            read = true;
            return {
              done: false,
              value: encoder.encode(
                'data: {"output":{"finish_reason":"stop","audio":{"data":""}}}\n\n',
              ),
            };
          },
        };
      },
    },
  });

  await assert.rejects(
    streamCosyVoice({
      apiKey: "sk-test",
      text: "你好",
      config,
      fetchImpl,
    }),
    (error) => {
      assert.ok(error instanceof TtsClientError);
      assert.equal(error.code, "EMPTY_AUDIO_STREAM");
      return true;
    },
  );
});
