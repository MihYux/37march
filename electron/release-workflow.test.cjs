const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ReleaseWorkspaceStore } = require("./release-workspace-store.cjs");

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "march7-workflow-"));
  const store = new ReleaseWorkspaceStore({
    filePath: path.join(directory, "release-workspace.json"),
    legacySnapshot: { campaigns: [] },
  });
  return { store, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test("new simplified workflow runs from version task to all regional AIs without audience import", () => {
  const { store, cleanup } = setup();
  try {
    let data = store.saveTask("japan", {
      title: "3.0 共生发行",
      objective: "launch",
      theme: "和三月七继续新的旅程",
      narrative: "从版本故事自然切入",
      facts: [{ id: "fact-1", label: "版本", value: "3.0", source: "区域发行方案" }],
      ownerId: "operator_lead",
      timeWindow: "2026-08-01 至 2026-08-14",
      consentConfirmed: true,
    });
    const task = data.workspaces.japan.tasks[0];
    assert.equal(data.workspaces.japan.segments.length, 0);
    assert.equal(task.status, "ready");

    data = store.generateDirective("japan", task.id, {});
    const directive = data.workspaces.japan.directives[0];
    assert.equal(directive.paths.length, 3);

    store.setOperator("operator_reviewer");
    store.reviewDirective("japan", directive.id, "approved", "事实与关系边界清晰");
    store.setOperator("operator_lead");
    data = store.saveExperiment("japan", {
      directiveId: directive.id,
      name: "首轮指令灰度",
      allocations: { control: 25, template: 25, symbiotic: 40, silent: 10 },
      pathRollouts: Object.fromEntries(directive.paths.map((item, index) => [
        item.id, [5, 3, 1][index],
      ])),
    });
    const experiment = data.workspaces.japan.experiments[0];
    assert.equal(experiment.pathRollouts[directive.paths[0].id], 5);

    data = store.publishToAgents("japan", directive.id, experiment.id);
    assert.equal(data.workspaces.japan.aiDeliveries.length, 3);
    assert.ok(data.workspaces.japan.aiDeliveries.every((item) => item.status === "delivered"));
    assert.equal(new Set(data.workspaces.japan.aiDeliveries.map((item) => item.batchId)).size, 1);
  } finally {
    cleanup();
  }
});

test("region information can be edited independently", () => {
  const { store, cleanup } = setup();
  try {
    const data = store.updateRegion("japan", {
      name: "日本区域",
      code: "JP",
      language: "ja-JP",
      timeZone: "Asia/Tokyo",
      quietHours: { start: "23:00", end: "08:30" },
    });
    const region = data.regions.find((item) => item.id === "japan");
    assert.equal(region.name, "日本区域");
    assert.equal(region.quietHours.start, "23:00");
    assert.equal(region.releaseAgents.length, 3);
  } finally {
    cleanup();
  }
});
