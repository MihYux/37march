const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const skillProfile = require("../shared/march7th-skill-profile.json");
const {
  COMPANION_SCHEMA_VERSION,
  CompanionStore,
  createDefaultCompanionData,
} = require("./companion-store.cjs");

const TEST_NOW = "2026-07-24T08:00:00.000Z";
const DEFAULT_ONBOARDING_INPUT = {
  displayName: "演示玩家",
  proactiveContactEnabled: true,
  allowedContentTypes: [
    "daily",
    "photo",
    "postcard",
    "relationship",
    "version_preheat",
    "version_launch",
    "version_sustain",
  ],
  recallEnabled: false,
  personalizationEnabled: true,
  memoryEnabled: true,
  quietHours: {
    start: "22:00",
    end: "09:00",
  },
  weeklyContactLimit: 2,
  consentAccepted: true,
  firstChoice: "take_photos",
};

function makeTemporaryStore() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "march7th-companion-store-"),
  );
  const filePath = path.join(directory, "companion-data.json");
  const store = new CompanionStore({
    filePath,
    skillProfile,
    clock: () => TEST_NOW,
  });
  return { directory, filePath, store };
}

test("default companion data is explicitly simulated and traceable", () => {
  const data = createDefaultCompanionData({
    skillProfile,
    now: TEST_NOW,
  });

  assert.equal(data.schemaVersion, COMPANION_SCHEMA_VERSION);
  assert.equal(data.isDemoData, true);
  assert.equal(data.skill.skillVersion, skillProfile.skillVersion);
  assert.equal(data.profile.proactiveContactEnabled, false);
  assert.equal(data.profile.recallEnabled, false);
  assert.equal(data.profile.onboardingCompleted, false);
  assert.deepEqual(data.memories, []);
  assert.deepEqual(data.messages, []);
  assert.ok(
    data.campaigns.every(
      (campaign) =>
        campaign.fixedFacts.dataNature ===
        "全部内容均为产品内模拟数据",
    ),
  );
});

test("store writes atomically and reloads the same business data", () => {
  const { filePath, store } = makeTemporaryStore();
  const firstSnapshot = store.getSnapshot();
  const reloaded = new CompanionStore({
    filePath,
    skillProfile,
    clock: () => TEST_NOW,
  }).getSnapshot();

  assert.deepEqual(reloaded, firstSnapshot);
  assert.deepEqual(reloaded.relationship.activeCampaignIds, []);
  assert.equal(fs.existsSync(`${filePath}.tmp`), false);
  // Unix 权限位仅在 posix 文件系统上有意义；Windows/NTFS 不保留 0o600，跳过断言
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  }
});

test("invalid data is backed up before a safe demo reset", () => {
  const { directory, filePath } = makeTemporaryStore();
  fs.writeFileSync(filePath, "{not-valid-json", "utf8");

  const recovered = new CompanionStore({
    filePath,
    skillProfile,
    clock: () => TEST_NOW,
  }).getSnapshot();
  const backups = fs
    .readdirSync(directory)
    .filter((name) => name.startsWith("companion-data.json.invalid-"));

  assert.equal(recovered.isDemoData, true);
  assert.equal(recovered.schemaVersion, COMPANION_SCHEMA_VERSION);
  assert.equal(backups.length, 1);
  assert.equal(
    fs.readFileSync(path.join(directory, backups[0]), "utf8"),
    "{not-valid-json",
  );
});

test("reset restores deterministic default data", () => {
  const { store } = makeTemporaryStore();
  const reset = store.resetDemo();

  assert.equal(reset.updatedAt, TEST_NOW);
  assert.equal(reset.profile.id, "demo-player-jp");
  assert.equal(reset.demoScenarioId, "japan_story");
  assert.equal(reset.profile.onboardingCompleted, true);
  assert.equal(reset.memories.length, 1);
  assert.equal(reset.executionLog[0].action, "demo_initialized");
});

test("onboarding requires consent before creating memory or messages", () => {
  const { store } = makeTemporaryStore();

  assert.throws(
    () =>
      store.completeOnboarding({
        ...DEFAULT_ONBOARDING_INPUT,
        consentAccepted: false,
      }),
    /需要先确认/,
  );
  assert.deepEqual(store.getSnapshot().memories, []);
  assert.deepEqual(store.getSnapshot().messages, []);
});

