const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ReleaseWorkspaceStore } = require("./release-workspace-store.cjs");

test("a saved regional plan publishes without the former directive gate", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "march7-direct-plan-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new ReleaseWorkspaceStore({
    filePath: path.join(directory, "release-workspace.json"),
    legacySnapshot: { campaigns: [] },
  });

  let snapshot = store.saveTask("china", {
    title: "中国区域发行方案",
    objective: "launch",
    theme: "版本发行",
    narrative: "按区域方案执行",
    facts: [],
    consentConfirmed: false,
    timeWindow: "",
  });
  const task = snapshot.workspaces.china.tasks[0];
  assert.equal(task.status, "draft");

  snapshot = store.publishPlanToAgents("china", task.id, 10);
  const workspace = snapshot.workspaces.china;
  assert.equal(workspace.planReleases.length, 1);
  assert.equal(workspace.planReleases[0].taskId, task.id);
  assert.equal(workspace.planReleases[0].rolloutPercent, 10);
  assert.equal(workspace.aiDeliveries.length, 3);
});
