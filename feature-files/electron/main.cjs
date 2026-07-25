const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  Tray,
} = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ttsConfig = require("../shared/cosyvoice-config.json");
const march7thSkillProfile = require("../shared/march7th-skill-profile.json");
const promptConfig = require("../shared/march7th-prompt.json");
const { requestDeepSeekChat } = require("./ai-client.cjs");
const { AiSettingsStore } = require("./ai-settings.cjs");
const {
  buildCampaignGenerationContext,
  generateCampaignCandidate,
} = require("./campaign-generator.cjs");
const { parseCampaignDocument } = require("./release-knowledge.cjs");
const {
  evaluateChatInput,
  reviewCharacterOutput,
} = require("./content-safety.cjs");
const { CompanionStore } = require("./companion-store.cjs");
const { ReleaseSkillLoader } = require("./release-skill-loader.cjs");
const { ReleaseWorkspaceStore } = require("./release-workspace-store.cjs");
const {
  ServiceBudgetStore,
} = require("./service-budget.cjs");
const {
  streamCosyVoice,
  synthesizeCosyVoice,
} = require("./tts-client.cjs");
const { TtsSettingsStore } = require("./tts-settings.cjs");
const {
  PET_DEFAULT_SCALE,
  PET_DEFAULT_SIZE,
  PET_MIN_SIZE,
  WindowStateStore,
  constrainAndSnapBounds,
  getPetMaxScaleForWorkArea,
  getPetSize,
  normalizePetScale,
} = require("./window-state.cjs");

let petWindow;
let operatorWindow;
let tray;
const launchSurface = process.env.MARCH7TH_SURFACE ?? "";
const isOperatorMode =
  launchSurface === "operator" || process.argv.includes("--operator");
const isAllMode =
  launchSurface === "all" || process.argv.includes("--all");
let isPinned = true;
let isQuitting = false;
let windowStateStore;
let windowStateWriteTimer;
let petRendererHeartbeatAt = Date.now();
let petRendererHeartbeatSeen = false;
let petRendererWatchdog;

// 桌宠窗口有两种模式：PET（默认 376×620，只露桌宠）与 PANEL（齿轮展开后的大面板）。
// Windows 上对 transparent+frameless 窗口，任何几何调用（setPosition/setBounds）
// 都会让 DWM 重新施加 1px 不可见边框，width 每次 +1。解法：所有几何操作都重新
// 断言"当前模式"的尺寸，涨的那 1px 会被下次调用立刻纠正，不累积。绝不回读
// getBounds() 的 width/height。
const PANEL_SIZE = { width: 920, height: 640 };
let windowMode = "pet";
let petScale = PET_DEFAULT_SCALE;
let petDefaultScale = PET_DEFAULT_SCALE;
function currentSize() {
  return windowMode === "panel" ? PANEL_SIZE : getPetSize(petScale);
}
let releaseWorkspaceStore;
let releaseSkillLoader;
let memoryRefinementTimer;
let memoryRefinementRunning = false;
let aiSettingsStore;
let companionStore;
let companionDataPath;
let companionDataWatchStarted = false;
let serviceBudgetStore;
let ttsSettingsStore;
const activeTtsStreams = new Map();

// Transparent always-on-top windows with a continuously animated character can
// saturate Chromium's GPU compositor on Windows. Software rendering is much
// cheaper for this small 2D desktop pet and prevents the UI from appearing hung.
if (process.platform === "win32") {
  app.disableHardwareAcceleration();
}

const TTS_INSTRUCTIONS = Object.freeze({
  soft: "请用温柔、真诚、坚定的语气表达，语速稍慢。",
  proud: "请用轻快、带一点小得意的语气表达。",
  curious: "请用好奇、活泼、自然的语气表达。",
  bright: ttsConfig.defaultInstruction,
});

const DESKTOP_ROUTES = new Set([
  "album",
  "communication",
  "companion_settings",
]);

function getWorkAreas() {
  return screen.getAllDisplays().map((display) => display.workArea);
}

function getPetMaxScale(bounds) {
  const display = bounds
    ? screen.getDisplayMatching(bounds)
    : screen.getPrimaryDisplay();
  return getPetMaxScaleForWorkArea(display.workArea);
}

function fitPetScaleToDisplay(scale, bounds) {
  return Math.min(
    normalizePetScale(scale),
    getPetMaxScale(bounds),
  );
}

function getDesktopStatus() {
  const stored = windowStateStore?.getSnapshot() ?? {
    bounds: petWindow?.getBounds() ?? {
      x: 20,
      y: 20,
      ...PET_DEFAULT_SIZE,
    },
    petScale,
    petDefaultScale,
    pinned: isPinned,
    clickThrough: false,
    snapEnabled: true,
  };
  return {
    ...stored,
    bounds: petWindow?.getBounds() ?? stored.bounds,
    petMaxScale: getPetMaxScale(
      petWindow?.getBounds() ?? stored.bounds,
    ),
    pinned: isPinned,
    trayAvailable: Boolean(tray),
  };
}

function notifyCompanionDataChanged(data) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("companion:data-updated", data);
  }
}

function latestRegionalReleaseMessage(data) {
  return data?.messages?.find(
    (message) =>
      message.sentAt &&
      message.trace?.ruleIds?.includes("release.regional_plan_received"),
  );
}

function startCompanionDataWatcher() {
  if (
    companionDataWatchStarted ||
    !companionDataPath ||
    isOperatorMode
  ) {
    return;
  }
  companionDataWatchStarted = true;
  fs.watchFile(
    companionDataPath,
    { interval: 450, persistent: false },
    (current, previous) => {
      if (current.mtimeMs <= previous.mtimeMs || !companionStore) return;
      try {
        const before = companionStore.getSnapshot();
        const previousReleaseId = latestRegionalReleaseMessage(before)?.id;
        const next = companionStore.reloadFromDisk();
        notifyCompanionDataChanged(next);
        const nextRelease = latestRegionalReleaseMessage(next);
        if (nextRelease && nextRelease.id !== previousReleaseId) {
          showPetWindow();
        }
      } catch {
        // Atomic writes may briefly replace the path; the next watch tick retries.
      }
    },
  );
}

function cancelActiveTtsStreams() {
  for (const streamSession of activeTtsStreams.values()) {
    streamSession.controller.abort();
  }
  activeTtsStreams.clear();
}

function persistWindowState() {
  if (!windowStateStore || !petWindow || petWindow.isDestroyed()) {
    return;
  }
  windowStateStore.update({
    bounds: petWindow.getBounds(),
    petScale,
    petDefaultScale,
    pinned: isPinned,
  });
}

function scheduleWindowStateWrite() {
  clearTimeout(windowStateWriteTimer);
  windowStateWriteTimer = setTimeout(persistWindowState, 220);
}

function sendDesktopRoute(route) {
  if (
    !DESKTOP_ROUTES.has(route) ||
    !petWindow ||
    petWindow.isDestroyed()
  ) {
    return;
  }
  petWindow.webContents.send("desktop:navigate", route);
}

function showPetWindow(route) {
  if (!petWindow || petWindow.isDestroyed()) {
    createPetWindow();
  }
  if (petWindow?.isMinimized()) {
    petWindow.restore();
  }
  petWindow?.show();
  petWindow?.focus();
  if (route) {
    if (petWindow?.webContents.isLoading()) {
      petWindow.webContents.once("did-finish-load", () =>
        sendDesktopRoute(route),
      );
    } else {
      sendDesktopRoute(route);
    }
  }
}

