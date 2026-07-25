const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ReleaseWorkspaceStore } = require("./release-workspace-store.cjs");

function createStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "march7-plan-publish-"));
  const store = new ReleaseWorkspaceStore({
    filePath: path.join(directory, "release-workspace.json"),
    legacySnapshot: { campaigns: [] },
  });
  return { directory, store };
}

function createReadyTask(store, title, theme) {
  const snapshot = store.saveTask("japan", {
    title,
    objective: "launch",
    theme,
    narrative: "由各个共生式发行 AI 执行区域发行方案",
    facts: [{ id: "fact-1", label: "区域方案", value: title, source: "日本区域发行方案" }],
    consentConfirmed: true,
    timeWindow: "2026-07-25 至 2026-08-10",
  });
  return snapshot.workspaces.japan.tasks[0];
}

test("regional plan can be published directly with gray rollout", (t) => {
  const { directory, store } = createStore();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const task = createReadyTask(store, "日本区域夏日版本", "维持角色关系连续性");

  let snapshot = store.snapshot();
  assert.equal(snapshot.workspaces.japan.directives.length, 0);

  snapshot = store.publishPlanToAgents("japan", task.id, 5);
  const workspace = snapshot.workspaces.japan;
  assert.equal(workspace.directives.length, 0);
  assert.equal(workspace.planReleases.length, 1);
  assert.equal(workspace.planReleases[0].rolloutPercent, 5);
  assert.equal(workspace.experiments[0].kind, "regional_plan");
  assert.equal(workspace.experiments[0].planRolloutPercent, 5);

  const deliveries = workspace.aiDeliveries;
  assert.equal(deliveries.length, 3);
  assert.ok(deliveries.every((delivery) => delivery.status === "delivered"));
  assert.ok(deliveries.every((delivery) => delivery.rolloutPercent === 5));
  assert.equal(new Set(deliveries.map((delivery) => delivery.batchId)).size, 1);

  const bundle = workspace.bundles[0];
  assert.equal(bundle.payload.type, "regional_symbiotic_release_plan");
  assert.equal(bundle.payload.region.id, "japan");
  assert.equal(bundle.payload.plan.id, task.id);
  assert.equal(bundle.payload.rolloutPercent, 5);
  assert.equal("ownerId" in bundle.payload.plan, false);
  assert.equal("reviewerId" in bundle.payload.plan, false);

  assert.throws(() => store.publishPlanToAgents("japan", task.id, 0));
  assert.throws(() => store.publishPlanToAgents("japan", task.id, 101));
});

test("published plan accepts aggregate metrics for later optimization", (t) => {
  const { directory, store } = createStore();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const task = createReadyTask(store, "日本区域关系维护版本", "验证区域发行方案效果");
  let snapshot = store.publishPlanToAgents("japan", task.id, 10);
  const experiment = snapshot.workspaces.japan.experiments[0];

  store.importMetrics("japan", experiment.id, JSON.stringify([{
    date: "2026-07-25",
    regionId: "japan",
    taskId: task.id,
    experimentId: experiment.id,
    groupId: "symbiotic",
    segmentId: "all",
    delivered: 100,
    read: 80,
    replied: 32,
    clicked: 20,
    engaged: 28,
    unsubscribed: 1,
    blocked: 0,
    complained: 0,
    continuedConversation: 18,
    initiatedConversation: 8,
  }]));

  snapshot = store.createOptimization(
    "japan",
    experiment.id,
    "继续观察区域方案的关系健康指标",
  );
  assert.equal(snapshot.workspaces.japan.optimizations[0].taskId, task.id);
});


test("example plan publish is fixed at 100 percent and auditable", (t) => {
  const { directory, store } = createStore();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const task = createReadyTask(store, "日本区域演示版本", "展示共生式发行能力");

  const snapshot = store.publishPlanToAgents(
    "japan",
    task.id,
    100,
    { exampleMode: true },
  );
  const workspace = snapshot.workspaces.japan;
  assert.equal(workspace.planReleases[0].rolloutPercent, 100);
  assert.equal(workspace.planReleases[0].exampleMode, true);
  assert.equal(workspace.bundles[0].payload.exampleMode, true);
  assert.ok(workspace.aiDeliveries.every((item) => item.exampleMode === true));
  assert.equal(
    snapshot.auditLog[0].action,
    "regional_plan.example_published_to_agents",
  );
});
