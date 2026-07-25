const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const skillProfile = require("../shared/march7th-skill-profile.json");
const {
  parseCampaignGenerationResult,
} = require("./campaign-generator.cjs");
const {
  CompanionStore,
} = require("./companion-store.cjs");
const {
  CONTACT_SUPPRESSION,
  evaluateContactPolicy,
} = require("./contact-policy.cjs");
const {
  containsSensitiveMemory,
  extractMemoryCandidate,
} = require("./memory-candidates.cjs");
const {
  parseCampaignDocument,
  retrieveApprovedKnowledge,
} = require("./release-knowledge.cjs");

const NOW = "2026-07-24T08:00:00.000Z";

function makeStore() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "march7th-release-system-"),
  );
  return new CompanionStore({
    filePath: path.join(directory, "companion-data.json"),
    skillProfile,
    clock: () => NOW,
  });
}

function onboardingInput() {
  return {
    displayName: "测试玩家",
    proactiveContactEnabled: true,
    allowedContentTypes: [
      "daily",
      "photo",
      "relationship",
      "version_preheat",
      "version_launch",
      "version_sustain",
    ],
    recallEnabled: false,
    personalizationEnabled: true,
    memoryEnabled: true,
    quietHours: { start: "22:00", end: "09:00" },
    weeklyContactLimit: 2,
    consentAccepted: true,
    firstChoice: "take_photos",
  };
}

test("memory candidates require explicit non-sensitive player statements", () => {
  const candidate = extractMemoryCandidate({
    text: "我最喜欢拍夜景",
    playerId: "player",
    characterId: "march-7th",
    sourceId: "chat-1",
    now: NOW,
  });
  assert.equal(candidate.category, "explicit_preference");
  assert.equal(candidate.summary, "拍夜景");
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.userConfirmed, false);
  assert.equal(
    containsSensitiveMemory("我的银行卡密码是 123456"),
    true,
  );
  assert.equal(
    extractMemoryCandidate({
      text: "我的银行卡密码是 123456",
      playerId: "player",
      characterId: "march-7th",
      sourceId: "chat-2",
      now: NOW,
    }),
    undefined,
  );
});

test("player confirms a memory before chat or campaign reuse", () => {
  const store = makeStore();
  store.completeOnboarding(onboardingInput());
  const candidate = store.proposeChatMemoryCandidate(
    "我喜欢探索雪原",
    "chat-1",
  );
  assert.ok(candidate);
  assert.equal(
    store.getAuthorizedChatMemories("雪原").some(
      (memory) => memory.id === candidate.id,
    ),
    false,
  );

  let data = store.resolveMemoryCandidate(candidate.id, true);
  let memory = data.memories.find((item) => item.id === candidate.id);
  assert.equal(memory.status, "confirmed");
  assert.equal(memory.campaignReusable, false);
  assert.equal(
    store.getAuthorizedChatMemories("雪原").some(
      (item) => item.id === candidate.id,
    ),
    true,
  );

  data = store.setMemoryCampaignReusable(candidate.id, true);
  memory = data.memories.find((item) => item.id === candidate.id);
  assert.equal(memory.campaignReusable, true);
});

test("pasted release plans are chunked and retrieval honors review and embargo", async () => {
  const parsed = await parseCampaignDocument({
    fileName: "version-plan.txt",
    text: "版本玩法\n\n玩家可以和三月七拍摄新的旅行照片。\n\n常见问题\n\n活动入口只在产品内开放。",
    now: NOW,
  });
  assert.equal(parsed.source.format, "txt");
  assert.ok(parsed.chunks.length >= 1);
  const chunk = parsed.chunks[0];
  chunk.approved = true;
  chunk.availableFrom = "2026-07-25T00:00:00.000Z";

  assert.deepEqual(
    retrieveApprovedKnowledge({
      chunks: parsed.chunks,
      query: "旅行照片",
      phase: "launch",
      region: "japan",
      segments: [],
      now: NOW,
    }),
    [],
  );
  chunk.availableFrom = NOW;
  const selected = retrieveApprovedKnowledge({
    chunks: parsed.chunks,
    query: "旅行照片",
    phase: "launch",
    region: "japan",
    segments: [],
    now: NOW,
  });
  assert.equal(selected[0].id, chunk.id);
});

test("campaign generation JSON is bounded and rejects invalid output", () => {
  const parsed = parseCampaignGenerationResult(
    JSON.stringify({
      title: "新旅程开场啦",
      body: "咱把照片收好啦，新旅程也已经开启。想看时再一起去。",
      actionId: "product://campaign/test",
      usedFactIds: ["fact-versionName"],
      usedKnowledgeChunkIds: ["knowledge-1"],
      riskFlags: [],
    }),
  );
  assert.equal(parsed.usedFactIds[0], "fact-versionName");
  assert.throws(
    () => parseCampaignGenerationResult("not json"),
    /有效的发行候选 JSON/,
  );
});

test("contact policy enforces kill switch, 24-hour cooldown and one version contact weekly", () => {
  const store = makeStore();
  const data = store.completeOnboarding(onboardingInput());
  const event = {
    id: "event-version",
    trigger: "version_launch",
    playerId: data.profile.id,
    characterId: data.skill.characterId,
    payload: {
      contentType: "version_launch",
      templateId: "launch-test",
    },
    status: "queued",
  };

  data.globalCampaignKillSwitch = true;
  assert.equal(
    evaluateContactPolicy({ data, event, now: NOW }).reason,
    CONTACT_SUPPRESSION.GLOBAL_KILL_SWITCH,
  );

  data.globalCampaignKillSwitch = false;
  data.messages = [];
  data.messages.push({
    id: "recent-daily",
    type: "daily",
    deliveryMode: "proactive",
    sentAt: "2026-07-24T00:00:00.000Z",
  });
  assert.equal(
    evaluateContactPolicy({ data, event, now: NOW }).reason,
    CONTACT_SUPPRESSION.MINIMUM_INTERVAL,
  );

  data.messages[0].sentAt = "2026-07-22T00:00:00.000Z";
  data.profile.weeklyContactLimit = 4;
  data.messages.push({
    id: "recent-version",
    type: "version_preheat",
    deliveryMode: "proactive",
    sentAt: "2026-07-21T00:00:00.000Z",
  });
  assert.equal(
    evaluateContactPolicy({ data, event, now: NOW }).reason,
    CONTACT_SUPPRESSION.VERSION_WEEKLY_LIMIT,
  );
});
