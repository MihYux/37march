const {
  reviewCampaignTask,
} = require("./campaign-review.cjs");

const DEMO_BASE_NOW = "2026-07-24T08:00:00.000Z";

const DEMO_SCENARIOS = Object.freeze({
  japan_story: {
    id: "japan_story",
    name: "日本剧情玩家",
    regionLabel: "日本 · Asia/Tokyo",
    playerLabel: "重剧情与角色关系",
    description:
      "允许日常、旅行和版本消息，保留共同记忆，但不接受低频召回。",
    expectedBehavior:
      "正常收到预热与上线候选内容，可引用获准共同记忆。",
    profile: {
      id: "demo-player-jp",
      displayName: "小遥",
      region: "japan",
      language: "ja-JP",
      timeZone: "Asia/Tokyo",
      playerType: ["story", "character_relationship"],
      allowedContentTypes: [
        "daily",
        "photo",
        "postcard",
        "relationship",
        "version_preheat",
        "version_launch",
        "version_sustain",
      ],
      proactiveContactEnabled: true,
      recallEnabled: false,
      personalizationEnabled: true,
      memoryEnabled: true,
      quietHours: {
        start: "22:00",
        end: "09:00",
      },
      weeklyContactLimit: 2,
    },
    memoryMode: "story",
  },
  china_active: {
    id: "china_active",
    name: "中国活跃玩家",
    regionLabel: "中国 · Asia/Shanghai",
    playerLabel: "高活跃与共同记录",
    description:
      "允许日常、照片和版本内容，互动频繁，每周联系上限更高。",
    expectedBehavior:
      "排期正常进入审核队列，关系阶段较快进入熟悉与同行。",
    profile: {
      id: "demo-player-cn",
      displayName: "阿星",
      region: "china",
      language: "zh-CN",
      timeZone: "Asia/Shanghai",
      playerType: ["active", "photo", "event"],
      allowedContentTypes: [
        "daily",
        "photo",
        "relationship",
        "version_preheat",
        "version_launch",
        "version_sustain",
      ],
      proactiveContactEnabled: true,
      recallEnabled: false,
      personalizationEnabled: true,
      memoryEnabled: true,
      quietHours: {
        start: "23:00",
        end: "08:00",
      },
      weeklyContactLimit: 3,
    },
    memoryMode: "active",
  },
  north_america_intensity: {
    id: "north_america_intensity",
    name: "北美强度玩家",
    regionLabel: "北美 · America/Los_Angeles",
    playerLabel: "关注玩法强度，低打扰",
    description:
      "只允许版本上线与持续内容，关闭长期记忆，每周最多一次联系。",
    expectedBehavior:
      "相同时刻会命中当地勿扰，且不得引用任何共同记忆。",
    profile: {
      id: "demo-player-na",
      displayName: "Nova",
      region: "north_america",
      language: "en-US",
      timeZone: "America/Los_Angeles",
      playerType: ["combat_intensity", "low_interruption"],
      allowedContentTypes: [
        "version_launch",
        "version_sustain",
      ],
      proactiveContactEnabled: true,
      recallEnabled: false,
      personalizationEnabled: false,
      memoryEnabled: false,
      quietHours: {
        start: "23:00",
        end: "08:00",
      },
      weeklyContactLimit: 1,
    },
    memoryMode: "none",
  },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function addDays(isoDate, days) {
  return new Date(
    Date.parse(isoDate) + days * 24 * 60 * 60 * 1_000,
  ).toISOString();
}

function getDemoScenarioSummaries() {
  return Object.values(DEMO_SCENARIOS).map(
    ({
      id,
      name,
      regionLabel,
      playerLabel,
      description,
      expectedBehavior,
    }) => ({
      id,
      name,
      regionLabel,
      playerLabel,
      description,
      expectedBehavior,
    }),
  );
}

function createScenarioMemories(data, mode) {
  if (mode === "none") return [];
  const choice = {
    id: `memory-${data.profile.id}-choice`,
    playerId: data.profile.id,
    characterId: data.skill.characterId,
    type: "choice",
    title: "下一次同行的约定",
    summary: "下次遇见好看的风景，要一起多拍几张照片。",
    characterText:
      "说好啦，漂亮风景可不许偷偷溜走。咱们到时候一起拍下来！",
    createdAt: DEMO_BASE_NOW,
    reusableByCharacter: true,
    userConfirmed: true,
    sourceEventId: `event-${data.profile.id}-choice`,
    visual: {
      assetId: "march7th-static-concept-v1",
      alt: "三月七举着相机记下模拟玩家的同行约定",
    },
  };
  if (mode === "story") return [choice];
  return [
    {
      id: `memory-${data.profile.id}-photo`,
      playerId: data.profile.id,
      characterId: data.skill.characterId,
      type: "photo",
      title: "一起拍下的列车窗景",
      summary: "在列车窗边停下来，保存了一张共同照片。",
      characterText:
        "普通的一天也值得拍下来嘛。以后翻到这页，肯定会想起现在。",
      createdAt: addDays(DEMO_BASE_NOW, 1),
      reusableByCharacter: true,
      userConfirmed: true,
      sourceEventId: `event-${data.profile.id}-photo`,
      visual: {
        assetId: "march7th-static-concept-v1",
        alt: "三月七在列车窗边保存共同照片",
      },
    },
    choice,
  ];
}

function applyDemoScenario(baseData, scenarioId) {
  const definition = DEMO_SCENARIOS[scenarioId];
  if (!definition) throw new Error("演示玩家场景不存在。");
  const data = clone(baseData);
  const profile = clone(definition.profile);
  Object.assign(data, {
    createdAt: DEMO_BASE_NOW,
    updatedAt: DEMO_BASE_NOW,
    demoNow: DEMO_BASE_NOW,
    demoStartedAt: DEMO_BASE_NOW,
    demoScenarioId: scenarioId,
  });
  Object.assign(data.profile, profile, {
    selectedCharacterId: data.skill.characterId,
    reducedContentTypes: [],
    onboardingCompleted: true,
    consentVersion: "rehoyo-companion-consent-v1",
  });
  Object.assign(data.relationship, {
    playerId: profile.id,
    characterId: data.skill.characterId,
    relationshipStage: "new",
    joinedAt: DEMO_BASE_NOW,
    lastInteractionAt: DEMO_BASE_NOW,
    proactiveContactEnabled: profile.proactiveContactEnabled,
    allowedContentTypes: clone(profile.allowedContentTypes),
    reducedContentTypes: [],
    personalizationEnabled: profile.personalizationEnabled,
    memoryEnabled: profile.memoryEnabled,
    quietHours: clone(profile.quietHours),
    weeklyContactLimit: profile.weeklyContactLimit,
    ignoredCount: 0,
    quietUntil: undefined,
    consentVersion: "rehoyo-companion-consent-v1",
    activeCampaignIds: ["campaign-demo-march7th"],
    paused: false,
  });
  data.memories = createScenarioMemories(
    data,
    definition.memoryMode,
  );
  data.events = [];
  data.messages = [
    {
      id: `message-${profile.id}-welcome`,
      characterId: data.skill.characterId,
      playerId: profile.id,
      type: "relationship",
      title: "本地演示同行已载入",
      body: "好啦，演示行程准备完毕。咱们按自己的节奏慢慢走！",
      createdAt: DEMO_BASE_NOW,
      eventId: `event-${profile.id}-welcome`,
      reviewStatus: "approved",
      trace: {
        skillVersion: data.skill.skillVersion,
        templateId: "march7th-first-join-v1",
        ruleIds: [
          "safety.demo_data_only",
          "relationship.player_choice_first",
        ],
        fixedFactIds: [],
        memoryIds: [],
        generatedAt: DEMO_BASE_NOW,
      },
      sentAt: DEMO_BASE_NOW,
      deliveryMode: "response",
      readAt: DEMO_BASE_NOW,
      favorite: false,
      liked: false,
      remindLater: false,
    },
  ];
  const campaign = data.campaigns[0];
  campaign.region = profile.region;
  campaign.targetSegments = clone(profile.playerType);
  campaign.status = "running";
  campaign.automaticReview = reviewCampaignTask({
    campaign,
    skill: data.skill,
    now: DEMO_BASE_NOW,
  });
  campaign.humanReview = {
    reviewer: "演示预置审核员",
    decision: "approved",
    reviewedAt: DEMO_BASE_NOW,
    note: "本地默认案例已核对固定事实、排期和安全入口。",
  };
  data.executionLog = [
    data.executionLog[0],
    {
      id: `log-scenario-${scenarioId}`,
      occurredAt: DEMO_BASE_NOW,
      category: "system",
      action: "demo_scenario_loaded",
      summary: `已载入${definition.name}本地演示案例。`,
      actor: "system",
      entityType: "profile",
      entityId: profile.id,
      metadata: {
        scenarioId,
        region: profile.region,
        timeZone: profile.timeZone,
        isDemoData: true,
      },
    },
  ];
  return data;
}

function calculateRelationshipStage(data) {
  if (
    data.relationship.paused ||
    data.profile.onboardingCompleted !== true
  ) {
    return "dormant";
  }
  const joinedDays =
    (Date.parse(data.demoNow) -
      Date.parse(data.relationship.joinedAt)) /
    (24 * 60 * 60 * 1_000);
  const lastInteractionAt =
    data.relationship.lastInteractionAt ??
    data.relationship.joinedAt;
  const inactiveDays =
    (Date.parse(data.demoNow) - Date.parse(lastInteractionAt)) /
    (24 * 60 * 60 * 1_000);
  if (inactiveDays >= 42) return "dormant";
  if (
    joinedDays >= 14 &&
    data.relationship.memoryEnabled &&
    data.memories.some(
      (memory) =>
        memory.userConfirmed && memory.reusableByCharacter,
    )
  ) {
    return "companion";
  }
  if (joinedDays >= 7) return "familiar";
  return "new";
}

module.exports = {
  DEMO_BASE_NOW,
  DEMO_SCENARIOS,
  applyDemoScenario,
  calculateRelationshipStage,
  getDemoScenarioSummaries,
};
