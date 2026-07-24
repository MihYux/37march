const assert = require("node:assert/strict");
const test = require("node:test");
const skillProfile = require("../shared/march7th-skill-profile.json");
const {
  createFixedFactEntries,
  renderCampaignMessage,
  reviewCampaignMessage,
  reviewCampaignTask,
} = require("./campaign-review.cjs");
const {
  createDefaultCompanionData,
} = require("./companion-store.cjs");

const NOW = "2026-07-24T08:00:00.000Z";

function createCampaign() {
  const facts = {
    dataNature: "全部内容均为产品内模拟数据",
    versionName: "概念版本",
    eventTime: "2026年8月7日 10:00（模拟）",
    actionTarget: "product://campaign/campaign-review-test",
    rewardStatement: "奖励信息仅为模拟占位，不代表真实游戏内容",
  };
  return {
    id: "campaign-review-test",
    characterId: skillProfile.characterId,
    version: "概念版本",
    region: "japan",
    targetSegments: ["story"],
    objective: "launch",
    globalTheme: "和三月七继续旅行",
    sellingPoints: ["一段新的模拟旅程"],
    narrativeApproach: "从玩家允许引用的照片约定切入。",
    fixedFacts: facts,
    fixedFactEntries: createFixedFactEntries(facts, NOW),
    allowedMemoryTypes: ["choice", "photo"],
    schedule: [
      {
        id: "schedule-preheat",
        phase: "preheat",
        scheduledAt: NOW,
        templateId: "march7th-version-preheat-v1",
      },
      {
        id: "schedule-launch",
        phase: "launch",
        scheduledAt: "2026-08-07T08:00:00.000Z",
        templateId: "march7th-version-invitation-v1",
      },
      {
        id: "schedule-sustain",
        phase: "sustain",
        scheduledAt: "2026-08-14T08:00:00.000Z",
        templateId: "march7th-version-sustain-v1",
      },
      {
        id: "schedule-complete",
        phase: "complete",
        scheduledAt: "2026-09-18T08:00:00.000Z",
        templateId: "campaign-complete-v1",
      },
    ],
    generationMode: "template_variables",
    frequencyLimit: "版本周期最多一次召回。",
    reviewRequired: true,
    expandConditions: ["人工批准"],
    throttleConditions: ["玩家忽略"],
    stopConditions: ["玩家退订"],
    status: "draft",
  };
}

test("campaign review requires locked facts and complete schedule", () => {
  const campaign = createCampaign();
  const passed = reviewCampaignTask({
    campaign,
    skill: skillProfile,
    now: NOW,
  });
  assert.equal(passed.passed, true);

  campaign.fixedFactEntries.find(
    (fact) => fact.key === "eventTime",
  ).locked = false;
  campaign.schedule = campaign.schedule.filter(
    (item) => item.phase !== "complete",
  );
  const failed = reviewCampaignTask({
    campaign,
    skill: skillProfile,
    now: NOW,
  });
  assert.equal(failed.passed, false);
  assert.deepEqual(
    failed.checks
      .filter((item) => item.status === "fail")
      .map((item) => item.id),
    ["fixed-facts-locked", "schedule-coverage"],
  );
});

test("campaign renderer only selects an authorized reusable memory", () => {
  const data = createDefaultCompanionData({
    skillProfile,
    now: NOW,
  });
  const campaign = createCampaign();
  data.profile.memoryEnabled = true;
  data.relationship.memoryEnabled = true;
  data.memories.push(
    {
      id: "memory-blocked",
      playerId: data.profile.id,
      characterId: skillProfile.characterId,
      type: "choice",
      title: "不允许引用",
      summary: "这条记忆已经关闭复用。",
      characterText: "",
      createdAt: NOW,
      status: "confirmed",
      reusableByCharacter: false,
      campaignReusable: false,
      userConfirmed: true,
    },
    {
      id: "memory-allowed",
      playerId: data.profile.id,
      characterId: skillProfile.characterId,
      type: "photo",
      title: "一起拍过的照片",
      summary: "获准引用的照片。",
      characterText: "",
      createdAt: NOW,
      status: "confirmed",
      reusableByCharacter: true,
      campaignReusable: true,
      userConfirmed: true,
    },
  );

  const rendered = renderCampaignMessage({
    data,
    campaign,
    phase: "launch",
    now: NOW,
  });
  assert.deepEqual(rendered.memoryIds, ["memory-allowed"]);
  assert.ok(rendered.body.includes("概念版本"));
  assert.ok(!rendered.body.includes("不允许引用"));
  assert.equal(
    rendered.action.targetId,
    "product://campaign/campaign-review-test",
  );
});

test("message review rejects altered facts and external links", () => {
  const data = createDefaultCompanionData({
    skillProfile,
    now: NOW,
  });
  const campaign = createCampaign();
  const rendered = renderCampaignMessage({
    data,
    campaign,
    phase: "launch",
    now: NOW,
  });
  const message = {
    id: "message-review-test",
    characterId: skillProfile.characterId,
    playerId: data.profile.id,
    type: rendered.type,
    title: rendered.title,
    body: rendered.body,
    createdAt: NOW,
    eventId: "event-review-test",
    campaignId: campaign.id,
    reviewStatus: "draft",
    trace: {
      skillVersion: skillProfile.skillVersion,
      templateId: rendered.templateId,
      ruleIds: [
        "knowledge.fixed_facts_only",
        "campaign.single_call_to_action",
      ],
      fixedFactIds: rendered.fixedFactIds,
      memoryIds: [],
      generatedAt: NOW,
    },
    favorite: false,
    liked: false,
    remindLater: false,
    action: rendered.action,
  };

  assert.equal(
    reviewCampaignMessage({
      message,
      campaign,
      data,
      skill: skillProfile,
      now: NOW,
    }).passed,
    true,
  );

  message.body =
    "另一个未经审核的版本已经开启，立即访问 https://example.com";
  message.action.targetId = "https://example.com";
  const failed = reviewCampaignMessage({
    message,
    campaign,
    data,
    skill: skillProfile,
    now: NOW,
  });
  assert.equal(failed.passed, false);
  assert.ok(
    failed.checks.some(
      (item) =>
        item.id === "fixed-facts-trace" &&
        item.status === "fail",
    ),
  );
  assert.ok(
    failed.checks.some(
      (item) =>
        item.id === "safe-copy" && item.status === "fail",
    ),
  );
});
