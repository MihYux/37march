const assert = require("node:assert/strict");
const test = require("node:test");
const {
  AiClientError,
  requestDeepSeekChat,
  sanitizeMessages,
} = require("./ai-client.cjs");

test("sends a short non-thinking DeepSeek V4 request", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          model: "deepseek-v4-flash",
          choices: [{ message: { content: "欸，咱在呢！" } }],
          usage: { prompt_tokens: 12, completion_tokens: 6 },
        };
      },
    };
  };

  const result = await requestDeepSeekChat({
    apiKey: "sk-test",
    messages: [{ role: "user", content: "你好" }],
    systemPrompt: "使用第一人称“咱”。",
    fetchImpl,
  });

  assert.equal(request.url, "https://api.deepseek.com/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer sk-test");
  assert.equal(request.body.model, "deepseek-v4-flash");
  assert.deepEqual(request.body.thinking, { type: "disabled" });
  assert.equal(request.body.messages[0].role, "system");
  assert.equal(result.content, "欸，咱在呢！");
});

test("maps provider authorization failures to a safe message", async () => {
  await assert.rejects(
    requestDeepSeekChat({
      apiKey: "sk-invalid",
      messages: [{ role: "user", content: "你好" }],
      systemPrompt: "角色提示词",
      fetchImpl: async () => ({ ok: false, status: 401 }),
    }),
    (error) => {
      assert.ok(error instanceof AiClientError);
      assert.equal(error.code, "AUTH_FAILED");
      assert.equal(error.message, "DeepSeek API Key 无效或没有访问权限。");
      assert.ok(!error.message.includes("sk-invalid"));
      return true;
    },
  );
});

test("sanitizes conversation roles, length and empty messages", () => {
  const longText = "a".repeat(2_500);
  const clean = sanitizeMessages([
    { role: "system", content: "untrusted system" },
    { role: "assistant", content: "  " },
    { role: "user", content: longText },
  ]);

  assert.equal(clean.length, 1);
  assert.equal(clean[0].role, "user");
  assert.equal(clean[0].content.length, 2_000);
});


test("keeps ten complete conversation turns for model context", () => {
  const messages = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message-${index}`,
  }));
  const clean = sanitizeMessages(messages);

  assert.equal(clean.length, 20);
  assert.equal(clean[0].content, "message-4");
  assert.equal(clean.at(-1).content, "message-23");
});
