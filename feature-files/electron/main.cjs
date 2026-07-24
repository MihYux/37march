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
const {
  ServiceBudgetStore,
} = require("./service-budget.cjs");
const {
  streamCosyVoice,
  synthesizeCosyVoice,
} = require("./tts-client.cjs");
const { TtsSettingsStore } = require("./tts-settings.cjs");
const {
  WindowStateStore,
  constrainAndSnapBounds,
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

// 桌宠固定尺寸。Windows 上对 transparent+frameless 窗口，任何几何调用
// （setPosition / setBounds 都一样）都会让 DWM 重新施加 1px 不可见边框，
// 导致 width 每次 +1。解法：所有几何操作都重新断言这个固定尺寸，涨的那 1px
// 会被下次调用立刻纠正，不再累积。绝不回读 getBounds() 的 width/height。
const PET_WIDTH = 430;
const PET_HEIGHT = 660;
let aiSettingsStore;
let companionStore;
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

function getDesktopStatus() {
  const stored = windowStateStore?.getSnapshot() ?? {
    bounds: petWindow?.getBounds() ?? {
      x: 20,
      y: 20,
      width: 430,
      height: 660,
    },
    pinned: isPinned,
    clickThrough: false,
    snapEnabled: true,
  };
  return {
    ...stored,
    bounds: petWindow?.getBounds() ?? stored.bounds,
    pinned: isPinned,
    trayAvailable: Boolean(tray),
  };
}

function notifyCompanionDataChanged(data) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("companion:data-updated", data);
  }
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
    pinned: isPinned,
  });
}

function scheduleWindowStateWrite() {
  clearTimeout(windowStateWriteTimer);
  windowStateWriteTimer = setTimeout(persistWindowState, 220);
}

function setClickThrough(enabled) {
  const nextEnabled = enabled === true;
  if (nextEnabled && !tray) {
    return {
      ...getDesktopStatus(),
      ok: false,
      error: "系统托盘不可用，无法保证恢复交互，已拒绝开启点击穿透。",
    };
  }
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setIgnoreMouseEvents(nextEnabled, {
      forward: true,
    });
  }
  windowStateStore?.update({
    clickThrough: nextEnabled,
    bounds: petWindow?.getBounds(),
    pinned: isPinned,
  });
  rebuildTrayMenu();
  return {
    ...getDesktopStatus(),
    ok: true,
  };
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
  setClickThrough(false);
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
      label: status.clickThrough ? "恢复窗口交互" : "开启点击穿透",
      enabled: status.clickThrough || status.trayAvailable,
      click: () => setClickThrough(!status.clickThrough),
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
        setClickThrough(false);
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
  // 用固定尺寸计算夹紧位置，并重新断言固定尺寸（见 PET_WIDTH 注释）。
  const current = petWindow.getBounds();
  const nextBounds = constrainAndSnapBounds(
    { x: current.x, y: current.y, width: PET_WIDTH, height: PET_HEIGHT },
    getWorkAreas(),
    { snap: status.snapEnabled },
  );
  petWindow.setBounds(
    { x: nextBounds.x, y: nextBounds.y, width: PET_WIDTH, height: PET_HEIGHT },
    false,
  );
  persistWindowState();
}