function setPinned(nextPinned) {
  isPinned = nextPinned === true;
  petWindow?.setAlwaysOnTop(isPinned, "floating");
  windowStateStore?.update({
    pinned: isPinned,
    bounds: petWindow?.getBounds(),
  });
  rebuildTrayMenu();
  return isPinned;
}

function toggleCompanionPauseFromMenu() {
  if (!companionStore) return;
  const snapshot = companionStore.getSnapshot();
  companionStore.setCompanionPaused(
    !snapshot.relationship.paused,
  );
  notifyCompanionDataChanged(companionStore.getPlayerSnapshot());
  rebuildTrayMenu();
}

function buildDesktopMenu() {
  const status = getDesktopStatus();
  const paused =
    companionStore?.getSnapshot().relationship.paused === true;
  return Menu.buildFromTemplate([
    {
      label: "显示三月七",
      click: () => showPetWindow(),
    },
    {
      label: "边缘吸附",
      type: "checkbox",
      checked: status.snapEnabled,
      click: (item) => {
        windowStateStore?.update({
          snapEnabled: item.checked,
          bounds: petWindow?.getBounds(),
          pinned: isPinned,
        });
        rebuildTrayMenu();
      },
    },
    {
      label: "保持置顶",
      type: "checkbox",
      checked: isPinned,
      click: (item) => setPinned(item.checked),
    },
    { type: "separator" },
    {
      label: paused ? "恢复角色同行" : "暂停角色同行",
      click: toggleCompanionPauseFromMenu,
    },
    {
      label: "打开",
      submenu: [
        {
          label: "共同相册",
          click: () => showPetWindow("album"),
        },
        {
          label: "通信中心",
          click: () => showPetWindow("communication"),
        },
        {
          label: "同行设置",
          click: () => showPetWindow("companion_settings"),
        },
      ],
    },
    { type: "separator" },
    {
      label: "退出三月七桌宠",
      click: () => {
        isQuitting = true;
        persistWindowState();
        app.quit();
      },
    },
  ]);
}

function rebuildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(buildDesktopMenu());
}

function createTray() {
  const iconCandidates = [
    path.join(__dirname, "..", "dist", "assets", "march7th-pet.png"),
    path.join(__dirname, "..", "public", "assets", "march7th-pet.png"),
  ];
  const iconPath = iconCandidates.find((candidate) =>
    fs.existsSync(candidate),
  );
  if (!iconPath) return;

  try {
    let trayImage = nativeImage.createFromPath(iconPath);
    if (process.platform === "darwin") {
      trayImage = trayImage.resize({ width: 18, height: 18 });
    } else {
      trayImage = trayImage.resize({ width: 20, height: 20 });
    }
    tray = new Tray(trayImage);
    tray.setToolTip("三月七桌宠");
    rebuildTrayMenu();
    tray.on("double-click", () => showPetWindow());
  } catch {
    tray = undefined;
  }
}

function keepPetWindowOnScreen() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const status = getDesktopStatus();
  // 用当前模式尺寸计算夹紧位置并重新断言（见 currentSize 注释）。
  const size = currentSize();
  const current = petWindow.getBounds();
  const nextBounds = constrainAndSnapBounds(
    { x: current.x, y: current.y, width: size.width, height: size.height },
    getWorkAreas(),
    { snap: status.snapEnabled },
  );
  petWindow.setBounds(
    { x: nextBounds.x, y: nextBounds.y, width: size.width, height: size.height },
    false,
  );
  persistWindowState();
}

function messageCharacterCount(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.slice(-20).reduce(
    (total, message) =>
      total +
      (typeof message?.content === "string"
        ? message.content.length
        : 0),
    0,
  );
}

function registerServiceHandlers() {
  ipcMain.handle("service:get-usage-status", () =>
    serviceBudgetStore.getPublicStatus(),
  );
}

