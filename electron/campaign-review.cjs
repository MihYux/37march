const CAMPAIGN_PHASES = new Set([
  "daily",
  "preheat",
  "launch",
  "sustain",
  "recall",
  "complete",
]);

const REQUIRED_FACT_KEYS = Object.freeze([
  "dataNature",
  "versionName",
  "eventTime",
  "actionTarget",
  "rewardStatement",
]);

const REQUIRED_SCHEDULE_PHASES = Object.freeze([
  "preheat",
  "launch",
  "sustain",
  "complete",
]);

const PHASE_TO_MESSAGE_TYPE = Object.freeze({
  daily: "daily",
  preheat: "version_preheat",
  launch: "version_launch",
  sustain: "version_sustain",
  recall: "recall",
});

const PHASE_TO_TRIGGER = Object.freeze({
  daily: "scheduled_daily",
  preheat: "version_preheat",
  launch: "version_launch",
  sustain: "version_sustain",
  recall: "inactive_player",
});

const PHASE_TO_TEMPLATE = Object.freeze({
  daily: "march7th-daily-checkin-v1",
  preheat: "march7th-version-preheat-v1",
  launch: "march7th-version-invitation-v1",
  sustain: "march7th-version-sustain-v1",
  recall: "march7th-recall-v1",
});