test("onboarding creates the first confirmed memory and welcome message", () => {
  const { store } = makeTemporaryStore();
  const data = store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);

  assert.equal(data.profile.onboardingCompleted, true);
  assert.equal(data.profile.proactiveContactEnabled, true);
  assert.equal(data.memories.length, 1);
  assert.equal(data.memories[0].id, "memory-first-choice");
  assert.equal(data.memories[0].userConfirmed, true);
  assert.equal(data.messages[0].id, "message-first-welcome");
  assert.equal(
    data.messages[0].trace.skillVersion,
    skillProfile.skillVersion,
  );
  assert.equal(data.executionLog.at(-1).action, "onboarding_completed");
});

test("disabling memory during onboarding does not create a memory", () => {
  const { store } = makeTemporaryStore();
  const data = store.completeOnboarding({
    ...DEFAULT_ONBOARDING_INPUT,
    memoryEnabled: false,
    firstChoice: "walk_slowly",
  });

  assert.deepEqual(data.memories, []);
  assert.deepEqual(data.messages[0].trace.memoryIds, []);
  assert.equal(data.messages[0].action, undefined);
});

test("memory reference preference persists with an execution log", () => {
  const { filePath, store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);
  const updated = store.setMemoryReusable("memory-first-choice", false);
  const reloaded = new CompanionStore({
    filePath,
    skillProfile,
    clock: () => TEST_NOW,
  }).getSnapshot();

  assert.equal(updated.memories[0].reusableByCharacter, false);
  assert.equal(reloaded.memories[0].reusableByCharacter, false);
  assert.equal(
    reloaded.executionLog.at(-1).action,
    "memory_reference_disabled",
  );
});

test("deleting a memory removes its message trace reference", () => {
  const { store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);
  const updated = store.deleteMemory("memory-first-choice");

  assert.equal(
    updated.memories.some((item) => item.id === "memory-first-choice"),
    false,
  );
  assert.equal(
    updated.messages.some((message) =>
      message.trace.memoryIds.includes("memory-first-choice"),
    ),
    false,
  );
  assert.equal(updated.executionLog.at(-1).action, "memory_deleted");
});

test("clearing memories preserves the auditable action without memory text", () => {
  const { store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);
  const updated = store.clearMemories();

  assert.deepEqual(updated.memories, []);
  assert.equal(updated.executionLog.at(-1).action, "all_memories_deleted");
  assert.equal(updated.executionLog.at(-1).metadata.removedCount, 1);
});

test("a photo is only saved when long-term memory is enabled", () => {
  const { store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);
  store.setMemoryEnabled(false);
  assert.throws(
    () => store.createPhotoMemory(),
    /请先开启长期记忆/,
  );

  store.setMemoryEnabled(true);
  const updated = store.createPhotoMemory();
  assert.equal(updated.memories[0].type, "photo");
  assert.equal(updated.memories[0].userConfirmed, true);
  assert.equal(updated.executionLog.at(-1).action, "photo_memory_created");
});

test("memory export contains only companion memory data", () => {
  const { store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);
  const exported = store.getMemoryExport();

  assert.equal(exported.isDemoData, true);
  assert.equal(exported.characterId, "march-7th");
  assert.equal(exported.memories.length, 1);
  assert.equal("messages" in exported, false);
  assert.equal("campaigns" in exported, false);
});

test("privacy export includes business data and explicitly excludes secrets", () => {
  const { store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);
  const exported = store.getPrivacyExport();
  const serialized = JSON.stringify(exported);

  assert.equal(exported.scope, "rehoyo-companion-local-data");
  assert.equal(exported.data.profile.displayName, "演示玩家");
  assert.ok(exported.excludes.includes("DeepSeek API Key"));
  assert.equal(/encryptedApiKey|audioBase64/.test(serialized), false);
});

test("reading and favoriting a message persists independently", () => {
  const { store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);
  const read = store.markMessageRead("message-first-welcome");
  const favorited = store.setMessageFavorite(
    "message-first-welcome",
    true,
  );

  assert.equal(
    read.messages.find((item) => item.id === "message-first-welcome")
      .readAt,
    TEST_NOW,
  );
  assert.equal(
    favorited.messages.find(
      (item) => item.id === "message-first-welcome",
    ).favorite,
    true,
  );
});