function messageCharacterCount(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.slice(-12).reduce(
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
          error: "请先在模型设置中填写 DeepSeek API Key。",
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
          error: "请先在模型设置中填写 DeepSeek API Key。",
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
      const authorizedMemories =
        companionStore.getAuthorizedChatMemories(
          latestUserMessage?.content ?? "",
          3,
        );
      const memoryContext = authorizedMemories.length
        ? `\n\n【玩家已确认且允许引用的记忆】\n${authorizedMemories
            .map(
              (memory) =>
                `- [${memory.id}] ${memory.title}：${memory.summary}`,
            )
            .join("\n")}\n只能在当前话题自然相关时引用；不得声称知道其他信息。`
        : "";
      const result = await requestDeepSeekChat({
        apiKey: aiSettingsStore.getApiKey(),
        model: settings.model,
        thinking: settings.thinking,
        messages: payload?.messages,
        systemPrompt: `${promptConfig.systemPrompt}${memoryContext}`,
      });
      serviceBudgetStore.recordSuccess("deepseek");
      const outputSafety = reviewCharacterOutput(result.content);
      const memoryCandidate = latestUserMessage
        ? companionStore.proposeChatMemoryCandidate(
            latestUserMessage.content,
            `chat-${Date.now()}`,
          )
        : undefined;
      return {
        ok: true,
        ...result,
        content: outputSafety.safeText,
        memoryCandidate: memoryCandidate
          ? {
              id: memoryCandidate.id,
              title: memoryCandidate.title,
              summary: memoryCandidate.summary,
              characterText: memoryCandidate.characterText,
              category: memoryCandidate.category,
            }
          : undefined,
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

function playerDataAfter(action) {
  action();
  return companionStore.getPlayerSnapshot();
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
    minWidth: 1080,
    minHeight: 700,
    title: "三月七角色发行控制台",
    backgroundColor: "#f4f1f7",
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

function createPetWindow() {
  const storedState = windowStateStore.getSnapshot();
  const initialBounds = constrainAndSnapBounds(
    storedState.bounds,
    getWorkAreas(),
    { snap: storedState.snapEnabled },
  );
  isPinned = storedState.pinned;

  petWindow = new BrowserWindow({
    ...initialBounds,
    width: PET_WIDTH,
    height: PET_HEIGHT,
    minWidth: 360,
    minHeight: 540,
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: isPinned,
    // 桌宠为固定尺寸，不允许用户缩放。
    // 注意：真正引发 Windows 拖拽放大的是「创建后调用 setBounds」(DWM 重施加
    // 边框厚度)，与 resizable 无关。resizable:false 只用于固定尺寸语义。
    // 几何不变量见各 setPosition 调用处注释。
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

  petWindow.once("ready-to-show", () => petWindow?.show());
  petWindow.on("move", scheduleWindowStateWrite);
  petWindow.on("resize", scheduleWindowStateWrite);
  petWindow.on("close", (event) => {
    clearTimeout(windowStateWriteTimer);
    setClickThrough(false);
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
  const nextBounds = constrainAndSnapBounds(
    { x: Math.round(x), y: Math.round(y), width: PET_WIDTH, height: PET_HEIGHT },
    getWorkAreas(),
    { snap: false },
  );
  // 重新断言固定尺寸：setPosition/setBounds 都会让 width 每次 +1，
  // 只有每次都把尺寸重设回 430x660 才能把那 1px 纠正回来，阻止累积。
  senderWindow.setBounds(
    { x: nextBounds.x, y: nextBounds.y, width: PET_WIDTH, height: PET_HEIGHT },
    false,
  );
});
ipcMain.handle("window:end-move", (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return getDesktopStatus();
  const status = getDesktopStatus();
  const current = senderWindow.getBounds();
  const nextBounds = constrainAndSnapBounds(
    { x: current.x, y: current.y, width: PET_WIDTH, height: PET_HEIGHT },
    getWorkAreas(),
    { snap: status.snapEnabled },
  );
  senderWindow.setBounds(
    { x: nextBounds.x, y: nextBounds.y, width: PET_WIDTH, height: PET_HEIGHT },
    false,
  );
  persistWindowState();
  return getDesktopStatus();
});
ipcMain.handle("window:get-desktop-status", () =>
  getDesktopStatus(),
);
ipcMain.handle("window:set-click-through", (_event, enabled) =>
  setClickThrough(enabled),
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
        x: workArea.x + Math.max(20, workArea.width - 450),
        y: workArea.y + Math.max(20, workArea.height - 680),
        width: 430,
        height: 660,
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
  registerServiceHandlers();
  registerTtsHandlers();
  if (isOperatorMode) {
    createOperatorWindow();
  } else {
    createTray();
    createPetWindow();
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
  clearTimeout(windowStateWriteTimer);
  if (windowStateStore) {
    setClickThrough(false);
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
