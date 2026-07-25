const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const skillProfile = require("../shared/march7th-skill-profile.json");
const { CompanionStore } = require("./companion-store.cjs");

function createStore(now = "2026-07-25T00:00:00.000Z") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "march-memory-"));
  return new CompanionStore({
    filePath: path.join(directory, "companion-data.json"),
    skillProfile,
    clock: () => now,
  });
}

test("records compact episodes and silently promotes safe explicit memories", () => {
  const store = createStore();
  const episode = store.recordConversationTurn({
    conversationId: "chat",
    turnId: "turn-1",
    userText: "我最喜欢角色剧情，尤其是同伴之间的故事。",
    assistantText: "那咱以后聊故事时会记得照顾你的节奏。",
    replySource: "model",
  });
  assert.ok(episode);
  assert.equal(store.getPendingMemoryEpisodes().length, 1);

  store.applyMemoryRefinement(
    [
      {
        category: "explicit_preference",
        title: "玩家明确表达的偏好",
        summary: "角色剧情和同伴故事",
        confidence: 0.92,
        tags: ["剧情"],
      },
      {
        category: "explicit_preference",
        title: "敏感信息",
        summary: "银行卡密码 123456",
        confidence: 0.99,
      },
    ],
    [episode.id],
  );

  const internal = store.getSnapshot();
  const automatic = internal.memories.find(
    (memory) => memory.origin === "automatic",
  );
  assert.ok(automatic);
  assert.equal(automatic.hidden, true);
  assert.equal(automatic.campaignReusable, true);
  assert.equal(store.getPendingMemoryEpisodes().length, 0);
  assert.equal(
    store.getPlayerSnapshot().memories.some((memory) => memory.id === automatic.id),
    false,
  );
  assert.deepEqual(store.getPlayerSnapshot().conversationEpisodes, []);
  assert.equal(
    store.getRelevantMemoryContext("角色剧情").durable[0].summary,
    "角色剧情和同伴故事",
  );
});

test("memory switch stops episode capture without deleting prior data", () => {
  const store = createStore();
  store.recordConversationTurn({
    conversationId: "chat",
    turnId: "turn-1",
    userText: "今天聊点轻松的。",
    assistantText: "好呀。",
    replySource: "local",
  });
  store.setMemoryEnabled(false);
  const result = store.recordConversationTurn({
    conversationId: "chat",
    turnId: "turn-2",
    userText: "这轮不应该保存。",
    assistantText: "明白。",
    replySource: "local",
  });
  assert.equal(result, undefined);
  assert.equal(store.getSnapshot().conversationEpisodes.length, 1);
  assert.deepEqual(store.getRelevantMemoryContext("轻松"), {
    durable: [],
    episodes: [],
  });
});


test("drops episodic summaries after the 90-day retention window", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "march-memory-expiry-"));
  const filePath = path.join(directory, "companion-data.json");
  const first = new CompanionStore({
    filePath,
    skillProfile,
    clock: () => "2026-01-01T00:00:00.000Z",
  });
  first.recordConversationTurn({
    conversationId: "chat",
    turnId: "turn-old",
    userText: "这是会过期的近期摘要。",
    assistantText: "收到。",
    replySource: "local",
  });
  assert.equal(first.getSnapshot().conversationEpisodes.length, 1);
  const reloaded = new CompanionStore({
    filePath,
    skillProfile,
    clock: () => "2026-04-02T00:00:01.000Z",
  });
  assert.deepEqual(reloaded.getSnapshot().conversationEpisodes, []);
});
