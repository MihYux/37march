const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  ServiceBudgetStore,
} = require("./service-budget.cjs");

function createHarness(start = "2026-07-24T08:00:00.000Z") {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "march7th-service-budget-"),
  );
  let now = start;
  const store = new ServiceBudgetStore({
    filePath: path.join(directory, "service-usage.json"),
    clock: () => now,
  });
  return {
    store,
    setNow(value) {
      now = value;
    },
  };
}

test("counts requests and characters without storing request text", () => {
  const { store } = createHarness();
  store.authorize("deepseek", { characters: 320 });
  store.recordSuccess("deepseek");
  const status = store.getPublicStatus().providers.deepseek;
  assert.equal(status.requests, 1);
  assert.equal(status.characters, 320);
  assert.equal(status.failures, 0);
});

test("opens the circuit after three consecutive failures", () => {
  const { store } = createHarness();
  for (let index = 0; index < 3; index += 1) {
    store.authorize("dashscope", { characters: 10 });
    store.recordFailure("dashscope", "NETWORK_ERROR");
  }
  assert.equal(
    store.getPublicStatus().providers.dashscope.circuitOpen,
    true,
  );
  assert.throws(
    () => store.authorize("dashscope", { characters: 10 }),
    (error) => error.code === "SERVICE_CIRCUIT_OPEN",
  );
});

test("a success resets consecutive failure state", () => {
  const { store } = createHarness();
  store.authorize("deepseek");
  store.recordFailure("deepseek", "NETWORK_ERROR");
  store.authorize("deepseek");
  store.recordSuccess("deepseek");
  assert.equal(
    store.getPublicStatus().providers.deepseek.circuitOpen,
    false,
  );
});

test("daily usage resets without changing the system clock", () => {
  const harness = createHarness();
  harness.store.authorize("deepseek", { characters: 50 });
  harness.setNow("2026-07-25T08:00:00.000Z");
  const status = harness.store.getPublicStatus();
  assert.equal(status.day, "2026-07-25");
  assert.equal(status.providers.deepseek.requests, 0);
  assert.equal(status.providers.deepseek.characters, 0);
});