test("lower frequency and unsubscribe update content preferences", () => {
  const { store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);
  const reduced = store.respondToMessage(
    "message-first-welcome",
    "lower_frequency",
  );
  const unsubscribed = store.respondToMessage(
    "message-first-welcome",
    "unsubscribe_type",
  );

  assert.ok(
    reduced.profile.reducedContentTypes.includes("relationship"),
  );
  assert.ok(
    reduced.relationship.reducedContentTypes.includes("relationship"),
  );
  assert.equal(
    unsubscribed.profile.allowedContentTypes.includes("relationship"),
    false,
  );
  assert.equal(
    unsubscribed.relationship.allowedContentTypes.includes(
      "relationship",
    ),
    false,
  );
});

test("unsupported free-form message responses are rejected", () => {
  const { store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);

  assert.throws(
    () =>
      store.respondToMessage(
        "message-first-welcome",
        "please run arbitrary text",
      ),
    /not supported/,
  );
});

test("companion preferences validate quiet hours and persist consent choices", () => {
  const { store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);

  assert.throws(
    () =>
      store.saveCompanionPreferences({
        ...DEFAULT_ONBOARDING_INPUT,
        quietHours: {
          start: "25:00",
          end: "09:00",
        },
      }),
    /invalid/,
  );

  const updated = store.saveCompanionPreferences({
    ...DEFAULT_ONBOARDING_INPUT,
    proactiveContactEnabled: false,
    recallEnabled: true,
    weeklyContactLimit: 1,
  });
  assert.equal(updated.profile.proactiveContactEnabled, false);
  assert.equal(updated.profile.recallEnabled, true);
  assert.ok(updated.profile.allowedContentTypes.includes("recall"));
  assert.equal(updated.relationship.weeklyContactLimit, 1);
});

test("pause, exit and relationship deletion stop active contact", () => {
  const { store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);

  const paused = store.setCompanionPaused(true);
  assert.equal(paused.relationship.paused, true);
  assert.equal(paused.relationship.relationshipStage, "dormant");

  const exited = store.exitCompanion();
  assert.equal(exited.profile.onboardingCompleted, false);
  assert.equal(exited.profile.proactiveContactEnabled, false);
  assert.equal(exited.relationship.paused, true);

  const deleted = store.deleteRelationshipData();
  assert.equal(deleted.profile.onboardingCompleted, false);
  assert.deepEqual(deleted.memories, []);
  assert.deepEqual(deleted.messages, []);
  assert.deepEqual(deleted.events, []);
});

test("queued events are allowed or suppressed with an auditable reason", () => {
  const { store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);
  const queued = store.queueRelationshipEvent({
    trigger: "scheduled_daily",
    contentType: "daily",
    templateId: "march7th-daily-checkin-v1",
  });
  const eventId = queued.events.at(-1).id;
  const allowed = store.evaluateContactEvent(eventId);

  assert.equal(
    allowed.events.find((event) => event.id === eventId).status,
    "awaiting_content",
  );
  assert.equal(allowed.executionLog.at(-1).action, "contact_event_allowed");

  store.setCompanionPaused(true);
  const secondQueued = store.queueRelationshipEvent({
    trigger: "scheduled_daily",
    contentType: "daily",
    templateId: "march7th-daily-checkin-v1",
  });
  const secondEventId = secondQueued.events.at(-1).id;
  const suppressed = store.evaluateContactEvent(secondEventId);
  const secondEvent = suppressed.events.find(
    (event) => event.id === secondEventId,
  );

  assert.equal(secondEvent.status, "suppressed");
  assert.equal(secondEvent.suppressionReason, "companion_paused");
});

test("two ignored contacts start a seven-day quiet period", () => {
  const { store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);

  store.registerIgnoredContact();
  const quiet = store.registerIgnoredContact();
  assert.equal(quiet.relationship.ignoredCount, 2);
  assert.equal(
    quiet.relationship.quietUntil,
    "2026-07-31T08:00:00.000Z",
  );
  assert.equal(store.getContactPolicyStatus().reason, "quiet_period");

  const active = store.registerPlayerInteraction();
  assert.equal(active.relationship.ignoredCount, 0);
  assert.equal(active.relationship.quietUntil, undefined);
});