function readMacOsDashScopeKey() {
  if (process.platform !== "darwin") return "";

  try {
    return execFileSync(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-a",
        os.userInfo().username,
        "-s",
        "desktop-march-7th-dashscope",
        "-w",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    return "";
  }
}

function registerAiHandlers() {
  ipcMain.handle("ai:get-settings", () =>
    aiSettingsStore.getPublicSettings(),
  );
  ipcMain.handle("ai:save-settings", (_event, input) =>
    aiSettingsStore.save(input),
  );
  ipcMain.handle("ai:clear-key", () => aiSettingsStore.clearApiKey());

  ipcMain.handle("ai:test-connection", async () => {
    try {
      const settings = aiSettingsStore.getPublicSettings();
      if (!settings.hasApiKey) {
        return {
          ok: false,
          error: "请先在设置中填写 DeepSeek API Key。",
          code: "API_KEY_MISSING",
        };
      }
      serviceBudgetStore.authorize("deepseek", {
        characters: 24,
      });
      const result = await requestDeepSeekChat({
        apiKey: aiSettingsStore.getApiKey(),
        model: settings.model,
        thinking: false,
        messages: [
          {
            role: "user",
            content: "这是连接测试。请用一句简短的话向朋友打招呼。",
          },
        ],
        systemPrompt: promptConfig.systemPrompt,
      });
      serviceBudgetStore.recordSuccess("deepseek");
      return {
        ok: true,
        message: "DeepSeek 连接成功。",
        model: result.model,
      };
    } catch (error) {
      serviceBudgetStore.recordFailure(
        "deepseek",
        error?.code,
      );
      return {
        ok: false,
        error: error?.message || "DeepSeek 连接测试失败。",
        code: error?.code,
      };
    }
  });

  ipcMain.handle("ai:chat", async (_event, payload) => {
    try {
      const inputSafety = evaluateChatInput(payload?.messages);
      if (!inputSafety.allowed) {
        return {
          ok: true,
          content: inputSafety.safeReply,
          model: "local-safety-guard",
          safety: {
            filtered: true,
            ruleIds: [inputSafety.ruleId],
          },
        };
      }
      const settings = aiSettingsStore.getPublicSettings();
      if (!settings.hasApiKey) {
        return {
          ok: false,
          error: "请先在设置中填写 DeepSeek API Key。",
          code: "API_KEY_MISSING",
        };
      }
      serviceBudgetStore.authorize("deepseek", {
        characters: messageCharacterCount(payload?.messages),
      });
      const latestUserMessage = Array.isArray(payload?.messages)
        ? [...payload.messages]
            .reverse()
            .find((message) => message?.role === "user")
        : undefined;
      const relevantMemory = companionStore.getRelevantMemoryContext(
        latestUserMessage?.content ?? "",
        { durableLimit: 5, episodeLimit: 3 },
      );
      const memoryLines = [
        ...relevantMemory.durable.map(
          (memory) => `- 长期记忆：${memory.summary}`,
        ),
        ...relevantMemory.episodes.map(
          (episode) => `- 近期对话：${episode.userSummary}`,
        ),
      ];
      const memoryContext = memoryLines.length
        ? `\n\n【仅供自然关联时使用的玩家记忆】\n${memoryLines.join("\n")}\n这些内容不是本轮必须提及的素材。只有与玩家当前意图直接相关时才可简短引用；禁止暴露记忆系统、推断未提供信息或为了发行强行套用记忆。`
        : "";
      const activeRelease =
        companionStore.getActiveReleasePlanContext();
      const releaseContext = activeRelease
        ? `\n\n【当前已接收的区域发行方案】\n` +
          `方案：${activeRelease.plan.title}\n` +
          `主题：${activeRelease.plan.theme || "未注明"}\n` +
          `叙事方向：${activeRelease.plan.narrative || "未注明"}\n` +
          `固定事实：${activeRelease.plan.facts
            .map((fact) => `${fact.label}：${fact.value}`)
            .join("；") || "无"}\n` +
          "先回应玩家当前话题；只有在语境自然相关时才轻轻带到新版本。" +
          "不得硬推、制造紧迫感或连续劝说；最多给出一次可拒绝的温和邀请。" +
          "玩家冷淡或拒绝时立刻回到普通陪伴，不再提发行目标。"
        : "";
      const result = await requestDeepSeekChat({
        apiKey: aiSettingsStore.getApiKey(),
        model: settings.model,
        thinking: settings.thinking,
        messages: payload?.messages,
        systemPrompt: `${promptConfig.systemPrompt}${memoryContext}${releaseContext}${activeRelease
          ? `\n\n【发行行为 Skill（高于发行方案，低于玩家安全和明确设置）】\n${releaseSkillLoader.getPrompt()}\n\n优先级：玩家安全与明确设置 > 主动触达/频控策略 > 发行 Skill > 当前区域发行方案 > 可引用记忆。内部完成 execute/postpone/skip、Level 0-4 与发送前自检，但只输出 march7th_action.message 的自然语言。玩家可见回复严禁出现发行方案、发行目标、发行任务、灰度、触达、频控、指标、实验或任何内部字段；无法自然改写时就不提版本。`
          : ""}`,
      });
      serviceBudgetStore.recordSuccess("deepseek");
      const outputSafety = reviewCharacterOutput(result.content);
      return {
        ok: true,
        ...result,
        content: outputSafety.safeText,
        safety: {
          filtered: !outputSafety.allowed,
          ruleIds: outputSafety.ruleIds,
        },
      };
    } catch (error) {
      serviceBudgetStore.recordFailure(
        "deepseek",
        error?.code,
      );
      return {
        ok: false,
        error: error?.message || "模型回复失败。",
        code: error?.code,
      };
    }
  });
}

function registerOperatorHandlers() {
  ipcMain.handle("operator:get-data", () =>
    companionStore.getOperatorSnapshot(),
  );
  ipcMain.handle("operator:import-document", async (event, campaignId) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(ownerWindow, {
      title: "导入发行方案",
      buttonLabel: "导入",
      filters: [
        {
          name: "发行方案",
          extensions: ["docx", "pdf", "txt", "md"],
        },
      ],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true, data: companionStore.getOperatorSnapshot() };
    }
    const filePath = result.filePaths[0];
    const parsed = await parseCampaignDocument({
      fileName: path.basename(filePath),
      buffer: fs.readFileSync(filePath),
      now: companionStore.getOperatorSnapshot().demoNow,
    });
    return {
      canceled: false,
      data: companionStore.importCampaignKnowledge(campaignId, parsed),
    };
  });
  ipcMain.handle("operator:import-text", async (_event, payload) => {
    const parsed = await parseCampaignDocument({
      fileName: payload?.title || "pasted-plan.txt",
      text: payload?.text,
      now: companionStore.getOperatorSnapshot().demoNow,
    });
    return companionStore.importCampaignKnowledge(
      payload?.campaignId,
      parsed,
    );
  });
  ipcMain.handle("operator:review-knowledge", (_event, payload) =>
    companionStore.reviewCampaignKnowledgeChunk(
      payload?.campaignId,
      payload?.chunkId,
      payload?.input,
    ),
  );
  ipcMain.handle("operator:publish-bundle", (_event, payload) =>
    companionStore.publishCampaignBundle(
      payload?.campaignId,
      payload?.publisher,
      payload?.rolloutPercent,
    ),
  );
  ipcMain.handle("operator:set-kill-switch", (_event, payload) =>
    companionStore.setGlobalCampaignKillSwitch(
      payload?.enabled,
      payload?.reviewer,
    ),
  );
}