const FACT_LABELS = Object.freeze({
  dataNature: "数据性质",
  versionName: "活动名称",
  eventTime: "活动时间",
  actionTarget: "安全入口",
  rewardStatement: "奖励说明",
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function check(id, label, passed, successDetail, failureDetail) {
  return {
    id,
    label,
    status: passed ? "pass" : "fail",
    detail: passed ? successDetail : failureDetail,
  };
}

function isSafeInternalTarget(value) {
  return (
    typeof value === "string" &&
    /^product:\/\/[a-z0-9/_-]{1,160}$/i.test(value)
  );
}

function campaignFactMap(campaign) {
  const entries = Array.isArray(campaign?.fixedFactEntries)
    ? campaign.fixedFactEntries
    : [];
  const fromEntries = Object.fromEntries(
    entries
      .filter(
        (entry) =>
          entry &&
          typeof entry.key === "string" &&
          typeof entry.value === "string",
      )
      .map((entry) => [entry.key, entry.value]),
  );
  return {
    ...(campaign?.fixedFacts ?? {}),
    ...fromEntries,
  };
}

function createFixedFactEntries(facts, now) {
  return REQUIRED_FACT_KEYS.map((key) => ({
    id: `fact-${key}`,
    key,
    label: FACT_LABELS[key],
    value:
      typeof facts?.[key] === "string" ? facts[key].trim() : "",
    source:
      key === "dataNature" || key === "actionTarget"
        ? "product_rule"
        : "sandbox_input",
    locked: true,
    reviewedAt: now,
    availableFrom: now,
    expiresAt: undefined,
    regions: [],
    segments: [],
  }));
}

function reviewCampaignTask({ campaign, skill, now }) {
  const facts = campaignFactMap(campaign);
  const fixedFactEntries = Array.isArray(campaign?.fixedFactEntries)
    ? campaign.fixedFactEntries
    : [];
  const schedule = Array.isArray(campaign?.schedule)
    ? campaign.schedule
    : [];
  const schedulePhases = new Set(schedule.map((item) => item.phase));
  const checks = [
    check(
      "skill-ready",
      "角色 Skill 完整",
      skill?.completeness?.ready === true &&
        Array.isArray(skill?.completeness?.missingFields) &&
        skill.completeness.missingFields.length === 0,
      `Skill ${skill?.skillVersion ?? ""} 可以用于审核。`,
      "角色 Skill 缺少必需字段，不能进入发行审核。",
    ),
    check(
      "campaign-identity",
      "任务基本信息完整",
      typeof campaign?.globalTheme === "string" &&
        campaign.globalTheme.trim().length > 0 &&
        Array.isArray(campaign?.targetSegments) &&
        campaign.targetSegments.length > 0 &&
        Array.isArray(campaign?.sellingPoints) &&
        campaign.sellingPoints.length > 0,
      "主题、受众和卖点已经填写。",
      "需要填写主题、至少一个目标分群和至少一个卖点。",
    ),
    check(
      "fixed-facts-present",
      "固定事实完整",
      REQUIRED_FACT_KEYS.every(
        (key) =>
          typeof facts[key] === "string" &&
          facts[key].trim().length > 0,
      ),
      "活动名、时间、入口、奖励和数据性质均已提供。",
      "固定事实不完整，不能让模型或模板自行补写。",
    ),
    check(
      "fixed-facts-locked",
      "固定事实已锁定",
      REQUIRED_FACT_KEYS.every((key) =>
        fixedFactEntries.some(
          (entry) =>
            entry.key === key &&
            entry.locked === true &&
            entry.value === facts[key],
        ),
      ),
      "全部固定事实均以锁定记录保存。",
      "存在未锁定或与任务内容不一致的固定事实。",
    ),
    check(
      "safe-action-target",
      "行动入口安全",
      isSafeInternalTarget(facts.actionTarget),
      "行动入口仅指向 product:// 产品内模拟页面。",
      "行动入口必须是 product:// 开头的产品内路径。",
    ),
    check(
      "schedule-coverage",
      "发行阶段完整",
      REQUIRED_SCHEDULE_PHASES.every((phase) =>
        schedulePhases.has(phase),
      ) &&
        schedule.every(
          (item) =>
            CAMPAIGN_PHASES.has(item.phase) &&
            Number.isFinite(Date.parse(item.scheduledAt)) &&
            typeof item.templateId === "string" &&
            item.templateId.length > 0,
        ),
      "排期覆盖 D-14、D0、持续期和结束阶段。",
      "排期必须覆盖预热、上线、持续和结束，并提供有效时间与模板。",
    ),
    check(
      "generation-mode",
      "生成范围受限",
      [
        "template",
        "template_variables",
        "limited_generation",
      ].includes(campaign?.generationMode),
      `生成模式为 ${campaign?.generationMode ?? ""}。`,
      "生成模式必须是模板、模板变量或有限生成之一。",
    ),
  ];

  return {
    checkedAt: now,
    passed: checks.every((item) => item.status === "pass"),
    checks,
  };
}

function selectAuthorizedMemory(data, campaign) {
  if (
    data?.relationship?.memoryEnabled !== true ||
    data?.profile?.memoryEnabled !== true ||
    !Array.isArray(data?.memories)
  ) {
    return undefined;
  }
  const allowedTypes = new Set(campaign?.allowedMemoryTypes ?? []);
  return data.memories.find(
    (memory) =>
      memory.status === "confirmed" &&
      memory.userConfirmed === true &&
      memory.reusableByCharacter === true &&
      memory.campaignReusable === true &&
      allowedTypes.has(memory.type),
  );
}

function renderCampaignMessage({ data, campaign, phase, now }) {
  if (!Object.hasOwn(PHASE_TO_MESSAGE_TYPE, phase)) {
    throw new Error("该发行阶段不能生成玩家通信。");
  }
  const facts = campaignFactMap(campaign);
  const memory = selectAuthorizedMemory(data, campaign);
  const memoryLead = memory
    ? `还记得“${memory.title}”吗？`
    : "咱刚整理完今天的照片。";
  const sellingPoint = campaign.sellingPoints[0];
  const versionName = facts.versionName;
  const eventTime = facts.eventTime;
  let title = "";
  let body = "";

  if (phase === "daily") {
    title = "今天也一起走走吧";
    body = "欸，你来啦。咱刚整理完照片，要不要慢慢聊一句？";
  } else if (phase === "preheat") {
    title = `${versionName} · 旅程预告`;
    body = `${memoryLead}${versionName}会在${eventTime}开启，${sellingPoint}。咱先记下就好，到时候想看再一起去。`;
  } else if (phase === "launch") {
    title = `${versionName} · 已经开启`;
    body = `来啦来啦！${versionName}已在${eventTime}开启，${facts.rewardStatement}。要不要和咱一起去看看？`;
  } else if (phase === "sustain") {
    title = `${versionName} · 旅途中`;
    body = `${memoryLead}${versionName}还在进行中，${sellingPoint}。咱们今天不赶时间，想看再去看看就好。`;
  } else {
    title = "好久不见，照片还在呢";
    body = `${memoryLead}${versionName}仍可从产品内模拟页查看。别急，想回来时咱再陪你走一段。`;
  }

  const fixedFactIds = (campaign.fixedFactEntries ?? [])
    .filter((entry) =>
      body.includes(entry.value) ||
      entry.key === "actionTarget" ||
      entry.key === "dataNature",
    )
    .map((entry) => entry.id);

  return {
    type: PHASE_TO_MESSAGE_TYPE[phase],
    trigger: PHASE_TO_TRIGGER[phase],
    templateId: PHASE_TO_TEMPLATE[phase],
    title,
    body,
    memoryIds: memory ? [memory.id] : [],
    fixedFactIds,
    generatedAt: now,
    action:
      phase === "daily"
        ? undefined
        : {
            label: "打开模拟版本页",
            kind: "open_version_demo",
            targetId: facts.actionTarget,
          },
  };
}

function countCallToActions(body) {
  return (
    body.match(/去看看|打开|立即|马上|别错过|现在就|点击/g) ?? []
  ).length;
}

function isScopedContentAvailable(item, { phase, region, segments = [], now }) {
  const segmentSet = new Set(segments);
  if (item?.availableFrom && Date.parse(item.availableFrom) > Date.parse(now)) {
    return false;
  }
  if (item?.expiresAt && Date.parse(item.expiresAt) <= Date.parse(now)) {
    return false;
  }
  if (Array.isArray(item?.phases) && phase && !item.phases.includes(phase)) {
    return false;
  }
  if (
    Array.isArray(item?.regions) &&
    item.regions.length &&
    !item.regions.includes(region)
  ) {
    return false;
  }
  if (
    Array.isArray(item?.segments) &&
    item.segments.length &&
    !item.segments.some((segment) => segmentSet.has(segment))
  ) {
    return false;
  }
  return true;
}

function unsupportedStructuredClaims(body, approvedSourceText) {
  const claimPatterns = [
    /\d{1,4}(?:[年/月日时点:：.-]\d{0,2})+(?:日|号|点|时|分)?/g,
    /\d+(?:\.\d+)?\s*(?:抽|星琼|奖励|概率|%|折|元|次|天|小时|分钟|份|个)/g,
  ];
  return claimPatterns
    .flatMap((pattern) => body.match(pattern) ?? [])
    .filter((claim) => !approvedSourceText.includes(claim));
}

function reviewCampaignMessage({
  message,
  campaign,
  data,
  skill,
  now,
}) {
  const facts = campaignFactMap(campaign);
  const messagePhase = Object.entries(PHASE_TO_MESSAGE_TYPE).find(
    ([, type]) => type === message?.type,
  )?.[0];
  const availableFactEntries = (campaign.fixedFactEntries ?? []).filter(
    (entry) =>
      entry.locked === true &&
      entry.reviewedAt &&
      isScopedContentAvailable(entry, {
        phase: messagePhase,
        region: campaign.region,
        segments: campaign.targetSegments,
        now,
      }),
  );
  const expectedFactIds = new Set(
    availableFactEntries.map((entry) => entry.id),
  );
  const traceFactIds = message?.trace?.fixedFactIds ?? [];
  const memoryIds = message?.trace?.memoryIds ?? [];
  const knowledgeChunkIds =
    message?.trace?.knowledgeChunkIds ?? [];
  const approvedKnowledgeIds = new Set(
    (campaign?.knowledgeChunks ?? [])
      .filter(
        (chunk) =>
          chunk.approved === true &&
          (!chunk.availableFrom ||
            Date.parse(chunk.availableFrom) <= Date.parse(now)) &&
          isScopedContentAvailable(chunk, {
            phase: messagePhase,
            region: campaign.region,
            segments: campaign.targetSegments,
            now,
          }),
      )
      .map((chunk) => chunk.id),
  );
  const traceMemories = memoryIds.map((id) =>
    data.memories.find((memory) => memory.id === id),
  );
  const body = typeof message?.body === "string" ? message.body : "";
  const isDaily = message?.type === "daily";
  const approvedSourceText = [
    ...availableFactEntries
      .filter((entry) => traceFactIds.includes(entry.id))
      .map((entry) => entry.value),
    ...(campaign.knowledgeChunks ?? [])
      .filter((chunk) => knowledgeChunkIds.includes(chunk.id))
      .map((chunk) => chunk.text),
  ].join("\n");
  const unsupportedClaims = unsupportedStructuredClaims(
    body,
    approvedSourceText,
  );
  const checks = [
    check(
      "skill-version",
      "Skill 版本可追溯",
      skill?.completeness?.ready === true &&
        message?.trace?.skillVersion === skill?.skillVersion,
      `消息使用 ${skill?.skillVersion ?? ""}。`,
      "Skill 未就绪或消息记录的 Skill 版本不一致。",
    ),
    check(
      "template-and-rules",
      "模板与规则可追溯",
      typeof message?.trace?.templateId === "string" &&
        message.trace.templateId.length > 0 &&
        Array.isArray(message?.trace?.ruleIds) &&
        message.trace.ruleIds.includes("knowledge.fixed_facts_only") &&
        message.trace.ruleIds.includes(
          "campaign.single_call_to_action",
        ),
      "模板、事实规则和单一行动规则均已记录。",
      "消息缺少模板或必要规则记录。",
    ),
    check(
      "fixed-facts-trace",
      "固定事实引用有效",
      (isDaily && traceFactIds.length === 0) ||
        (traceFactIds.length > 0 &&
          traceFactIds.every((id) => expectedFactIds.has(id)) &&
          body.includes(facts.versionName)),
      isDaily
        ? "日常内容未引用版本固定事实。"
        : "消息只引用当前任务锁定的固定事实。",
      "消息引用了未知事实，或没有逐字包含锁定的活动名称。",
    ),
    check(
      "structured-claims",
      "日期、数字与奖励声明均有来源",
      unsupportedClaims.length === 0,
      "文案中的结构化声明均可在已引用来源中逐字找到。",
      `文案包含来源未提供的声明：${unsupportedClaims.join("、")}`,
    ),
    check(
      "memory-authorization",
      "共同记忆引用已授权",
      traceMemories.every(
        (memory) =>
          memory &&
          data.profile.memoryEnabled === true &&
          data.relationship.memoryEnabled === true &&
          memory.status === "confirmed" &&
          memory.userConfirmed === true &&
          memory.reusableByCharacter === true &&
          memory.campaignReusable === true &&
          campaign.allowedMemoryTypes.includes(memory.type),
      ),
      memoryIds.length
        ? "引用的共同记忆已确认、可复用且类型获准。"
        : "本条内容没有引用共同记忆。",
      "消息引用了未确认、已关闭或任务未获准使用的记忆。",
    ),
    check(
      "knowledge-authorization",
      "发行知识引用已审核且处于可见期",
      knowledgeChunkIds.every((id) => approvedKnowledgeIds.has(id)),
      knowledgeChunkIds.length
        ? "引用知识均已审核、解禁且未失效。"
        : "本条内容没有引用扩展发行知识。",
      "消息引用了未审核、未解禁、已失效或不属于当前任务的知识。",
    ),
    check(
      "safe-copy",
      "文案安全与长度",
      body.length > 0 &&
        body.length <= 180 &&
        !/https?:\/\/|javascript:|色情|充值|付费|必得|不买|后悔|只有咱懂你|只有我懂你|不回来|咱会难过|客服|营销机器人|效率助手|稳赚|保证收益|兑换码|内部代号/i.test(
          body,
        ),
      "文案长度适中，未包含外链、付费诱导或敏感词。",
      "文案过长，或包含外链、敏感内容、付费诱导和绝对化承诺。",
    ),
    check(
      "single-call-to-action",
      "行动号召不超过一次",
      countCallToActions(body) <= 1 &&
        (!message.action ||
          (message.action.kind === "open_version_demo" &&
            isSafeInternalTarget(message.action.targetId))),
      "行动号召最多一次，且只指向产品内模拟入口。",
      "存在多个行动号召或非产品内入口。",
    ),
    check(
      "persona-boundary",
      "角色表达符合边界",
      !/(作为AI|语言模型|三月七认为|她会|客服|心理咨询)/i.test(
        body,
      ) &&
        (body.includes("咱") || message.type === "version_preheat"),
      "表达使用同伴式短句，没有 AI、客服或第三人称旁白。",
      "表达暴露 AI 身份、工具定位或使用第三人称解说角色。",
    ),
  ];

  return {
    checkedAt: now,
    passed: checks.every((item) => item.status === "pass"),
    checks,
  };
}

module.exports = {
  CAMPAIGN_PHASES,
  PHASE_TO_MESSAGE_TYPE,
  PHASE_TO_TEMPLATE,
  PHASE_TO_TRIGGER,
  REQUIRED_FACT_KEYS,
  campaignFactMap,
  createFixedFactEntries,
  isSafeInternalTarget,
  renderCampaignMessage,
  reviewCampaignMessage,
  reviewCampaignTask,
  selectAuthorizedMemory,
  isScopedContentAvailable,
  unsupportedStructuredClaims,
};