test("campaign and message require separate automatic and human reviews", () => {
  const { store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);
  const campaignId = "campaign-demo-march7th";

  let data = store.submitCampaignReview(campaignId);
  let campaign = data.campaigns.find(
    (item) => item.id === campaignId,
  );
  assert.equal(campaign.automaticReview.passed, true);
  assert.equal(campaign.status, "awaiting_review");

  data = store.reviewCampaign(campaignId, {
    decision: "approved",
    reviewer: "本地审核员",
    note: "固定事实和排期已核对。",
  });
  campaign = data.campaigns.find((item) => item.id === campaignId);
  assert.equal(campaign.status, "approved");
  assert.equal(campaign.humanReview.decision, "approved");

  data = store.setCampaignLifecycle(campaignId, "start");
  assert.equal(
    data.relationship.activeCampaignIds.includes(campaignId),
    true,
  );

  data = store.generateCampaignMessage(campaignId, "launch");
  const messageId = data.messages[0].id;
  assert.equal(data.messages[0].reviewStatus, "draft");
  assert.equal(data.messages[0].sentAt, undefined);

  data = store.runMessageAutomaticReview(messageId);
  assert.equal(
    data.messages.find((item) => item.id === messageId)
      .reviewStatus,
    "awaiting_human_review",
  );

  data = store.reviewCampaignMessage(messageId, {
    decision: "approved",
    reviewer: "本地审核员",
    note: "角色口吻和固定事实均通过。",
  });
  assert.equal(
    data.messages.find((item) => item.id === messageId)
      .reviewStatus,
    "approved",
  );
  assert.equal(
    data.messages.find((item) => item.id === messageId).sentAt,
    undefined,
  );

  data = store.publishCampaignBundle(campaignId, "本地审核员");
  assert.equal(
    data.campaigns
      .find((item) => item.id === campaignId)
      .publishedBundles.some((bundle) => bundle.status === "active"),
    true,
  );

  data = store.deliverCampaignMessage(messageId);
  assert.equal(
    data.messages.find((item) => item.id === messageId).sentAt,
    TEST_NOW,
  );
  assert.equal(
    data.events.find(
      (event) =>
        event.id ===
        data.messages.find((item) => item.id === messageId).eventId,
    ).status,
    "executed",
  );
});

test("campaign automatic review blocks unsafe fixed-fact targets", () => {
  const { store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);
  const initial = store.getSnapshot();
  const campaign = initial.campaigns[0];
  const updated = store.updateCampaign(campaign.id, {
    version: campaign.version,
    globalTheme: campaign.globalTheme,
    narrativeApproach: campaign.narrativeApproach,
    sellingPoints: campaign.sellingPoints,
    targetSegments: campaign.targetSegments,
    generationMode: campaign.generationMode,
    fixedFacts: {
      ...campaign.fixedFacts,
      actionTarget: "https://untrusted.example",
    },
  });
  assert.equal(updated.campaigns[0].status, "draft");

  const reviewed = store.submitCampaignReview(campaign.id);
  const result = reviewed.campaigns.find(
    (item) => item.id === campaign.id,
  ).automaticReview;
  assert.equal(result.passed, false);
  assert.ok(
    result.checks.some(
      (item) =>
        item.id === "safe-action-target" &&
        item.status === "fail",
    ),
  );
});

test("pausing and stopping a campaign immediately block pending delivery", () => {
  const { store } = makeTemporaryStore();
  store.completeOnboarding(DEFAULT_ONBOARDING_INPUT);
  const campaignId = "campaign-demo-march7th";
  store.submitCampaignReview(campaignId);
  store.reviewCampaign(campaignId, {
    decision: "approved",
    reviewer: "本地审核员",
    note: "",
  });
  store.setCampaignLifecycle(campaignId, "start");
  const drafted = store.generateCampaignMessage(
    campaignId,
    "preheat",
  );
  const messageId = drafted.messages[0].id;

  const paused = store.setCampaignLifecycle(campaignId, "pause");
  assert.equal(paused.campaigns[0].status, "paused");
  assert.equal(
    paused.relationship.activeCampaignIds.includes(campaignId),
    false,
  );

  const resumed = store.setCampaignLifecycle(campaignId, "resume");
  assert.equal(resumed.campaigns[0].status, "running");

  const stopped = store.setCampaignLifecycle(campaignId, "stop");
  assert.equal(stopped.campaigns[0].status, "stopped");
  assert.equal(
    stopped.messages.find((item) => item.id === messageId)
      .reviewStatus,
    "expired",
  );
  assert.equal(
    stopped.events.find(
      (event) =>
        event.id ===
        stopped.messages.find((item) => item.id === messageId)
          .eventId,
    ).status,
    "cancelled",
  );
});