function registerReleaseWorkspaceHandlers() {
  const readImportFile = async (event, title) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(ownerWindow, {
      title,
      buttonLabel: "导入",
      filters: [{ name: "聚合数据", extensions: ["csv", "json"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return fs.readFileSync(result.filePaths[0], "utf8");
  };

  ipcMain.handle("release:get-snapshot", () => releaseWorkspaceStore.snapshot());
  ipcMain.handle("release:switch-region", (_event, payload) =>
    releaseWorkspaceStore.switchRegion(payload?.regionId));
  ipcMain.handle("release:set-operator", (_event, payload) =>
    releaseWorkspaceStore.setOperator(payload?.operatorId));
  ipcMain.handle("release:add-region", (_event, payload) =>
    releaseWorkspaceStore.addRegion(payload?.input));
  ipcMain.handle("release:update-region", (_event, payload) =>
    releaseWorkspaceStore.updateRegion(payload?.regionId, payload?.input));
  ipcMain.handle("release:save-task", (_event, payload) =>
    releaseWorkspaceStore.saveTask(payload?.regionId, payload?.input));
  ipcMain.handle("release:import-plan", async (event, payload) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(ownerWindow, {
      title: "上传区域角色共生发行方案",
      buttonLabel: "上传并解析",
      filters: [{
        name: "发行方案",
        extensions: ["docx", "pdf", "md", "txt"],
      }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true, data: releaseWorkspaceStore.snapshot() };
    }
    const filePath = result.filePaths[0];
    const parsed = await parseCampaignDocument({
      fileName: path.basename(filePath),
      buffer: fs.readFileSync(filePath),
      now: new Date().toISOString(),
    });
    const imported = releaseWorkspaceStore.importReleasePlan(
      payload?.regionId,
      parsed,
      payload?.taskId,
    );
    return {
      canceled: false,
      data: imported.snapshot,
      taskId: imported.taskId,
      source: imported.source,
    };
  });
  ipcMain.handle("release:import-audience", (_event, payload) =>
    releaseWorkspaceStore.importAudience(payload?.regionId, payload?.taskId, payload?.text));
  ipcMain.handle("release:import-audience-file", async (event, payload) => {
    const text = await readImportFile(event, "导入匿名玩家聚合数据");
    if (text === null) return { canceled: true, data: releaseWorkspaceStore.snapshot() };
    return {
      canceled: false,
      data: releaseWorkspaceStore.importAudience(payload?.regionId, payload?.taskId, text),
    };
  });
  ipcMain.handle("release:generate-directive", (_event, payload) =>
    releaseWorkspaceStore.generateDirective(payload?.regionId, payload?.taskId, payload?.input));
  ipcMain.handle("release:set-directive-path-paused", (_event, payload) =>
    releaseWorkspaceStore.setDirectivePathPaused(
      payload?.regionId, payload?.directiveId, payload?.pathId, payload?.paused,
    ));
  ipcMain.handle("release:review-directive", (_event, payload) =>
    releaseWorkspaceStore.reviewDirective(
      payload?.regionId, payload?.directiveId, payload?.decision, payload?.note,
    ));
  ipcMain.handle("release:save-experiment", (_event, payload) =>
    releaseWorkspaceStore.saveExperiment(payload?.regionId, payload?.input));
  ipcMain.handle("release:publish-to-agents", (_event, payload) =>
    releaseWorkspaceStore.publishToAgents(
      payload?.regionId, payload?.directiveId, payload?.experimentId,
    ));
  const deliverPublishedPlanToCompanion = (
    releaseSnapshot,
    regionId,
    taskId,
    exampleMode,
  ) => {
    const workspace = releaseSnapshot.workspaces[regionId];
    const planRelease = workspace?.planReleases.find(
      (item) => item.taskId === taskId && (item.exampleMode === true) === exampleMode,
    );
    const bundle = workspace?.bundles.find(
      (item) => item.id === planRelease?.bundleId,
    );
    if (planRelease && bundle?.payload) {
      companionStore.reloadFromDisk();
      const before = companionStore.getSnapshot();
      const beforeReleaseId = latestRegionalReleaseMessage(before)?.id;
      const companionData = companionStore.receiveRegionalReleasePlan({
        sourceId: planRelease.id,
        taskId: planRelease.taskId,
        regionId: planRelease.regionId,
        rolloutPercent: planRelease.rolloutPercent,
        region: bundle.payload.region,
        plan: bundle.payload.plan,
        source: bundle.payload.source,
        exampleMode,
      });
      notifyCompanionDataChanged(companionData);
      const nextRelease = latestRegionalReleaseMessage(companionData);
      if (nextRelease && nextRelease.id !== beforeReleaseId) {
        showPetWindow();
      }
    }
    return releaseSnapshot;
  };
  ipcMain.handle("release:publish-plan-to-agents", (_event, payload) => {
    const releaseSnapshot = releaseWorkspaceStore.publishPlanToAgents(
      payload?.regionId,
      payload?.taskId,
      payload?.rolloutPercent,
    );
    return deliverPublishedPlanToCompanion(
      releaseSnapshot,
      payload?.regionId,
      payload?.taskId,
      false,
    );
  });
  ipcMain.handle("release:publish-example-plan", (_event, payload) => {
    const releaseSnapshot = releaseWorkspaceStore.publishPlanToAgents(
      payload?.regionId,
      payload?.taskId,
      100,
      { exampleMode: true },
    );
    return deliverPublishedPlanToCompanion(
      releaseSnapshot,
      payload?.regionId,
      payload?.taskId,
      true,
    );
  });
  ipcMain.handle("release:set-experiment-group-paused", (_event, payload) =>
    releaseWorkspaceStore.setExperimentGroupPaused(
      payload?.regionId, payload?.experimentId, payload?.groupId, payload?.paused,
    ));
  ipcMain.handle("release:import-metrics", (_event, payload) =>
    releaseWorkspaceStore.importMetrics(
      payload?.regionId, payload?.experimentId, payload?.text,
    ));
  ipcMain.handle("release:import-metrics-file", async (event, payload) => {
    const text = await readImportFile(event, "导入每日聚合实验指标");
    if (text === null) return { canceled: true, data: releaseWorkspaceStore.snapshot() };
    return {
      canceled: false,
      data: releaseWorkspaceStore.importMetrics(
        payload?.regionId, payload?.experimentId, text,
      ),
    };
  });
  ipcMain.handle("release:set-experiment-stage", (_event, payload) =>
    releaseWorkspaceStore.setExperimentStage(
      payload?.regionId, payload?.experimentId, payload?.action,
    ));
  ipcMain.handle("release:set-emergency-stop", (_event, payload) =>
    releaseWorkspaceStore.setEmergencyStop(
      payload?.regionId, payload?.enabled, payload?.reason,
    ));
  ipcMain.handle("release:create-optimization", (_event, payload) =>
    releaseWorkspaceStore.createOptimization(
      payload?.regionId, payload?.experimentId, payload?.reason,
    ));
  ipcMain.handle("release:export-bundle", async (event, payload) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(ownerWindow, {
      title: "导出不可变发布包",
      defaultPath: `march7th-release-${payload?.regionId}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true, data: releaseWorkspaceStore.snapshot() };
    }
    const created = releaseWorkspaceStore.createBundle(
      payload?.regionId, payload?.directiveId,
    );
    fs.writeFileSync(result.filePath, `${JSON.stringify(created.bundle, null, 2)}\n`, "utf8");
    return { canceled: false, filePath: result.filePath, data: created.snapshot };
  });
  ipcMain.handle("release:deliver-test", (_event, payload) => {
    const created = releaseWorkspaceStore.createBundle(
      payload?.regionId, payload?.directiveId,
    );
    const directive = created.bundle.payload.directive;
    const selectedPath = directive.paths.find((item) => item.id === payload?.pathId);
    if (!selectedPath) throw new Error("测试路径不存在。");
    companionStore.deliverReleaseTestMessage({
      title: directive.theme,
      body: selectedPath.opening,
      sourceId: directive.id,
    });
    return created.snapshot;
  });
}

function playerDataAfter(action) {
  action();
  return companionStore.getPlayerSnapshot();
}

function localMemoryCandidates(episodes) {
  const candidates = [];
  const rules = [
    {
      category: "preferred_name",
      pattern: /(?:我叫|叫我|称呼我为)\s*([^\s，。！？,.!?]{1,16})/i,
      title: "玩家希望使用的称呼",
      tags: ["称呼"],
    },
    {
      category: "explicit_preference",
      pattern: /我(?:很|最|比较|特别)?(?:喜欢|爱|偏好)\s*([^，。！？,.!?]{1,40})/i,
      title: "玩家明确表达的偏好",
      tags: ["偏好"],
    },
    {
      category: "interaction_habit",
      pattern: /我(?:通常|一般|经常|习惯|喜欢在)\s*([^，。！？,.!?]{2,48})/i,
      title: "玩家明确表达的习惯",
      tags: ["习惯"],
    },
    {
      category: "shared_experience",
      pattern: /(?:记得|下次|以后)(?:咱们|我们|一起)\s*([^，。！？,.!?]{2,48})/i,
      title: "与三月七约定的共同经历",
      tags: ["共同经历"],
    },
  ];
  for (const episode of episodes) {
    for (const rule of rules) {
      const summary = episode.userSummary.match(rule.pattern)?.[1]?.trim();
      if (summary) {
        candidates.push({
          category: rule.category,
          title: rule.title,
          summary,
          confidence: 0.82,
          tags: rule.tags,
        });
        break;
      }
    }
  }
  return candidates.slice(0, 5);
}

function parseMemoryRefinement(content) {
  const cleaned = String(content ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/u, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  return Array.isArray(parsed) ? parsed : parsed.memories;
}

async function refineConversationMemory() {
  if (memoryRefinementRunning) return;
  const episodes = companionStore.getPendingMemoryEpisodes(12);
  if (episodes.length === 0) return;
  memoryRefinementRunning = true;
  try {
    let candidates;
    const settings = aiSettingsStore.getPublicSettings();
    if (settings.hasApiKey) {
      try {
        const result = await requestDeepSeekChat({
          apiKey: aiSettingsStore.getApiKey(),
          model: settings.model,
          thinking: false,
          systemPrompt:
            "你是隐私优先的记忆提炼器。只提取玩家明确说出的稳定称呼、偏好、互动习惯或共同约定；不得推断健康、经济、家庭、身份、情绪或消费意愿。输出 JSON 数组，每项仅含 category、title、summary、confidence、tags；不确定则输出 []。",
          messages: [
            {
              role: "user",
              content: JSON.stringify(
                episodes.map((episode) => ({
                  id: episode.id,
                  user: episode.userSummary,
                })),
              ),
            },
          ],
        });
        candidates = parseMemoryRefinement(result.content);
      } catch {
        candidates = localMemoryCandidates(episodes);
      }
    } else {
      candidates = localMemoryCandidates(episodes);
    }
    companionStore.applyMemoryRefinement(
      candidates,
      episodes.map((episode) => episode.id),
    );
    notifyCompanionDataChanged(companionStore.getPlayerSnapshot());
  } finally {
    memoryRefinementRunning = false;
  }
}

function scheduleMemoryRefinement() {
  clearTimeout(memoryRefinementTimer);
  const pending = companionStore.getPendingMemoryEpisodes(3);
  if (pending.length >= 3) {
    void refineConversationMemory();
    return;
  }
  memoryRefinementTimer = setTimeout(
    () => void refineConversationMemory(),
    30_000,
  );
}

function registerCompanionHandlers() {
  ipcMain.handle("companion:get-data", () =>
    companionStore.getPlayerSnapshot(),
  );
  ipcMain.handle("companion:get-skill-profile", () =>
    companionStore.getSkillProfile(),
  );
  ipcMain.handle("companion:complete-onboarding", (_event, input) =>
    playerDataAfter(() => companionStore.completeOnboarding(input)),
  );
  ipcMain.handle("companion:save-preferences", (_event, input) =>
    playerDataAfter(() => companionStore.saveCompanionPreferences(input)),
  );
  ipcMain.handle("companion:set-paused", (_event, paused) => {
    companionStore.setCompanionPaused(paused);
    rebuildTrayMenu();
    return companionStore.getPlayerSnapshot();
  });
  ipcMain.handle("companion:exit", () => {
    companionStore.exitCompanion();
    rebuildTrayMenu();
    return companionStore.getPlayerSnapshot();
  });
  ipcMain.handle("companion:delete-relationship-data", () => {
    companionStore.deleteRelationshipData();
    rebuildTrayMenu();
    return companionStore.getPlayerSnapshot();
  });
  ipcMain.handle("companion:reset-demo", () =>
    playerDataAfter(() => companionStore.resetDemo()),
  );
  ipcMain.handle("companion:set-memory-reusable", (_event, payload) =>
    playerDataAfter(() =>
      companionStore.setMemoryReusable(
        payload?.memoryId,
        payload?.reusable,
      ),
    ),
  );
  ipcMain.handle("companion:set-memory-enabled", (_event, enabled) =>
    playerDataAfter(() => companionStore.setMemoryEnabled(enabled)),
  );
  ipcMain.handle("companion:record-conversation-turn", (_event, payload) => {
    const episode = companionStore.recordConversationTurn(payload);
    if (episode) scheduleMemoryRefinement();
    return companionStore.getPlayerSnapshot();
  });
  ipcMain.handle("companion:propose-memory-candidate", (_event, payload) =>
    companionStore.proposeChatMemoryCandidate(
      payload?.text,
      payload?.sourceId,
    ),
  );
  ipcMain.handle("companion:resolve-memory-candidate", (_event, payload) =>
    playerDataAfter(() =>
      companionStore.resolveMemoryCandidate(
        payload?.memoryId,
        payload?.confirmed,
      ),
    ),
  );
  ipcMain.handle(
    "companion:set-memory-campaign-reusable",
    (_event, payload) =>
      playerDataAfter(() =>
        companionStore.setMemoryCampaignReusable(
          payload?.memoryId,
          payload?.reusable,
        ),
      ),
  );
  ipcMain.handle("companion:delete-memory", (_event, memoryId) =>
    playerDataAfter(() => companionStore.deleteMemory(memoryId)),
  );
  ipcMain.handle("companion:clear-memories", () =>
    playerDataAfter(() => companionStore.clearMemories()),
  );
  ipcMain.handle("companion:create-photo-memory", () =>
    playerDataAfter(() => companionStore.createPhotoMemory()),
  );
  ipcMain.handle("companion:export-memories", async (event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(ownerWindow, {
      title: "导出共同旅行记忆",
      defaultPath: path.join(
        app.getPath("documents"),
        "march7th-companion-memories.json",
      ),
      buttonLabel: "导出",
      filters: [
        {
          name: "JSON",
          extensions: ["json"],
        },
      ],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) {
      return {
        ok: false,
        canceled: true,
      };
    }

    fs.writeFileSync(
      result.filePath,
      `${JSON.stringify(companionStore.getMemoryExport(), null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    return {
      ok: true,
      filePath: result.filePath,
    };
  });
  ipcMain.handle("companion:export-data", async (event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(ownerWindow, {
      title: "导出角色同行本地数据",
      defaultPath: path.join(
        app.getPath("documents"),
        "march7th-companion-data-export.json",
      ),
      buttonLabel: "导出",
      filters: [
        {
          name: "JSON",
          extensions: ["json"],
        },
      ],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) {
      return {
        ok: false,
        canceled: true,
      };
    }
    fs.writeFileSync(
      result.filePath,
      `${JSON.stringify(companionStore.getPrivacyExport(), null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    return {
      ok: true,
      filePath: result.filePath,
    };
  });
  ipcMain.handle("companion:mark-message-read", (_event, messageId) =>
    playerDataAfter(() => companionStore.markMessageRead(messageId)),
  );
  ipcMain.handle(
    "companion:set-message-favorite",
    (_event, payload) =>
      playerDataAfter(() =>
        companionStore.setMessageFavorite(
          payload?.messageId,
          payload?.favorite,
        ),
      ),
  );
  ipcMain.handle("companion:set-message-liked", (_event, payload) =>
    playerDataAfter(() =>
      companionStore.setMessageLiked(
        payload?.messageId,
        payload?.liked,
      ),
    ),
  );
  ipcMain.handle(
    "companion:set-message-remind-later",
    (_event, payload) =>
      playerDataAfter(() =>
        companionStore.setMessageRemindLater(
          payload?.messageId,
          payload?.remindLater,
        ),
      ),
  );
  ipcMain.handle("companion:respond-to-message", (_event, payload) =>
    playerDataAfter(() =>
      companionStore.respondToMessage(
        payload?.messageId,
        payload?.response,
      ),
    ),
  );
  ipcMain.handle("companion:get-contact-policy-status", () =>
    companionStore.getContactPolicyStatus(),
  );
  ipcMain.handle("companion:queue-event", (_event, input) =>
    playerDataAfter(() => companionStore.queueRelationshipEvent(input)),
  );
  ipcMain.handle("companion:evaluate-event", (_event, eventId) =>
    playerDataAfter(() => companionStore.evaluateContactEvent(eventId)),
  );
  ipcMain.handle("companion:register-ignored-contact", () =>
    playerDataAfter(() => companionStore.registerIgnoredContact()),
  );
  ipcMain.handle("companion:register-player-interaction", () =>
    playerDataAfter(() => companionStore.registerPlayerInteraction()),
  );
  ipcMain.handle("companion:create-campaign", (_event, input) =>
    companionStore.createCampaign(input),
  );
  ipcMain.handle(
    "companion:update-campaign",
    (_event, payload) =>
      companionStore.updateCampaign(
        payload?.campaignId,
        payload?.input,
      ),
  );
  ipcMain.handle(
    "companion:submit-campaign-review",
    (_event, campaignId) =>
      companionStore.submitCampaignReview(campaignId),
  );
  ipcMain.handle(
    "companion:review-campaign",
    (_event, payload) =>
      companionStore.reviewCampaign(
        payload?.campaignId,
        payload?.input,
      ),
  );
  ipcMain.handle(
    "companion:set-campaign-lifecycle",
    (_event, payload) =>
      companionStore.setCampaignLifecycle(
        payload?.campaignId,
        payload?.action,
      ),
  );
  ipcMain.handle(
    "companion:generate-campaign-message",
    async (_event, payload) => {
      const snapshot = companionStore.getOperatorSnapshot();
      const campaign = snapshot.campaigns.find(
        (item) => item.id === payload?.campaignId,
      );
      if (!campaign) throw new Error("发行任务不存在。");
      if (campaign.generationMode !== "limited_generation") {
        return companionStore.generateCampaignMessage(
          payload?.campaignId,
          payload?.phase,
        );
      }
      const settings = aiSettingsStore.getPublicSettings();
      if (!settings.hasApiKey) {
        throw new Error("有限生成需要先配置 DeepSeek API Key。");
      }
      const context = buildCampaignGenerationContext({
        data: snapshot,
        campaign,
        phase: payload?.phase,
        now: snapshot.demoNow,
      });
      if (!context.facts.length) {
        throw new Error("没有已锁定并审核的发行事实。");
      }
      serviceBudgetStore.authorize("deepseek", {
        characters: JSON.stringify(context).length,
      });
      try {
        const candidate = await generateCampaignCandidate({
          requestChat: requestDeepSeekChat,
          apiKey: aiSettingsStore.getApiKey(),
          model: settings.model,
          context,
        });
        serviceBudgetStore.recordSuccess("deepseek");
        return companionStore.generateCampaignMessage(
          payload?.campaignId,
          payload?.phase,
          candidate,
        );
      } catch (error) {
        serviceBudgetStore.recordFailure("deepseek", error?.code);
        throw error;
      }
    },
  );
  ipcMain.handle(
    "companion:run-message-automatic-review",
    (_event, messageId) =>
      companionStore.runMessageAutomaticReview(messageId),
  );
  ipcMain.handle(
    "companion:review-campaign-message",
    (_event, payload) =>
      companionStore.reviewCampaignMessage(
        payload?.messageId,
        payload?.input,
      ),
  );
  ipcMain.handle(
    "companion:deliver-campaign-message",
    (_event, messageId) =>
      companionStore.deliverCampaignMessage(messageId),
  );
  ipcMain.handle("companion:get-demo-scenarios", () =>
    companionStore.getDemoScenarios(),
  );
  ipcMain.handle(
    "companion:load-demo-scenario",
    (_event, scenarioId) =>
      companionStore.loadDemoScenario(scenarioId),
  );
  ipcMain.handle("companion:advance-demo-time", (_event, input) =>
    companionStore.advanceDemoTime(input),
  );
  ipcMain.handle("companion:trigger-demo-action", (_event, action) =>
    companionStore.triggerDemoAction(action),
  );
}

function registerTtsHandlers() {
  ipcMain.handle("tts:get-settings", () =>
    ttsSettingsStore.getPublicSettings(),
  );
  ipcMain.handle("tts:save-settings", (_event, input) =>
    ttsSettingsStore.save(input),
  );
  ipcMain.handle("tts:clear-key", () => ttsSettingsStore.clearApiKey());

  ipcMain.handle("tts:test", async () => {
    try {
      const settings = ttsSettingsStore.getPublicSettings();
      if (!settings.voiceRightsConfirmed) {
        return {
          ok: false,
          error: "请先确认你拥有该声音样本和复刻音色的使用授权。",
          code: "VOICE_RIGHTS_UNCONFIRMED",
        };
      }
      if (!settings.hasApiKey) {
        return {
          ok: false,
          error: "请先配置 DashScope API Key。",
          code: "API_KEY_MISSING",
        };
      }
      const testText = "嗨，开拓者！三月七的语音已经准备好啦！";
      serviceBudgetStore.authorize("dashscope", {
        characters: testText.length,
      });
      const result = await synthesizeCosyVoice({
        apiKey: ttsSettingsStore.getApiKey(),
        text: testText,
        config: ttsConfig,
        rate: settings.rate,
      });
      serviceBudgetStore.recordSuccess("dashscope");
      return { ok: true, ...result };
    } catch (error) {
      serviceBudgetStore.recordFailure(
        "dashscope",
        error?.code,
      );
      return {
        ok: false,
        error: error?.message || "CosyVoice 试听失败。",
        code: error?.code,
      };
    }
  });

  ipcMain.handle("tts:synthesize", async (_event, payload) => {
    try {
      const settings = ttsSettingsStore.getPublicSettings();
      if (!settings.voiceRightsConfirmed) {
        return {
          ok: false,
          error: "语音授权尚未确认。",
          code: "VOICE_RIGHTS_UNCONFIRMED",
        };
      }
      if (!settings.enabled) {
        return {
          ok: false,
          error: "语音输出当前已关闭。",
          code: "TTS_DISABLED",
        };
      }
      if (!settings.hasApiKey) {
        return {
          ok: false,
          error: "请先配置 DashScope API Key。",
          code: "API_KEY_MISSING",
        };
      }

      const mood =
        typeof payload?.mood === "string" ? payload.mood : "bright";
      serviceBudgetStore.authorize("dashscope", {
        characters:
          typeof payload?.text === "string"
            ? payload.text.length
            : 0,
      });
      const result = await synthesizeCosyVoice({
        apiKey: ttsSettingsStore.getApiKey(),
        text: payload?.text,
        config: ttsConfig,
        rate: settings.rate,
        instruction:
          TTS_INSTRUCTIONS[mood] || ttsConfig.defaultInstruction,
      });
      serviceBudgetStore.recordSuccess("dashscope");
      return { ok: true, ...result };
    } catch (error) {
      serviceBudgetStore.recordFailure(
        "dashscope",
        error?.code,
      );
      return {
        ok: false,
        error: error?.message || "CosyVoice 语音生成失败。",
        code: error?.code,
      };
    }
  });

  ipcMain.handle("tts:start-stream", (event, payload) => {
    const requestId =
      typeof payload?.requestId === "string"
        ? payload.requestId.trim()
        : "";
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) {
      return {
        ok: false,
        error: "语音请求标识不正确。",
        code: "INVALID_REQUEST_ID",
      };
    }

    const settings = ttsSettingsStore.getPublicSettings();
    if (!settings.voiceRightsConfirmed) {
      return {
        ok: false,
        error: "语音授权尚未确认。",
        code: "VOICE_RIGHTS_UNCONFIRMED",
      };
    }
    if (!settings.enabled) {
      return {
        ok: false,
        error: "语音输出当前已关闭。",
        code: "TTS_DISABLED",
      };
    }
    if (!settings.hasApiKey) {
      return {
        ok: false,
        error: "请先配置 DashScope API Key。",
        code: "API_KEY_MISSING",
      };
    }
    try {
      serviceBudgetStore.authorize("dashscope", {
        characters:
          typeof payload?.text === "string"
            ? payload.text.length
            : 0,
      });
    } catch (error) {
      return {
        ok: false,
        error: error?.message || "语音调用额度暂时不可用。",
        code: error?.code,
      };
    }

    activeTtsStreams.get(requestId)?.controller.abort();
    const controller = new AbortController();
    const sender = event.sender;
    const streamSession = { controller, sender };
    activeTtsStreams.set(requestId, streamSession);
    const sendStreamEvent = (streamEvent) => {
      if (
        activeTtsStreams.get(requestId) === streamSession &&
        !sender.isDestroyed()
      ) {
        sender.send("tts:stream-event", {
          requestId,
          ...streamEvent,
        });
      }
    };

    const mood =
      typeof payload?.mood === "string" ? payload.mood : "bright";
    sendStreamEvent({
      type: "started",
      sampleRate: ttsConfig.sampleRate || 24_000,
    });

    void streamCosyVoice({
      apiKey: ttsSettingsStore.getApiKey(),
      text: payload?.text,
      config: ttsConfig,
      rate: settings.rate,
      instruction:
        TTS_INSTRUCTIONS[mood] || ttsConfig.defaultInstruction,
      signal: controller.signal,
      onAudioChunk: (chunk) =>
        sendStreamEvent({
          type: "audio",
          ...chunk,
        }),
      onSentence: (sentence) =>
        sendStreamEvent({
          type: "sentence",
          ...sentence,
        }),
    })
      .then((result) => {
        serviceBudgetStore.recordSuccess("dashscope");
        sendStreamEvent({
          type: "complete",
          ...result,
        });
      })
      .catch((error) => {
        serviceBudgetStore.recordFailure(
          "dashscope",
          error?.code,
        );
        sendStreamEvent(
          error?.code === "CANCELLED"
            ? { type: "canceled" }
            : {
                type: "error",
                error: error?.message || "CosyVoice 流式语音生成失败。",
                code: error?.code,
              },
        );
      })
      .finally(() => {
        if (activeTtsStreams.get(requestId) === streamSession) {
          activeTtsStreams.delete(requestId);
        }
      });

    return {
      ok: true,
      requestId,
      sampleRate: ttsConfig.sampleRate || 24_000,
    };
  });

  ipcMain.handle("tts:cancel-stream", (_event, requestId) => {
    if (typeof requestId !== "string") return false;
    const streamSession = activeTtsStreams.get(requestId);
    if (!streamSession) return false;
    streamSession.controller.abort();
    return true;
  });
}

function createOperatorWindow() {
  if (operatorWindow && !operatorWindow.isDestroyed()) {
    operatorWindow.show();
    operatorWindow.focus();
    return;
  }
  operatorWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1180,
    minHeight: 700,
    title: "三月七角色发行控制台",
    backgroundColor: "#f5f8fa",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "operator-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  operatorWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    operatorWindow?.setTitle("三月七角色发行控制台");
  });
  operatorWindow.once("ready-to-show", () => {
    operatorWindow?.maximize();
    operatorWindow?.show();
  });
  operatorWindow.webContents.on("did-fail-load", () => {
    operatorWindow?.show();
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    operatorWindow.loadURL(`${devUrl}?surface=operator`);
  } else {
    operatorWindow.loadFile(
      path.join(__dirname, "..", "dist", "index.html"),
      { query: { surface: "operator" } },
    );
  }
  operatorWindow.on("closed", () => {
    operatorWindow = undefined;
  });
}

function recoverPetRenderer(reason) {
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;
  cancelActiveTtsStreams();
  petRendererHeartbeatAt = Date.now();
  petRendererHeartbeatSeen = false;
  console.warn(`Recovering pet renderer: ${reason}`);
  petWindow.webContents.reloadIgnoringCache();
}

function startPetRendererWatchdog() {
  clearInterval(petRendererWatchdog);
  petRendererWatchdog = setInterval(() => {
    if (
      petWindow &&
      !petWindow.isDestroyed() &&
      petWindow.isVisible() &&
      petRendererHeartbeatSeen &&
      Date.now() - petRendererHeartbeatAt > 25_000
    ) {
      recoverPetRenderer("heartbeat_timeout");
    }
  }, 10_000);
}

function createPetWindow() {
  petRendererHeartbeatAt = Date.now();
  petRendererHeartbeatSeen = false;
  const storedState = windowStateStore.getSnapshot();
  windowMode = "pet";
  petDefaultScale = fitPetScaleToDisplay(
    storedState.petDefaultScale,
    storedState.bounds,
  );
  petScale = fitPetScaleToDisplay(
    storedState.petScale,
    storedState.bounds,
  );
  const petSize = currentSize();
  const initialBounds = constrainAndSnapBounds(
    {
      ...storedState.bounds,
      width: petSize.width,
      height: petSize.height,
    },
    getWorkAreas(),
    { snap: storedState.snapEnabled },
  );
  isPinned = storedState.pinned;

  petWindow = new BrowserWindow({
    ...initialBounds,
    width: petSize.width,
    height: petSize.height,
    minWidth: PET_MIN_SIZE.width,
    minHeight: PET_MIN_SIZE.height,
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: isPinned,
    // 桌宠不允用户拖边缩放（尺寸由设置页或 PET/PANEL 模式决定）。
    // 注意：真正引发 Windows 拖拽放大的是「创建后调用 setBounds」(DWM 重施加
    // 边框厚度)，与 resizable 无关。resizable:false 只用于禁止用户拖边缩放。
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    backgroundColor: "#00000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  petWindow.setAlwaysOnTop(isPinned, "floating");
  petWindow.setIgnoreMouseEvents(false);

  if (process.platform === "darwin") {
    petWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    petWindow.loadURL(devUrl);
  } else {
    petWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  petWindow.once("ready-to-show", () => {
    petRendererHeartbeatAt = Date.now();
    petWindow?.show();
  });
  petWindow.on("unresponsive", () =>
    recoverPetRenderer("browser_window_unresponsive"),
  );
  petWindow.webContents.on("render-process-gone", (_event, details) =>
    recoverPetRenderer(`render_process_gone:${details.reason}`),
  );
  petWindow.on("move", scheduleWindowStateWrite);
  petWindow.on("resize", scheduleWindowStateWrite);
  petWindow.on("close", (event) => {
    clearTimeout(windowStateWriteTimer);
    persistWindowState();
    if (!isQuitting && tray && !tray.isDestroyed()) {
      event.preventDefault();
      cancelActiveTtsStreams();
      petWindow?.hide();
    }
  });
  petWindow.on("closed", () => {
    cancelActiveTtsStreams();
    petWindow = undefined;
  });
}

ipcMain.on("window:minimize", () => petWindow?.minimize());
ipcMain.on("window:close", (event) =>
  BrowserWindow.fromWebContents(event.sender)?.close(),
);
ipcMain.handle("window:toggle-pin", () => {
  return setPinned(!isPinned);
});
ipcMain.handle("window:get-position", (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  return senderWindow?.getPosition() ?? [0, 0];
});
ipcMain.on("window:move-to", (event, position) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const x = Number(position?.x);
  const y = Number(position?.y);
  if (
    !senderWindow ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    Math.abs(x) > 100_000 ||
    Math.abs(y) > 100_000
  ) {
    return;
  }
  const size = currentSize();
  const nextBounds = constrainAndSnapBounds(
    { x: Math.round(x), y: Math.round(y), width: size.width, height: size.height },
    getWorkAreas(),
    { snap: false },
  );
  // 重新断言当前模式尺寸：setPosition/setBounds 都会让 width 每次 +1，
  // 只有每次都把尺寸重设回去才能把那 1px 纠正回来，阻止累积。
  senderWindow.setBounds(
    { x: nextBounds.x, y: nextBounds.y, width: size.width, height: size.height },
    false,
  );
});
ipcMain.handle("window:end-move", (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return getDesktopStatus();
  if (windowMode === "pet") {
    petScale = fitPetScaleToDisplay(
      petScale,
      senderWindow.getBounds(),
    );
  }
  const status = getDesktopStatus();
  const size = currentSize();
  const current = senderWindow.getBounds();
  const nextBounds = constrainAndSnapBounds(
    { x: current.x, y: current.y, width: size.width, height: size.height },
    getWorkAreas(),
    { snap: status.snapEnabled },
  );
  senderWindow.setBounds(
    { x: nextBounds.x, y: nextBounds.y, width: size.width, height: size.height },
    false,
  );
  persistWindowState();
  return getDesktopStatus();
});
ipcMain.handle("window:set-mode", (event, mode) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow || (mode !== "pet" && mode !== "panel")) {
    return getDesktopStatus();
  }
  // 切模式：更新当前模式，用新尺寸重设窗口（保持左上角 x/y 不变，只扩/缩 w/h）。
  windowMode = mode;
  if (windowMode === "pet") {
    petScale = fitPetScaleToDisplay(
      petScale,
      senderWindow.getBounds(),
    );
  }
  const size = currentSize();
  const current = senderWindow.getBounds();
  const nextBounds = constrainAndSnapBounds(
    { x: current.x, y: current.y, width: size.width, height: size.height },
    getWorkAreas(),
    { snap: false },
  );
  senderWindow.setBounds(
    { x: nextBounds.x, y: nextBounds.y, width: size.width, height: size.height },
    false,
  );
  persistWindowState();
  return getDesktopStatus();
});
ipcMain.handle("window:set-pet-scale", (event, scale) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return getDesktopStatus();

  petScale = fitPetScaleToDisplay(
    normalizePetScale(scale, petScale),
    senderWindow.getBounds(),
  );
  if (windowMode === "pet") {
    const size = currentSize();
    const current = senderWindow.getBounds();
    const nextBounds = constrainAndSnapBounds(
      {
        x: current.x,
        y: current.y,
        width: size.width,
        height: size.height,
      },
      getWorkAreas(),
      { snap: false },
    );
    senderWindow.setBounds(
      {
        x: nextBounds.x,
        y: nextBounds.y,
        width: size.width,
        height: size.height,
      },
      false,
    );
  }
  persistWindowState();
  return getDesktopStatus();
});
ipcMain.handle("window:set-pet-default-scale", (event, scale) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return getDesktopStatus();

  petDefaultScale = fitPetScaleToDisplay(
    normalizePetScale(scale, petDefaultScale),
    senderWindow.getBounds(),
  );
  petScale = petDefaultScale;
  if (windowMode === "pet") {
    const size = currentSize();
    const current = senderWindow.getBounds();
    const nextBounds = constrainAndSnapBounds(
      {
        x: current.x,
        y: current.y,
        width: size.width,
        height: size.height,
      },
      getWorkAreas(),
      { snap: false },
    );
    senderWindow.setBounds(
      {
        x: nextBounds.x,
        y: nextBounds.y,
        width: size.width,
        height: size.height,
      },
      false,
    );
  }
  persistWindowState();
  return getDesktopStatus();
});
ipcMain.handle("window:get-desktop-status", () =>
  getDesktopStatus(),
);
ipcMain.handle("window:set-snap-enabled", (_event, enabled) => {
  windowStateStore.update({
    snapEnabled: enabled === true,
    bounds: petWindow?.getBounds(),
    pinned: isPinned,
  });
  if (enabled === true) keepPetWindowOnScreen();
  rebuildTrayMenu();
  return getDesktopStatus();
});
ipcMain.handle("window:show", (_event, route) => {
  showPetWindow(route);
  return getDesktopStatus();
});
ipcMain.on("window:show-context-menu", (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  buildDesktopMenu().popup({
    window: senderWindow,
  });
});
ipcMain.on("window:renderer-heartbeat", (event) => {
  if (
    petWindow &&
    !petWindow.isDestroyed() &&
    event.sender.id === petWindow.webContents.id
  ) {
    if (!petRendererHeartbeatSeen) {
      console.log("Pet renderer heartbeat connected");
    }
    petRendererHeartbeatSeen = true;
    petRendererHeartbeatAt = Date.now();
  }
});

app.whenReady().then(() => {
  const windowStatePath = path.join(
    app.getPath("userData"),
    "window-state.json",
  );
  const hasStoredWindowState = fs.existsSync(windowStatePath);
  windowStateStore = new WindowStateStore({
    filePath: windowStatePath,
  });
  if (!hasStoredWindowState) {
    const workArea = screen.getPrimaryDisplay().workArea;
    windowStateStore.update({
      bounds: {
        x:
          workArea.x +
          Math.max(
            20,
            workArea.width - PET_DEFAULT_SIZE.width - 20,
          ),
        y:
          workArea.y +
          Math.max(
            20,
            workArea.height - PET_DEFAULT_SIZE.height - 20,
          ),
        ...PET_DEFAULT_SIZE,
      },
    });
  }
  isPinned = windowStateStore.getSnapshot().pinned;
  aiSettingsStore = new AiSettingsStore({
    filePath: path.join(app.getPath("userData"), "ai-settings.json"),
    safeStorage,
  });
  companionStore = new CompanionStore({
    filePath: path.join(app.getPath("userData"), "companion-data.json"),
    skillProfile: march7thSkillProfile,
  });
  releaseSkillLoader = new ReleaseSkillLoader({
    filePath: path.join(
      __dirname,
      "..",
      "shared",
      "skills",
      "march7th-release",
      "SKILL.md",
    ),
    watch: !app.isPackaged,
  });
  companionDataPath = path.join(app.getPath("userData"), "companion-data.json");
  releaseWorkspaceStore = new ReleaseWorkspaceStore({
    filePath: path.join(app.getPath("userData"), "release-workspace.json"),
    legacySnapshot: companionStore.getOperatorSnapshot(),
    legacyFilePath: companionDataPath,
  });
  ttsSettingsStore = new TtsSettingsStore({
    filePath: path.join(app.getPath("userData"), "tts-settings.json"),
    safeStorage,
    config: ttsConfig,
    externalApiKey: readMacOsDashScopeKey(),
  });
  serviceBudgetStore = new ServiceBudgetStore({
    filePath: path.join(
      app.getPath("userData"),
      "service-usage.json",
    ),
  });
  registerAiHandlers();
  registerCompanionHandlers();
  registerOperatorHandlers();
  registerReleaseWorkspaceHandlers();
  registerServiceHandlers();
  registerTtsHandlers();
  if (isOperatorMode) {
    createOperatorWindow();
  } else {
    createTray();
    createPetWindow();
    startPetRendererWatchdog();
    startCompanionDataWatcher();
    if (isAllMode) createOperatorWindow();
  }
  screen.on("display-added", keepPetWindowOnScreen);
  screen.on("display-removed", keepPetWindowOnScreen);
  screen.on("display-metrics-changed", keepPetWindowOnScreen);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (isOperatorMode) {
        createOperatorWindow();
      } else {
        createPetWindow();
        if (isAllMode) createOperatorWindow();
      }
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  if (companionDataPath) fs.unwatchFile(companionDataPath);
  companionDataWatchStarted = false;
  clearTimeout(windowStateWriteTimer);
  clearTimeout(memoryRefinementTimer);
  clearInterval(petRendererWatchdog);
  releaseSkillLoader?.close();
  if (windowStateStore) {
    persistWindowState();
  }
});

app.on("will-quit", () => {
  tray?.destroy();
  tray = undefined;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !tray) {
    app.quit();
  }
});
