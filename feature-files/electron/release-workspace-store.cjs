const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SCHEMA_VERSION = 1;
const ROLES = Object.freeze({
  LEAD: "release_lead",
  OPS: "character_ops",
  REVIEWER: "reviewer",
});

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
  return new Date().toISOString();
}

function clone(value) {
  return structuredClone(value);
}

function assertText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}不能为空。`);
  }
  return value.trim();
}

function assertCounts(record, line) {
  const fields = [
    "delivered", "read", "replied", "clicked", "participated",
    "unsubscribed", "blocked", "complaints", "continuedConversation",
    "proactiveConversation",
  ];
  for (const field of fields) {
    const value = Number(record[field] ?? 0);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`第 ${line} 行 ${field} 必须是非负整数。`);
    }
    record[field] = value;
  }
  for (const field of fields.slice(1)) {
    if (record[field] > record.delivered) {
      throw new Error(`第 ${line} 行 ${field} 不能大于 delivered。`);
    }
  }
}

function parseCsv(text) {
  const rows = String(text).trim().split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) throw new Error("CSV 至少需要表头和一行数据。");
  const headers = rows[0].split(",").map((item) => item.trim());
  return rows.slice(1).map((row, index) => {
    const cells = row.split(",").map((item) => item.trim());
    return {
      __line: index + 2,
      ...Object.fromEntries(headers.map((header, cell) => [header, cells[cell] ?? ""])),
    };
  });
}

function parseRecords(text, kind) {
  const source = assertText(text, `${kind}数据`);
  if (source.startsWith("[") || source.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new Error(`JSON 解析失败：${error.message}`);
    }
    const records = Array.isArray(parsed) ? parsed : parsed.records;
    if (!Array.isArray(records)) throw new Error("JSON 必须是数组或包含 records 数组。");
    return records.map((record, index) => ({ __line: index + 1, ...record }));
  }
  return parseCsv(source);
}

function extractReleasePlan(parsedDocument, region) {
  if (!parsedDocument?.source || !Array.isArray(parsedDocument?.chunks)) {
    throw new Error("发行方案解析结果无效。");
  }
  const text = parsedDocument.chunks
    .map((chunk) => String(chunk.text || ""))
    .join("\n\n")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!text) throw new Error("发行方案没有可用文字。");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const clean = (value) => String(value || "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*+]\s*/, "")
    .replace(/^\d+[.)、]\s*/, "")
    .trim();
  const findValue = (labels) => {
    for (let index = 0; index < lines.length; index += 1) {
      const line = clean(lines[index]);
      for (const label of labels) {
        const match = line.match(new RegExp(`^${label}\\s*[:：]\\s*(.+)$`, "i"));
        if (match?.[1]) return clean(match[1]);
        if (new RegExp(`^${label}$`, "i").test(line) && lines[index + 1]) {
          return clean(lines[index + 1]);
        }
      }
    }
    return "";
  };
  const declaredRegion = findValue(["发行区域", "目标区域", "区域", "Region"]);
  if (declaredRegion) {
    const aliases = {
      china: ["中国", "大陆", "china", "cn"],
      japan: ["日本", "japan", "jp"],
      north_america: ["北美", "north america", "na", "us", "美国", "加拿大"],
    };
    const allowed = [
      region.id, region.code, region.name,
      ...(aliases[region.id] || []),
    ].map((value) => String(value).toLowerCase());
    const normalized = declaredRegion.toLowerCase();
    if (!allowed.some((value) => normalized.includes(value))) {
      throw new Error(`方案声明区域“${declaredRegion}”与当前${region.name}工作区不匹配。`);
    }
  }
  const title = findValue(["任务名称", "方案名称", "版本名称", "标题"])
    || clean(lines.find((line) => /^#/.test(line)) || lines[0])
    || path.parse(parsedDocument.source.name).name;
  const theme = findValue(["全局主题", "核心主题", "发行主题", "主题", "目标"])
    || lines.slice(0, 3).map(clean).join(" · ").slice(0, 240);
  const objectiveText = findValue(["发行目标", "任务目标", "目标"]) || text;
  const objective = /召回|recall/i.test(objectiveText) ? "recall"
    : /预热|preheat/i.test(objectiveText) ? "preheat"
      : /持续|长线|sustain/i.test(objectiveText) ? "sustain"
        : "launch";
  const facts = [
    ["版本名称", findValue(["版本名称", "版本"])],
    ["活动时间", findValue(["活动时间", "发行时间", "时间窗口", "上线时间"])],
    ["行动入口", findValue(["行动入口", "安全入口", "活动入口"])],
    ["奖励说明", findValue(["奖励说明", "奖励", "权益"])],
    ["核心卖点", findValue(["核心卖点", "卖点"])],
  ].filter(([, value]) => value).map(([label, value]) => ({
    id: id("fact"),
    label,
    value,
    source: parsedDocument.source.name,
  }));
  if (!facts.length) {
    facts.push({
      id: id("fact"),
      label: "方案摘要",
      value: lines.slice(0, 4).map(clean).join(" ").slice(0, 280),
      source: parsedDocument.source.name,
    });
  }
  return {
    title: title.slice(0, 160),
    objective,
    theme: theme.slice(0, 500),
    narrative: findValue(["叙事方式", "叙事策略", "角色表达策略", "角色策略"]).slice(0, 1200),
    timeWindow: findValue(["时间窗口", "发行时间", "活动时间", "上线时间"]).slice(0, 200),
    facts,
    declaredRegion,
    sourceDocument: {
      id: parsedDocument.source.id,
      name: parsedDocument.source.name,
      format: parsedDocument.source.format,
      importedAt: parsedDocument.source.importedAt,
      chunkCount: parsedDocument.source.chunkCount,
    },
  };
}

function defaultAgents(regionId) {
  const names = {
    china: "中国",
    japan: "日本",
    north_america: "北美",
  };
  const label = names[regionId] || "区域";
  return [
    { id: `${regionId}-relationship-ai`, name: `${label}关系守护 AI`, description: "负责关系边界、拒绝和降频策略", enabled: true },
    { id: `${regionId}-character-ai`, name: `${label}角色表达 AI`, description: "负责三月七角色语气与互动路径", enabled: true },
    { id: `${regionId}-delivery-ai`, name: `${label}发行执行 AI`, description: "负责灰度比例、触达节奏和执行回执", enabled: true },
  ];
}

function defaultRegions() {
  return [
    { id: "china", code: "CN", name: "中国", language: "zh-CN", timeZone: "Asia/Shanghai", quietHours: { start: "22:00", end: "08:00" }, releaseAgents: defaultAgents("china") },
    { id: "japan", code: "JP", name: "日本", language: "ja-JP", timeZone: "Asia/Tokyo", quietHours: { start: "22:00", end: "08:00" }, releaseAgents: defaultAgents("japan") },
    { id: "north_america", code: "NA", name: "北美", language: "en-US", timeZone: "America/Los_Angeles", quietHours: { start: "21:00", end: "08:00" }, releaseAgents: defaultAgents("north_america") },
  ];
}

function emptyWorkspace(regionId) {
  return {
    regionId,
    tasks: [],
    segments: [],
    directives: [],
    reviews: [],
    experiments: [],
    metrics: [],
    evaluations: [],
    optimizations: [],
    bundles: [],
    planSources: [],
    planReleases: [],
    aiDeliveries: [],
    emergencyStoppedAt: null,
  };
}

function defaultRoot() {
  const regions = defaultRegions();
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now(),
    updatedAt: now(),
    activeRegionId: "japan",
    activeOperatorId: "operator_lead",
    regions,
    operators: [
      { id: "operator_lead", name: "发行负责人", role: ROLES.LEAD },
      { id: "operator_ops", name: "角色运营", role: ROLES.OPS },
      { id: "operator_reviewer", name: "内容审核员", role: ROLES.REVIEWER },
    ],
    workspaces: Object.fromEntries(regions.map((region) => [region.id, emptyWorkspace(region.id)])),
    auditLog: [],
    migrations: {},
  };
}

function migratedTask(campaign) {
  const fixedFacts = campaign.fixedFacts ?? {};
  return {
    id: `legacy_${campaign.id}`,
    regionId: "japan",
    title: campaign.version || "迁移的发行任务",
    objective: campaign.objective || "launch",
    theme: campaign.globalTheme || "",
    narrative: campaign.narrativeApproach || "",
    facts: [
      { id: id("fact"), label: "版本名称", value: fixedFacts.versionName || campaign.version || "", source: "旧控制台迁移" },
      { id: id("fact"), label: "活动时间", value: fixedFacts.eventTime || "", source: "旧控制台迁移" },
      { id: id("fact"), label: "行动入口", value: fixedFacts.actionTarget || "", source: "旧控制台迁移" },
    ],
    ownerId: "operator_lead",
    reviewerId: "operator_reviewer",
    timeWindow: fixedFacts.eventTime || "待确认",
    status: campaign.status === "approved" || campaign.status === "running" ? "ready" : "draft",
    gate: {
      objective: Boolean(campaign.globalTheme),
      evidence: Boolean(campaign.fixedFactEntries?.length || fixedFacts.versionName),
      consent: true,
      reviewer: true,
      timeWindow: Boolean(fixedFacts.eventTime),
    },
    createdAt: now(),
    updatedAt: now(),
    sourceCampaignId: campaign.id,
  };
}

function rate(value, denominator) {
  return denominator > 0 ? value / denominator : 0;
}

function evaluate(metrics, experiment) {
  const total = metrics.reduce((sum, item) => {
    for (const key of [
      "delivered", "read", "replied", "clicked", "participated",
      "unsubscribed", "blocked", "complaints", "continuedConversation",
      "proactiveConversation",
    ]) sum[key] = (sum[key] ?? 0) + item[key];
    return sum;
  }, {});
  const delivered = total.delivered ?? 0;
  const calculated = {
    sampleSize: delivered,
    readRate: rate(total.read, delivered),
    replyRate: rate(total.replied, delivered),
    clickRate: rate(total.clicked, delivered),
    participationRate: rate(total.participated, delivered),
    unsubscribeRate: rate(total.unsubscribed, delivered),
    blockedRate: rate(total.blocked, delivered),
    complaintRate: rate(total.complaints, delivered),
    continuedConversationRate: rate(total.continuedConversation, delivered),
    proactiveConversationRate: rate(total.proactiveConversation, delivered),
  };
  const thresholds = experiment.thresholds;
  let recommendation = "observe";
  let reason = "样本量尚未达到决策要求。";
  if (
    calculated.unsubscribeRate >= thresholds.maxUnsubscribeRate ||
    calculated.blockedRate >= thresholds.maxBlockedRate ||
    calculated.complaintRate >= thresholds.maxComplaintRate
  ) {
    recommendation = experiment.stage === "internal" ? "pause" : "rollback";
    reason = "关系健康硬性护栏已触发。";
  } else if (delivered >= thresholds.minSampleSize) {
    if (
      calculated.replyRate >= thresholds.minReplyRate &&
      calculated.continuedConversationRate >= thresholds.minContinuedConversationRate
    ) {
      recommendation = "expand";
      reason = "效果阈值满足，且关系健康护栏安全。";
    } else {
      recommendation = "optimize";
      reason = "样本充足，但效果或关系连续性仍需优化。";
    }
  }
  return { calculated, recommendation, reason };
}

class ReleaseWorkspaceStore {
  constructor({ filePath, legacySnapshot, legacyFilePath }) {
    this.filePath = filePath;
    this.legacyFilePath = legacyFilePath;
    this.data = this.#load();
    for (const region of this.data.regions || []) {
      if (!Array.isArray(region.releaseAgents)) region.releaseAgents = defaultAgents(region.id);
    }
    for (const workspace of Object.values(this.data.workspaces || {})) {
      if (!Array.isArray(workspace.planSources)) workspace.planSources = [];
      if (!Array.isArray(workspace.planReleases)) workspace.planReleases = [];
      if (!Array.isArray(workspace.aiDeliveries)) workspace.aiDeliveries = [];
    }
    this.#migrateLegacy(legacySnapshot);
    this.#save();
  }

  #load() {
    if (!fs.existsSync(this.filePath)) return defaultRoot();
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(`不支持的发行工作区版本：${parsed.schemaVersion}`);
    }
    return parsed;
  }

  #save() {
    this.data.updatedAt = now();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), "utf8");
    fs.renameSync(tempPath, this.filePath);
  }

  #migrateLegacy(snapshot) {
    if (this.data.migrations.companionCampaignsV1 || !snapshot?.campaigns?.length) return;
    if (this.legacyFilePath && fs.existsSync(this.legacyFilePath)) {
      const backupPath = `${this.legacyFilePath}.release-migration-backup`;
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(this.legacyFilePath, backupPath);
      }
    }
    if (fs.existsSync(this.filePath)) {
      fs.copyFileSync(this.filePath, `${this.filePath}.backup-${Date.now()}`);
    }
    const workspace = this.data.workspaces.japan;
    for (const campaign of snapshot.campaigns) {
      if (!workspace.tasks.some((task) => task.sourceCampaignId === campaign.id)) {
        workspace.tasks.push(migratedTask(campaign));
      }
    }
    this.data.migrations.companionCampaignsV1 = {
      completedAt: now(),
      sourceIds: snapshot.campaigns.map((campaign) => campaign.id),
    };
  }

  #operator() {
    const operator = this.data.operators.find((item) => item.id === this.data.activeOperatorId);
    if (!operator) throw new Error("当前操作者不存在。");
    return operator;
  }

  #require(roles) {
    const operator = this.#operator();
    if (!roles.includes(operator.role)) throw new Error("当前角色无权执行此操作。");
    return operator;
  }

  #workspace(regionId) {
    if (!regionId || !this.data.regions.some((region) => region.id === regionId)) {
      throw new Error("区域不存在。");
    }
    const workspace = this.data.workspaces[regionId];
    if (!workspace || workspace.regionId !== regionId) throw new Error("区域工作区不匹配。");
    return workspace;
  }

  #audit(regionId, action, entityType, entityId, before, after, reason = "") {
    const operator = this.#operator();
    this.data.auditLog.unshift({
      id: id("audit"),
      occurredAt: now(),
      regionId,
      operatorId: operator.id,
      operatorName: operator.name,
      role: operator.role,
      action,
      entityType,
      entityId,
      reason,
      before,
      after,
    });
    this.data.auditLog = this.data.auditLog.slice(0, 300);
  }

  snapshot() {
    return clone(this.data);
  }

  switchRegion(regionId) {
    this.#workspace(regionId);
    this.data.activeRegionId = regionId;
    this.#save();
    return this.snapshot();
  }

  setOperator(operatorId) {
    if (!this.data.operators.some((item) => item.id === operatorId)) throw new Error("操作者不存在。");
    this.data.activeOperatorId = operatorId;
    this.#save();
    return this.snapshot();
  }

  addRegion(input) {
    this.#require([ROLES.LEAD]);
    const code = assertText(input?.code, "区域代码").toUpperCase();
    if (this.data.regions.some((region) => region.code === code)) throw new Error("区域代码已存在。");
    const region = {
      id: id("region"),
      code,
      name: assertText(input?.name, "区域名称"),
      language: assertText(input?.language, "语言"),
      timeZone: assertText(input?.timeZone, "时区"),
      quietHours: {
        start: input?.quietHours?.start || "22:00",
        end: input?.quietHours?.end || "08:00",
      },
      releaseAgents: defaultAgents(code.toLowerCase()),
    };
    this.data.regions.push(region);
    this.data.workspaces[region.id] = emptyWorkspace(region.id);
    this.#audit(region.id, "region.created", "region", region.id, null, region);
    this.#save();
    return this.snapshot();
  }

  updateRegion(regionId, input) {
    this.#require([ROLES.LEAD]);
    this.#workspace(regionId);
    const region = this.data.regions.find((item) => item.id === regionId);
    const before = clone(region);
    const code = assertText(input?.code, "区域代码").toUpperCase();
    if (this.data.regions.some((item) => item.id !== regionId && item.code === code)) {
      throw new Error("区域代码已存在。");
    }
    region.name = assertText(input?.name, "区域名称");
    region.code = code;
    region.language = assertText(input?.language, "主要语言");
    region.timeZone = assertText(input?.timeZone, "时区");
    region.quietHours = {
      start: assertText(input?.quietHours?.start, "静默开始时间"),
      end: assertText(input?.quietHours?.end, "静默结束时间"),
    };
    this.#audit(regionId, "region.updated", "region", regionId, before, region);
    this.#save();
    return this.snapshot();
  }

  saveTask(regionId, input) {
    const operator = this.#require([ROLES.LEAD, ROLES.OPS]);
    const workspace = this.#workspace(regionId);
    const existing = input?.id ? workspace.tasks.find((task) => task.id === input.id) : null;
    const before = existing ? clone(existing) : null;
    const task = {
      id: existing?.id || id("task"),
      regionId,
      title: assertText(input?.title, "任务名称"),
      objective: input?.objective || "launch",
      theme: assertText(input?.theme, "任务主题"),
      narrative: input?.narrative?.trim() || "",
      facts: Array.isArray(input?.facts) ? input.facts.slice(0, 20) : [],
      ownerId: input?.ownerId || operator.id,
      reviewerId: input?.reviewerId || "operator_reviewer",
      timeWindow: input?.timeWindow?.trim() || "",
      status: existing?.status || "draft",
      gate: {
        objective: Boolean(input?.theme?.trim()),
        evidence: Boolean(input?.facts?.some((fact) => fact.value?.trim() && fact.source?.trim())),
        consent: Boolean(input?.consentConfirmed),
        reviewer: true,
        timeWindow: Boolean(input?.timeWindow?.trim()),
      },
      createdAt: existing?.createdAt || now(),
      updatedAt: now(),
    };
    task.status = Object.values(task.gate).every(Boolean) ? "ready" : "draft";
    if (existing) Object.assign(existing, task);
    else workspace.tasks.unshift(task);
    this.#audit(regionId, existing ? "task.updated" : "task.created", "task", task.id, before, task);
    this.#save();
    return this.snapshot();
  }

  importReleasePlan(regionId, parsedDocument, taskId) {
    const operator = this.#require([ROLES.LEAD, ROLES.OPS]);
    const workspace = this.#workspace(regionId);
    const region = this.data.regions.find((item) => item.id === regionId);
    const extracted = extractReleasePlan(parsedDocument, region);
    const existing = taskId
      ? workspace.tasks.find((item) => item.id === taskId)
      : null;
    if (taskId && !existing) throw new Error("要更新的任务不属于当前区域。");
    const before = existing ? clone(existing) : null;
    const task = {
      id: existing?.id || id("task"),
      regionId,
      title: extracted.title,
      objective: extracted.objective,
      theme: extracted.theme,
      narrative: extracted.narrative,
      facts: extracted.facts,
      ownerId: existing?.ownerId || operator.id,
      reviewerId: existing?.reviewerId || "operator_reviewer",
      timeWindow: extracted.timeWindow,
      status: "draft",
      gate: {
        objective: Boolean(extracted.theme),
        evidence: extracted.facts.length > 0,
        consent: false,
        reviewer: Boolean(existing?.reviewerId || "operator_reviewer"),
        timeWindow: Boolean(extracted.timeWindow),
      },
      sourceDocument: extracted.sourceDocument,
      createdAt: existing?.createdAt || now(),
      updatedAt: now(),
    };
    if (existing) Object.assign(existing, task);
    else workspace.tasks.unshift(task);
    const sourceRecord = {
      ...extracted.sourceDocument,
      content: parsedDocument.chunks.map((chunk) => String(chunk.text || "")).join("\n\n").slice(0, 500000),
      regionId,
      taskId: task.id,
      declaredRegion: extracted.declaredRegion,
      status: "imported_needs_confirmation",
    };
    workspace.planSources.unshift(sourceRecord);
    workspace.planSources = workspace.planSources.slice(0, 100);
    this.#audit(
      regionId,
      existing ? "release_plan.reimported" : "release_plan.imported",
      "task",
      task.id,
      before,
      task,
      `来源：${extracted.sourceDocument.name}`,
    );
    this.#save();
    return { snapshot: this.snapshot(), taskId: task.id, source: clone(sourceRecord) };
  }

  importAudience(regionId, taskId, text) {
    this.#require([ROLES.LEAD, ROLES.OPS]);
    const workspace = this.#workspace(regionId);
    if (!workspace.tasks.some((task) => task.id === taskId)) throw new Error("任务不属于当前区域。");
    const records = parseRecords(text, "玩家分群");
    for (const record of records) {
      if (record.regionId && record.regionId !== regionId) throw new Error(`第 ${record.__line} 行区域不匹配。`);
      const segment = {
        id: record.id || id("segment"),
        regionId,
        taskId,
        name: assertText(record.name, `第 ${record.__line} 行分群名称`),
        eligible: Number(record.eligible ?? 0),
        authorized: Number(record.authorized ?? 0),
        reachable: Number(record.reachable ?? 0),
        excluded: Number(record.excluded ?? 0),
        fatigue: record.fatigue || "low",
        conflicts: record.conflicts || "",
        criteria: record.criteria || "",
        samples: Array.isArray(record.samples) ? record.samples.slice(0, 3).map((sample, index) => ({
          alias: `匿名样本 ${index + 1}`,
          relationshipStage: sample.relationshipStage || "未知",
          authorizedMemory: sample.authorizedMemory || "无",
        })) : [],
      };
      for (const field of ["eligible", "authorized", "reachable", "excluded"]) {
        if (!Number.isInteger(segment[field]) || segment[field] < 0) throw new Error(`第 ${record.__line} 行 ${field} 必须是非负整数。`);
      }
      if (segment.authorized > segment.eligible || segment.reachable > segment.authorized) {
        throw new Error(`第 ${record.__line} 行人数分母关系不合法。`);
      }
      workspace.segments.push(segment);
    }
    this.#audit(regionId, "audience.imported", "task", taskId, null, { count: records.length });
    this.#save();
    return this.snapshot();
  }

  generateDirective(regionId, taskId, input = {}) {
    const operator = this.#require([ROLES.LEAD, ROLES.OPS]);
    const workspace = this.#workspace(regionId);
    const task = workspace.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("任务不属于当前区域。");
    if (!Object.values(task.gate).every(Boolean)) throw new Error("请先完成任务可执行性门禁。");
    const facts = task.facts.filter((fact) => fact.value?.trim());
    const paths = [
      ["light", "轻量路径", "自然问候，只传达一个核心信息。"],
      ["standard", "标准路径", "结合玩家关系阶段说明活动价值。"],
      ["deep", "深度路径", "仅在明确授权时引用共同经历。"],
    ].map(([depth, name, opening]) => ({
      id: id("path"),
      depth,
      name,
      opening: `${opening}${task.theme}`,
      branches: {
        interested: "太好啦，那我陪你继续看看。",
        inquiry: "我只会使用已经确认的事实来回答，不确定的部分会明确说明。",
        cold: "没关系，我们先停在这里，不打扰你。",
        refuse: "收到，我不会继续这次内容，也不会降低你的选择权。",
      },
      paused: false,
    }));
    const directive = {
      id: id("directive"),
      regionId,
      taskId,
      version: 1,
      status: "draft",
      createdBy: operator.id,
      createdAt: now(),
      goal: input.goal?.trim() || task.theme,
      theme: task.theme,
      tone: input.tone?.trim() || "真诚、轻松、不过度热情",
      forbidden: input.forbidden?.trim() || "不得制造紧迫感，不得暗示虚假奖励，不得绕过拒绝",
      memoryDepth: input.memoryDepth || "authorized_only",
      successBoundary: input.successBoundary?.trim() || "玩家愿意继续对话；拒绝或冷淡时立即停止",
      evidence: facts.map((fact) => ({ label: fact.label, value: fact.value, source: fact.source })),
      riskLevel: input.memoryDepth === "deep" ? "high" : "medium",
      paths,
    };
    workspace.directives.unshift(directive);
    this.#audit(regionId, "directive.generated", "directive", directive.id, null, directive);
    this.#save();
    return this.snapshot();
  }

  setDirectivePathPaused(regionId, directiveId, pathId, paused) {
    this.#require([ROLES.LEAD, ROLES.OPS]);
    const workspace = this.#workspace(regionId);
    const directive = workspace.directives.find((item) => item.id === directiveId);
    if (!directive) throw new Error("指令不属于当前区域。");
    const pathItem = directive.paths.find((item) => item.id === pathId);
    if (!pathItem) throw new Error("互动路径不存在。");
    const before = clone(pathItem);
    pathItem.paused = Boolean(paused);
    this.#audit(
      regionId,
      pathItem.paused ? "directive.path_paused" : "directive.path_resumed",
      "directive",
      directiveId,
      before,
      pathItem,
      `路径：${pathItem.name}`,
    );
    this.#save();
    return this.snapshot();
  }

  reviewDirective(regionId, directiveId, decision, note) {
    const reviewer = this.#require([ROLES.REVIEWER, ROLES.LEAD]);
    const workspace = this.#workspace(regionId);
    const directive = workspace.directives.find((item) => item.id === directiveId);
    if (!directive) throw new Error("指令不属于当前区域。");
    if (directive.riskLevel === "high" && directive.createdBy === reviewer.id) {
      throw new Error("高风险内容不能由创建者自行最终批准。");
    }
    const allowed = ["approved", "approved_with_changes", "returned", "forbidden", "escalated"];
    if (!allowed.includes(decision)) throw new Error("审核决定无效。");
    directive.status = decision === "approved" || decision === "approved_with_changes" ? "approved" : decision;
    directive.reviewedAt = now();
    directive.reviewedBy = reviewer.id;
    directive.reviewNote = String(note || "");
    workspace.reviews.unshift({
      id: id("review"), regionId, directiveId, reviewerId: reviewer.id,
      decision, note: String(note || ""), reviewedAt: directive.reviewedAt,
    });
    this.#audit(regionId, "directive.reviewed", "directive", directive.id, null, { decision, note });
    this.#save();
    return this.snapshot();
  }

  saveExperiment(regionId, input) {
    const operator = this.#require([ROLES.LEAD]);
    const workspace = this.#workspace(regionId);
    const directive = workspace.directives.find((item) => item.id === input?.directiveId);
    if (!directive || directive.status !== "approved") throw new Error("只有已批准指令可以进入实验。");
    const allocations = input?.allocations || {};
    const keys = ["control", "template", "symbiotic", "silent"];
    if (keys.reduce((sum, key) => sum + Number(allocations[key] || 0), 0) !== 100) {
      throw new Error("四组实验比例之和必须等于 100%。");
    }
    const pathRollouts = input?.pathRollouts || {};
    for (const pathItem of directive.paths) {
      const value = Number(pathRollouts[pathItem.id] ?? 0);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error(`“${pathItem.name}”的灰度比例必须在 0% 到 100% 之间。`);
      }
      pathRollouts[pathItem.id] = value;
    }
    const existing = input?.id
      ? workspace.experiments.find((item) => item.id === input.id && item.directiveId === directive.id)
      : null;
    const before = existing ? clone(existing) : null;
    const experiment = {
      id: existing?.id || id("experiment"), regionId, taskId: directive.taskId, directiveId: directive.id,
      name: assertText(input?.name, "实验名称"), stage: "internal", status: "active",
      createdBy: existing?.createdBy || operator.id, createdAt: existing?.createdAt || now(), updatedAt: now(),
      groups: keys.map((key) => ({ id: key, allocation: Number(allocations[key]), paused: false })),
      pathRollouts,
      thresholds: {
        minSampleSize: Number(input?.thresholds?.minSampleSize ?? 100),
        minReplyRate: Number(input?.thresholds?.minReplyRate ?? 0.08),
        minContinuedConversationRate: Number(input?.thresholds?.minContinuedConversationRate ?? 0.03),
        maxUnsubscribeRate: Number(input?.thresholds?.maxUnsubscribeRate ?? 0.02),
        maxBlockedRate: Number(input?.thresholds?.maxBlockedRate ?? 0.01),
        maxComplaintRate: Number(input?.thresholds?.maxComplaintRate ?? 0.005),
      },
    };
    if (existing) Object.assign(existing, experiment);
    else workspace.experiments.unshift(experiment);
    this.#audit(regionId, existing ? "experiment.updated" : "experiment.created", "experiment", experiment.id, before, experiment);
    this.#save();
    return this.snapshot();
  }

  setExperimentGroupPaused(regionId, experimentId, groupId, paused) {
    this.#require([ROLES.LEAD]);
    const workspace = this.#workspace(regionId);
    const experiment = workspace.experiments.find((item) => item.id === experimentId);
    if (!experiment) throw new Error("实验不属于当前区域。");
    const group = experiment.groups.find((item) => item.id === groupId);
    if (!group) throw new Error("实验组不存在。");
    const before = clone(group);
    group.paused = Boolean(paused);
    this.#audit(
      regionId,
      group.paused ? "experiment.group_paused" : "experiment.group_resumed",
      "experiment",
      experimentId,
      before,
      group,
      `实验组：${group.id}`,
    );
    this.#save();
    return this.snapshot();
  }

  importMetrics(regionId, experimentId, text) {
    this.#require([ROLES.LEAD, ROLES.OPS]);
    const workspace = this.#workspace(regionId);
    const experiment = workspace.experiments.find((item) => item.id === experimentId);
    if (!experiment) throw new Error("实验不属于当前区域。");
    const records = parseRecords(text, "实验指标");
    for (const record of records) {
      if (record.regionId && record.regionId !== regionId) throw new Error(`第 ${record.__line} 行区域不匹配。`);
      if (record.experimentId && record.experimentId !== experimentId) throw new Error(`第 ${record.__line} 行实验不匹配。`);
      if (!experiment.groups.some((group) => group.id === record.groupId)) throw new Error(`第 ${record.__line} 行实验组无效。`);
      assertCounts(record, record.__line);
      workspace.metrics.push({
        id: id("metric"), regionId, experimentId, date: assertText(record.date, `第 ${record.__line} 行日期`),
        groupId: record.groupId, segmentId: record.segmentId || "",
        memoryDepth: record.memoryDepth || "unknown",
        ...Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith("__"))),
      });
    }
    const related = workspace.metrics.filter((item) => item.experimentId === experimentId);
    const result = evaluate(related, experiment);
    workspace.evaluations.unshift({
      id: id("evaluation"), regionId, experimentId, createdAt: now(), ...result,
    });
    this.#audit(regionId, "metrics.imported", "experiment", experimentId, null, { count: records.length, recommendation: result.recommendation });
    this.#save();
    return this.snapshot();
  }

  setExperimentStage(regionId, experimentId, action) {
    const operator = this.#require([ROLES.LEAD]);
    const workspace = this.#workspace(regionId);
    const experiment = workspace.experiments.find((item) => item.id === experimentId);
    if (!experiment) throw new Error("实验不属于当前区域。");
    const before = clone(experiment);
    const stages = ["internal", "one_percent", "five_percent", "expanded"];
    if (action === "pause" || action === "withdraw") {
      experiment.status = action === "pause" ? "paused" : "withdrawn";
    } else if (action === "rollback") {
      experiment.stage = stages[Math.max(0, stages.indexOf(experiment.stage) - 1)];
      experiment.status = "active";
    } else if (action === "advance") {
      const latest = workspace.evaluations.find((item) => item.experimentId === experimentId);
      if (latest?.recommendation === "pause" || latest?.recommendation === "rollback") throw new Error("关系健康护栏已触发，不能扩大。");
      experiment.stage = stages[Math.min(stages.length - 1, stages.indexOf(experiment.stage) + 1)];
      experiment.status = "active";
    } else throw new Error("实验操作无效。");
    experiment.updatedAt = now();
    this.#audit(regionId, `experiment.${action}`, "experiment", experimentId, before, experiment, `由 ${operator.name} 确认`);
    this.#save();
    return this.snapshot();
  }

  setEmergencyStop(regionId, enabled, reason) {
    this.#require([ROLES.LEAD]);
    const workspace = this.#workspace(regionId);
    workspace.emergencyStoppedAt = enabled ? now() : null;
    for (const experiment of workspace.experiments) {
      if (enabled && experiment.status === "active") experiment.status = "paused";
    }
    this.#audit(regionId, enabled ? "workspace.emergency_stopped" : "workspace.resumed", "workspace", regionId, null, { enabled }, reason);
    this.#save();
    return this.snapshot();
  }

  createOptimization(regionId, experimentId, reason) {
    this.#require([ROLES.LEAD, ROLES.OPS]);
    const workspace = this.#workspace(regionId);
    const experiment = workspace.experiments.find((item) => item.id === experimentId);
    if (!experiment) throw new Error("实验不属于当前区域。");
    const directive = workspace.directives.find((item) => item.id === experiment.directiveId);
    const task = workspace.tasks.find((item) => item.id === experiment.taskId);
    if (!directive && !task) throw new Error("优化对象不存在。");
    const revisions = workspace.optimizations.filter((item) =>
      directive ? item.directiveId === directive.id : item.taskId === task.id,
    );
    const baseVersion = directive?.version ?? 1;
    const optimization = {
      id: id("optimization"), regionId, experimentId,
      directiveId: directive?.id || "", taskId: task?.id || experiment.taskId,
      fromVersion: baseVersion, toVersion: baseVersion + revisions.length + 1,
      reason: assertText(reason, "优化原因"), evidenceEvaluationId:
        workspace.evaluations.find((item) => item.experimentId === experimentId)?.id || "",
      changes: "根据效果与关系健康数据调整区域发行方案和灰度比例。",
      createdAt: now(), rollbackDirectiveId: directive?.id || "", rollbackTaskId: task?.id || "",
    };
    workspace.optimizations.unshift(optimization);
    this.#audit(regionId, "optimization.created", "optimization", optimization.id, null, optimization);
    this.#save();
    return this.snapshot();
  }

  publishPlanToAgents(regionId, taskId, rolloutPercent, options = {}) {
    const exampleMode = options?.exampleMode === true;
    const operator = this.#require([ROLES.LEAD]);
    const workspace = this.#workspace(regionId);
    const region = this.data.regions.find((item) => item.id === regionId);
    const task = workspace.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("版本任务不属于当前区域。");
    if (workspace.emergencyStoppedAt) throw new Error("当前区域处于紧急暂停状态。");
    const percent = Number(rolloutPercent);
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
      throw new Error("灰度比例必须在 1% 到 100% 之间。");
    }
    const enabledAgents = region.releaseAgents.filter((agent) => agent.enabled);
    if (!enabledAgents.length) throw new Error("当前区域没有启用的共生式发行 AI。");
    const sourcePlan = workspace.planSources.find((item) => item.taskId === taskId) || null;
    const publicTask = clone(task);
    delete publicTask.ownerId;
    delete publicTask.reviewerId;
    const createdAt = now();
    const payloadObject = {
      type: "regional_symbiotic_release_plan",
      schemaVersion: 1,
      region: {
        id: region.id, code: region.code, name: region.name,
        language: region.language, timeZone: region.timeZone,
        quietHours: clone(region.quietHours),
      },
      plan: publicTask,
      source: sourcePlan ? {
        name: sourcePlan.name, format: sourcePlan.format,
        importedAt: sourcePlan.importedAt, content: sourcePlan.content || "",
      } : null,
      rolloutPercent: percent,
      exampleMode,
      createdAt,
    };
    const serialized = JSON.stringify(payloadObject);
    const bundle = {
      id: id("bundle"), regionId, taskId, directiveId: "",
      createdAt, createdBy: operator.id,
      checksum: crypto.createHash("sha256").update(serialized).digest("hex"),
      payload: payloadObject,
    };
    workspace.bundles.unshift(bundle);
    const experiment = {
      id: id("experiment"), regionId, taskId, directiveId: "",
      name: `${task.title} · 方案灰度`, stage: "internal", status: "active",
      kind: "regional_plan", planRolloutPercent: percent,
      createdBy: operator.id, createdAt,
      groups: [
        { id: "control", allocation: 0, paused: false },
        { id: "template", allocation: 0, paused: false },
        { id: "symbiotic", allocation: 100, paused: false },
        { id: "silent", allocation: 0, paused: false },
      ],
      pathRollouts: {},
      thresholds: {
        minSampleSize: 100, minReplyRate: 0.08,
        minContinuedConversationRate: 0.03,
        maxUnsubscribeRate: 0.02, maxBlockedRate: 0.01,
        maxComplaintRate: 0.005,
      },
    };
    workspace.experiments.unshift(experiment);
    const batchId = id("publish_batch");
    const planRelease = {
      id: id("plan_release"), batchId, bundleId: bundle.id,
      checksum: bundle.checksum, experimentId: experiment.id,
      regionId, taskId, rolloutPercent: percent, exampleMode,
      status: "published", publishedAt: createdAt,
      agentIds: enabledAgents.map((agent) => agent.id),
    };
    workspace.planReleases.unshift(planRelease);
    const deliveries = enabledAgents.map((agent) => ({
      id: id("ai_delivery"), batchId, bundleId: bundle.id,
      checksum: bundle.checksum, planReleaseId: planRelease.id,
      regionId, taskId, directiveId: "", experimentId: experiment.id,
      agentId: agent.id, agentName: agent.name,
      rolloutPercent: percent, pathRollouts: {},
      status: "delivered", publishedAt: createdAt,
      deliveredAt: createdAt, publishedBy: operator.id, exampleMode,
    }));
    workspace.aiDeliveries.unshift(...deliveries);
    workspace.aiDeliveries = workspace.aiDeliveries.slice(0, 500);
    this.#audit(
      regionId,
      exampleMode
        ? "regional_plan.example_published_to_agents"
        : "regional_plan.published_to_agents",
      "plan_release",
      planRelease.id,
      null,
      { taskId, rolloutPercent: percent, exampleMode, agentIds: planRelease.agentIds, checksum: bundle.checksum },
      exampleMode
        ? `示例方案已跳过频控并推送到 ${enabledAgents.length} 个共生式发行 AI`
        : `区域发行方案已推送到 ${enabledAgents.length} 个共生式发行 AI`,
    );
    this.#save();
    return this.snapshot();
  }

  createBundle(regionId, directiveId) {
    const operator = this.#require([ROLES.LEAD]);
    const workspace = this.#workspace(regionId);
    const directive = workspace.directives.find((item) => item.id === directiveId);
    if (!directive || directive.status !== "approved") throw new Error("只能发布已批准指令。");
    if (workspace.emergencyStoppedAt) throw new Error("当前区域处于紧急暂停状态。");
    const payload = JSON.stringify({ regionId, directive, createdAt: now() });
    const bundle = {
      id: id("bundle"), regionId, directiveId, createdAt: now(), createdBy: operator.id,
      checksum: crypto.createHash("sha256").update(payload).digest("hex"), payload: JSON.parse(payload),
    };
    workspace.bundles.unshift(bundle);
    this.#audit(regionId, "bundle.created", "bundle", bundle.id, null, { checksum: bundle.checksum });
    this.#save();
    return { snapshot: this.snapshot(), bundle: clone(bundle) };
  }

  publishToAgents(regionId, directiveId, experimentId) {
    const operator = this.#require([ROLES.LEAD]);
    const workspace = this.#workspace(regionId);
    const region = this.data.regions.find((item) => item.id === regionId);
    const experiment = workspace.experiments.find(
      (item) => item.id === experimentId && item.directiveId === directiveId,
    );
    if (!experiment) throw new Error("请先保存当前指令的灰度设置。");
    if (experiment.status !== "active") throw new Error("灰度设置当前不可发布。");
    const enabledAgents = region.releaseAgents.filter((agent) => agent.enabled);
    if (!enabledAgents.length) throw new Error("当前区域没有启用的共生式发行 AI。");
    const created = this.createBundle(regionId, directiveId);
    const batchId = id("publish_batch");
    const publishedAt = now();
    const deliveries = enabledAgents.map((agent) => ({
      id: id("ai_delivery"),
      batchId,
      bundleId: created.bundle.id,
      checksum: created.bundle.checksum,
      regionId,
      taskId: experiment.taskId,
      directiveId,
      experimentId,
      agentId: agent.id,
      agentName: agent.name,
      pathRollouts: clone(experiment.pathRollouts),
      status: "delivered",
      publishedAt,
      deliveredAt: publishedAt,
      publishedBy: operator.id,
    }));
    workspace.aiDeliveries.unshift(...deliveries);
    workspace.aiDeliveries = workspace.aiDeliveries.slice(0, 500);
    this.#audit(
      regionId,
      "release.published_to_agents",
      "publish_batch",
      batchId,
      null,
      { agentIds: enabledAgents.map((agent) => agent.id), bundleId: created.bundle.id },
      `推送到 ${enabledAgents.length} 个区域共生式发行 AI`,
    );
    this.#save();
    return this.snapshot();
  }
}

module.exports = {
  ReleaseWorkspaceStore,
  ROLES,
  evaluate,
  extractReleasePlan,
  parseRecords,
};
