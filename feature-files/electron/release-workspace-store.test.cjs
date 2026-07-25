const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  ReleaseWorkspaceStore,
  evaluate,
  extractReleasePlan,
  parseRecords,
} = require("./release-workspace-store.cjs");

function createStore(legacySnapshot = { campaigns: [] }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "march7-release-"));
  const filePath = path.join(directory, "release-workspace.json");
  const store = new ReleaseWorkspaceStore({ filePath, legacySnapshot });
  return {
    store,
    filePath,
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

function readyTask(store, regionId = "japan") {
  const snapshot = store.saveTask(regionId, {
    title: "版本发行",
    objective: "launch",
    theme: "和三月七继续新的旅程",
    narrative: "从共同经历自然切入",
    facts: [{ id: "fact-1", label: "版本", value: "3.0", source: "发行方案" }],
    ownerId: "operator_lead",
    reviewerId: "operator_reviewer",
    timeWindow: "2026-08-01 至 2026-08-14",
    consentConfirmed: true,
  });
  return snapshot.workspaces[regionId].tasks[0];
}

test("creates isolated default regional workspaces", () => {
  const { store, cleanup } = createStore();
  try {
    const data = store.snapshot();
    assert.deepEqual(data.regions.map((region) => region.id), [
      "china", "japan", "north_america",
    ]);
    readyTask(store, "japan");
    const next = store.snapshot();
    assert.equal(next.workspaces.japan.tasks.length, 1);
    assert.equal(next.workspaces.china.tasks.length, 0);
  } finally {
    cleanup();
  }
});

test("migrates legacy campaigns once without changing the source", () => {
  const legacy = {
    campaigns: [{
      id: "campaign-1",
      version: "旧任务",
      objective: "launch",
      globalTheme: "旧主题",
      fixedFacts: { versionName: "2.0", eventTime: "2026-08" },
      fixedFactEntries: [],
      status: "draft",
    }],
  };
  const { store, filePath, cleanup } = createStore(legacy);
  try {
    assert.equal(store.snapshot().workspaces.japan.tasks.length, 1);
    const reloaded = new ReleaseWorkspaceStore({ filePath, legacySnapshot: legacy });
    assert.equal(reloaded.snapshot().workspaces.japan.tasks.length, 1);
    assert.equal(legacy.campaigns[0].version, "旧任务");
  } finally {
    cleanup();
  }
});

test("enforces local operator permissions in the store", () => {
  const { store, cleanup } = createStore();
  try {
    store.setOperator("operator_reviewer");
    assert.throws(
      () => store.addRegion({
        code: "EU", name: "欧洲", language: "en-GB",
        timeZone: "Europe/London", quietHours: { start: "22:00", end: "08:00" },
      }),
      /无权/,
    );
  } finally {
    cleanup();
  }
});

test("validates audience denominators and region ownership", () => {
  const { store, cleanup } = createStore();
  try {
    const task = readyTask(store);
    assert.throws(
      () => store.importAudience(
        "japan",
        task.id,
        "name,eligible,authorized,reachable,excluded\n错误分群,10,11,8,0",
      ),
      /分母关系/,
    );
    assert.throws(
      () => store.importAudience(
        "china",
        task.id,
        "name,eligible,authorized,reachable,excluded\n跨区分群,10,9,8,1",
      ),
      /任务不属于/,
    );
  } finally {
    cleanup();
  }
});

test("generates three paths and all four response branches", () => {
  const { store, cleanup } = createStore();
  try {
    const task = readyTask(store);
    store.importAudience(
      "japan",
      task.id,
      "name,eligible,authorized,reachable,excluded\n剧情玩家,100,90,80,10",
    );
    const data = store.generateDirective("japan", task.id);
    const directive = data.workspaces.japan.directives[0];
    assert.deepEqual(directive.paths.map((path) => path.depth), [
      "light", "standard", "deep",
    ]);
    for (const pathItem of directive.paths) {
      assert.deepEqual(Object.keys(pathItem.branches), [
        "interested", "inquiry", "cold", "refuse",
      ]);
    }
    assert.equal(directive.evidence[0].source, "发行方案");
  } finally {
    cleanup();
  }
});

test("requires approval before experiment and applies relationship guardrails", () => {
  const { store, cleanup } = createStore();
  try {
    const task = readyTask(store);
    store.importAudience(
      "japan",
      task.id,
      "name,eligible,authorized,reachable,excluded\n剧情玩家,100,90,80,10",
    );
    let data = store.generateDirective("japan", task.id);
    const directive = data.workspaces.japan.directives[0];
    assert.throws(
      () => store.saveExperiment("japan", {
        directiveId: directive.id,
        name: "灰度",
        allocations: { control: 25, template: 25, symbiotic: 40, silent: 10 },
      }),
      /已批准/,
    );
    store.setOperator("operator_reviewer");
    store.reviewDirective("japan", directive.id, "approved", "边界清晰");
    store.setOperator("operator_lead");
    data = store.saveExperiment("japan", {
      directiveId: directive.id,
      name: "灰度",
      allocations: { control: 25, template: 25, symbiotic: 40, silent: 10 },
      thresholds: {
        minSampleSize: 100, minReplyRate: 0.08,
        minContinuedConversationRate: 0.03, maxUnsubscribeRate: 0.02,
        maxBlockedRate: 0.01, maxComplaintRate: 0.005,
      },
    });
    const experiment = data.workspaces.japan.experiments[0];
    data = store.importMetrics(
      "japan",
      experiment.id,
      `date,groupId,delivered,read,replied,clicked,participated,unsubscribed,blocked,complaints,continuedConversation,proactiveConversation
2026-08-01,symbiotic,100,70,12,10,8,3,0,0,5,2`,
    );
    assert.equal(data.workspaces.japan.evaluations[0].recommendation, "pause");
    assert.throws(
      () => store.setExperimentStage("japan", experiment.id, "advance"),
      /不能扩大/,
    );
  } finally {
    cleanup();
  }
});

test("parses JSON records and rejects invalid metric counts", () => {
  assert.equal(parseRecords('[{"name":"分群"}]', "玩家分群")[0].name, "分群");
  const result = evaluate(
    [{
      delivered: 120, read: 90, replied: 15, clicked: 8, participated: 6,
      unsubscribed: 0, blocked: 0, complaints: 0,
      continuedConversation: 6, proactiveConversation: 2,
    }],
    {
      stage: "internal",
      thresholds: {
        minSampleSize: 100, minReplyRate: 0.08,
        minContinuedConversationRate: 0.03, maxUnsubscribeRate: 0.02,
        maxBlockedRate: 0.01, maxComplaintRate: 0.005,
      },
    },
  );
  assert.equal(result.recommendation, "expand");
});

test("extracts a structured regional release plan", () => {
  const extracted = extractReleasePlan({
    source: {
      id: "source-1", name: "日本区域共生发行方案.md", format: "md",
      importedAt: "2026-08-01T00:00:00.000Z", chunkCount: 1,
    },
    chunks: [{
      text: `# 三月七日本区域共生发行
发行区域：日本
发行目标：版本预热
全局主题：和三月七一起准备新的旅程
叙事方式：从玩家明确授权的共同经历自然切入
时间窗口：2026-08-01 至 2026-08-14
版本名称：3.0
奖励说明：以官方页面为准`,
    }],
  }, {
    id: "japan", code: "JP", name: "日本",
  });
  assert.equal(extracted.objective, "preheat");
  assert.equal(extracted.theme, "和三月七一起准备新的旅程");
  assert.equal(extracted.timeWindow, "2026-08-01 至 2026-08-14");
  assert.equal(extracted.facts.length, 3);
});

test("plan import validates region and invalidates consent for human confirmation", () => {
  const { store, cleanup } = createStore();
  try {
    const parsed = {
      source: {
        id: "source-1", name: "方案.md", format: "md",
        importedAt: "2026-08-01T00:00:00.000Z", chunkCount: 1,
      },
      chunks: [{
        text: `# 日本区域角色共生发行
发行区域：日本
全局主题：继续新的旅程
时间窗口：2026-08-01 至 2026-08-14
版本名称：3.0`,
      }],
    };
    const imported = store.importReleasePlan("japan", parsed);
    const task = imported.snapshot.workspaces.japan.tasks[0];
    assert.equal(task.sourceDocument.name, "方案.md");
    assert.equal(task.gate.consent, false);
    assert.equal(task.status, "draft");
    assert.equal(imported.snapshot.workspaces.japan.planSources.length, 1);
    assert.throws(
      () => store.importReleasePlan("china", parsed),
      /区域.*不匹配/,
    );
  } finally {
    cleanup();
  }
});
