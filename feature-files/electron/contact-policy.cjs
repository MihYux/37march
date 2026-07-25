const CONTACT_SUPPRESSION = Object.freeze({
  ONBOARDING_REQUIRED: "onboarding_required",
  COMPANION_PAUSED: "companion_paused",
  PROACTIVE_DISABLED: "proactive_contact_disabled",
  CONTENT_TYPE_DISABLED: "content_type_disabled",
  RECALL_NOT_AUTHORIZED: "recall_not_authorized",
  QUIET_HOURS: "quiet_hours",
  QUIET_PERIOD: "quiet_period",
  WEEKLY_LIMIT: "weekly_contact_limit",
  VERSION_WEEKLY_LIMIT: "version_weekly_contact_limit",
  MINIMUM_INTERVAL: "minimum_contact_interval",
  GLOBAL_KILL_SWITCH: "global_campaign_kill_switch",
  REDUCED_FREQUENCY: "reduced_content_frequency",
  DUPLICATE_TEMPLATE: "duplicate_template",
  INVALID_EVENT: "invalid_event",
  CONTEXT_NOT_ELIGIBLE: "context_not_eligible",
});

const MESSAGE_TYPES = new Set([
  "daily",
  "photo",
  "postcard",
  "relationship",
  "version_preheat",
  "version_launch",
  "version_sustain",
  "recall",
]);

const TRIGGER_TO_CONTENT_TYPE = Object.freeze({
  first_join: "relationship",
  scheduled_daily: "daily",
  player_click: "relationship",
  player_choice: "relationship",
  memory_anniversary: "relationship",
  character_birthday: "relationship",
  player_birthday: "relationship",
  version_preheat: "version_preheat",
  version_launch: "version_launch",
  version_sustain: "version_sustain",
  inactive_player: "recall",
  return_to_game: "relationship",
  manual_demo_event: "daily",
});

function localMinutes(isoDate, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(isoDate));
  const hour = Number(
    parts.find((part) => part.type === "hour")?.value,
  );
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value,
  );
  return hour * 60 + minute;
}

function timeToMinutes(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }
  const [hour, minute] = value.split(":").map(Number);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function isWithinQuietHours(isoDate, quietHours, timeZone) {
  const start = timeToMinutes(quietHours?.start);
  const end = timeToMinutes(quietHours?.end);
  if (start === null || end === null || start === end) return false;
  const now = localMinutes(isoDate, timeZone);
  return start < end
    ? now >= start && now < end
    : now >= start || now < end;
}

function resolveContentType(event) {
  const explicitType = event?.payload?.contentType;
  if (MESSAGE_TYPES.has(explicitType)) return explicitType;
  return TRIGGER_TO_CONTENT_TYPE[event?.trigger] ?? "";
}

function proactiveMessagesSince(messages, threshold) {
  const thresholdMs = Date.parse(threshold);
  return messages.filter(
    (message) =>
      message.deliveryMode === "proactive" &&
      message.sentAt &&
      Date.parse(message.sentAt) >= thresholdMs,
  );
}

function suppress(reason, contentType, evaluatedAt, details = {}) {
  return {
    allowed: false,
    reason,
    contentType,
    evaluatedAt,
    details,
  };
}

