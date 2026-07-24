const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const skillProfile = require("../shared/march7th-skill-profile.json");
const {
  CompanionStore,
  isPlayerInRollout,
} = require("./companion-store.cjs");

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "march7-release-agent-"));
  const filePath = path.join(directory, "companion-data.json");
  const store = new CompanionStore({
    filePath,
    skillProfile,
    clock: () => "2026-07-24T08:00:00.000Z",
  });
  store.loadDemoScenario("japan_story");
  return { directory, filePath, store };
}

function planInput(sourceId = "release-plan-1", rolloutPercent = 100) {
  return {
    sourceId,
    taskId: "task-summer",
    regionId: "japan",
    rolloutPercent,
    plan: {
      id: "task-summer",
      title: "夏日同行版本",
      theme: "和三月七继续新的旅程",
      narrative: "从共同经历自然过渡到新版本体验",
      timeWindow: "2026-07-25 至 2026-08-10",
      facts: [{
        id: "fact-version",
        label: "版本",
        value: "夏日同行版本",
        source: "区域发行方案",
      }],
    },
    source: {
      name: "日本区域发行方案.md",
      content: "已确认的区域方案正文。",
    },
  };
}

test("selected companion receives the plan and starts a soft memory-aware chat", (t) => {
  const { directory, store } = setup();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  store.setMemoryCampaignReusable(
    "memory-demo-player-jp-choice",
    true,
  );

  const snapshot = store.receiveRegionalReleasePlan(planInput());
  const message = snapshot.messages[0];
  assert.equal(message.type, "version_launch");
  assert.equal(message.deliveryMode, "proactive");
  assert.ok(message.sentAt);
  assert.ok(message.body.includes("不用急着现在就去"));
  assert.ok(message.trace.ruleIds.includes("release.regional_plan_received"));
  assert.equal(message.trace.memoryIds.length, 1);
  assert.equal(snapshot.events.at(-1).status, "executed");

  const context = store.getActiveReleasePlanContext();
  assert.equal(context.plan.title, "夏日同行版本");
  assert.equal(context.proactiveStatus, "executed");

  const duplicate = store.receiveRegionalReleasePlan(planInput());
  assert.equal(
    duplicate.messages.filter((item) =>
      item.trace.ruleIds.includes("release.regional_plan_received"),
    ).length,
    1,
  );
});

test("contact policy can defer proactive chat while retaining passive context", (t) => {
  const { directory, store } = setup();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  store.setCompanionPaused(true);

  const snapshot = store.receiveRegionalReleasePlan(
    planInput("release-plan-paused"),
  );
  assert.equal(
    snapshot.messages.some((item) =>
      item.trace.ruleIds.includes("release.regional_plan_received"),
    ),
    false,
  );
  assert.equal(snapshot.events.at(-1).status, "suppressed");
  assert.ok(store.getActiveReleasePlanContext());
});

test("a companion outside gray rollout does not receive plan context", (t) => {
  const { directory, store } = setup();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const playerId = store.getSnapshot().profile.id;
  let sourceId = "";
  for (let index = 0; index < 500; index += 1) {
    const candidate = `release-plan-gray-${index}`;
    if (!isPlayerInRollout(playerId, `regional-plan:${candidate}`, 1)) {
      sourceId = candidate;
      break;
    }
  }
  assert.ok(sourceId);

  const snapshot = store.receiveRegionalReleasePlan(planInput(sourceId, 1));
  assert.equal(snapshot.events.at(-1).suppressionReason, "gray_rollout_not_selected");
  assert.equal(store.getActiveReleasePlanContext(), null);
});

test("a running pet process can reload a plan written by the console process", (t) => {
  const { directory, filePath, store: consoleStore } = setup();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const petStore = new CompanionStore({
    filePath,
    skillProfile,
    clock: () => "2026-07-24T08:00:00.000Z",
  });

  consoleStore.receiveRegionalReleasePlan(planInput("release-plan-cross-process"));
  const reloaded = petStore.reloadFromDisk();
  assert.ok(
    reloaded.messages.some((item) =>
      item.trace.ruleIds.includes("release.regional_plan_received"),
    ),
  );
});
