const assert = require("node:assert/strict");
const test = require("node:test");
const skillProfile = require("../shared/march7th-skill-profile.json");
const {
  CONTACT_SUPPRESSION,
  evaluateContactPolicy,
  isWithinQuietHours,
} = require("./contact-policy.cjs");
const {
  createDefaultCompanionData,
} = require("./companion-store.cjs");

const NOW = "2026-07-24T06:00:00.000Z";

function makeAllowedData() {
  const data = createDefaultCompanionData({
    skillProfile,
    now: NOW,
  });
  data.profile.onboardingCompleted = true;
  data.profile.proactiveContactEnabled = true;
  data.profile.timeZone = "Asia/Tokyo";
  data.profile.quietHours = {
    start: "22:00",
    end: "09:00",
  };
  data.relationship.paused = false;
  data.relationship.quietUntil = undefined;
  return data;
}

function makeEvent(overrides = {}) {
  return {
    id: "event-policy-test",
    trigger: "scheduled_daily",
    playerId: "demo-player-jp",
    characterId: "march-7th",
    scheduledAt: NOW,
    payload: {
      contentType: "daily",
      templateId: "march7th-daily-checkin-v1",
    },
    status: "queued",
    ...overrides,
  };
}

test("quiet hours support a range that crosses midnight", () => {
  assert.equal(
    isWithinQuietHours(
      "2026-07-24T14:30:00.000Z",
      { start: "22:00", end: "09:00" },
      "Asia/Tokyo",
    ),
    true,
  );
  assert.equal(
    isWithinQuietHours(
      "2026-07-24T06:00:00.000Z",
      { start: "22:00", end: "09:00" },
      "Asia/Tokyo",
    ),
    false,
  );
});

test("onboarding, pause and proactive consent suppress in priority order", () => {
  const data = makeAllowedData();
  data.profile.onboardingCompleted = false;
  assert.equal(
    evaluateContactPolicy({ data, event: makeEvent(), now: NOW })
      .reason,
    CONTACT_SUPPRESSION.ONBOARDING_REQUIRED,
  );

  data.profile.onboardingCompleted = true;
  data.relationship.paused = true;
  assert.equal(
    evaluateContactPolicy({ data, event: makeEvent(), now: NOW })
      .reason,
    CONTACT_SUPPRESSION.COMPANION_PAUSED,
  );

  data.relationship.paused = false;
  data.profile.proactiveContactEnabled = false;
  assert.equal(
    evaluateContactPolicy({ data, event: makeEvent(), now: NOW })
      .reason,
    CONTACT_SUPPRESSION.PROACTIVE_DISABLED,
  );
});

test("recall requires separate authorization", () => {
  const data = makeAllowedData();
  data.profile.recallEnabled = false;
  const event = makeEvent({
    trigger: "inactive_player",
    payload: {
      contentType: "recall",
    },
  });

  assert.equal(
    evaluateContactPolicy({ data, event, now: NOW }).reason,
    CONTACT_SUPPRESSION.RECALL_NOT_AUTHORIZED,
  );
});

test("quiet period and weekly contact limit suppress active messages", () => {
  const data = makeAllowedData();
  data.relationship.quietUntil = "2026-07-30T00:00:00.000Z";
  assert.equal(
    evaluateContactPolicy({ data, event: makeEvent(), now: NOW })
      .reason,
    CONTACT_SUPPRESSION.QUIET_PERIOD,
  );

  data.relationship.quietUntil = undefined;
  data.profile.weeklyContactLimit = 1;
  data.messages.push({
    id: "message-proactive-this-week",
    type: "photo",
    sentAt: "2026-07-23T06:00:00.000Z",
    deliveryMode: "proactive",
  });
  assert.equal(
    evaluateContactPolicy({ data, event: makeEvent(), now: NOW })
      .reason,
    CONTACT_SUPPRESSION.WEEKLY_LIMIT,
  );
});

test("reduced content and duplicate templates use independent windows", () => {
  const data = makeAllowedData();
  data.profile.reducedContentTypes.push("daily");
  data.messages.push({
    id: "message-reduced-daily",
    type: "daily",
    sentAt: "2026-07-15T06:00:00.000Z",
    deliveryMode: "proactive",
    trace: {
      templateId: "different-template",
    },
  });
  assert.equal(
    evaluateContactPolicy({ data, event: makeEvent(), now: NOW })
      .reason,
    CONTACT_SUPPRESSION.REDUCED_FREQUENCY,
  );

  data.profile.reducedContentTypes = [];
  data.messages[0].sentAt = "2026-07-23T06:00:00.000Z";
  data.messages[0].trace.templateId =
    "march7th-daily-checkin-v1";
  assert.equal(
    evaluateContactPolicy({ data, event: makeEvent(), now: NOW })
      .reason,
    CONTACT_SUPPRESSION.DUPLICATE_TEMPLATE,
  );
});

test("an authorized event outside suppression windows is allowed", () => {
  const data = makeAllowedData();
  const result = evaluateContactPolicy({
    data,
    event: makeEvent(),
    now: NOW,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, null);
  assert.equal(result.contentType, "daily");
  assert.deepEqual(result.details, {
    weeklyUsed: 0,
    weeklyLimit: 2,
  });
});


test("example release bypasses frequency limits but not consent or pause", () => {
  const data = makeAllowedData();
  data.profile.weeklyContactLimit = 1;
  data.messages.push({
    id: "message-version-this-week",
    type: "version_launch",
    sentAt: "2026-07-24T05:30:00.000Z",
    deliveryMode: "proactive",
  });
  const event = makeEvent({
    trigger: "version_launch",
    payload: {
      contentType: "version_launch",
      templateId: "example-release",
      exampleFrequencyBypass: true,
    },
  });

  const allowed = evaluateContactPolicy({ data, event, now: NOW });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.details.exampleFrequencyBypass, true);

  data.relationship.paused = true;
  assert.equal(
    evaluateContactPolicy({ data, event, now: NOW }).reason,
    CONTACT_SUPPRESSION.COMPANION_PAUSED,
  );
});
