const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const skillProfile = require("../shared/march7th-skill-profile.json");
const { CompanionStore } = require("./companion-store.cjs");

const TEST_NOW = "2026-07-24T08:00:00.000Z";

function createStore() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "march7th-prd-acceptance-"),
  );
  return new CompanionStore({
    filePath: path.join(directory, "companion-data.json"),
    skillProfile,
    clock: () => TEST_NOW,
  });
}

function approveAndDeliverLatest(store, type) {
  let data = store.getSnapshot();
  const message = data.messages.find(
    (item) =>
      item.type === type &&
      item.reviewStatus === "awaiting_human_review" &&
      !item.sentAt,
  );
  assert.ok(message, `${type} message should await human review`);

  data = store.reviewCampaignMessage(message.id, {
    decision: "approved",
    reviewer: "PRD 验收",
    note: "Skill、固定事实、玩家授权和联系策略均已核对。",
  });
  assert.equal(
    data.messages.find((item) => item.id === message.id).reviewStatus,
    "approved",
  );

  data = store.publishCampaignBundle(
    message.campaignId,
    "PRD 验收",
  );
  data = store.deliverCampaignMessage(message.id);
  const delivered = data.messages.find((item) => item.id === message.id);
  assert.equal(delivered.sentAt, data.demoNow);
  return delivered;
}

test("default three-minute demo covers Day 1, 14 and 42 end to end", () => {
  const startedAt = Date.now();
  const store = createStore();
  const baseline = store.resetDemo();

  assert.equal(baseline.demoScenarioId, "japan_story");
  assert.equal(baseline.isDemoData, true);
  assert.equal(baseline.skill.skillVersion, skillProfile.skillVersion);
  assert.equal(baseline.profile.onboardingCompleted, true);
  assert.ok(baseline.memories.some((memory) => memory.userConfirmed));
  assert.ok(
    baseline.campaigns.every(
      (campaign) =>
        campaign.fixedFacts.dataNature ===
        "全部内容均为产品内模拟数据",
    ),
  );

  let data = store.advanceDemoTime({ day: 1 });
  assert.equal(data.demoNow, "2026-07-25T08:00:00.000Z");
  const preheat = approveAndDeliverLatest(
    store,
    "version_preheat",
  );
  data = store.setMessageFavorite(preheat.id, true);
  assert.equal(
    data.messages.find((message) => message.id === preheat.id)
      .favorite,
    true,
  );

  data = store.advanceDemoTime({ day: 14 });
  assert.equal(data.demoNow, "2026-08-07T08:00:00.000Z");
  assert.equal(data.relationship.relationshipStage, "companion");
  const launch = approveAndDeliverLatest(store, "version_launch");
  data = store.respondToMessage(launch.id, "like");
  assert.equal(
    data.messages.find((message) => message.id === launch.id).liked,
    true,
  );
  assert.ok(launch.action?.targetId.startsWith("product://"));
  assert.ok(launch.trace.fixedFactIds.length >= 4);
  assert.equal(launch.trace.skillVersion, skillProfile.skillVersion);

  data = store.advanceDemoTime({ day: 42 });
  assert.equal(data.demoNow, "2026-09-04T08:00:00.000Z");
  const sustain = approveAndDeliverLatest(
    store,
    "version_sustain",
  );
  data = store.respondToMessage(sustain.id, "not_interested");
  assert.equal(data.campaigns[0].status, "paused");
  assert.deepEqual(data.relationship.activeCampaignIds, []);
  assert.ok(data.profile.allowedContentTypes.includes("daily"));
  assert.ok(
    data.executionLog.some(
      (entry) => entry.action === "message_response_not_interested",
    ),
  );

  const reset = store.resetDemo();
  assert.deepEqual(reset, baseline);
  assert.ok(
    Date.now() - startedAt < 180_000,
    "the deterministic demo must fit in three minutes",
  );
});

test("memory reuse revocation survives later campaign generation", () => {
  const store = createStore();
  let data = store.resetDemo();
  const memory = data.memories.find(
    (item) => item.reusableByCharacter,
  );
  assert.ok(memory);

  data = store.setMemoryReusable(memory.id, false);
  assert.equal(
    data.memories.find((item) => item.id === memory.id)
      .reusableByCharacter,
    false,
  );

  data = store.advanceDemoTime({ day: 14 });
  const launch = data.messages.find(
    (message) => message.type === "version_launch",
  );
  assert.ok(launch);
  assert.equal(launch.trace.memoryIds.includes(memory.id), false);
});
