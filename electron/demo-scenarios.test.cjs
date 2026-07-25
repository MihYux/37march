const assert = require("node:assert/strict");
const test = require("node:test");
const skillProfile = require("../shared/march7th-skill-profile.json");
const {
  createDefaultCompanionData,
} = require("./companion-store.cjs");
const {
  DEMO_BASE_NOW,
  applyDemoScenario,
  calculateRelationshipStage,
  getDemoScenarioSummaries,
} = require("./demo-scenarios.cjs");

function scenario(id) {
  return applyDemoScenario(
    createDefaultCompanionData({
      skillProfile,
      now: DEMO_BASE_NOW,
    }),
    id,
  );
}

test("three demo players have distinct regions and consent profiles", () => {
  const summaries = getDemoScenarioSummaries();
  assert.deepEqual(
    summaries.map((item) => item.id),
    [
      "japan_story",
      "china_active",
      "north_america_intensity",
    ],
  );

  const japan = scenario("japan_story");
  const china = scenario("china_active");
  const northAmerica = scenario("north_america_intensity");
  assert.equal(japan.profile.region, "japan");
  assert.equal(china.profile.region, "china");
  assert.equal(northAmerica.profile.region, "north_america");
  assert.equal(japan.profile.weeklyContactLimit, 2);
  assert.equal(china.profile.weeklyContactLimit, 3);
  assert.equal(northAmerica.profile.weeklyContactLimit, 1);
  assert.equal(northAmerica.profile.memoryEnabled, false);
  assert.deepEqual(northAmerica.memories, []);
});

test("scenario loading is deterministic and explicitly simulated", () => {
  const first = scenario("japan_story");
  const second = scenario("japan_story");
  assert.deepEqual(second, first);
  assert.equal(first.demoNow, DEMO_BASE_NOW);
  assert.equal(first.demoStartedAt, DEMO_BASE_NOW);
  assert.equal(first.isDemoData, true);
  assert.equal(first.campaigns[0].status, "running");
  assert.equal(first.campaigns[0].automaticReview.passed, true);
});

test("relationship stage evolves from new to familiar and companion", () => {
  const data = scenario("japan_story");
  assert.equal(calculateRelationshipStage(data), "new");
  data.demoNow = "2026-07-31T08:00:00.000Z";
  assert.equal(calculateRelationshipStage(data), "familiar");
  data.demoNow = "2026-08-07T08:00:00.000Z";
  assert.equal(calculateRelationshipStage(data), "companion");

  const noMemory = scenario("north_america_intensity");
  noMemory.demoNow = "2026-08-07T08:00:00.000Z";
  assert.equal(calculateRelationshipStage(noMemory), "familiar");
  noMemory.demoNow = "2026-09-04T08:00:00.000Z";
  assert.equal(calculateRelationshipStage(noMemory), "dormant");
});