test("demo time advances scheduled content without changing the system clock", () => {
  const { store } = makeTemporaryStore();
  store.loadDemoScenario("japan_story");

  let data = store.advanceDemoTime({ day: 1 });
  assert.equal(data.demoNow, "2026-07-25T08:00:00.000Z");
  assert.equal(data.relationship.relationshipStage, "new");
  assert.ok(
    data.messages.some(
      (message) =>
        message.type === "version_preheat" &&
        message.reviewStatus === "awaiting_human_review" &&
        !message.sentAt,
    ),
  );

  data = store.advanceDemoTime({ day: 7 });
  assert.equal(data.relationship.relationshipStage, "familiar");
  data = store.advanceDemoTime({ day: 14 });
  assert.equal(data.relationship.relationshipStage, "companion");
  assert.ok(
    data.messages.some(
      (message) =>
        message.type === "version_launch" &&
        message.reviewStatus === "awaiting_human_review",
    ),
  );
  assert.equal(
    data.executionLog.filter(
      (entry) => entry.action === "demo_time_advanced",
    ).length,
    3,
  );
});

test("demo players receive different contact-policy results", () => {
  const { store } = makeTemporaryStore();

  store.loadDemoScenario("china_active");
  const china = store.advanceDemoTime({ day: 1 });
  assert.ok(
    china.events.some(
      (event) =>
        event.payload?.phase === "preheat" &&
        event.status === "awaiting_review",
    ),
  );

  store.loadDemoScenario("north_america_intensity");
  let northAmerica = store.advanceDemoTime({ day: 1 });
  assert.ok(
    northAmerica.events.some(
      (event) =>
        event.payload?.phase === "preheat" &&
        event.suppressionReason === "content_type_disabled",
    ),
  );
  northAmerica = store.advanceDemoTime({ day: 14 });
  assert.ok(
    northAmerica.events.some(
      (event) =>
        event.payload?.phase === "launch" &&
        event.suppressionReason === "quiet_hours",
    ),
  );
  assert.equal(
    northAmerica.messages.some(
      (message) => message.trace.memoryIds.length > 0,
    ),
    false,
  );
});

test("demo actions cover ignore, response, unsubscribe and risk blocking", () => {
  const { store } = makeTemporaryStore();
  store.loadDemoScenario("japan_story");

  store.triggerDemoAction("ignore_contact");
  let data = store.triggerDemoAction("ignore_contact");
  assert.equal(data.relationship.ignoredCount, 2);
  assert.equal(
    data.relationship.quietUntil,
    "2026-07-31T08:00:00.000Z",
  );

  data = store.triggerDemoAction("positive_reply");
  assert.equal(data.relationship.ignoredCount, 0);
  assert.equal(data.relationship.quietUntil, undefined);
  assert.equal(data.messages[0].liked, true);

  data = store.triggerDemoAction("risk_unsafe_link");
  const riskMessage = data.messages[0];
  assert.equal(
    riskMessage.reviewStatus,
    "automatic_check_failed",
  );
  assert.equal(riskMessage.sentAt, undefined);
  assert.ok(
    riskMessage.automaticReview.checks.some(
      (item) =>
        item.id === "safe-copy" && item.status === "fail",
    ),
  );

  data = store.triggerDemoAction("unsubscribe_version");
  assert.deepEqual(
    data.profile.allowedContentTypes.filter((type) =>
      type.startsWith("version_"),
    ),
    [],
  );
  assert.equal(data.campaigns[0].status, "stopped");
  assert.deepEqual(data.relationship.activeCampaignIds, []);
});

test("demo reset restores an identical default scenario", () => {
  const { store } = makeTemporaryStore();
  store.loadDemoScenario("china_active");
  store.advanceDemoTime({ day: 14 });
  store.triggerDemoAction("risk_unsafe_link");

  const firstReset = store.resetDemo();
  store.advanceDemoTime({ day: 1 });
  const secondReset = store.resetDemo();
  assert.deepEqual(secondReset, firstReset);
  assert.equal(secondReset.demoScenarioId, "japan_story");
  assert.equal(secondReset.demoNow, "2026-07-24T08:00:00.000Z");
});
