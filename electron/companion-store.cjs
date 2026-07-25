const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { evaluateContactPolicy } = require("./contact-policy.cjs");
const { reviewCharacterOutput } = require("./content-safety.cjs");
const { containsSensitiveMemory, extractMemoryCandidate } = require("./memory-candidates.cjs");
const {
  PHASE_TO_MESSAGE_TYPE,
  PHASE_TO_TEMPLATE,
  PHASE_TO_TRIGGER,
  createFixedFactEntries,
  renderCampaignMessage,
  reviewCampaignMessage: reviewCampaignContent,
  reviewCampaignTask,
  isScopedContentAvailable,
  unsupportedStructuredClaims,
} = require("./campaign-review.cjs");
const {
  DEMO_BASE_NOW,
  applyDemoScenario,
  calculateRelationshipStage,
  getDemoScenarioSummaries,
} = require("./demo-scenarios.cjs");

const COMPANION_SCHEMA_VERSION = 3;
const PREVIOUS_SCHEMA_VERSIONS = new Set([1, 2, 3]);
const EPISODE_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const MAX_CONVERSATION_EPISODES = 1_000;
const MAX_COLLECTION_ITEMS = 2_000;
const PLAYER_VISIBLE_TITLE_FALLBACK = "三月七想和你聊聊";
const PLAYER_VISIBLE_MESSAGE_FALLBACK =
  "开拓者，最近列车上多了件挺有意思的新鲜事。你有空、也正好想换换心情的时候，可以来看看；最近忙的话就先放着。";

function sanitizePlayerVisibleText(value, fallback) {
  const reviewed = reviewCharacterOutput(String(value ?? ""));
  return reviewed.allowed ? reviewed.safeText : fallback;
}
const MESSAGE_RESPONSES = new Set([
  "like",
  "later",
  "not_interested",
  "lower_frequency",
  "unsubscribe_type",
]);
const ALLOWED_MESSAGE_TYPES = new Set([
  "daily",
  "photo",
  "postcard",
  "relationship",
  "version_preheat",
  "version_launch",
  "version_sustain",
  "recall",
]);
const FIRST_JOIN_CHOICES = Object.freeze({
  take_photos: {
    summary: "下一次一起旅行时，想拍很多照片。",
    characterText:
      "说好啦，下次碰见漂亮的风景，咱可要拉着你多拍几张！",
  },
  explore_places: {
    summary: "下一次一起旅行时，想探索没有去过的新地方。",
    characterText:
      "探索新地方？这可太对咱胃口了。到时候谁先喊累谁就负责请果汁！",
  },
  hear_stories: {
    summary: "下一次一起旅行时，想听一路上遇见的新故事。",
    characterText:
      "好呀，故事可不能只听一半。等咱们遇见有意思的人，就一起把后续问清楚！",
  },
  walk_slowly: {
    summary: "下一次一起旅行时，想什么都不赶，慢慢走。",
    characterText:
      "慢慢走也挺好嘛。反正重要的不是赶多远，是咱们真的一起走过。",
  },
});
const RELATIONSHIP_TRIGGERS = new Set([
  "first_join",
  "scheduled_daily",
  "player_click",
  "player_choice",
  "memory_anniversary",
  "character_birthday",
  "player_birthday",
  "version_preheat",
  "version_launch",
  "version_sustain",
  "inactive_player",
  "return_to_game",
  "manual_demo_event",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlayerInRollout(playerId, campaignId, rolloutPercent = 100) {
  if (rolloutPercent >= 100) return true;
  const bucket =
    Number.parseInt(
      createHash("sha256")
        .update(`${campaignId}:${playerId}`)
        .digest("hex")
        .slice(0, 8),
      16,
    ) % 100;
  return bucket < rolloutPercent;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  );
}

function asShortString(value, fallback, maxLength = 240) {
  return typeof value === "string" && value.length <= maxLength
    ? value
    : fallback;
}

function asStringArray(value, fallback, maxItems = 100) {
  if (!Array.isArray(value)) return clone(fallback);
  return value
    .filter((item) => typeof item === "string" && item.length <= 240)
    .slice(0, maxItems);
}

function asRecordArray(value, requiredFields) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item) =>
        isObject(item) &&
        requiredFields.every(
          (field) =>
            typeof item[field] === "string" &&
            item[field].length > 0 &&
            item[field].length <= 2_000,
        ),
    )
    .slice(0, MAX_COLLECTION_ITEMS)
    .map(clone);
}

function validateEntityId(value, label = "Entity") {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9_-]{1,120}$/.test(value)
  ) {
    throw new Error(`${label} identifier is invalid.`);
  }
  return value;
}

function validateQuietTime(value, label) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    throw new Error(`${label} time must use HH:MM.`);
  }
  const [hour, minute] = value.split(":").map(Number);
  if (hour > 23 || minute > 59) {
    throw new Error(`${label} time is invalid.`);
  }
  return value;
}

function validatePreferencesInput(input) {
  if (!isObject(input)) {
    throw new Error("Companion preferences are required.");
  }
  const displayName =
    typeof input.displayName === "string" ? input.displayName.trim() : "";
  if (!displayName || displayName.length > 24) {
    throw new Error("玩家称呼需要 1 到 24 个字符。");
  }
  if (!Array.isArray(input.allowedContentTypes)) {
    throw new Error("Allowed content types are required.");
  }
  const allowedContentTypes = [
    ...new Set(
      input.allowedContentTypes.filter((type) =>
        ALLOWED_MESSAGE_TYPES.has(type),
      ),
    ),
  ];
  if (allowedContentTypes.length !== input.allowedContentTypes.length) {
    throw new Error("存在不支持的内容类型。");
  }
  for (const field of [
    "proactiveContactEnabled",
    "recallEnabled",
    "personalizationEnabled",
    "memoryEnabled",
  ]) {
    if (typeof input[field] !== "boolean") {
      throw new Error(`${field} must be a boolean.`);
    }
  }
  if (!isObject(input.quietHours)) {
    throw new Error("Quiet hours are required.");
  }
  const weeklyContactLimit = Number(input.weeklyContactLimit);
  if (
    !Number.isInteger(weeklyContactLimit) ||
    weeklyContactLimit < 0 ||
    weeklyContactLimit > 7
  ) {
    throw new Error("每周主动联系上限需要在 0 到 7 次之间。");
  }

  const recallEnabled = input.recallEnabled === true;
  const normalizedTypes = recallEnabled
    ? [...new Set([...allowedContentTypes, "recall"])]
    : allowedContentTypes.filter((type) => type !== "recall");

  return {
    displayName,
    proactiveContactEnabled: input.proactiveContactEnabled === true,
    allowedContentTypes: normalizedTypes,
    recallEnabled,
    personalizationEnabled: input.personalizationEnabled === true,
    memoryEnabled: input.memoryEnabled === true,
    quietHours: {
      start: validateQuietTime(input.quietHours.start, "Quiet start"),
      end: validateQuietTime(input.quietHours.end, "Quiet end"),
    },
    weeklyContactLimit,
  };
}

function addDays(isoDate, days) {
  return new Date(
    Date.parse(isoDate) + days * 24 * 60 * 60 * 1_000,
  ).toISOString();
}

function buildCampaignSchedule(baseDate, campaignId) {
  return [
    {
      id: `${campaignId}-d14`,
      phase: "preheat",
      scheduledAt: baseDate,
      templateId: "march7th-version-preheat-v1",
    },
    {
      id: `${campaignId}-d0`,
      phase: "launch",
      scheduledAt: addDays(baseDate, 14),
      templateId: "march7th-version-invitation-v1",
    },
    {
      id: `${campaignId}-d7`,
      phase: "sustain",
      scheduledAt: addDays(baseDate, 21),
      templateId: "march7th-version-sustain-v1",
    },
    {
      id: `${campaignId}-d42`,
      phase: "complete",
      scheduledAt: addDays(baseDate, 56),
      templateId: "campaign-complete-v1",
    },
  ];
}

function validateCampaignDraftInput(input, fallback = {}) {
  if (!isObject(input)) {
    throw new Error("发行任务内容不能为空。");
  }
  const version = asShortString(
    input.version?.trim(),
    fallback.version ?? "",
    60,
  );
  const globalTheme = asShortString(
    input.globalTheme?.trim(),
    fallback.globalTheme ?? "",
    100,
  );
  const narrativeApproach = asShortString(
    input.narrativeApproach?.trim(),
    fallback.narrativeApproach ?? "",
    240,
  );
  const sellingPoints = asStringArray(
    input.sellingPoints,
    fallback.sellingPoints ?? [],
    5,
  )
    .map((item) => item.trim())
    .filter(Boolean);
  const targetSegments = asStringArray(
    input.targetSegments,
    fallback.targetSegments ?? [],
    10,
  )
    .map((item) => item.trim())
    .filter(Boolean);
  const generationMode = [
    "template",
    "template_variables",
    "limited_generation",
  ].includes(input.generationMode)
    ? input.generationMode
    : fallback.generationMode ?? "template_variables";
  const facts = isObject(input.fixedFacts)
    ? input.fixedFacts
    : fallback.fixedFacts ?? {};
  const fixedFacts = {
    dataNature: "全部内容均为产品内模拟数据",
    versionName: asShortString(
      facts.versionName?.trim(),
      fallback.fixedFacts?.versionName ?? "",
      80,
    ),
    eventTime: asShortString(
      facts.eventTime?.trim(),
      fallback.fixedFacts?.eventTime ?? "",
      80,
    ),
    actionTarget: asShortString(
      facts.actionTarget?.trim(),
      fallback.fixedFacts?.actionTarget ?? "",
      180,
    ),
    rewardStatement: asShortString(
      facts.rewardStatement?.trim(),
      fallback.fixedFacts?.rewardStatement ?? "",
      120,
    ),
  };

  if (
    !version ||
    !globalTheme ||
    !narrativeApproach ||
    sellingPoints.length === 0 ||
    targetSegments.length === 0
  ) {
    throw new Error("版本、主题、叙事方式、目标分群和卖点均不能为空。");
  }

  return {
    version,
    globalTheme,
    narrativeApproach,
    sellingPoints,
    targetSegments,
    generationMode,
    fixedFacts,
  };
}

function validateHumanReviewInput(input) {
  if (
    !isObject(input) ||
    !["approved", "rejected"].includes(input.decision)
  ) {
    throw new Error("人工审核决定无效。");
  }
  const reviewer =
    typeof input.reviewer === "string" ? input.reviewer.trim() : "";
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (!reviewer || reviewer.length > 40) {
    throw new Error("审核者名称需要 1 到 40 个字符。");
  }
  if (note.length > 240) {
    throw new Error("审核备注不能超过 240 个字符。");
  }
  if (input.decision === "rejected" && !note) {
    throw new Error("拒绝内容时必须填写审核原因。");
  }
  return {
    reviewer,
    note,
    decision: input.decision,
  };
}

function createDefaultCompanionData({
  skillProfile,
  now = new Date().toISOString(),
} = {}) {
  if (!isObject(skillProfile)) {
    throw new Error("A structured character skill profile is required.");
  }

  const playerId = "demo-player-jp";
  const characterId = skillProfile.characterId;

  return {
    schemaVersion: COMPANION_SCHEMA_VERSION,
    isDemoData: true,
    createdAt: now,
    updatedAt: now,
    demoNow: now,
    demoStartedAt: now,
    demoScenarioId: "unconfigured",
    skill: clone(skillProfile),
    profile: {
      id: playerId,
      displayName: "演示玩家",
      region: "japan",
      language: "zh-CN",
      timeZone: "Asia/Tokyo",
      playerType: ["story", "character_relationship"],
      selectedCharacterId: characterId,
      allowedContentTypes: [
        "daily",
        "photo",
        "postcard",
        "relationship",
        "version_preheat",
        "version_launch",
        "version_sustain",
      ],
      reducedContentTypes: [],
      proactiveContactEnabled: false,
      recallEnabled: false,
      personalizationEnabled: true,
      memoryEnabled: true,
      quietHours: {
        start: "22:00",
        end: "09:00",
      },
      weeklyContactLimit: 2,
      onboardingCompleted: false,
      consentVersion: "rehoyo-companion-consent-v1",
    },
    relationship: {
      playerId,
      characterId,
      relationshipStage: "new",
      joinedAt: now,
      proactiveContactEnabled: false,
      allowedContentTypes: [
        "daily",
        "photo",
        "postcard",
        "relationship",
        "version_preheat",
        "version_launch",
        "version_sustain",
      ],
      reducedContentTypes: [],
      personalizationEnabled: true,
      memoryEnabled: true,
      quietHours: {
        start: "22:00",
        end: "09:00",
      },
      weeklyContactLimit: 2,
      ignoredCount: 0,
      consentVersion: "rehoyo-companion-consent-v1",
      activeCampaignIds: [],
      paused: false,
    },
    memories: [],
    conversationEpisodes: [],
    events: [],
    messages: [],
    campaigns: [
      (() => {
        const id = "campaign-demo-march7th";
        const fixedFacts = {
          dataNature: "全部内容均为产品内模拟数据",
          versionName: "概念版本",
          eventTime: "2026年8月7日 10:00（模拟）",
          actionTarget: "product://campaign/campaign-demo-march7th",
          rewardStatement: "奖励信息仅为模拟占位，不代表真实游戏内容",
        };
        return {
        id,
        characterId,
        version: "概念版本",
        region: "japan",
        targetSegments: [
          "story",
          "character_relationship",
          "inactive_14_days",
        ],
        objective: "launch",
        globalTheme: "与三月七重新踏上旅程",
        sellingPoints: ["三月七的成长", "一段新的模拟旅程"],
        narrativeApproach: "从玩家允许引用的拍照约定切入。",
        fixedFacts,
        fixedFactEntries: createFixedFactEntries(fixedFacts, now),
        knowledgeSources: [],
        knowledgeChunks: [],
        publishedBundles: [],
        allowedMemoryTypes: ["choice", "photo"],
        schedule: buildCampaignSchedule(now, id),
        generationMode: "template_variables",
        frequencyLimit: "版本周期最多一次召回，且服从玩家授权和勿扰。",
        reviewRequired: true,
        expandConditions: ["人工批准", "自动校验全部通过"],
        throttleConditions: ["玩家连续忽略", "同类内容接近频率上限"],
        stopConditions: [
          "玩家退订",
          "事实或人设校验失败",
          "人工紧急停止",
        ],
        status: "draft",
      };
      })(),
    ],
    globalCampaignKillSwitch: false,
    executionLog: [
      {
        id: "log-demo-initialized",
        occurredAt: now,
        category: "system",
        action: "demo_initialized",
        summary: "已创建角色同行计划本地模拟数据。",
        actor: "system",
        entityType: "profile",
        entityId: playerId,
        metadata: {
          schemaVersion: COMPANION_SCHEMA_VERSION,
          isDemoData: true,
        },
      },
    ],
  };
}