function evaluateContactPolicy({ data, event, now }) {
  const evaluatedAt = new Date(now).toISOString();
  const contentType = resolveContentType(event);
  if (!contentType) {
    return suppress(
      CONTACT_SUPPRESSION.INVALID_EVENT,
      "",
      evaluatedAt,
    );
  }
  if (
    data.globalCampaignKillSwitch === true &&
    ["version_preheat", "version_launch", "version_sustain", "recall"].includes(
      contentType,
    )
  ) {
    return suppress(
      CONTACT_SUPPRESSION.GLOBAL_KILL_SWITCH,
      contentType,
      evaluatedAt,
    );
  }
  const versionTypes = new Set([
    "version_preheat",
    "version_launch",
    "version_sustain",
    "recall",
  ]);
  const bypassFrequencyLimits =
    versionTypes.has(contentType) &&
    event?.payload?.exampleFrequencyBypass === true;
  const playerContext = event?.payload?.playerContext;
  if (
    versionTypes.has(contentType) &&
    playerContext &&
    (playerContext.naturalTrigger === false ||
      playerContext.isChatting === true ||
      playerContext.negativeEmotion === true ||
      playerContext.panelOpen === true)
  ) {
    return suppress(
      CONTACT_SUPPRESSION.CONTEXT_NOT_ELIGIBLE,
      contentType,
      evaluatedAt,
    );
  }
  if (!data.profile.onboardingCompleted) {
    return suppress(
      CONTACT_SUPPRESSION.ONBOARDING_REQUIRED,
      contentType,
      evaluatedAt,
    );
  }
  if (data.relationship.paused) {
    return suppress(
      CONTACT_SUPPRESSION.COMPANION_PAUSED,
      contentType,
      evaluatedAt,
    );
  }
  if (!data.profile.proactiveContactEnabled) {
    return suppress(
      CONTACT_SUPPRESSION.PROACTIVE_DISABLED,
      contentType,
      evaluatedAt,
    );
  }
  if (contentType === "recall" && !data.profile.recallEnabled) {
    return suppress(
      CONTACT_SUPPRESSION.RECALL_NOT_AUTHORIZED,
      contentType,
      evaluatedAt,
    );
  }
  if (!data.profile.allowedContentTypes.includes(contentType)) {
    return suppress(
      CONTACT_SUPPRESSION.CONTENT_TYPE_DISABLED,
      contentType,
      evaluatedAt,
    );
  }
  if (
    isWithinQuietHours(
      evaluatedAt,
      data.profile.quietHours,
      data.profile.timeZone,
    )
  ) {
    return suppress(
      CONTACT_SUPPRESSION.QUIET_HOURS,
      contentType,
      evaluatedAt,
      {
        start: data.profile.quietHours.start,
        end: data.profile.quietHours.end,
        timeZone: data.profile.timeZone,
      },
    );
  }
  if (
    data.relationship.quietUntil &&
    Date.parse(data.relationship.quietUntil) > Date.parse(evaluatedAt)
  ) {
    return suppress(
      CONTACT_SUPPRESSION.QUIET_PERIOD,
      contentType,
      evaluatedAt,
      {
        quietUntil: data.relationship.quietUntil,
      },
    );
  }

  const weekThreshold = new Date(
    Date.parse(evaluatedAt) - 7 * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const weeklyMessages = proactiveMessagesSince(
    data.messages,
    weekThreshold,
  );
  if (!bypassFrequencyLimits && weeklyMessages.length >= data.profile.weeklyContactLimit) {
    return suppress(
      CONTACT_SUPPRESSION.WEEKLY_LIMIT,
      contentType,
      evaluatedAt,
      {
        used: weeklyMessages.length,
        limit: data.profile.weeklyContactLimit,
      },
    );
  }

  const minimumIntervalThreshold =
    Date.parse(evaluatedAt) - 24 * 60 * 60 * 1_000;
  const latestProactive = data.messages
    .filter(
      (message) =>
        message.deliveryMode === "proactive" && message.sentAt,
    )
    .sort(
      (left, right) =>
        Date.parse(right.sentAt) - Date.parse(left.sentAt),
    )[0];
  if (
    !bypassFrequencyLimits &&
    latestProactive &&
    Date.parse(latestProactive.sentAt) > minimumIntervalThreshold
  ) {
    return suppress(
      CONTACT_SUPPRESSION.MINIMUM_INTERVAL,
      contentType,
      evaluatedAt,
      { lastSentAt: latestProactive.sentAt, hours: 24 },
    );
  }

  if (
    !bypassFrequencyLimits &&
    versionTypes.has(contentType) &&
    weeklyMessages.some((message) => versionTypes.has(message.type))
  ) {
    return suppress(
      CONTACT_SUPPRESSION.VERSION_WEEKLY_LIMIT,
      contentType,
      evaluatedAt,
      { used: 1, limit: 1 },
    );
  }

  if (!bypassFrequencyLimits && data.profile.reducedContentTypes.includes(contentType)) {
    const reducedThreshold = Date.parse(evaluatedAt) - 14 * 24 * 60 * 60 * 1_000;
    const recentlySentSameType = data.messages.some(
      (message) =>
        message.deliveryMode === "proactive" &&
        message.type === contentType &&
        message.sentAt &&
        Date.parse(message.sentAt) >= reducedThreshold,
    );
    if (recentlySentSameType) {
      return suppress(
        CONTACT_SUPPRESSION.REDUCED_FREQUENCY,
        contentType,
        evaluatedAt,
      );
    }
  }

  const templateId = event?.payload?.templateId;
  if (!bypassFrequencyLimits && typeof templateId === "string" && templateId) {
    const duplicateThreshold =
      Date.parse(evaluatedAt) - 7 * 24 * 60 * 60 * 1_000;
    const repeatedTemplate = data.messages.some(
      (message) =>
        message.deliveryMode === "proactive" &&
        message.trace?.templateId === templateId &&
        message.sentAt &&
        Date.parse(message.sentAt) >= duplicateThreshold,
    );
    if (repeatedTemplate) {
      return suppress(
        CONTACT_SUPPRESSION.DUPLICATE_TEMPLATE,
        contentType,
        evaluatedAt,
        {
          templateId,
        },
      );
    }
  }

  return {
    allowed: true,
    reason: null,
    contentType,
    evaluatedAt,
    details: {
      weeklyUsed: weeklyMessages.length,
      weeklyLimit: data.profile.weeklyContactLimit,
      ...(bypassFrequencyLimits
        ? { exampleFrequencyBypass: true }
        : {}),
    },
  };
}

module.exports = {
  CONTACT_SUPPRESSION,
  evaluateContactPolicy,
  isWithinQuietHours,
  resolveContentType,
};