function normalizeCompanionData(input, { skillProfile, now }) {
  if (!isObject(input)) {
    throw new Error("Companion data must be an object.");
  }
  if (!PREVIOUS_SCHEMA_VERSIONS.has(input.schemaVersion)) {
    throw new Error(
      `Unsupported companion schema version: ${input.schemaVersion}`,
    );
  }

  const fallback = createDefaultCompanionData({ skillProfile, now });
  const profile = isObject(input.profile) ? input.profile : {};
  const relationship = isObject(input.relationship)
    ? input.relationship
    : {};

  return {
    ...fallback,
    schemaVersion: COMPANION_SCHEMA_VERSION,
    createdAt: isIsoDate(input.createdAt)
      ? input.createdAt
      : fallback.createdAt,
    updatedAt: isIsoDate(input.updatedAt)
      ? input.updatedAt
      : fallback.updatedAt,
    demoNow: isIsoDate(input.demoNow)
      ? input.demoNow
      : fallback.demoNow,
    demoStartedAt: isIsoDate(input.demoStartedAt)
      ? input.demoStartedAt
      : isIsoDate(input.createdAt)
        ? input.createdAt
        : fallback.demoStartedAt,
    demoScenarioId: [
      "japan_story",
      "china_active",
      "north_america_intensity",
      "unconfigured",
    ].includes(input.demoScenarioId)
      ? input.demoScenarioId
      : fallback.demoScenarioId,
    skill: clone(skillProfile),
    profile: {
      ...fallback.profile,
      id: asShortString(profile.id, fallback.profile.id, 100),
      displayName: asShortString(
        profile.displayName,
        fallback.profile.displayName,
        80,
      ),
      region: ["china", "japan", "north_america"].includes(profile.region)
        ? profile.region
        : fallback.profile.region,
      language: asShortString(
        profile.language,
        fallback.profile.language,
        20,
      ),
      timeZone: [
        "Asia/Shanghai",
        "Asia/Tokyo",
        "America/Los_Angeles",
      ].includes(profile.timeZone)
        ? profile.timeZone
        : fallback.profile.timeZone,
      playerType: asStringArray(
        profile.playerType,
        fallback.profile.playerType,
        20,
      ),
      selectedCharacterId: fallback.profile.selectedCharacterId,
      allowedContentTypes: asStringArray(
        profile.allowedContentTypes,
        fallback.profile.allowedContentTypes,
        20,
      ),
      reducedContentTypes: asStringArray(
        profile.reducedContentTypes,
        fallback.profile.reducedContentTypes,
        20,
      ),
      proactiveContactEnabled:
        profile.proactiveContactEnabled !== false,
      recallEnabled: profile.recallEnabled === true,
      personalizationEnabled:
        profile.personalizationEnabled !== false,
      memoryEnabled: profile.memoryEnabled !== false,
      quietHours: isObject(profile.quietHours)
        ? {
            start: asShortString(
              profile.quietHours.start,
              fallback.profile.quietHours.start,
              5,
            ),
            end: asShortString(
              profile.quietHours.end,
              fallback.profile.quietHours.end,
              5,
            ),
          }
        : fallback.profile.quietHours,
      weeklyContactLimit:
        Number.isInteger(profile.weeklyContactLimit) &&
        profile.weeklyContactLimit >= 0 &&
        profile.weeklyContactLimit <= 14
          ? profile.weeklyContactLimit
          : fallback.profile.weeklyContactLimit,
      onboardingCompleted: profile.onboardingCompleted === true,
      consentVersion: asShortString(
        profile.consentVersion,
        fallback.profile.consentVersion,
        80,
      ),
    },
    relationship: {
      ...fallback.relationship,
      playerId: asShortString(
        relationship.playerId,
        fallback.relationship.playerId,
        100,
      ),
      characterId: fallback.relationship.characterId,
      relationshipStage: [
        "new",
        "familiar",
        "companion",
        "dormant",
      ].includes(relationship.relationshipStage)
        ? relationship.relationshipStage
        : fallback.relationship.relationshipStage,
      joinedAt: isIsoDate(relationship.joinedAt)
        ? relationship.joinedAt
        : fallback.relationship.joinedAt,
      lastInteractionAt: isIsoDate(relationship.lastInteractionAt)
        ? relationship.lastInteractionAt
        : fallback.relationship.lastInteractionAt,
      proactiveContactEnabled:
        relationship.proactiveContactEnabled !== false,
      allowedContentTypes: asStringArray(
        relationship.allowedContentTypes,
        fallback.relationship.allowedContentTypes,
        20,
      ),
      reducedContentTypes: asStringArray(
        relationship.reducedContentTypes,
        fallback.relationship.reducedContentTypes,
        20,
      ),
      personalizationEnabled:
        relationship.personalizationEnabled !== false,
      memoryEnabled: relationship.memoryEnabled !== false,
      quietHours: isObject(relationship.quietHours)
        ? {
            start: asShortString(
              relationship.quietHours.start,
              fallback.relationship.quietHours.start,
              5,
            ),
            end: asShortString(
              relationship.quietHours.end,
              fallback.relationship.quietHours.end,
              5,
            ),
          }
        : fallback.relationship.quietHours,
      weeklyContactLimit:
        Number.isInteger(relationship.weeklyContactLimit) &&
        relationship.weeklyContactLimit >= 0 &&
        relationship.weeklyContactLimit <= 14
          ? relationship.weeklyContactLimit
          : fallback.relationship.weeklyContactLimit,
      ignoredCount:
        Number.isInteger(relationship.ignoredCount) &&
        relationship.ignoredCount >= 0 &&
        relationship.ignoredCount <= 1_000
          ? relationship.ignoredCount
          : fallback.relationship.ignoredCount,
      quietUntil: isIsoDate(relationship.quietUntil)
        ? relationship.quietUntil
        : undefined,
      consentVersion: asShortString(
        relationship.consentVersion,
        fallback.relationship.consentVersion,
        80,
      ),
      activeCampaignIds: asStringArray(
        relationship.activeCampaignIds,
        fallback.relationship.activeCampaignIds,
        100,
      ),
      paused: relationship.paused === true,
    },
    memories: asRecordArray(input.memories, [
      "id",
      "playerId",
      "characterId",
      "type",
      "title",
      "summary",
      "createdAt",
    ]).map((memory) => ({
      ...memory,
      category:
        typeof memory.category === "string"
          ? memory.category
          : memory.type === "choice"
            ? "shared_experience"
            : "explicit_preference",
      status:
        ["candidate", "confirmed", "rejected", "deleted"].includes(
          memory.status,
        )
          ? memory.status
          : memory.userConfirmed === true
            ? "confirmed"
            : "candidate",
      sourceType:
        typeof memory.sourceType === "string"
          ? memory.sourceType
          : memory.sourceEventId
            ? "onboarding"
            : "photo",
      sourceId:
        typeof memory.sourceId === "string"
          ? memory.sourceId
          : memory.sourceEventId,
      consentAt:
        isIsoDate(memory.consentAt)
          ? memory.consentAt
          : memory.userConfirmed === true
            ? memory.createdAt
            : undefined,
      campaignReusable: memory.campaignReusable === true,
      tags: asStringArray(memory.tags, [], 12),
      memoryVersion:
        Number.isInteger(memory.memoryVersion) && memory.memoryVersion > 0
          ? memory.memoryVersion
          : 1,
      rationale: asShortString(
        memory.rationale,
        "由旧版共同记忆迁移；玩家可以随时关闭引用或删除。",
        240,
      ),
      origin: memory.origin === "automatic" ? "automatic" : "explicit",
      hidden: memory.hidden === true || memory.origin === "automatic",
      confidence:
        typeof memory.confidence === "number"
          ? Math.max(0, Math.min(1, memory.confidence))
          : memory.userConfirmed === true
            ? 1
            : 0.5,
      lastReferencedAt: isIsoDate(memory.lastReferencedAt)
        ? memory.lastReferencedAt
        : undefined,
      supersededBy:
        typeof memory.supersededBy === "string"
          ? memory.supersededBy
          : undefined,
    })),
    conversationEpisodes: (Array.isArray(input.conversationEpisodes)
      ? input.conversationEpisodes
      : []
    )
      .filter(
        (episode) =>
          isObject(episode) &&
          typeof episode.id === "string" &&
          isIsoDate(episode.createdAt) &&
          Date.parse(episode.createdAt) >= Date.parse(now) - EPISODE_RETENTION_MS,
      )
      .slice(-MAX_CONVERSATION_EPISODES)
      .map((episode) => ({
        id: asShortString(episode.id, `episode-${randomUUID()}`, 120),
        conversationId: asShortString(
          episode.conversationId,
          "desktop-chat",
          120,
        ),
        turnId: asShortString(episode.turnId, episode.id, 120),
        createdAt: episode.createdAt,
        expiresAt: isIsoDate(episode.expiresAt)
          ? episode.expiresAt
          : new Date(Date.parse(episode.createdAt) + EPISODE_RETENTION_MS).toISOString(),
        userSummary: asShortString(episode.userSummary, "", 280),
        assistantSummary: asShortString(episode.assistantSummary, "", 280),
        topics: asStringArray(episode.topics, [], 12),
        replySource: ["model", "local", "error"].includes(episode.replySource)
          ? episode.replySource
          : "local",
        refinedAt: isIsoDate(episode.refinedAt)
          ? episode.refinedAt
          : undefined,
      })),
    events: asRecordArray(input.events, [
      "id",
      "trigger",
      "playerId",
      "characterId",
      "status",
    ]),
    messages: asRecordArray(input.messages, [
      "id",
      "characterId",
      "playerId",
      "type",
      "title",
      "body",
      "createdAt",
      "eventId",
      "reviewStatus",
    ]).map((message) => ({
      ...message,
      title: sanitizePlayerVisibleText(
        message.title,
        PLAYER_VISIBLE_TITLE_FALLBACK,
      ),
      body: sanitizePlayerVisibleText(
        message.body,
        PLAYER_VISIBLE_MESSAGE_FALLBACK,
      ),
    })),
    campaigns: asRecordArray(input.campaigns, [
      "id",
      "characterId",
      "version",
      "region",
      "objective",
      "status",
    ]).map((campaign) => {
      const fallbackCampaign =
        fallback.campaigns.find((item) => item.id === campaign.id) ??
        fallback.campaigns[0];
      const fixedFacts = {
        ...fallbackCampaign.fixedFacts,
        ...(isObject(campaign.fixedFacts)
          ? campaign.fixedFacts
          : {}),
      };
      return {
        ...fallbackCampaign,
        ...campaign,
        fixedFacts,
        knowledgeSources: Array.isArray(campaign.knowledgeSources)
          ? clone(campaign.knowledgeSources).slice(0, 100)
          : [],
        knowledgeChunks: Array.isArray(campaign.knowledgeChunks)
          ? clone(campaign.knowledgeChunks).slice(0, 500)
          : [],
        publishedBundles: Array.isArray(campaign.publishedBundles)
          ? clone(campaign.publishedBundles)
              .slice(0, 100)
              .map((bundle) => ({
                ...bundle,
                rolloutPercent: [5, 25, 100].includes(bundle.rolloutPercent)
                  ? bundle.rolloutPercent
                  : 100,
              }))
          : [],
        fixedFactEntries: Array.isArray(campaign.fixedFactEntries)
          ? clone(campaign.fixedFactEntries)
          : createFixedFactEntries(fixedFacts, now),
        schedule:
          Array.isArray(campaign.schedule) &&
          campaign.schedule.length > 0
            ? clone(campaign.schedule)
            : buildCampaignSchedule(now, campaign.id),
        generationMode: [
          "template",
          "template_variables",
          "limited_generation",
        ].includes(campaign.generationMode)
          ? campaign.generationMode
          : "template_variables",
      };
    }),
    globalCampaignKillSwitch:
      input.globalCampaignKillSwitch === true,
    executionLog: asRecordArray(input.executionLog, [
      "id",
      "occurredAt",
      "category",
      "action",
      "summary",
      "actor",
    ]),
  };
}

class CompanionStore {
  constructor({
    filePath,
    skillProfile,
    clock = () => new Date().toISOString(),
  }) {
    this.filePath = filePath;
    this.skillProfile = clone(skillProfile);
    this.clock = clock;
    this.data = this.#read();
  }

  #backupInvalidFile() {
    if (!fs.existsSync(this.filePath)) return;
    const safeTimestamp = this.clock().replaceAll(":", "-");
    fs.copyFileSync(
      this.filePath,
      `${this.filePath}.invalid-${safeTimestamp}`,
    );
  }

  #read() {
    const now = this.clock();
    if (!fs.existsSync(this.filePath)) {
      const data = createDefaultCompanionData({
        skillProfile: this.skillProfile,
        now,
      });
      this.#write(data);
      return data;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      const data = normalizeCompanionData(parsed, {
        skillProfile: this.skillProfile,
        now,
      });
      this.#write(data);
      return data;
    } catch {
      this.#backupInvalidFile();
      const data = createDefaultCompanionData({
        skillProfile: this.skillProfile,
        now,
      });
      this.#write(data);
      return data;
    }
  }

  #write(data) {
    const directory = path.dirname(this.filePath);
    const temporaryFile = `${this.filePath}.tmp`;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      temporaryFile,
      `${JSON.stringify(data, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    fs.renameSync(temporaryFile, this.filePath);
  }

  #appendLog(data, entry) {
    data.executionLog.push({
      id: `log-${randomUUID()}`,
      occurredAt: entry.occurredAt,
      category: entry.category,
      action: entry.action,
      summary: entry.summary,
      actor: entry.actor,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata ?? {},
    });
    if (data.executionLog.length > MAX_COLLECTION_ITEMS) {
      data.executionLog = data.executionLog.slice(-MAX_COLLECTION_ITEMS);
    }
  }

  #commit(mutator) {
    const now = this.clock();
    const draft = this.getSnapshot();
    mutator(draft, now);
    draft.updatedAt = now;
    this.data = normalizeCompanionData(draft, {
      skillProfile: this.skillProfile,
      now,
    });
    this.#write(this.data);
    return this.getSnapshot();
  }

  #findMessage(data, messageId) {
    const validId = validateEntityId(messageId, "Message");
    const message = data.messages.find((item) => item.id === validId);
    if (!message) throw new Error("Message was not found.");
    return message;
  }

  #findCampaign(data, campaignId) {
    const validId = validateEntityId(campaignId, "Campaign");
    const campaign = data.campaigns.find(
      (item) => item.id === validId,
    );
    if (!campaign) throw new Error("发行任务不存在。");
    return campaign;
  }

  #processDueCampaignSchedule(data, now) {
    const dueItems = [];
    for (const campaign of data.campaigns) {
      if (campaign.status !== "running") continue;
      for (const scheduleItem of campaign.schedule ?? []) {
        if (
          Date.parse(scheduleItem.scheduledAt) <=
            Date.parse(data.demoNow) &&
          !data.executionLog.some(
            (entry) =>
              entry.metadata?.scheduleItemId === scheduleItem.id,
          )
        ) {
          dueItems.push({ campaign, scheduleItem });
        }
      }
    }
    dueItems.sort(
      (left, right) =>
        Date.parse(left.scheduleItem.scheduledAt) -
        Date.parse(right.scheduleItem.scheduledAt),
    );

    for (const { campaign, scheduleItem } of dueItems) {
      if (scheduleItem.phase === "complete") {
        campaign.status = "completed";
        data.relationship.activeCampaignIds =
          data.relationship.activeCampaignIds.filter(
            (id) => id !== campaign.id,
          );
        this.#appendLog(data, {
          occurredAt: now,
          category: "campaign",
          action: "campaign_schedule_completed",
          summary: "发行排期到达结束阶段，任务已完成并恢复日常陪伴。",
          actor: "system",
          entityType: "campaign",
          entityId: campaign.id,
          metadata: {
            scheduleItemId: scheduleItem.id,
            phase: scheduleItem.phase,
            demoNow: data.demoNow,
          },
        });
        continue;
      }

      const contentType = PHASE_TO_MESSAGE_TYPE[scheduleItem.phase];
      const trigger = PHASE_TO_TRIGGER[scheduleItem.phase];
      if (!contentType || !trigger) continue;
      const eventId = `event-${randomUUID()}`;
      const event = {
        id: eventId,
        trigger,
        playerId: data.profile.id,
        characterId: data.skill.characterId,
        scheduledAt: scheduleItem.scheduledAt,
        payload: {
          campaignId: campaign.id,
          contentType,
          templateId: scheduleItem.templateId,
          phase: scheduleItem.phase,
          scheduleItemId: scheduleItem.id,
          source: "demo_time_advance",
        },
        status: "queued",
      };
      data.events.push(event);
      const contactDecision = evaluateContactPolicy({
        data,
        event,
        now: data.demoNow,
      });
      if (!contactDecision.allowed) {
        event.status = "suppressed";
        event.suppressionReason =
          contactDecision.reason ?? "unknown";
        this.#appendLog(data, {
          occurredAt: now,
          category: "event",
          action: "scheduled_campaign_event_suppressed",
          summary: "时间快进命中的发行事件被联系策略抑制。",
          actor: "system",
          entityType: "event",
          entityId: event.id,
          metadata: {
            campaignId: campaign.id,
            scheduleItemId: scheduleItem.id,
            phase: scheduleItem.phase,
            reason: contactDecision.reason ?? "",
            demoNow: data.demoNow,
          },
        });
        continue;
      }

      const rendered = renderCampaignMessage({
        data,
        campaign,
        phase: scheduleItem.phase,
        now: data.demoNow,
      });
      const message = {
        id: `message-${randomUUID()}`,
        characterId: data.skill.characterId,
        playerId: data.profile.id,
        type: rendered.type,
        title: rendered.title,
        body: rendered.body,
        createdAt: data.demoNow,
        eventId,
        campaignId: campaign.id,
        reviewStatus: "draft",
        trace: {
          skillVersion: data.skill.skillVersion,
          templateId: rendered.templateId,
          ruleIds: [
            "knowledge.fixed_facts_only",
            "memory.authorized_reference",
            "campaign.single_call_to_action",
            "safety.contact_policy_before_generation",
          ],
          fixedFactIds: rendered.fixedFactIds,
          knowledgeChunkIds: rendered.knowledgeChunkIds ?? [],
          memoryIds: rendered.memoryIds,
          generatedAt: rendered.generatedAt,
        },
        deliveryMode: "proactive",
        favorite: false,
        liked: false,
        remindLater: false,
        action: rendered.action,
      };
      const review = reviewCampaignContent({
        message,
        campaign,
        data,
        skill: data.skill,
        now: data.demoNow,
      });
      message.automaticReview = review;
      message.reviewStatus = review.passed
        ? "awaiting_human_review"
        : "automatic_check_failed";
      data.messages.unshift(message);
      event.status = review.passed
        ? "awaiting_review"
        : "cancelled";
      this.#appendLog(data, {
        occurredAt: now,
        category: "review",
        action: review.passed
          ? "scheduled_message_awaiting_human_review"
          : "scheduled_message_automatic_check_failed",
        summary: review.passed
          ? "排期生成的消息通过自动检查，等待人工审核。"
          : "排期生成的消息未通过自动检查，禁止投递。",
        actor: "system",
        entityType: "message",
        entityId: message.id,
        metadata: {
          campaignId: campaign.id,
          scheduleItemId: scheduleItem.id,
          phase: scheduleItem.phase,
          failedChecks: review.checks.filter(
            (item) => item.status === "fail",
          ).length,
          demoNow: data.demoNow,
        },
      });
    }
  }

  getSnapshot() {
    return clone(this.data);
  }

  reloadFromDisk() {
    if (!fs.existsSync(this.filePath)) return this.getSnapshot();
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    this.data = normalizeCompanionData(parsed, {
      skillProfile: this.skillProfile,
      now: this.clock(),
    });
    return this.getSnapshot();
  }

  getOperatorSnapshot() {
    return this.getSnapshot();
  }

  getActiveReleasePlanContext() {
    const event = [...this.data.events].reverse().find(
      (item) =>
        item.payload?.source === "regional_release_plan" &&
        item.payload?.rolloutSelected === true &&
        item.payload?.releasePlan &&
        item.status !== "cancelled",
    );
    if (!event) return null;
    return clone({
      sourceId: event.payload.sourceId,
      regionId: event.payload.regionId,
      rolloutPercent: event.payload.rolloutPercent,
      plan: event.payload.releasePlan,
      proactiveStatus: event.status,
      suppressionReason: event.suppressionReason ?? "",
    });
  }

  getPlayerSnapshot() {
    const snapshot = this.getSnapshot();
    snapshot.messages = snapshot.messages.map((message) => ({
      ...message,
      title: sanitizePlayerVisibleText(
        message.title,
        PLAYER_VISIBLE_TITLE_FALLBACK,
      ),
      body: sanitizePlayerVisibleText(
        message.body,
        PLAYER_VISIBLE_MESSAGE_FALLBACK,
      ),
    }));
    snapshot.memories = snapshot.memories.filter(
      (memory) => memory.hidden !== true,
    );
    snapshot.conversationEpisodes = [];
    snapshot.campaigns = snapshot.campaigns.map((campaign) => ({
      ...campaign,
      fixedFacts: {},
      fixedFactEntries: [],
      knowledgeSources: [],
      knowledgeChunks: [],
      automaticReview: undefined,
      humanReview: undefined,
      publishedBundles: (campaign.publishedBundles ?? []).filter(
        (bundle) =>
          bundle.status === "active" &&
          isPlayerInRollout(
            snapshot.profile.id,
            campaign.id,
            bundle.rolloutPercent,
          ),
      ),
    }));
    snapshot.executionLog = snapshot.executionLog.filter(
      (entry) =>
        !["review", "risk"].includes(entry.category) &&
        !entry.action.includes("knowledge"),
    );
    return snapshot;
  }

  getAuthorizedChatMemories(query = "", limit = 3) {
    if (
      this.data.profile.memoryEnabled !== true ||
      this.data.relationship.memoryEnabled !== true ||
      this.data.profile.personalizationEnabled !== true
    ) {
      return [];
    }
    const terms = String(query)
      .toLowerCase()
      .split(/[\s，。！？、；：,.!?;:]+/)
      .filter((term) => term.length >= 2);
    return this.data.memories
      .filter(
        (memory) =>
          memory.status === "confirmed" &&
          memory.userConfirmed === true &&
          memory.reusableByCharacter === true,
      )
      .map((memory) => ({
        memory,
        score: terms.reduce(
          (score, term) =>
            score +
            (`${memory.title} ${memory.summary} ${(memory.tags ?? []).join(" ")}`
              .toLowerCase()
              .includes(term)
              ? 1
              : 0),
          0,
        ),
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          Date.parse(right.memory.createdAt) -
            Date.parse(left.memory.createdAt),
      )
      .slice(0, Math.max(0, Math.min(3, limit)))
      .map(({ memory }) => clone(memory));
  }

  getRelevantMemoryContext(query = "", { durableLimit = 5, episodeLimit = 3 } = {}) {
    if (
      this.data.profile.memoryEnabled !== true ||
      this.data.relationship.memoryEnabled !== true ||
      this.data.profile.personalizationEnabled !== true
    ) {
      return { durable: [], episodes: [] };
    }
    const terms = [
      ...new Set(
        String(query)
          .toLowerCase()
          .split(/[\s，。！？、；：,.!?;:]+/)
          .flatMap((term) => {
            if (term.length < 2) return [];
            const fragments = [term];
            for (let index = 0; index < term.length - 1; index += 1) {
              fragments.push(term.slice(index, index + 2));
            }
            return fragments;
          }),
      ),
    ];
    const scoreText = (value) =>
      terms.reduce(
        (score, term) => score + (String(value).toLowerCase().includes(term) ? 2 : 0),
        0,
      );
    const durable = this.data.memories
      .filter(
        (memory) =>
          memory.status === "confirmed" &&
          memory.userConfirmed === true &&
          memory.reusableByCharacter === true &&
          !memory.supersededBy,
      )
      .map((memory) => ({
        memory,
        score:
          scoreText(`${memory.title} ${memory.summary} ${(memory.tags ?? []).join(" ")}`) +
          (memory.origin === "automatic" ? 1 : 2),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          Date.parse(right.memory.createdAt) - Date.parse(left.memory.createdAt),
      )
      .slice(0, Math.max(0, Math.min(5, durableLimit)))
      .map(({ memory }) => clone(memory));
    const episodes = [...this.data.conversationEpisodes]
      .map((episode) => ({
        episode,
        score: scoreText(
          `${episode.userSummary} ${episode.assistantSummary} ${episode.topics.join(" ")}`,
        ),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          Date.parse(right.episode.createdAt) - Date.parse(left.episode.createdAt),
      )
      .slice(0, Math.max(0, Math.min(3, episodeLimit)))
      .map(({ episode }) => clone(episode));
    return { durable, episodes };
  }

  recordConversationTurn(input) {
    let episode;
    this.#commit((data) => {
      if (
        data.profile.memoryEnabled !== true ||
        data.relationship.memoryEnabled !== true
      ) {
        return;
      }
      const userText = asShortString(input?.userText, "", 280);
      const assistantText = asShortString(input?.assistantText, "", 280);
      if (!userText || !assistantText) return;
      const createdAt = data.demoNow;
      episode = {
        id: `episode-${randomUUID()}`,
        conversationId: asShortString(input?.conversationId, "desktop-chat", 120),
        turnId: asShortString(input?.turnId, `turn-${randomUUID()}`, 120),
        createdAt,
        expiresAt: new Date(Date.parse(createdAt) + EPISODE_RETENTION_MS).toISOString(),
        userSummary: userText,
        assistantSummary: assistantText,
        topics: asStringArray(input?.topics, [], 12),
        replySource: ["model", "local", "error"].includes(input?.replySource)
          ? input.replySource
          : "local",
      };
      data.conversationEpisodes.push(episode);
      if (data.conversationEpisodes.length > MAX_CONVERSATION_EPISODES) {
        data.conversationEpisodes = data.conversationEpisodes.slice(
          -MAX_CONVERSATION_EPISODES,
        );
      }
    });
    return episode ? clone(episode) : undefined;
  }

  getPendingMemoryEpisodes(limit = 12) {
    if (
      this.data.profile.memoryEnabled !== true ||
      this.data.relationship.memoryEnabled !== true
    ) {
      return [];
    }
    return this.data.conversationEpisodes
      .filter((episode) => !episode.refinedAt)
      .slice(-Math.max(1, Math.min(20, limit)))
      .map(clone);
  }

  applyMemoryRefinement(candidates, episodeIds) {
    const allowedCategories = new Set([
      "preferred_name",
      "explicit_preference",
      "shared_experience",
      "interaction_habit",
    ]);
    return this.#commit((data) => {
      if (
        data.profile.memoryEnabled !== true ||
        data.relationship.memoryEnabled !== true
      ) {
        return;
      }
      const refinedAt = data.demoNow;
      const validEpisodeIds = new Set(
        Array.isArray(episodeIds) ? episodeIds.filter((id) => typeof id === "string") : [],
      );
      for (const episode of data.conversationEpisodes) {
        if (validEpisodeIds.has(episode.id)) episode.refinedAt = refinedAt;
      }
      for (const raw of Array.isArray(candidates) ? candidates.slice(0, 5) : []) {
        const summary = asShortString(raw?.summary, "", 120);
        const category = allowedCategories.has(raw?.category)
          ? raw.category
          : undefined;
        const confidence =
          typeof raw?.confidence === "number"
            ? Math.max(0, Math.min(1, raw.confidence))
            : 0;
        if (!summary || !category || confidence < 0.75) continue;
        if (containsSensitiveMemory(summary)) continue;
        const duplicate = data.memories.some(
          (memory) =>
            memory.status !== "deleted" &&
            memory.category === category &&
            memory.summary === summary,
        );
        if (duplicate) continue;
        const memoryId = `memory-auto-${randomUUID()}`;
        if (category === "preferred_name") {
          for (const previous of data.memories) {
            if (
              previous.category === "preferred_name" &&
              previous.status === "confirmed" &&
              !previous.supersededBy
            ) {
              previous.supersededBy = memoryId;
            }
          }
        }
        data.memories.unshift({
          id: memoryId,
          playerId: data.profile.id,
          characterId: data.skill.characterId,
          type: category === "shared_experience" ? "choice" : "milestone",
          category,
          title: asShortString(raw?.title, "自然形成的长期记忆", 80),
          summary,
          characterText: summary,
          createdAt: refinedAt,
          status: "confirmed",
          userConfirmed: true,
          reusableByCharacter: true,
          campaignReusable: true,
          sourceType: "chat",
          sourceId: [...validEpisodeIds].join(",").slice(0, 120),
          tags: asStringArray(raw?.tags, [], 12),
          memoryVersion: 1,
          rationale: "由本地对话分层记忆系统从明确表达中提炼。",
          origin: "automatic",
          hidden: true,
          confidence,
        });
      }
    });
  }

  proposeChatMemoryCandidate(text, sourceId) {
    let candidate;
    this.#commit((data, now) => {
      if (
        !data.profile.onboardingCompleted ||
        !data.profile.memoryEnabled ||
        !data.relationship.memoryEnabled
      ) {
        return;
      }
      candidate = extractMemoryCandidate({
        text,
        playerId: data.profile.id,
        characterId: data.skill.characterId,
        sourceId: asShortString(sourceId, `chat-${randomUUID()}`, 120),
        now: data.demoNow,
      });
      if (!candidate) return;
      const duplicate = data.memories.some(
        (memory) =>
          memory.status !== "deleted" &&
          memory.category === candidate.category &&
          memory.summary === candidate.summary,
      );
      if (duplicate) {
        candidate = undefined;
        return;
      }
      data.memories.unshift(candidate);
      this.#appendLog(data, {
        occurredAt: now,
        category: "memory",
        action: "memory_candidate_proposed",
        summary: "系统识别到一条记忆候选，等待玩家明确确认。",
        actor: "system",
        entityType: "memory",
        entityId: candidate.id,
        metadata: {
          category: candidate.category,
          sourceType: candidate.sourceType,
        },
      });
    });
    return candidate ? clone(candidate) : undefined;
  }

  resolveMemoryCandidate(memoryId, confirmed) {
    const validId = validateEntityId(memoryId, "Memory");
    if (typeof confirmed !== "boolean") {
      throw new Error("记忆候选决定必须是布尔值。");
    }
    return this.#commit((data, now) => {
      const memory = data.memories.find((item) => item.id === validId);
      if (!memory || memory.status !== "candidate") {
        throw new Error("记忆候选不存在或已经处理。");
      }
      memory.status = confirmed ? "confirmed" : "rejected";
      memory.userConfirmed = confirmed;
      memory.reusableByCharacter = confirmed;
      memory.campaignReusable = false;
      memory.consentAt = confirmed ? data.demoNow : undefined;
      this.#appendLog(data, {
        occurredAt: now,
        category: "memory",
        action: confirmed
          ? "memory_candidate_confirmed"
          : "memory_candidate_rejected",
        summary: confirmed
          ? "玩家确认了一条长期记忆。"
          : "玩家拒绝了记忆候选；该内容不会用于个性化。",
        actor: "player",
        entityType: "memory",
        entityId: validId,
        metadata: { confirmed },
      });
    });
  }

  setMemoryCampaignReusable(memoryId, reusable) {
    const validId = validateEntityId(memoryId, "Memory");
    if (typeof reusable !== "boolean") {
      throw new Error("发行记忆授权必须是布尔值。");
    }
    return this.#commit((data, now) => {
      const memory = data.memories.find((item) => item.id === validId);
      if (
        !memory ||
        memory.status !== "confirmed" ||
        memory.userConfirmed !== true
      ) {
        throw new Error("只有已确认记忆可以授权给发行内容。");
      }
      memory.campaignReusable = reusable;
      this.#appendLog(data, {
        occurredAt: now,
        category: "memory",
        action: reusable
          ? "memory_campaign_reuse_enabled"
          : "memory_campaign_reuse_disabled",
        summary: reusable
          ? "玩家允许发行内容在自然相关时引用这条记忆。"
          : "玩家撤销了这条记忆的发行引用授权。",
        actor: "player",
        entityType: "memory",
        entityId: validId,
        metadata: { campaignReusable: reusable },
      });
    });
  }

  importCampaignKnowledge(campaignId, parsedDocument) {
    if (
      !isObject(parsedDocument?.source) ||
      !Array.isArray(parsedDocument?.chunks)
    ) {
      throw new Error("发行知识文档格式无效。");
    }
    return this.#commit((data, now) => {
      const campaign = this.#findCampaign(data, campaignId);
      if (["running", "completed", "stopped"].includes(campaign.status)) {
        throw new Error("运行中或已结束的任务不能导入新知识。");
      }
      campaign.knowledgeSources ??= [];
      campaign.knowledgeChunks ??= [];
      campaign.knowledgeSources.push(clone(parsedDocument.source));
      campaign.knowledgeChunks.push(...clone(parsedDocument.chunks));
      campaign.status = "draft";
      campaign.automaticReview = undefined;
      campaign.humanReview = undefined;
      this.#appendLog(data, {
        occurredAt: now,
        category: "campaign",
        action: "campaign_knowledge_imported",
        summary: "发行方案已切分为待审核知识片段。",
        actor: "reviewer",
        entityType: "campaign",
        entityId: campaign.id,
        metadata: {
          sourceId: parsedDocument.source.id,
          chunks: parsedDocument.chunks.length,
        },
      });
    });
  }

  reviewCampaignKnowledgeChunk(campaignId, chunkId, input) {
    const validChunkId = validateEntityId(chunkId, "Knowledge chunk");
    if (!isObject(input) || typeof input.approved !== "boolean") {
      throw new Error("知识审核输入无效。");
    }
    const reviewer = asShortString(input.reviewer?.trim(), "", 40);
    if (!reviewer) throw new Error("知识审核者不能为空。");
    return this.#commit((data, now) => {
      const campaign = this.#findCampaign(data, campaignId);
      const chunk = (campaign.knowledgeChunks ?? []).find(
        (item) => item.id === validChunkId,
      );
      if (!chunk) throw new Error("知识片段不存在。");
      chunk.approved = input.approved;
      chunk.phases = asStringArray(
        input.phases,
        ["preheat", "launch", "sustain", "recall"],
        4,
      ).filter((phase) =>
        ["preheat", "launch", "sustain", "recall"].includes(phase),
      );
      chunk.regions = asStringArray(input.regions, [], 10);
      chunk.segments = asStringArray(input.segments, [], 20);
      chunk.availableFrom = isIsoDate(input.availableFrom)
        ? new Date(input.availableFrom).toISOString()
        : data.demoNow;
      chunk.expiresAt = isIsoDate(input.expiresAt)
        ? new Date(input.expiresAt).toISOString()
        : undefined;
      chunk.reviewedAt = data.demoNow;
      chunk.reviewedBy = reviewer;
      const source = (campaign.knowledgeSources ?? []).find(
        (item) => item.id === chunk.sourceId,
      );
      if (source) {
        const sourceChunks = campaign.knowledgeChunks.filter(
          (item) => item.sourceId === source.id,
        );
        source.status = sourceChunks.every((item) => item.approved)
          ? "approved"
          : "awaiting_review";
      }
      this.#appendLog(data, {
        occurredAt: now,
        category: "review",
        action: input.approved
          ? "campaign_knowledge_approved"
          : "campaign_knowledge_rejected",
        summary: input.approved
          ? "发行知识片段已批准并设置可见范围。"
          : "发行知识片段已拒绝，不会进入模型上下文。",
        actor: "reviewer",
        entityType: "campaign",
        entityId: campaign.id,
        metadata: {
          chunkId: validChunkId,
          reviewer,
        },
      });
    });
  }

  publishCampaignBundle(campaignId, publisher, rolloutPercent = 100) {
    const publishedBy = asShortString(publisher?.trim(), "", 40);
    if (![5, 25, 100].includes(rolloutPercent)) {
      throw new Error("灰度比例只支持 5%、25% 或 100%。");
    }
    if (!publishedBy) throw new Error("发布者不能为空。");
    return this.#commit((data, now) => {
      if (data.globalCampaignKillSwitch) {
        throw new Error("全局发行急停已开启，不能发布内容包。");
      }
      const campaign = this.#findCampaign(data, campaignId);
      if (
        campaign.status !== "running" ||
        campaign.humanReview?.decision !== "approved"
      ) {
        throw new Error("只有已人工批准且运行中的任务可以发布内容包。");
      }
      const approvedMessages = data.messages.filter(
        (message) =>
          message.campaignId === campaign.id &&
          message.reviewStatus === "approved",
      );
      if (!approvedMessages.length) {
        throw new Error("内容包至少需要一条已人工批准的消息。");
      }
      const payload = {
        campaignId: campaign.id,
        rolloutPercent,
        fixedFactIds: campaign.fixedFactEntries
          .filter((fact) => fact.locked && fact.reviewedAt)
          .map((fact) => fact.id)
          .sort(),
        knowledgeChunkIds: (campaign.knowledgeChunks ?? [])
          .filter((chunk) => chunk.approved)
          .map((chunk) => chunk.id)
          .sort(),
        messageIds: approvedMessages.map((message) => message.id).sort(),
      };
      const checksum = createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex");
      campaign.publishedBundles ??= [];
      for (const existing of campaign.publishedBundles) {
        if (existing.status === "active") {
          existing.status = "revoked";
          existing.revokedAt = data.demoNow;
        }
      }
      const bundle = {
        id: `campaign-bundle-${randomUUID()}`,
        campaignId: campaign.id,
        bundleVersion: campaign.publishedBundles.length + 1,
        publishedAt: data.demoNow,
        publishedBy,
        checksum,
        ...payload,
        status: "active",
      };
      campaign.publishedBundles.push(bundle);
      this.#appendLog(data, {
        occurredAt: now,
        category: "campaign",
        action: "campaign_bundle_published",
        summary: "不可变发行内容包已经发布到玩家只读通道。",
        actor: "reviewer",
        entityType: "campaign",
        entityId: campaign.id,
        metadata: {
          bundleId: bundle.id,
          bundleVersion: bundle.bundleVersion,
          checksum,
        },
      });
    });
  }

  setGlobalCampaignKillSwitch(enabled, reviewer = "operator") {
    if (typeof enabled !== "boolean") {
      throw new Error("急停状态必须是布尔值。");
    }
    return this.#commit((data, now) => {
      data.globalCampaignKillSwitch = enabled;
      if (enabled) {
        for (const campaign of data.campaigns) {
          if (!["completed", "stopped"].includes(campaign.status)) {
            campaign.status = "stopped";
            campaign.emergencyStoppedAt = data.demoNow;
          }
          for (const bundle of campaign.publishedBundles ?? []) {
            if (bundle.status === "active") {
              bundle.status = "revoked";
              bundle.revokedAt = data.demoNow;
            }
          }
        }
        data.relationship.activeCampaignIds = [];
        for (const message of data.messages) {
          if (message.campaignId && !message.sentAt) {
            message.reviewStatus = "expired";
          }
        }
      }
      this.#appendLog(data, {
        occurredAt: now,
        category: "risk",
        action: enabled
          ? "global_campaign_kill_switch_enabled"
          : "global_campaign_kill_switch_disabled",
        summary: enabled
          ? "全局发行急停已开启，所有活动包与待发送内容立即失效。"
          : "全局发行急停已解除；已停止任务不会自动恢复。",
        actor: "reviewer",
        entityType: "profile",
        entityId: data.profile.id,
        metadata: {
          enabled,
          reviewer: asShortString(reviewer, "operator", 40),
        },
      });
    });
  }

  getSkillProfile() {
    return clone(this.skillProfile);
  }

  completeOnboarding(input) {
    if (!isObject(input) || input.consentAccepted !== true) {
      throw new Error("需要先确认概念体验、数据和隐私说明。");
    }
    if (!Object.hasOwn(FIRST_JOIN_CHOICES, input.firstChoice)) {
      throw new Error("请选择一种第一次同行方式。");
    }
    const preferences = validatePreferencesInput(input);
    const choice = FIRST_JOIN_CHOICES[input.firstChoice];

    return this.#commit((data, now) => {
      if (data.profile.onboardingCompleted) {
        throw new Error("首次同行已经完成。");
      }
      const eventTime = data.demoNow;
      Object.assign(data.profile, preferences, {
        onboardingCompleted: true,
        consentVersion: "rehoyo-companion-consent-v1",
      });
      Object.assign(data.relationship, {
        relationshipStage: "new",
        joinedAt: eventTime,
        lastInteractionAt: eventTime,
        proactiveContactEnabled:
          preferences.proactiveContactEnabled,
        allowedContentTypes: clone(
          preferences.allowedContentTypes,
        ),
        reducedContentTypes: [],
        personalizationEnabled:
          preferences.personalizationEnabled,
        memoryEnabled: preferences.memoryEnabled,
        quietHours: clone(preferences.quietHours),
        weeklyContactLimit: preferences.weeklyContactLimit,
        ignoredCount: 0,
        quietUntil: undefined,
        consentVersion: "rehoyo-companion-consent-v1",
        paused: false,
      });

      data.events.push(
        {
          id: "event-first-join",
          trigger: "first_join",
          playerId: data.profile.id,
          characterId: data.skill.characterId,
          scheduledAt: eventTime,
          payload: {
            consentVersion: data.profile.consentVersion,
            isDemoData: true,
          },
          status: "executed",
        },
        {
          id: "event-first-choice",
          trigger: "player_choice",
          playerId: data.profile.id,
          characterId: data.skill.characterId,
          scheduledAt: eventTime,
          payload: {
            choice: input.firstChoice,
            savedToMemory: preferences.memoryEnabled,
          },
          status: "executed",
        },
      );

      if (
        preferences.memoryEnabled &&
        !data.memories.some(
          (memory) => memory.id === "memory-first-choice",
        )
      ) {
        data.memories.unshift({
          id: "memory-first-choice",
          playerId: data.profile.id,
          characterId: data.skill.characterId,
          type: "choice",
          title: "第一次同行的约定",
          summary: choice.summary,
          characterText: choice.characterText,
          createdAt: eventTime,
          reusableByCharacter: true,
          userConfirmed: true,
          sourceEventId: "event-first-choice",
          visual: {
            assetId: "march7th-static-concept-v1",
            alt: "三月七举着相机，记下第一次同行约定",
          },
        });
      }

      if (
        !data.messages.some(
          (message) => message.id === "message-first-welcome",
        )
      ) {
        data.messages.unshift({
          id: "message-first-welcome",
          characterId: data.skill.characterId,
          playerId: data.profile.id,
          type: "relationship",
          title: "同行开始啦",
          body: choice.characterText,
          createdAt: eventTime,
          eventId: "event-first-join",
          reviewStatus: "approved",
          trace: {
            skillVersion: data.skill.skillVersion,
            templateId: "march7th-first-join-v1",
            ruleIds: [
              "relationship.player_choice_first",
              "memory.explicit_confirmation",
              "safety.consent_before_contact",
            ],
            fixedFactIds: [],
            memoryIds: preferences.memoryEnabled
              ? ["memory-first-choice"]
              : [],
            generatedAt: eventTime,
          },
          sentAt: eventTime,
          deliveryMode: "response",
          favorite: false,
          liked: false,
          remindLater: false,
          action: preferences.memoryEnabled
            ? {
                label: "查看第一次同行",
                kind: "open_album",
                targetId: "memory-first-choice",
              }
            : undefined,
        });
      }

      this.#appendLog(data, {
        occurredAt: now,
        category: "consent",
        action: "onboarding_completed",
        summary: "玩家完成概念体验说明、授权偏好和第一次同行选择。",
        actor: "player",
        entityType: "profile",
        entityId: data.profile.id,
        metadata: {
          consentVersion: data.profile.consentVersion,
          proactiveContactEnabled:
            preferences.proactiveContactEnabled,
          recallEnabled: preferences.recallEnabled,
          personalizationEnabled:
            preferences.personalizationEnabled,
          memoryEnabled: preferences.memoryEnabled,
          weeklyContactLimit: preferences.weeklyContactLimit,
          firstChoice: input.firstChoice,
        },
      });
    });
  }

  saveCompanionPreferences(input) {
    const preferences = validatePreferencesInput(input);
    return this.#commit((data, now) => {
      Object.assign(data.profile, preferences);
      Object.assign(data.relationship, {
        proactiveContactEnabled:
          preferences.proactiveContactEnabled,
        allowedContentTypes: clone(
          preferences.allowedContentTypes,
        ),
        personalizationEnabled:
          preferences.personalizationEnabled,
        memoryEnabled: preferences.memoryEnabled,
        quietHours: clone(preferences.quietHours),
        weeklyContactLimit: preferences.weeklyContactLimit,
      });
      this.#appendLog(data, {
        occurredAt: now,
        category: "preference",
        action: "companion_preferences_updated",
        summary: "玩家更新了角色同行授权与联系偏好。",
        actor: "player",
        entityType: "profile",
        entityId: data.profile.id,
        metadata: {
          proactiveContactEnabled:
            preferences.proactiveContactEnabled,
          recallEnabled: preferences.recallEnabled,
          personalizationEnabled:
            preferences.personalizationEnabled,
          memoryEnabled: preferences.memoryEnabled,
          weeklyContactLimit: preferences.weeklyContactLimit,
        },
      });
    });
  }

  setCompanionPaused(paused) {
    if (typeof paused !== "boolean") {
      throw new Error("Pause setting must be a boolean.");
    }
    return this.#commit((data, now) => {
      data.relationship.paused = paused;
      data.relationship.relationshipStage = paused
        ? "dormant"
        : data.memories.length > 1
          ? "familiar"
          : "new";
      this.#appendLog(data, {
        occurredAt: now,
        category: "preference",
        action: paused
          ? "companion_paused"
          : "companion_resumed",
        summary: paused
          ? "玩家暂停了角色同行。"
          : "玩家恢复了角色同行。",
        actor: "player",
        entityType: "profile",
        entityId: data.profile.id,
        metadata: {
          paused,
        },
      });
    });
  }

  exitCompanion() {
    return this.#commit((data, now) => {
      data.profile.onboardingCompleted = false;
      data.profile.proactiveContactEnabled = false;
      data.profile.recallEnabled = false;
      data.relationship.proactiveContactEnabled = false;
      data.relationship.paused = true;
      data.relationship.relationshipStage = "dormant";
      this.#appendLog(data, {
        occurredAt: now,
        category: "consent",
        action: "companion_exited",
        summary: "玩家退出了角色同行计划，所有主动联系已经关闭。",
        actor: "player",
        entityType: "profile",
        entityId: data.profile.id,
        metadata: {},
      });
    });
  }

  deleteRelationshipData() {
    const now = this.clock();
    this.data = createDefaultCompanionData({
      skillProfile: this.skillProfile,
      now,
    });
    this.#write(this.data);
    return this.getSnapshot();
  }

  setMemoryReusable(memoryId, reusable) {
    const validId = validateEntityId(memoryId, "Memory");
    if (typeof reusable !== "boolean") {
      throw new Error("Memory reference preference must be a boolean.");
    }

    return this.#commit((data, now) => {
      const memory = data.memories.find((item) => item.id === validId);
      if (!memory) throw new Error("Memory was not found.");
      memory.reusableByCharacter = reusable;
      if (!reusable) memory.campaignReusable = false;
      this.#appendLog(data, {
        occurredAt: now,
        category: "memory",
        action: reusable
          ? "memory_reference_enabled"
          : "memory_reference_disabled",
        summary: reusable
          ? "玩家允许三月七未来引用这条记忆。"
          : "玩家禁止三月七未来引用这条记忆。",
        actor: "player",
        entityType: "memory",
        entityId: validId,
        metadata: {
          reusableByCharacter: reusable,
        },
      });
    });
  }

  setMemoryEnabled(enabled) {
    if (typeof enabled !== "boolean") {
      throw new Error("Memory setting must be a boolean.");
    }

    return this.#commit((data, now) => {
      data.profile.memoryEnabled = enabled;
      data.relationship.memoryEnabled = enabled;
      this.#appendLog(data, {
        occurredAt: now,
        category: "preference",
        action: enabled
          ? "long_term_memory_enabled"
          : "long_term_memory_disabled",
        summary: enabled
          ? "玩家开启了长期记忆。"
          : "玩家关闭了长期记忆，已有记录保留但不会被角色引用。",
        actor: "player",
        entityType: "profile",
        entityId: data.profile.id,
        metadata: {
          memoryEnabled: enabled,
        },
      });
    });
  }

  deleteMemory(memoryId) {
    const validId = validateEntityId(memoryId, "Memory");

    return this.#commit((data, now) => {
      const memoryIndex = data.memories.findIndex(
        (item) => item.id === validId,
      );
      if (memoryIndex < 0) throw new Error("Memory was not found.");
      data.memories.splice(memoryIndex, 1);
      for (const message of data.messages) {
        if (isObject(message.trace) && Array.isArray(message.trace.memoryIds)) {
          message.trace.memoryIds = message.trace.memoryIds.filter(
            (id) => id !== validId,
          );
        }
      }
      this.#appendLog(data, {
        occurredAt: now,
        category: "memory",
        action: "memory_deleted",
        summary: "玩家删除了一条共同记忆及其可识别引用。",
        actor: "player",
        entityType: "memory",
        entityId: validId,
        metadata: {},
      });
    });
  }

  clearMemories() {
    return this.#commit((data, now) => {
      const removedCount = data.memories.length;
      data.memories = [];
      for (const message of data.messages) {
        if (isObject(message.trace)) {
          message.trace.memoryIds = [];
        }
      }
      this.#appendLog(data, {
        occurredAt: now,
        category: "memory",
        action: "all_memories_deleted",
        summary: "玩家清空了全部共同记忆及其可识别引用。",
        actor: "player",
        entityType: "profile",
        entityId: data.profile.id,
        metadata: {
          removedCount,
        },
      });
    });
  }

  createPhotoMemory() {
    return this.#commit((data, now) => {
      if (!data.profile.memoryEnabled || !data.relationship.memoryEnabled) {
        throw new Error("请先开启长期记忆，再把照片收进相册。");
      }

      const suffix = randomUUID();
      const memoryId = `memory-photo-${suffix}`;
      const eventId = `event-photo-${suffix}`;
      const createdAt = data.demoNow;
      data.events.push({
        id: eventId,
        trigger: "player_click",
        playerId: data.profile.id,
        characterId: data.skill.characterId,
        scheduledAt: createdAt,
        payload: {
          contentType: "photo",
          userConfirmedSave: true,
        },
        status: "executed",
      });
      data.memories.unshift({
        id: memoryId,
        playerId: data.profile.id,
        characterId: data.skill.characterId,
        type: "photo",
        title: "今天一起拍下的照片",
        summary: "玩家主动确认，把这次轻互动保存进共同旅行相册。",
        characterText:
          "收好啦！以后翻到这张的时候，可别假装忘了今天是和谁一起拍的哦。",
        createdAt,
        reusableByCharacter: true,
        userConfirmed: true,
        sourceEventId: eventId,
        visual: {
          assetId: "march7th-static-concept-v1",
          alt: "三月七举着相机，记录今天的同行时刻",
        },
      });
      this.#appendLog(data, {
        occurredAt: now,
        category: "memory",
        action: "photo_memory_created",
        summary: "玩家确认将一次拍照互动保存为共同记忆。",
        actor: "player",
        entityType: "memory",
        entityId: memoryId,
        metadata: {
          type: "photo",
          userConfirmed: true,
        },
      });
    });
  }

  getMemoryExport() {
    return {
      schemaVersion: COMPANION_SCHEMA_VERSION,
      exportedAt: this.clock(),
      isDemoData: true,
      playerId: this.data.profile.id,
      characterId: this.data.skill.characterId,
      memoryEnabled: this.data.profile.memoryEnabled,
      memories: clone(this.data.memories),
    };
  }

  getPrivacyExport() {
    return {
      schemaVersion: COMPANION_SCHEMA_VERSION,
      exportedAt: this.clock(),
      scope: "rehoyo-companion-local-data",
      excludes: [
        "DeepSeek API Key",
        "DashScope API Key",
        "generated audio buffers",
        "free chat history",
      ],
      data: this.getSnapshot(),
    };
  }

  markMessageRead(messageId) {
    const validId = validateEntityId(messageId, "Message");
    const current = this.data.messages.find(
      (item) => item.id === validId,
    );
    if (!current) throw new Error("Message was not found.");
    if (current.readAt) return this.getSnapshot();

    return this.#commit((data, now) => {
      const message = this.#findMessage(data, validId);
      message.readAt = now;
      this.#appendLog(data, {
        occurredAt: now,
        category: "delivery",
        action: "message_read",
        summary: "玩家阅读了一条角色通信消息。",
        actor: "player",
        entityType: "message",
        entityId: validId,
        metadata: {
          type: message.type,
        },
      });
    });
  }

  setMessageFavorite(messageId, favorite) {
    if (typeof favorite !== "boolean") {
      throw new Error("Favorite preference must be a boolean.");
    }
    return this.#commit((data, now) => {
      const message = this.#findMessage(data, messageId);
      message.favorite = favorite;
      this.#appendLog(data, {
        occurredAt: now,
        category: "preference",
        action: favorite
          ? "message_favorited"
          : "message_unfavorited",
        summary: favorite
          ? "玩家收藏了一条角色通信。"
          : "玩家取消收藏一条角色通信。",
        actor: "player",
        entityType: "message",
        entityId: message.id,
        metadata: {
          type: message.type,
        },
      });
    });
  }

  setMessageLiked(messageId, liked) {
    if (typeof liked !== "boolean") {
      throw new Error("Like preference must be a boolean.");
    }
    return this.#commit((data, now) => {
      const message = this.#findMessage(data, messageId);
      message.liked = liked;
      if (liked) message.playerResponse = "like";
      this.#appendLog(data, {
        occurredAt: now,
        category: "preference",
        action: liked ? "message_liked" : "message_unliked",
        summary: liked
          ? "玩家表示喜欢这条角色通信。"
          : "玩家取消喜欢这条角色通信。",
        actor: "player",
        entityType: "message",
        entityId: message.id,
        metadata: {
          type: message.type,
        },
      });
    });
  }

  setMessageRemindLater(messageId, remindLater) {
    if (typeof remindLater !== "boolean") {
      throw new Error("Reminder preference must be a boolean.");
    }
    return this.#commit((data, now) => {
      const message = this.#findMessage(data, messageId);
      message.remindLater = remindLater;
      if (remindLater) message.playerResponse = "later";
      this.#appendLog(data, {
        occurredAt: now,
        category: "preference",
        action: remindLater
          ? "message_remind_later"
          : "message_reminder_cleared",
        summary: remindLater
          ? "玩家选择稍后再看这条角色通信。"
          : "玩家取消了这条消息的稍后提醒。",
        actor: "player",
        entityType: "message",
        entityId: message.id,
        metadata: {
          type: message.type,
        },
      });
    });
  }

  respondToMessage(messageId, response) {
    if (!MESSAGE_RESPONSES.has(response)) {
      throw new Error("This message response is not supported.");
    }

    return this.#commit((data, now) => {
      const message = this.#findMessage(data, messageId);
      message.playerResponse = response;
      if (response === "like") message.liked = true;
      if (response === "later") message.remindLater = true;

      if (response === "lower_frequency") {
        if (!data.profile.reducedContentTypes.includes(message.type)) {
          data.profile.reducedContentTypes.push(message.type);
        }
        if (
          !data.relationship.reducedContentTypes.includes(message.type)
        ) {
          data.relationship.reducedContentTypes.push(message.type);
        }
      }

      if (response === "unsubscribe_type") {
        data.profile.allowedContentTypes =
          data.profile.allowedContentTypes.filter(
            (type) => type !== message.type,
          );
        data.relationship.allowedContentTypes =
          data.relationship.allowedContentTypes.filter(
            (type) => type !== message.type,
          );
      }

      if (response === "not_interested" && message.campaignId) {
        const campaign = data.campaigns.find(
          (item) => item.id === message.campaignId,
        );
        if (
          campaign &&
          !["completed", "stopped"].includes(campaign.status)
        ) {
          campaign.status = "paused";
        }
        data.relationship.activeCampaignIds =
          data.relationship.activeCampaignIds.filter(
            (id) => id !== message.campaignId,
          );
      }

      const summaryByResponse = {
        like: "玩家表示喜欢这条角色通信。",
        later: "玩家选择稍后再看这条角色通信。",
        not_interested: "玩家表示对这条内容不感兴趣。",
        lower_frequency: "玩家要求降低此类内容的联系频率。",
        unsubscribe_type: "玩家退订了此类角色通信。",
      };
      this.#appendLog(data, {
        occurredAt: now,
        category: "preference",
        action: `message_response_${response}`,
        summary: summaryByResponse[response],
        actor: "player",
        entityType: "message",
        entityId: message.id,
        metadata: {
          type: message.type,
          campaignId: message.campaignId ?? "",
        },
      });
    });
  }

  queueRelationshipEvent(input) {
    if (!isObject(input) || !RELATIONSHIP_TRIGGERS.has(input.trigger)) {
      throw new Error("Relationship trigger is invalid.");
    }
    if (!ALLOWED_MESSAGE_TYPES.has(input.contentType)) {
      throw new Error("Event content type is invalid.");
    }
    const templateId =
      typeof input.templateId === "string" &&
      /^[a-zA-Z0-9._-]{1,160}$/.test(input.templateId)
        ? input.templateId
        : "";

    return this.#commit((data, now) => {
      const eventId = `event-${randomUUID()}`;
      data.events.push({
        id: eventId,
        trigger: input.trigger,
        playerId: data.profile.id,
        characterId: data.skill.characterId,
        scheduledAt: data.demoNow,
        payload: {
          contentType: input.contentType,
          templateId,
          source: "local_sandbox",
        },
        status: "queued",
      });
      this.#appendLog(data, {
        occurredAt: now,
        category: "event",
        action: "relationship_event_queued",
        summary: "一个本地关系事件已进入队列。",
        actor: "system",
        entityType: "event",
        entityId: eventId,
        metadata: {
          trigger: input.trigger,
          contentType: input.contentType,
        },
      });
    });
  }

  evaluateContactEvent(eventId) {
    const validId = validateEntityId(eventId, "Event");
    return this.#commit((data, now) => {
      const event = data.events.find((item) => item.id === validId);
      if (!event) throw new Error("Relationship event was not found.");
      if (!["queued", "suppressed"].includes(event.status)) {
        throw new Error("This event cannot be evaluated again.");
      }
      const result = evaluateContactPolicy({
        data,
        event,
        now: data.demoNow,
      });
      event.status = result.allowed
        ? "awaiting_content"
        : "suppressed";
      event.suppressionReason = result.reason ?? undefined;
      this.#appendLog(data, {
        occurredAt: now,
        category: "event",
        action: result.allowed
          ? "contact_event_allowed"
          : "contact_event_suppressed",
        summary: result.allowed
          ? "关系事件通过联系策略，等待生成内容。"
          : "关系事件被联系策略抑制。",
        actor: "system",
        entityType: "event",
        entityId: event.id,
        metadata: {
          contentType: result.contentType,
          reason: result.reason ?? "",
          evaluatedAt: result.evaluatedAt,
        },
      });
    });
  }

  getContactPolicyStatus() {
    return evaluateContactPolicy({
      data: this.getSnapshot(),
      event: {
        id: "event-policy-status",
        trigger: "scheduled_daily",
        playerId: this.data.profile.id,
        characterId: this.data.skill.characterId,
        scheduledAt: this.data.demoNow,
        payload: {
          contentType: "daily",
          templateId: "",
        },
        status: "queued",
      },
      now: this.data.demoNow,
    });
  }

  registerIgnoredContact() {
    return this.#commit((data, now) => {
      data.relationship.ignoredCount += 1;
      if (data.relationship.ignoredCount >= 2) {
        data.relationship.quietUntil = addDays(data.demoNow, 7);
      }
      this.#appendLog(data, {
        occurredAt: now,
        category: "preference",
        action:
          data.relationship.ignoredCount >= 2
            ? "quiet_period_started"
            : "proactive_contact_ignored",
        summary:
          data.relationship.ignoredCount >= 2
            ? "玩家连续忽略两次主动联系，系统进入七天安静期。"
            : "玩家忽略了一次主动联系。",
        actor: "system",
        entityType: "profile",
        entityId: data.profile.id,
        metadata: {
          ignoredCount: data.relationship.ignoredCount,
          quietUntil: data.relationship.quietUntil ?? "",
        },
      });
    });
  }

  registerPlayerInteraction() {
    return this.#commit((data, now) => {
      const previousIgnoredCount = data.relationship.ignoredCount;
      data.relationship.ignoredCount = 0;
      data.relationship.quietUntil = undefined;
      data.relationship.lastInteractionAt = data.demoNow;
      this.#appendLog(data, {
        occurredAt: now,
        category: "event",
        action: "player_interaction_registered",
        summary: "玩家主动互动，连续忽略计数已经重置。",
        actor: "player",
        entityType: "profile",
        entityId: data.profile.id,
        metadata: {
          previousIgnoredCount,
        },
      });
    });
  }

  createCampaign(input) {
    const campaignId = `campaign-${randomUUID()}`;
    const draft = validateCampaignDraftInput(input);
    return this.#commit((data, now) => {
      if (data.campaigns.length >= 50) {
        throw new Error("本地沙盒最多保留 50 个发行任务。");
      }
      data.campaigns.unshift({
        id: campaignId,
        characterId: data.skill.characterId,
        version: draft.version,
        region: data.profile.region,
        targetSegments: clone(draft.targetSegments),
        objective: "launch",
        globalTheme: draft.globalTheme,
        sellingPoints: clone(draft.sellingPoints),
        narrativeApproach: draft.narrativeApproach,
        fixedFacts: clone(draft.fixedFacts),
        fixedFactEntries: createFixedFactEntries(
          draft.fixedFacts,
          data.demoNow,
        ),
        allowedMemoryTypes: ["choice", "photo", "postcard"],
        schedule: buildCampaignSchedule(data.demoNow, campaignId),
        generationMode: draft.generationMode,
        knowledgeSources: [],
        knowledgeChunks: [],
        publishedBundles: [],
        frequencyLimit:
          "版本周期最多一次召回，且服从玩家授权、勿扰、退订和每周上限。",
        reviewRequired: true,
        expandConditions: ["人工批准", "自动校验全部通过"],
        throttleConditions: [
          "玩家连续忽略",
          "同类内容接近频率上限",
        ],
        stopConditions: [
          "玩家退订",
          "事实或人设校验失败",
          "人工紧急停止",
        ],
        status: "draft",
      });
      this.#appendLog(data, {
        occurredAt: now,
        category: "campaign",
        action: "campaign_created",
        summary: "本地发行沙盒创建了一项草稿任务。",
        actor: "reviewer",
        entityType: "campaign",
        entityId: campaignId,
        metadata: {
          version: draft.version,
          generationMode: draft.generationMode,
        },
      });
    });
  }

  updateCampaign(campaignId, input) {
    return this.#commit((data, now) => {
      const campaign = this.#findCampaign(data, campaignId);
      if (
        ["running", "completed", "stopped"].includes(
          campaign.status,
        )
      ) {
        throw new Error("运行中或已结束的任务不能直接编辑。");
      }
      const draft = validateCampaignDraftInput(input, campaign);
      Object.assign(campaign, {
        version: draft.version,
        globalTheme: draft.globalTheme,
        narrativeApproach: draft.narrativeApproach,
        sellingPoints: clone(draft.sellingPoints),
        targetSegments: clone(draft.targetSegments),
        generationMode: draft.generationMode,
        fixedFacts: clone(draft.fixedFacts),
        fixedFactEntries: createFixedFactEntries(
          draft.fixedFacts,
          data.demoNow,
        ),
        status: "draft",
        automaticReview: undefined,
        humanReview: undefined,
      });
      data.relationship.activeCampaignIds =
        data.relationship.activeCampaignIds.filter(
          (id) => id !== campaign.id,
        );
      this.#appendLog(data, {
        occurredAt: now,
        category: "campaign",
        action: "campaign_updated",
        summary: "发行任务已修改，历史审核结论失效并退回草稿。",
        actor: "reviewer",
        entityType: "campaign",
        entityId: campaign.id,
        metadata: {
          generationMode: campaign.generationMode,
        },
      });
    });
  }

  submitCampaignReview(campaignId) {
    return this.#commit((data, now) => {
      const campaign = this.#findCampaign(data, campaignId);
      if (!["draft", "awaiting_review"].includes(campaign.status)) {
        throw new Error("只有草稿任务可以提交自动检查。");
      }
      const review = reviewCampaignTask({
        campaign,
        skill: data.skill,
        now: data.demoNow,
      });
      campaign.automaticReview = review;
      campaign.humanReview = undefined;
      campaign.status = review.passed
        ? "awaiting_review"
        : "draft";
      this.#appendLog(data, {
        occurredAt: now,
        category: "review",
        action: review.passed
          ? "campaign_automatic_check_passed"
          : "campaign_automatic_check_failed",
        summary: review.passed
          ? "发行任务通过自动检查，等待人工审核。"
          : "发行任务自动检查失败，保持草稿状态。",
        actor: "system",
        entityType: "campaign",
        entityId: campaign.id,
        metadata: {
          failedChecks: review.checks.filter(
            (item) => item.status === "fail",
          ).length,
        },
      });
    });
  }

  reviewCampaign(campaignId, input) {
    const reviewInput = validateHumanReviewInput(input);
    return this.#commit((data, now) => {
      const campaign = this.#findCampaign(data, campaignId);
      if (
        campaign.status !== "awaiting_review" ||
        campaign.automaticReview?.passed !== true
      ) {
        throw new Error("任务必须先通过自动检查才能人工审核。");
      }
      campaign.humanReview = {
        ...reviewInput,
        reviewedAt: data.demoNow,
      };
      campaign.status =
        reviewInput.decision === "approved" ? "approved" : "draft";
      this.#appendLog(data, {
        occurredAt: now,
        category: "review",
        action: `campaign_human_${reviewInput.decision}`,
        summary:
          reviewInput.decision === "approved"
            ? "审核者批准了发行任务。"
            : "审核者拒绝了发行任务，任务退回草稿。",
        actor: "reviewer",
        entityType: "campaign",
        entityId: campaign.id,
        metadata: {
          reviewer: reviewInput.reviewer,
          note: reviewInput.note,
        },
      });
    });
  }

  setCampaignLifecycle(campaignId, action) {
    if (
      !["start", "pause", "resume", "stop", "complete"].includes(
        action,
      )
    ) {
      throw new Error("发行任务状态操作无效。");
    }
    return this.#commit((data, now) => {
      const campaign = this.#findCampaign(data, campaignId);
      const expectedStatus = {
        start: "approved",
        pause: "running",
        resume: "paused",
      };
      if (
        expectedStatus[action] &&
        campaign.status !== expectedStatus[action]
      ) {
        throw new Error("当前任务状态不允许执行这个操作。");
      }
      if (
        ["stop", "complete"].includes(action) &&
        ["completed", "stopped"].includes(campaign.status)
      ) {
        throw new Error("发行任务已经结束。");
      }
      if (
        action === "complete" &&
        !["running", "paused"].includes(campaign.status)
      ) {
        throw new Error("只有运行中或已暂停的任务可以正常完成。");
      }
      if (
        action === "resume" &&
        campaign.humanReview?.decision !== "approved"
      ) {
        throw new Error("恢复前需要保留有效的人工批准记录。");
      }

      const statusByAction = {
        start: "running",
        pause: "paused",
        resume: "running",
        stop: "stopped",
        complete: "completed",
      };
      campaign.status = statusByAction[action];
      const active =
        action === "start" || action === "resume";
      data.relationship.activeCampaignIds = active
        ? [
            ...new Set([
              ...data.relationship.activeCampaignIds,
              campaign.id,
            ]),
          ]
        : data.relationship.activeCampaignIds.filter(
            (id) => id !== campaign.id,
          );

      if (action === "stop" || action === "complete") {
        for (const message of data.messages) {
          if (
            message.campaignId === campaign.id &&
            !message.sentAt &&
            !["rejected", "expired"].includes(message.reviewStatus)
          ) {
            message.reviewStatus = "expired";
          }
        }
        for (const event of data.events) {
          if (
            event.payload?.campaignId === campaign.id &&
            !["executed", "cancelled"].includes(event.status)
          ) {
            event.status = "cancelled";
          }
        }
      }

      this.#appendLog(data, {
        occurredAt: now,
        category: "campaign",
        action: `campaign_${action}`,
        summary: {
          start: "发行任务开始运行。",
          pause: "发行任务已暂停，后续内容立即停止。",
          resume: "发行任务恢复运行。",
          stop: "发行任务已停止，未发送内容全部失效。",
          complete: "发行任务已完成，角色恢复日常陪伴。",
        }[action],
        actor: "reviewer",
        entityType: "campaign",
        entityId: campaign.id,
        metadata: {
          status: campaign.status,
        },
      });
    });
  }

  generateCampaignMessage(campaignId, phase, candidate) {
    if (!Object.hasOwn(PHASE_TO_MESSAGE_TYPE, phase)) {
      throw new Error("发行消息阶段无效。");
    }
    return this.#commit((data, now) => {
      const campaign = this.#findCampaign(data, campaignId);
      if (campaign.status !== "running") {
        throw new Error("只有运行中的发行任务可以生成消息。");
      }
      const eventId = `event-${randomUUID()}`;
      const event = {
        id: eventId,
        trigger: PHASE_TO_TRIGGER[phase],
        playerId: data.profile.id,
        characterId: data.skill.characterId,
        scheduledAt: data.demoNow,
        payload: {
          campaignId: campaign.id,
          contentType: PHASE_TO_MESSAGE_TYPE[phase],
          templateId: PHASE_TO_TEMPLATE[phase],
          phase,
          source: "campaign_sandbox",
        },
        status: "queued",
      };
      data.events.push(event);
      const contactDecision = evaluateContactPolicy({
        data,
        event,
        now: data.demoNow,
      });
      if (!contactDecision.allowed) {
        event.status = "suppressed";
        event.suppressionReason =
          contactDecision.reason ?? "unknown";
        this.#appendLog(data, {
          occurredAt: now,
          category: "event",
          action: "campaign_event_suppressed",
          summary: "发行事件被玩家授权或联系策略抑制。",
          actor: "system",
          entityType: "event",
          entityId: event.id,
          metadata: {
            campaignId: campaign.id,
            reason: contactDecision.reason ?? "",
          },
        });
        return;
      }

      const rendered = renderCampaignMessage({
        data,
        campaign,
        phase,
        now: data.demoNow,
      });
      if (candidate) {
        if (
          !isObject(candidate) ||
          candidate.riskFlags?.length ||
          typeof candidate.title !== "string" ||
          typeof candidate.body !== "string"
        ) {
          throw new Error("模型候选无效或包含风险标记。");
        }
        const allowedFacts = new Set(
          campaign.fixedFactEntries
            .filter(
              (fact) =>
                fact.locked &&
                fact.reviewedAt &&
                isScopedContentAvailable(fact, {
                  phase,
                  region: campaign.region,
                  segments: campaign.targetSegments,
                  now: data.demoNow,
                }),
            )
            .map((fact) => fact.id),
        );
        const allowedKnowledge = new Set(
          (campaign.knowledgeChunks ?? [])
            .filter(
              (chunk) =>
                chunk.approved &&
                isScopedContentAvailable(chunk, {
                  phase,
                  region: campaign.region,
                  segments: campaign.targetSegments,
                  now: data.demoNow,
                }),
            )
            .map((chunk) => chunk.id),
        );
        if (
          !(candidate.usedFactIds ?? []).every((id) =>
            allowedFacts.has(id),
          ) ||
          !(candidate.usedKnowledgeChunkIds ?? []).every((id) =>
            allowedKnowledge.has(id),
          )
        ) {
          throw new Error("模型候选引用了未批准的事实或知识。");
        }
        const approvedSourceText = [
          ...campaign.fixedFactEntries
            .filter((fact) => (candidate.usedFactIds ?? []).includes(fact.id))
            .map((fact) => fact.value),
          ...(campaign.knowledgeChunks ?? [])
            .filter((chunk) =>
              (candidate.usedKnowledgeChunkIds ?? []).includes(chunk.id),
            )
            .map((chunk) => chunk.text),
        ].join("\n");
        const unsupportedClaims = unsupportedStructuredClaims(
          `${candidate.title}\n${candidate.body}`,
          approvedSourceText,
        );
        if (unsupportedClaims.length) {
          throw new Error(
            `模型候选包含来源未提供的日期、数字或奖励声明：${unsupportedClaims.join("、")}`,
          );
        }
        if (
          candidate.actionId &&
          candidate.actionId !== campaign.fixedFacts.actionTarget
        ) {
          throw new Error("模型候选尝试修改锁定的产品内入口。");
        }
        rendered.title = candidate.title.trim().slice(0, 80);
        rendered.body = candidate.body.trim().slice(0, 180);
        rendered.fixedFactIds = [...candidate.usedFactIds];
        rendered.knowledgeChunkIds = [
          ...candidate.usedKnowledgeChunkIds,
        ];
      }
      const messageId = `message-${randomUUID()}`;
      event.status = "awaiting_review";
      data.messages.unshift({
        id: messageId,
        characterId: data.skill.characterId,
        playerId: data.profile.id,
        type: rendered.type,
        title: rendered.title,
        body: rendered.body,
        createdAt: data.demoNow,
        eventId,
        campaignId: campaign.id,
        reviewStatus: "draft",
        trace: {
          skillVersion: data.skill.skillVersion,
          templateId: rendered.templateId,
          ruleIds: [
            "knowledge.fixed_facts_only",
            "memory.authorized_reference",
            "campaign.single_call_to_action",
            "safety.contact_policy_before_generation",
          ],
          fixedFactIds: rendered.fixedFactIds,
          knowledgeChunkIds: rendered.knowledgeChunkIds ?? [],
          memoryIds: rendered.memoryIds,
          generatedAt: rendered.generatedAt,
        },
        deliveryMode: "proactive",
        favorite: false,
        liked: false,
        remindLater: false,
        action: rendered.action,
      });
      this.#appendLog(data, {
        occurredAt: now,
        category: "campaign",
        action: "campaign_message_drafted",
        summary: "发行任务使用锁定事实生成了一条待审核消息。",
        actor: "character",
        entityType: "message",
        entityId: messageId,
        metadata: {
          campaignId: campaign.id,
          phase,
          generationMode: campaign.generationMode,
        },
      });
    });
  }

  runMessageAutomaticReview(messageId) {
    return this.#commit((data, now) => {
      const message = this.#findMessage(data, messageId);
      if (
        !["draft", "automatic_check_failed"].includes(
          message.reviewStatus,
        )
      ) {
        throw new Error("只有草稿消息可以执行自动检查。");
      }
      if (!message.campaignId) {
        throw new Error("这条消息不属于发行任务。");
      }
      const campaign = this.#findCampaign(
        data,
        message.campaignId,
      );
      const review = reviewCampaignContent({
        message,
        campaign,
        data,
        skill: data.skill,
        now: data.demoNow,
      });
      message.automaticReview = review;
      message.humanReview = undefined;
      message.reviewStatus = review.passed
        ? "awaiting_human_review"
        : "automatic_check_failed";
      this.#appendLog(data, {
        occurredAt: now,
        category: "review",
        action: review.passed
          ? "message_automatic_check_passed"
          : "message_automatic_check_failed",
        summary: review.passed
          ? "发行消息通过自动检查，等待人工审核。"
          : "发行消息自动检查失败，禁止进入玩家收件箱。",
        actor: "system",
        entityType: "message",
        entityId: message.id,
        metadata: {
          campaignId: campaign.id,
          failedChecks: review.checks.filter(
            (item) => item.status === "fail",
          ).length,
        },
      });
    });
  }

  reviewCampaignMessage(messageId, input) {
    const reviewInput = validateHumanReviewInput(input);
    return this.#commit((data, now) => {
      const message = this.#findMessage(data, messageId);
      if (
        message.reviewStatus !== "awaiting_human_review" ||
        message.automaticReview?.passed !== true
      ) {
        throw new Error("消息必须先通过自动检查才能人工审核。");
      }
      message.humanReview = {
        ...reviewInput,
        reviewedAt: data.demoNow,
      };
      message.reviewStatus =
        reviewInput.decision === "approved"
          ? "approved"
          : "rejected";
      this.#appendLog(data, {
        occurredAt: now,
        category: "review",
        action: `message_human_${reviewInput.decision}`,
        summary:
          reviewInput.decision === "approved"
            ? "审核者批准了发行消息，等待实际投递。"
            : "审核者拒绝了发行消息。",
        actor: "reviewer",
        entityType: "message",
        entityId: message.id,
        metadata: {
          reviewer: reviewInput.reviewer,
          note: reviewInput.note,
          campaignId: message.campaignId ?? "",
        },
      });
    });
  }

  receiveRegionalReleasePlan(input) {
    if (!isObject(input)) throw new Error("区域发行方案不能为空。");
    const text = (value, maxLength) =>
      typeof value === "string" ? value.trim().slice(0, maxLength) : "";
    const sourceId = text(input.sourceId, 160);
    const taskId = text(input.taskId ?? input.plan?.id, 120);
    const regionId = text(input.regionId ?? input.region?.id, 80);
    const rolloutPercent = Number(input.rolloutPercent);
    const exampleMode = input.exampleMode === true;
    if (!sourceId || !taskId || !regionId) {
      throw new Error("区域发行方案缺少来源、任务或区域标识。");
    }
    if (
      !Number.isFinite(rolloutPercent) ||
      rolloutPercent < 1 ||
      rolloutPercent > 100
    ) {
      throw new Error("灰度比例必须在 1% 到 100% 之间。");
    }
    const plan = {
      id: taskId,
      title: text(input.plan?.title, 120) || "新的版本旅程",
      theme: text(input.plan?.theme, 240),
      narrative: text(input.plan?.narrative, 1200),
      timeWindow: text(input.plan?.timeWindow, 120),
      facts: Array.isArray(input.plan?.facts)
        ? input.plan.facts.slice(0, 20).map((fact, index) => ({
            id: text(fact?.id, 120) || `fact-${index + 1}`,
            label: text(fact?.label, 120),
            value: text(fact?.value, 500),
            source: text(fact?.source, 240),
          }))
        : [],
      sourceName: text(input.source?.name, 160),
      sourceExcerpt: text(input.source?.content, 6000),
    };

    return this.#commit((data, now) => {
      const duplicate = data.events.some(
        (event) =>
          event.payload?.source === "regional_release_plan" &&
          event.payload?.sourceId === sourceId,
      );
      if (duplicate) return;

      const eventId = `event-${randomUUID()}`;
      const rolloutSelected = isPlayerInRollout(
        data.profile.id,
        `regional-plan:${sourceId}`,
        rolloutPercent,
      );
      const event = {
        id: eventId,
        trigger: "version_launch",
        playerId: data.profile.id,
        characterId: data.skill.characterId,
        scheduledAt: data.demoNow,
        payload: {
          source: "regional_release_plan",
          sourceId,
          taskId,
          regionId,
          rolloutPercent,
          rolloutSelected,
          exampleMode,
          exampleFrequencyBypass: exampleMode,
          contentType: "version_launch",
          templateId: `regional-plan-${sourceId}`.slice(0, 160),
          ...(rolloutSelected ? { releasePlan: plan } : {}),
        },
        status: "queued",
      };
      data.events.push(event);

      if (!rolloutSelected) {
        event.status = "suppressed";
        event.suppressionReason = "gray_rollout_not_selected";
        this.#appendLog(data, {
          occurredAt: now,
          category: "delivery",
          action: "regional_plan_gray_not_selected",
          summary: "当前桌宠未命中本次灰度，不接收区域发行方案。",
          actor: "system",
          entityType: "event",
          entityId: eventId,
          metadata: { sourceId, taskId, regionId, rolloutPercent },
        });
        return;
      }

      this.#appendLog(data, {
        occurredAt: now,
        category: "delivery",
        action: "regional_plan_received",
        summary: "三月七已接收命中灰度的区域发行方案。",
        actor: "system",
        entityType: "event",
        entityId: eventId,
        metadata: { sourceId, taskId, regionId, rolloutPercent, exampleMode },
      });

      const contactDecision = evaluateContactPolicy({
        data,
        event,
        now: data.demoNow,
      });
      if (!contactDecision.allowed) {
        event.status = "suppressed";
        event.suppressionReason = contactDecision.reason ?? "unknown";
        this.#appendLog(data, {
          occurredAt: now,
          category: "delivery",
          action: "regional_plan_proactive_contact_suppressed",
          summary: "区域方案已保留为被动聊天上下文，主动联系因关系护栏暂缓。",
          actor: "system",
          entityType: "event",
          entityId: eventId,
          metadata: {
            sourceId,
            taskId,
            regionId,
            reason: contactDecision.reason ?? "unknown",
          },
        });
        return;
      }

      const memory = (
        data.profile.memoryEnabled === true &&
        data.relationship.memoryEnabled === true
      )
        ? [...data.memories].reverse().find(
            (item) =>
              item.status === "confirmed" &&
              item.userConfirmed === true &&
              item.reusableByCharacter === true &&
              item.campaignReusable === true,
          )
        : null;
      const topic = sanitizePlayerVisibleText(
        plan.theme || plan.title,
        "列车上的新故事",
      );
      const memoryLead = memory
        ? `还记得“${sanitizePlayerVisibleText(memory.title, "以前聊过的那件事")}”吗？`
        : "";
      const body = sanitizePlayerVisibleText(
        `${memoryLead}最近列车上多了件和“${topic}”有关的新鲜事。` +
          "你有空、也正好想换换心情的时候，可以来看看；最近忙的话就先放着。",
        PLAYER_VISIBLE_MESSAGE_FALLBACK,
      );
      const messageId = `message-${randomUUID()}`;
      data.messages.unshift({
        id: messageId,
        characterId: data.skill.characterId,
        playerId: data.profile.id,
        type: "version_launch",
        title: "咱发现了一段新旅程",
        body,
        createdAt: data.demoNow,
        eventId,
        reviewStatus: "approved",
        humanReview: {
          reviewer: "区域发行控制台",
          decision: "approved",
          reviewedAt: data.demoNow,
          note: exampleMode
            ? "示例发布：仅绕过主动触达频控，其余关系与安全护栏保持有效。"
            : "区域方案发布后由共生式角色按关系护栏自然执行。",
        },
        trace: {
          skillVersion: data.skill.skillVersion,
          templateId: `regional-plan-${sourceId}`.slice(0, 160),
          ruleIds: [
            "release.regional_plan_received",
            "release.gray_rollout_selected",
            ...(exampleMode ? ["release.example_frequency_bypass"] : []),
            "memory.authorized_reference",
            "relationship.soft_version_invitation",
            "safety.contact_policy_before_generation",
          ],
          fixedFactIds: plan.facts.map((fact) => fact.id),
          knowledgeChunkIds: [],
          memoryIds: memory ? [memory.id] : [],
          generatedAt: data.demoNow,
        },
        releasePlan: plan,
        releaseSourceId: sourceId,
        sentAt: data.demoNow,
        deliveryMode: "proactive",
        favorite: false,
        liked: false,
        remindLater: false,
        action: {
          label: "有空再看看",
          kind: "open_version_demo",
          targetId: `product://campaign/${taskId}`,
        },
      });
      event.status = "executed";
      this.#appendLog(data, {
        occurredAt: now,
        category: "delivery",
        action: "regional_plan_proactive_chat_started",
        summary: "三月七结合授权记忆，以低打扰方式主动发起了版本话题。",
        actor: "character",
        entityType: "message",
        entityId: messageId,
        metadata: {
          sourceId,
          taskId,
          regionId,
          memoryId: memory?.id ?? "",
        },
      });
    });
  }

  deliverReleaseTestMessage(input) {
    const rawTitle = asShortString(input?.title, "三月七想和你聊聊", 120);
    const rawBody = asShortString(input?.body, "", 1200);
    if (!rawBody) throw new Error("测试消息内容不能为空。");
    const title = sanitizePlayerVisibleText(
      rawTitle,
      PLAYER_VISIBLE_TITLE_FALLBACK,
    );
    const body = sanitizePlayerVisibleText(
      rawBody,
      PLAYER_VISIBLE_MESSAGE_FALLBACK,
    );
    return this.#commit((data, now) => {
      const eventId = `event-${randomUUID()}`;
      const messageId = `message-${randomUUID()}`;
      data.events.push({
        id: eventId,
        trigger: "manual_demo_event",
        playerId: data.profile.id,
        characterId: data.skill.characterId,
        payload: { source: "release_workspace_test", contentType: "version_launch" },
        status: "executed",
      });
      data.messages.push({
        id: messageId,
        characterId: data.skill.characterId,
        playerId: data.profile.id,
        type: "version_launch",
        title,
        body,
        createdAt: data.demoNow,
        eventId,
        reviewStatus: "approved",
        humanReview: {
          reviewer: "发行控制台",
          decision: "approved",
          reviewedAt: data.demoNow,
          note: "已批准指令的本地单条测试投递",
        },
        trace: {
          skillVersion: data.skill.skillVersion,
          templateId: "release-workspace-test",
          ruleIds: ["release.approved_only", "release.no_aggregate_data"],
          fixedFactIds: [],
          knowledgeChunkIds: [],
          memoryIds: [],
          generatedAt: data.demoNow,
        },
        sentAt: data.demoNow,
        deliveryMode: "proactive",
        favorite: false,
        liked: false,
        remindLater: false,
      });
      this.#appendLog(data, {
        occurredAt: now,
        category: "delivery",
        action: "release_workspace_test_delivered",
        summary: "发行控制台投递了一条已批准的本地测试消息。",
        actor: "reviewer",
        entityType: "message",
        entityId: messageId,
        metadata: { sourceId: asShortString(input?.sourceId, "", 160) },
      });
    });
  }

  deliverCampaignMessage(messageId) {
    return this.#commit((data, now) => {
      const message = this.#findMessage(data, messageId);
      if (
        message.reviewStatus !== "approved" ||
        message.sentAt
      ) {
        throw new Error("只有已批准且未发送的消息可以投递。");
      }
      if (!message.campaignId) {
        throw new Error("这条消息不属于发行任务。");
      }
      const campaign = this.#findCampaign(
        data,
        message.campaignId,
      );
      if (data.globalCampaignKillSwitch) {
        throw new Error("全局发行急停已开启。");
      }
      if (
        !(campaign.publishedBundles ?? []).some(
          (bundle) =>
            bundle.status === "active" &&
            bundle.messageIds.includes(message.id) &&
            isPlayerInRollout(
              data.profile.id,
              campaign.id,
              bundle.rolloutPercent,
            ),
        )
      ) {
        throw new Error("消息不属于当前有效的已发布内容包。");
      }
      if (campaign.status !== "running") {
        throw new Error("发行任务当前没有运行。");
      }
      const event = data.events.find(
        (item) => item.id === message.eventId,
      );
      if (!event) throw new Error("消息关联事件不存在。");
      const contactDecision = evaluateContactPolicy({
        data,
        event,
        now: data.demoNow,
      });
      if (!contactDecision.allowed) {
        event.status = "suppressed";
        event.suppressionReason =
          contactDecision.reason ?? "unknown";
        this.#appendLog(data, {
          occurredAt: now,
          category: "delivery",
          action: "campaign_delivery_suppressed",
          summary: "已批准消息在发送前被联系策略抑制。",
          actor: "system",
          entityType: "message",
          entityId: message.id,
          metadata: {
            campaignId: campaign.id,
            reason: contactDecision.reason ?? "",
          },
        });
        return;
      }
      message.sentAt = data.demoNow;
      event.status = "executed";
      event.suppressionReason = undefined;
      data.relationship.activeCampaignIds = [
        ...new Set([
          ...data.relationship.activeCampaignIds,
          campaign.id,
        ]),
      ];
      this.#appendLog(data, {
        occurredAt: now,
        category: "delivery",
        action: "campaign_message_delivered",
        summary: "通过两级审核的发行消息已进入角色通信中心。",
        actor: "system",
        entityType: "message",
        entityId: message.id,
        metadata: {
          campaignId: campaign.id,
          type: message.type,
          eventId: event.id,
        },
      });
    });
  }

  getDemoScenarios() {
    return clone(getDemoScenarioSummaries());
  }

  loadDemoScenario(scenarioId) {
    const baseData = createDefaultCompanionData({
      skillProfile: this.skillProfile,
      now: DEMO_BASE_NOW,
    });
    const scenarioData = applyDemoScenario(baseData, scenarioId);
    this.data = normalizeCompanionData(scenarioData, {
      skillProfile: this.skillProfile,
      now: DEMO_BASE_NOW,
    });
    this.#write(this.data);
    return this.getSnapshot();
  }

  advanceDemoTime(input) {
    if (!isObject(input)) {
      throw new Error("需要提供演示时间目标。");
    }
    return this.#commit((data, now) => {
      let target;
      if ([1, 7, 14, 42].includes(input.day)) {
        target = addDays(data.demoStartedAt, input.day);
      } else if (isIsoDate(input.target)) {
        target = new Date(input.target).toISOString();
      } else {
        throw new Error("演示时间只支持 Day 1、7、14、42 或有效自定义时间。");
      }
      const targetTime = Date.parse(target);
      const currentTime = Date.parse(data.demoNow);
      const startedTime = Date.parse(data.demoStartedAt);
      if (targetTime <= currentTime) {
        throw new Error("演示时间只能向前推进。");
      }
      if (
        targetTime >
        startedTime + 365 * 24 * 60 * 60 * 1_000
      ) {
        throw new Error("单个演示案例最多向前推进 365 天。");
      }
      const previousDemoNow = data.demoNow;
      const previousStage = data.relationship.relationshipStage;
      data.demoNow = target;
      this.#processDueCampaignSchedule(data, now);
      data.relationship.relationshipStage =
        calculateRelationshipStage(data);
      this.#appendLog(data, {
        occurredAt: now,
        category: "system",
        action: "demo_time_advanced",
        summary: "本地演示时钟已向前推进，未修改系统时间。",
        actor: "reviewer",
        entityType: "profile",
        entityId: data.profile.id,
        metadata: {
          previousDemoNow,
          demoNow: data.demoNow,
          previousStage,
          relationshipStage:
            data.relationship.relationshipStage,
        },
      });
      if (
        previousStage !== data.relationship.relationshipStage
      ) {
        this.#appendLog(data, {
          occurredAt: now,
          category: "event",
          action: "relationship_stage_changed",
          summary: "演示时间推进触发了关系阶段变化。",
          actor: "system",
          entityType: "profile",
          entityId: data.profile.id,
          metadata: {
            previousStage,
            relationshipStage:
              data.relationship.relationshipStage,
            demoNow: data.demoNow,
          },
        });
      }
    });
  }

  triggerDemoAction(action) {
    if (
      ![
        "ignore_contact",
        "positive_reply",
        "unsubscribe_version",
        "risk_unsafe_link",
      ].includes(action)
    ) {
      throw new Error("演示动作无效。");
    }
    return this.#commit((data, now) => {
      if (action === "ignore_contact") {
        data.relationship.ignoredCount += 1;
        if (data.relationship.ignoredCount >= 2) {
          data.relationship.quietUntil = addDays(
            data.demoNow,
            7,
          );
        }
        this.#appendLog(data, {
          occurredAt: now,
          category: "preference",
          action:
            data.relationship.ignoredCount >= 2
              ? "demo_quiet_period_started"
              : "demo_contact_ignored",
          summary:
            data.relationship.ignoredCount >= 2
              ? "演示玩家连续忽略两次，进入七天安静期。"
              : "演示玩家忽略了一次主动联系。",
          actor: "player",
          entityType: "profile",
          entityId: data.profile.id,
          metadata: {
            ignoredCount: data.relationship.ignoredCount,
            quietUntil: data.relationship.quietUntil ?? "",
          },
        });
        return;
      }

      if (action === "positive_reply") {
        const message = data.messages.find(
          (item) => item.sentAt && item.reviewStatus === "approved",
        );
        if (!message) {
          throw new Error("当前没有可以回复的已发送消息。");
        }
        message.liked = true;
        message.playerResponse = "like";
        data.relationship.ignoredCount = 0;
        data.relationship.quietUntil = undefined;
        data.relationship.lastInteractionAt = data.demoNow;
        this.#appendLog(data, {
          occurredAt: now,
          category: "preference",
          action: "demo_positive_reply",
          summary: "演示玩家喜欢并回复了最近一条已发送通信。",
          actor: "player",
          entityType: "message",
          entityId: message.id,
          metadata: {
            type: message.type,
          },
        });
        return;
      }

      if (action === "unsubscribe_version") {
        const versionTypes = new Set([
          "version_preheat",
          "version_launch",
          "version_sustain",
          "recall",
        ]);
        data.profile.allowedContentTypes =
          data.profile.allowedContentTypes.filter(
            (type) => !versionTypes.has(type),
          );
        data.relationship.allowedContentTypes =
          data.relationship.allowedContentTypes.filter(
            (type) => !versionTypes.has(type),
          );
        data.profile.recallEnabled = false;
        for (const campaign of data.campaigns) {
          if (!["completed", "stopped"].includes(campaign.status)) {
            campaign.status = "stopped";
          }
        }
        data.relationship.activeCampaignIds = [];
        for (const message of data.messages) {
          if (
            message.campaignId &&
            !message.sentAt &&
            !["rejected", "expired"].includes(message.reviewStatus)
          ) {
            message.reviewStatus = "expired";
          }
        }
        this.#appendLog(data, {
          occurredAt: now,
          category: "preference",
          action: "demo_version_unsubscribed",
          summary: "演示玩家退订版本内容，活动任务和未发送内容立即停止。",
          actor: "player",
          entityType: "profile",
          entityId: data.profile.id,
          metadata: {
            stoppedCampaigns: data.campaigns.filter(
              (campaign) => campaign.status === "stopped",
            ).length,
          },
        });
        return;
      }

      const campaign = data.campaigns.find(
        (item) => item.status === "running",
      );
      if (!campaign) {
        throw new Error("当前没有运行中的任务用于风险测试。");
      }
      const eventId = `event-${randomUUID()}`;
      const message = {
        id: `message-${randomUUID()}`,
        characterId: data.skill.characterId,
        playerId: data.profile.id,
        type: "version_launch",
        title: "风险测试：未审核外链",
        body: "三月七认为你必须立即充值，并打开 https://unsafe.example",
        createdAt: data.demoNow,
        eventId,
        campaignId: campaign.id,
        reviewStatus: "draft",
        trace: {
          skillVersion: data.skill.skillVersion,
          templateId: "risk-injection-demo-v1",
          ruleIds: [
            "knowledge.fixed_facts_only",
            "campaign.single_call_to_action",
          ],
          fixedFactIds: campaign.fixedFactEntries.map(
            (entry) => entry.id,
          ),
          memoryIds: [],
          generatedAt: data.demoNow,
        },
        deliveryMode: "proactive",
        favorite: false,
        liked: false,
        remindLater: false,
        action: {
          label: "不安全入口",
          kind: "open_version_demo",
          targetId: "https://unsafe.example",
        },
      };
      const review = reviewCampaignContent({
        message,
        campaign,
        data,
        skill: data.skill,
        now: data.demoNow,
      });
      message.automaticReview = review;
      message.reviewStatus = "automatic_check_failed";
      data.events.push({
        id: eventId,
        trigger: "manual_demo_event",
        playerId: data.profile.id,
        characterId: data.skill.characterId,
        scheduledAt: data.demoNow,
        payload: {
          campaignId: campaign.id,
          contentType: message.type,
          source: "risk_demo",
        },
        status: "cancelled",
        suppressionReason: "automatic_check_failed",
      });
      data.messages.unshift(message);
      this.#appendLog(data, {
        occurredAt: now,
        category: "risk",
        action: "unsafe_campaign_content_blocked",
        summary: "风险演示内容因外链、付费诱导和角色边界问题被拦截。",
        actor: "system",
        entityType: "message",
        entityId: message.id,
        metadata: {
          failedChecks: review.checks.filter(
            (item) => item.status === "fail",
          ).length,
          sent: false,
        },
      });
    });
  }

  resetDemo() {
    return this.loadDemoScenario("japan_story");
  }
}

module.exports = {
  COMPANION_SCHEMA_VERSION,
  CompanionStore,
  isPlayerInRollout,
  createDefaultCompanionData,
  normalizeCompanionData,
};
